// src/components/IdentityChip.tsx
import { useState } from 'react'
import clsx from 'clsx'
import { Copy, Check, ShieldCheck } from 'lucide-react'
import Identicon from './Identicon'

export type IdentityChipProps = {
    ain?: string
    label?: string
    verified?: boolean
    size?: 'xs' | 'sm' | 'md'          // 👈 add xs
    outlined?: boolean
    copyable?: boolean
    className?: string                 // wrapper
    chipClassName?: string             // 👈 new: inner chip container
    textClassName?: string             // 👈 new: text (AIN) span
    iconSize?: number                  // 👈 new: override identicon size
    font?: 'mono' | 'sans'             // 👈 new: pick font family
    rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' // 👈 new: radius
    onClick?: () => void
}

export default function IdentityChip({
    ain,
    label,
    verified = false,
    size = 'md',
    outlined = false,
    copyable = false,
    className,
    chipClassName,
    textClassName,
    iconSize,
    font = 'mono',
    rounded = 'lg',
    onClick,
}: IdentityChipProps) {
    const [copied, setCopied] = useState(false)
    const showAin = ain || '—'

    const isXs = size === 'xs'
    const isSm = size === 'sm'

    const pxpy =
        isXs ? 'px-1.5 py-0.5 text-[11px]' :
            isSm ? 'px-2 py-0.5 text-[12px]' :
                'px-2.5 py-1 text-sm'

    const radius =
        rounded === 'full' ? 'rounded-full' :
            rounded === '2xl' ? 'rounded-2xl' :
                rounded === 'xl' ? 'rounded-xl' :
                    rounded === 'lg' ? 'rounded-lg' :
                        rounded === 'md' ? 'rounded-md' : 'rounded-sm'

    const wrap = clsx('inline-flex items-center whitespace-nowrap select-none', className)

    const chip = clsx(
        'inline-flex items-center',
        radius,
        pxpy,
        outlined ? 'border border-brand-line bg-white/60' : 'bg-brand-line/30',
        chipClassName
    )

    const fontCls = font === 'mono' ? 'font-mono' : 'font-sans'

    const icoSize = iconSize ?? (isXs ? 14 : isSm ? 16 : 20)
    const verSize = isXs ? 12 : isSm ? 14 : 16

    const copy = async () => {
        if (!ain) return
        try {
            await navigator.clipboard.writeText(ain)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
        } catch { /* noop */ }
    }

    return (
        <span className={wrap}>
            <Identicon value={ain || label || 'anon'} size={icoSize} className="shrink-0" />

            <span
                className={chip}
                role={onClick ? 'button' : undefined}
                tabIndex={onClick ? 0 : -1}
                onClick={onClick}
                onKeyDown={(e) => {
                    if (!onClick) return
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
                }}
            >
                <span className={clsx('ml-1 leading-none', fontCls, textClassName)}>{showAin}</span>

                {verified && (
                    <ShieldCheck
                        size={verSize}
                        className="ml-1 shrink-0 text-emerald-600"
                        aria-label="verified"
                    />
                )}

                {label && (
                    <span className={clsx('ml-2 truncate', isXs ? 'max-w-[100px]' : isSm ? 'max-w-[120px]' : 'max-w-[160px]')}>
                        {label}
                    </span>
                )}

                {copyable && ain && (
                    <button
                        type="button"
                        className="ml-1 rounded p-0.5 hover:bg-brand-line/40 transition"
                        onClick={(e) => { e.stopPropagation(); copy() }}
                        aria-label={copied ? 'Copied' : 'Copy AIN'}
                    >
                        {copied ? <Check size={verSize} /> : <Copy size={verSize} />}
                    </button>
                )}
            </span>
        </span>
    )
}
