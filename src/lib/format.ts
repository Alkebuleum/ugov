export function formatLocalId(id: string | number | null | undefined) {
    const s = String(id ?? '').trim()
    if (!s) return '—'
    return /^\d+$/.test(s) ? s.padStart(4, '0') : s // screenshot shows 4-digit style e.g. #1749
}

export function formatAmountShort(v?: number | string, unit?: string) {
    if (v === null || v === undefined || v === '') return ''
    const n = Number(v)
    if (Number.isNaN(n)) return String(v)
    const compact = Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n)
    return unit ? `${compact} ${unit}` : compact
}
