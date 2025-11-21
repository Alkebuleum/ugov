import { motion } from 'framer-motion'
import StatusChip from './StatusChip'
import { MessageSquare, CheckCircle2, BadgeCheck } from 'lucide-react'
import TagPill from './TagPill'
import { formatLocalId, formatTimeAgo } from '../lib/format'
import IdentityChip from './IdentityChip'

type Badge = { label: string; variant?: 'pink' | 'orange' | 'green' | 'slate' }

export type ProposalLike = {
    id?: string
    reservedId?: string | number
    title?: string
    status?: string

    // timestamps from Firestore
    createdAt?: any
    updatedAt?: any

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
    const time = r.time ?? ''
    const comments = r.counters?.comments ?? r.comments ?? 0
    const amount = formatAmount({
        amountNum: r.amountNum,
        amountUnit: r.amountUnit,
        amountText: r.amountText,
    })

    const updatedAt = r.updatedAt ?? r.createdAt
    const isDraft = (r.status || '').toLowerCase() === 'draft'
    const timeLabel = updatedAt
        ? `${isDraft ? 'Last edited' : 'Updated'} ${formatTimeAgo(updatedAt)}`
        : (time || '')


    const authorObj = (r.author ?? {}) as {
        name?: string
        address?: string
        avatar?: number
        verified?: boolean
    }
    const ain = authorObj.name || ''

    return (
        <motion.div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) =>
                (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick?.())
            }
            className={`px-4 py-4 cursor-pointer ${withDivider ? 'border-b border-brand-line' : ''
                }`}
            whileHover={{ scale: 1.002, backgroundColor: 'rgba(233,237,243,0.4)' }}
        >
            <div className="flex flex-col gap-2">
                {/* ROW 1: ID (left) + Status (right) */}
                <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium tabular-nums">
                        #{formatLocalId(r.reservedId)}
                    </span>
                    <StatusChip status={r.status as any} />
                </div>

                {/* ROW 2: Title (full width) */}
                <div className="text-[15px] sm:text-[17px] font-medium leading-snug line-clamp-2 sm:line-clamp-1">
                    {r.title ?? 'Untitled'}
                </div>

                {/* ROW 3: Meta + amount + progress */}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate">
                    <IdentityChip
                        ain={ain}
                        verified={!!authorObj.verified}
                        size="sm"
                        outlined={false}
                        copyable={false}
                    />

                    <span className="whitespace-nowrap">{timeLabel}</span>


                    {r.badges?.map((b: any, i: number) => (
                        <TagPill key={i} variant={b.variant ?? 'orange'}>
                            {b.label}
                        </TagPill>
                    ))}

                    <span className="opacity-50">|</span>
                    <span className="inline-flex items-center gap-1">
                        <MessageSquare size={14} /> {comments ?? 0}
                    </span>

                    {amount && (
                        <>
                            <span className="opacity-50">•</span>
                            <span className="text-ink font-semibold tabular-nums text-xs">
                                {amount}
                            </span>
                        </>
                    )}

                    <span className="ml-2">
                        <TinyProgress value={r.progressPct ?? 0} />
                    </span>
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
