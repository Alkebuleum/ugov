import { ReactNode } from 'react'
import { useDAO } from '../lib/dao'
import { Plus } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'

export default function LoadingGate({ children }: { children: ReactNode }) {
    const { loading, daos } = useDAO()
    const nav = useNavigate()
    const loc = useLocation()

    // While DAO context loads, show a visible default page (prevents blank)
    if (loading) {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8">
                <section className="card p-6 animate-pulse">
                    <div className="h-6 w-52 bg-brand-line/50 rounded mb-3" />
                    <div className="h-4 w-96 bg-brand-line/40 rounded" />
                </section>
            </div>
        )
    }

    // If there are no DAOs anywhere in the app, show Create CTA by default (except on the creator route)
    const creating = loc.pathname.toLowerCase() === '/daos/new'
    if (!creating && daos.length === 0) {
        return (
            <div className="flex items-center justify-center h-[56vh]">
                <div className="text-center">
                    <h1 className="text-2xl md:text-3xl font-semibold">Create your first DAO</h1>
                    <p className="text-slate mt-2 max-w-[60ch]">
                        Start by creating a DAO to enable proposals, treasury, and governance.
                    </p>
                    <button onClick={() => nav('/daos/new')} className="btn-cta inline-flex items-center mt-5">
                        <Plus size={16} className="mr-2" /> Create DAO
                    </button>
                </div>
            </div>
        )
    }

    return <>{children}</>
}
