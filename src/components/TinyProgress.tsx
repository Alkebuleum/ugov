export default function TinyProgress({ value = 0 }: { value?: number }) {
    const pct = Math.max(0, Math.min(100, value))
    return (
        <div className="h-2 w-24 rounded-full bg-slate-200/80 overflow-hidden">
            <div className="h-full bg-brand-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
    )
}
