export default function AppFallback() {
    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            <section className="card p-6 animate-pulse">
                <div className="h-6 w-40 bg-brand-line/50 rounded mb-3" />
                <div className="h-4 w-80 bg-brand-line/40 rounded" />
            </section>
        </div>
    )
}
