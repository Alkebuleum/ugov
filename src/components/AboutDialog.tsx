import { useEffect } from 'react'
import { X } from 'lucide-react'
import { FLAGS } from '../lib/flags'
import { CHAIN } from '../lib/chain'

type Props = { open: boolean; onClose: () => void }

export default function AboutDialog({ open, onClose }: Props) {
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [open, onClose])

    if (!open) return null

    const contact = import.meta.env.VITE_CONTACT_EMAIL as string | undefined
    const appVersion = String(import.meta.env.VITE_APP_VERSION ?? FLAGS.version)
    const build = (import.meta.env.VITE_BUILD as string | undefined) || ''

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg mx-4 rounded-2xl border border-brand-line bg-white shadow-xl p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold">About uGov</h2>
                    <button
                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-black/5"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-3 text-sm text-ink">
                    <p>
                        <strong>uGov</strong> is Alkebuleum’s on-chain governance hub. It helps communities
                        create proposals, vote, and manage treasuries with transparency.
                    </p>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-brand-line/60 p-2">
                            <div className="text-slate">App Version</div>
                            <div className="font-mono">{appVersion}{build ? ` • ${build}` : ''}</div>
                        </div>
                        <div className="rounded-xl border border-brand-line/60 p-2">
                            <div className="text-slate">Network</div>
                            <div className="font-mono">
                                {CHAIN?.name ?? 'Custom'} (chainId {CHAIN?.id})
                            </div>
                        </div>
                    </div>

                    <p className="text-xs text-slate">
                        uGov connects via <span className="font-mono">amvault-connect</span> for secure
                        wallet & identity. Some features may be limited depending on the version and feature
                        flags configured at build time.
                    </p>

                    {contact && (
                        <p className="text-xs">
                            Contact: <a className="underline" href={`mailto:${contact}`}>{contact}</a>
                        </p>
                    )}
                </div>

                <div className="mt-4 flex justify-end">
                    <button className="btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    )
}
