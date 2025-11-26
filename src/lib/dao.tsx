import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { db, ensureUserByAmid, listenUserByAmid, setUserPrefsByAmid } from './firebase'
import {
    collection,
    onSnapshot,
    orderBy,
    query,
    Timestamp,
    serverTimestamp,
    writeBatch,
    doc,
} from 'firebase/firestore'
import { useAuth } from 'amvault-connect'

/* -------------------- debug helpers -------------------- */
function isDebug(): boolean {
    try {
        const sp = new URLSearchParams(window.location.search)
        if (sp.get('debug') === '1') return true
        if (localStorage.getItem('ugov.debug') === '1') return true
        // @ts-ignore
        if (import.meta?.env?.VITE_DEBUG === 'true') return true
    } catch { }
    return false
}
function dlog(...args: any[]) { if (isDebug()) console.log('[uGov]', ...args) }
const LOAD_TIMEOUT_MS = 8000

function friendlyFirestoreError(e: any): string {
    const code = e?.code || e?.name || ''
    if (code.includes('permission-denied')) {
        return 'Permission denied: authenticate or update Firestore rules.'
    }
    if (code.includes('unauthenticated')) {
        return 'Not signed in: please connect and try again.'
    }
    if (code.includes('unavailable') || code.includes('network')) {
        return 'Network/Firestore unavailable: check internet or try again.'
    }
    if (code.includes('failed-precondition')) {
        return 'Failed precondition (index/setting). Verify Firestore indexes/rules.'
    }
    return e?.message || 'Unknown Firestore error'
}

// Which AIN is allowed to manage multiple DAOs
const DAO_ADMIN_AIN = String(import.meta.env.VITE_UGOV_DAO_ADMIN_AIN || '')
    .trim()
    .toLowerCase()

/* -------------------- types & context -------------------- */




export type TrackedToken = {
    address: string
    symbol: string
    decimals?: number
    balance?: number | string
    priceUsd?: number | string
    updatedAt?: Timestamp
}

export type DAO = {
    id: string
    address: string
    name?: string
    about?: string
    isDefault: boolean
    treasury: string
    admin: string
    votesToken: string
    votingDelayBlocks: number
    votingPeriodBlocks: number
    timelockDelaySeconds: number
    quorumBps: number
    createdAt?: Timestamp
    trackedTokens?: TrackedToken[]
}

type DAOContextType = {
    daos: DAO[]
    current: DAO | null
    setCurrent: (d: DAO | null) => void
    createDAO: (data: Omit<DAO, 'id' | 'createdAt'>) => Promise<string>
    loading: boolean
    error: string | null
}

const DAOContext = createContext<DAOContextType>({
    daos: [],
    current: null,
    setCurrent: () => { },
    createDAO: async () => '',
    loading: true,
    error: null,
})

const LS_KEY = 'ugov.currentDaoId'

