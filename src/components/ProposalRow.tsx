import { motion } from 'framer-motion'
import StatusChip from './StatusChip'
import { MessageSquare, CheckCircle2, BadgeCheck } from 'lucide-react'
import { formatLocalId } from '../lib/format'
import TagPill from './TagPill'

import Identicon from '../components/Identicon'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import IdentityChip from './IdentityChip'

type Badge = { label: string; variant?: 'pink' | 'orange' | 'green' | 'slate' }

export type ProposalLike = {
    id?: string
    reservedId?: string | number
    title?: string
    status?: string

    // Amount (supports either numeric+unit OR preformatted text)
    amountNum?: number | string
    amountUnit?: string
    amountText?: string

    author?:
    | { name?: string; avatar?: number; org?: string; verified?: boolean }
    | string
    avatar?: number
    org?: string
    verified?: boolean

    time?: string
    comments?: number
    counters?: { comments?: number }

    badges?: Badge[]
    progressPct?: number
}

function TinyProgress({ value = 0 }: { value?: number }) {
    const pct = Math.max(0, Math.min(100, value))
    return (
        <div className="h-2 w-16 rounded-full bg-slate-200/80 overflow-hidden">
            <div className="h-full bg-brand-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
    )
}

function formatAmount({ amountNum, amountUnit, amountText }: {
    amountNum?: number | string
    amountUnit?: string
    amountText?: string
}) {
    if (amountText) return amountText
    if (amountNum === undefined || amountNum === null || amountNum === '') return ''
    const n = Number(amountNum)
    if (Number.isNaN(n)) return String(amountNum)
    const compact = Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n)
    return amountUnit ? `${compact} ${amountUnit}` : compact
}

export default function ProposalRow({
    data: r,
    onClick,
    withDivider,
}: {
    data: ProposalLike
    onClick?: () => void
    withDivider?: boolean
}) {
    /*    const authorObj =
           typeof r.author === 'string'
               ? { name: r.author, avatar: r.avatar, org: r.org, verified: r.verified }
               : r.author ?? {} */

    //const orgName = (authorObj.org || authorObj.name || '—') as string
    //const authorSeed = (authorObj.avatar ?? r.avatar ?? 1) as number
    const time = r.time ?? ''
    const comments = r.counters?.comments ?? r.comments ?? 0
    const amount = formatAmount({ amountNum: r.amountNum, amountUnit: r.amountUnit, amountText: r.amountText })


    // Derive AIN / author info
    const authorObj = (r.author ?? {}) as { name?: string; address?: string; avatar?: number; verified?: boolean }
    const ain = authorObj.name || ''  // e.g., "AA000000019"
    const authorSeed = authorObj.avatar ?? 1
    const orgName = ain || '—'        // what you showed previously as orgName

    const [copiedAinId, setCopiedAinId] = useState<string | null>(null)
    async function copyAin(text: string, id: string) {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedAinId(id)
            setTimeout(() => setCopiedAinId(null), 1200)
        } catch { }
    }


    return (
        <motion.div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick?.())}
            className={`px-4 py-4 cursor-pointer ${withDivider ? 'border-b border-brand-line' : ''}`}
            whileHover={{ scale: 1.002, backgroundColor: 'rgba(233,237,243,0.4)' }}
        >
            {/* Layout: [ID rail (top-aligned with title)] [title+meta] [amount+status] */}
            <div className="grid grid-cols-[90px,1fr,auto] items-start gap-4">
                {/* LEFT: proposal number (top-aligned with the title row) */}
                <div className="self-start pt-0.5 text-slate text-sm font-medium tabular-nums">
                    #{formatLocalId(r.reservedId)}
                </div>

                {/* CENTER: title (row 1) + meta (row 2) */}
                <div className="min-w-0">
                    <div className="text-[17px] font-medium leading-snug line-clamp-1">
                        {r.title ?? 'Untitled'}
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-sm text-slate flex-wrap">
                        {/* AIN chip (clean, no outline, no copy) */}
                        {/*                   <span
                            className="
      inline-flex items-center gap-2 px-2 py-1 rounded-lg
      bg-brand-line/30 hover:bg-brand-line/50
      transition shadow-sm
    "
                            title={ain || 'AIN'}
                        >
                            <Identicon value={ain || orgName} size={16} />
                            <span className="font-mono text-[12px] leading-none tracking-tight">
                                {ain || '—'}
                            </span>
                        </span>

                       
                        {authorObj.verified && (
                            <span className="inline-flex items-center" title="Verified">
                                <BadgeCheck size={16} className="text-emerald-600" aria-hidden="true" />
                            </span>
                        )} */}
                        <IdentityChip
                            ain={ain}
                            verified={!!authorObj.verified}
                            size="sm"
                            outlined={false}     // default, can omit
                            copyable={false}     // default, can omit
                        />

                        {/*<span className="opacity-50">|</span>*/}
                        <span className="whitespace-nowrap">{time}</span>

                        {/* Badges */}
                        {r.badges?.map((b: any, i: number) => (
                            <TagPill key={i} variant={b.variant ?? 'orange'}>
                                {b.label}
                            </TagPill>
                        ))}

                        <span className="opacity-50">|</span>
                        <span className="inline-flex items-center gap-1">
                            <MessageSquare size={14} /> {comments ?? 0}
                        </span>

                        <span className="ml-2">
                            <TinyProgress value={r.progressPct ?? 0} />
                        </span>
                    </div>


                </div>

                {/* RIGHT: amount (row 1) + status (row 2) */}
                <div className="flex flex-col items-end gap-2">
                    {amount && <div className="text-ink font-semibold tabular-nums">{amount}</div>}
                    <StatusChip status={r.status as any} />
                </div>
            </div>
        </motion.div>
    )
}

/* -------- Optional built-in skeleton to match layout -------- */
function RowSkeleton({ withDivider = false }: { withDivider?: boolean }) {
    return (
        <div className={`px-4 py-4 ${withDivider ? 'border-b border-brand-line' : ''} animate-pulse`}>
            <div className="grid grid-cols-[90px,1fr,auto] items-start gap-4">
                <div className="h-3 w-12 bg-brand-line/70 rounded self-start" />
                <div className="min-w-0">
                    <div className="h-4 w-3/4 bg-brand-line rounded mb-2" />
                    <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-brand-line" />
                        <div className="h-3 w-32 bg-brand-line rounded" />
                        <div className="h-3 w-10 bg-brand-line/70 rounded ml-2" />
                        <div className="h-5 w-20 bg-brand-line/60 rounded-full ml-2" />
                        <div className="h-3 w-14 bg-brand-line/70 rounded ml-2" />
                        <div className="h-2 w-16 bg-brand-line/70 rounded-full ml-2" />
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="h-4 w-24 bg-brand-line rounded" />
                    <div className="h-6 w-20 bg-brand-line rounded-full" />
                </div>
            </div>
        </div>
    )
}

// expose skeleton for convenient imports
ProposalRow.Skeleton = RowSkeleton
