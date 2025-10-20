// src/lib/useDaoCounts.ts
import { useEffect, useState } from 'react'
import { db } from './firebase'
import { collection, query, where, getCountFromServer } from 'firebase/firestore'

export function useDaoCounts(daoId?: string) {
    const [passed, setPassed] = useState(0)
    const [activeOnchain, setActiveOnchain] = useState(0)
    const [discussion, setDiscussion] = useState(0)
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!daoId) {
            setPassed(0); setActiveOnchain(0); setDiscussion(0); setTotal(0)
            return
        }
        let cancelled = false
            ; (async () => {
                try {
                    setLoading(true); setError(null)
                    const base = collection(db, `daos/${daoId}/proposals`)

                    const qOn = query(base, where('phase', '==', 'onchain'))
                    const qDis = query(base, where('phase', '==', 'discussion'))

                    // NOTE: adjust these statuses if your write-path sets different names
                    const qPassed = query(base, where('status', 'in', [
                        'Approved', 'Succeeded', 'Executed', 'Completed'
                    ]))

                    const [onSnap, disSnap, passSnap] = await Promise.all([
                        getCountFromServer(qOn),
                        getCountFromServer(qDis),
                        getCountFromServer(qPassed),
                    ])

                    const onchain = onSnap.data().count || 0
                    const dis = disSnap.data().count || 0
                    const pass = passSnap.data().count || 0

                    if (!cancelled) {
                        setActiveOnchain(onchain)
                        setDiscussion(dis)
                        setPassed(pass)
                        setTotal(onchain + dis)
                    }
                } catch (e: any) {
                    if (!cancelled) setError(e?.message || 'Failed to load counts')
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()
        return () => { cancelled = true }
    }, [daoId])

    return { passed, activeOnchain, discussion, total, loading, error }
}