export function DAOProvider({ children }: { children: React.ReactNode }) {
    const { session } = useAuth()
    const [daos, setDaos] = useState<DAO[]>([])
    const [current, _setCurrent] = useState<DAO | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [hydrated, setHydrated] = useState(false) // first snapshot applied?
    const [userLastDaoId, setUserLastDaoId] = useState<string | null>(null)


    const userAmid = session?.ain ? String(session.ain) : null
    const userWallet = session?.address || undefined
    const [userPrefDaoId, setUserPrefDaoId] = useState<string | null>(null) // NEW
    const userUnsubRef = useRef<null | (() => void)>(null)

    // 🔐 Is this user the DAO super-admin?
    const isDaoAdmin =
        !!session?.ain &&
        !!DAO_ADMIN_AIN &&
        session.ain.trim().toLowerCase() === DAO_ADMIN_AIN// NEW

    // Live list of DAOs with watchdog timeout
    useEffect(() => {
        setLoading(true)
        setError(null)

        const q = query(collection(db, 'daos'), orderBy('createdAt', 'asc'))

        const timeout = setTimeout(() => {
            // If we still haven't received the first snapshot, surface a useful hint
            if (loading) {
                const msg = 'Timeout: DAOs did not load. Check Firebase config, network, or Firestore rules.'
                dlog('DAO snapshot timed out')
                setError(msg)
                setLoading(false)
            }
        }, LOAD_TIMEOUT_MS)

        const unsub = onSnapshot(
            q,
            (snap) => {
                clearTimeout(timeout)
                const raw = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DAO[]

                const rows = raw.filter((r) => {
                    const ok = typeof r.address === 'string' && r.address.length > 0
                    if (!ok) dlog('DAO skipped malformed doc (missing address)', r)
                    return ok
                })

                // 🔐 Visibility filter:
                // - Admin AIN: sees ALL DAOs
                // - Everyone else: only default DAO(s), or first DAO as fallback
                let visible = rows
                if (!isDaoAdmin) {
                    const defaults = rows.filter(d => d.isDefault)
                    visible = defaults.length ? defaults : rows.slice(0, 1)
                }

                dlog('DAO snapshot OK', {
                    count: visible.length,
                    ids: visible.map(r => r.id),
                    isDaoAdmin,
                })
                setDaos(visible)
                setLoading(false)
            },

            (e) => {
                clearTimeout(timeout)
                console.error('[uGov] Firestore onSnapshot error', e)
                setError(friendlyFirestoreError(e))
                setLoading(false)
            }
        )
        return () => {
            clearTimeout(timeout)
            dlog('DAO snapshot unsubscribed')
            unsub()
        }
    }, [isDaoAdmin])

    // Listen to user prefs (AIN) and keep userPrefDaoId fresh                  // NEW
    useEffect(() => {
        // clear any prior listener
        if (userUnsubRef.current) { userUnsubRef.current(); userUnsubRef.current = null }
        setUserPrefDaoId(null)

        if (!session?.ain) return
        userUnsubRef.current = listenUserByAmid(session.ain, (u) => {
            const last = u?.prefs?.lastOpenDaoId || null
            setUserPrefDaoId(last)
        })
        return () => { if (userUnsubRef.current) userUnsubRef.current(); userUnsubRef.current = null }
    }, [session?.ain])

    // Initial pick order: user prefs → localStorage → default → first
    useEffect(() => {
        if (loading) return
        if (hydrated) {
            // If current disappears (deleted), refallback
            if (current && !daos.some(d => d.id === current.id)) {
                const fb = daos.find(d => d.isDefault) ?? daos[0] ?? null
                _setCurrent(fb)
                if (fb) localStorage.setItem(LS_KEY, fb.id); else localStorage.removeItem(LS_KEY)
            }
            return
        }

        // Only runs once after the first usable DAOs list is in
        const saved = localStorage.getItem(LS_KEY)
        const pick =
            (userPrefDaoId && daos.find(d => d.id === userPrefDaoId)) ||      // 1) user prefs
            (saved && daos.find(d => d.id === saved)) ||                      // 2) local storage
            daos.find(d => d.isDefault) ||                                    // 3) default
            daos[0] ||                                                        // 4) first
            null

        _setCurrent(pick)
        if (pick) localStorage.setItem(LS_KEY, pick.id)
        else localStorage.removeItem(LS_KEY)
        setHydrated(true)
    }, [loading, hydrated, daos, current, userPrefDaoId]) // include userPrefDaoId  // NEW

    const setCurrent = (d: DAO | null) => {
        if (d) localStorage.setItem(LS_KEY, d.id)
        else localStorage.removeItem(LS_KEY)
        _setCurrent(d)
    }


    // Ensure user doc + listen for prefs
    useEffect(() => {
        if (!userAmid) { setUserLastDaoId(null); return }
        let unsub = () => { }
            ; (async () => {
                try {
                    await ensureUserByAmid(userAmid, userWallet) // upsert + track latest wallet
                } catch (e) {
                    console.warn('[DAOProvider] ensureUserByAmid failed:', e)
                }
                unsub = listenUserByAmid(userAmid, (udoc) => {
                    const last = udoc?.prefs?.lastOpenDaoId || null
                    setUserLastDaoId(last)
                })
            })()
        return () => unsub()
    }, [userAmid, userWallet])


    const createDAO = async (data: Omit<DAO, 'id' | 'createdAt'>) => {
        if (!isDaoAdmin) {
            const err = new Error('Only the DAO admin can create new DAOs.')
            console.warn('[uGov] createDAO blocked for non-admin AIN', { ain: session?.ain })
            setError(err.message)
            throw err
        }
        try {
            const makeDefault = daos.length === 0 || data.isDefault === true

            const batch = writeBatch(db)
            const col = collection(db, 'daos')
            const ref = doc(col) // pre-generate ID

            if (makeDefault && daos.length > 0) {
                daos.forEach((d) => {
                    batch.update(doc(db, 'daos', d.id), { isDefault: false })
                })
            }

            batch.set(ref, { ...data, isDefault: makeDefault ? true : !!data.isDefault, createdAt: serverTimestamp() })
            await batch.commit()

            dlog('DAO created', { id: ref.id, makeDefault })
            localStorage.setItem(LS_KEY, ref.id)
            // Optimistic set; snapshot will follow
            _setCurrent({ id: ref.id, ...data, isDefault: makeDefault } as DAO)
            return ref.id
        } catch (e: any) {
            console.error('[uGov] createDAO error', e)
            setError(e?.message ?? 'Failed to create DAO')
            throw e
        }
    }

    const api = useMemo(
        () => ({
            daos,
            current,
            setCurrent,
            createDAO,
            loading,
            error,
        }),
        [daos, current, loading, error]
    )

    if (isDebug()) {
        // @ts-ignore
        (window as any).__UGOV_DAO = { daos, current, loading, error, hydrated }
    }

    return <DAOContext.Provider value={api}>{children}</DAOContext.Provider>
}

export function useDAO() {
    return useContext(DAOContext)
}
