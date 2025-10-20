type Variant = 'pink' | 'orange' | 'green' | 'slate'

const styles: Record<Variant, string> = {
    pink: 'bg-rose-100 text-rose-700',
    orange: 'bg-orange-100 text-orange-700',
    green: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-100 text-slate-600',
}

export default function TagPill({
    children,
    variant = 'orange',
}: {
    children: React.ReactNode
    variant?: Variant
}) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[variant]}`}
        >
            {children}
        </span>
    )
}
