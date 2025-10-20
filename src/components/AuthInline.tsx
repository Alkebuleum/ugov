import { ReactNode } from 'react'
import { useAuth } from 'amvault-connect'

type InlineProps = {
    /** Human-friendly action name: "comment", "vote", "like", "create a proposal" */
    action: string
    /** If true, render as a compact sentence with a login link; otherwise render a small card block */
    compact?: boolean
    /** Content to show when the user IS logged in (e.g., your form or controls) */
    children: ReactNode
}

/**
 * Renders children if logged in; else shows a login prompt (compact or block).
 * - compact: `Please login to comment` (with clickable login link)
 * - block: a small card with "Connect AmVault" button
 */
export default function AuthInline({ action, compact, children }: InlineProps) {
    const { session, signin } = useAuth()

    if (session) return <>{children}</>

    if (compact) {
        return (
            <p className="text-sm text-slate">
                Please{' '}
                <button
                    className="underline underline-offset-2 text-ink hover:text-brand-primary focus:outline-none"
                    onClick={signin}
                >
                    login
                </button>{' '}
                to {action}.
            </p>
        )
    }

    return (
        <div className="rounded-xl border border-brand-line bg-white p-4 flex items-center justify-between gap-3">
            <div className="text-sm">
                <div className="font-medium text-ink">Login required</div>
                <div className="text-slate">Connect AmVault to {action}.</div>
            </div>
            <button className="btn" onClick={signin}>Connect AmVault</button>
        </div>
    )
}
