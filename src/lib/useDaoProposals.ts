import { useEffect, useState } from 'react'
import { db } from './firebase'
import { collection, onSnapshot, orderBy, query, where, limit as qlimit } from 'firebase/firestore'
import type { Phase } from './firebase'

export function useDaoProposals(daoId?: string, opts?: { phase?: Phase; limit?: number }) {
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let unsub: (() => void) | undefined
        setLoading(true)
        setError(null)
        setItems([])

        if (!daoId) { setLoading(false); return }

        try {
            let q = query(
                collection(db, 'proposals'),
                where('daoId', '==', daoId),
                orderBy('createdAt', 'desc'),
                qlimit(opts?.limit ?? 30)
            )
            if (opts?.phase) {
                q = query(
                    collection(db, 'proposals'),
                    where('daoId', '==', daoId),
                    where('phase', '==', opts.phase),
                    orderBy('createdAt', 'desc'),
                    qlimit(opts?.limit ?? 30)
                )
            }
            unsub = onSnapshot(q, (snap) => {
                setItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
                setLoading(false)
            }, (e) => {
                setError(e?.message || 'Failed to load proposals')
                setLoading(false)
            })
        } catch (e: any) {
            setError(e?.message || 'Failed to load proposals')
            setLoading(false)
        }
        return () => { if (unsub) unsub() }
    }, [daoId, opts?.phase, opts?.limit])

    return { items, loading, error }
}
