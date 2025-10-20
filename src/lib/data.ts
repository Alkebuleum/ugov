
import { db } from './firebase'
import { collection, getDocs, orderBy, limit, query, Timestamp } from 'firebase/firestore'

export type DocProposal = {
  id: string
  title: string
  bodyMd: string
  status: 'Active'|'Submitted'|'Deciding'|'Rejected'
  author: { name:string, avatar:number }
  createdAt?: Timestamp
  counters?: { comments:number, votes:number }
  amount?: string | null
}

export async function fetchProposals(limitTo = 20): Promise<DocProposal[]> {
  const q = query(collection(db, 'proposals'), orderBy('createdAt','desc'), limit(limitTo))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id:d.id, ...(d.data() as any) }))
}
