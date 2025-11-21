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


export function toJsDate(v: any): Date | null {
    if (!v) return null

    // Firestore Timestamp-style
    if (typeof v.toDate === 'function') return v.toDate()
    if (v instanceof Date) return v

    const ms = typeof v === 'number' ? v : Date.parse(String(v))
    if (!Number.isFinite(ms)) return null
    return new Date(ms)
}

export function formatTimeAgo(v: any): string {
    const d = toJsDate(v)
    if (!d) return ''

    const now = new Date()
    const diffMs = Math.max(0, now.getTime() - d.getTime())
    const sec = Math.floor(diffMs / 1000)

    if (sec < 60) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`
    const hrs = Math.floor(min / 60)
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
    const weeks = Math.floor(days / 7)
    if (weeks < 4) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
    const months = Math.floor(days / 30)
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
    const years = Math.floor(days / 365)
    return `${years} year${years === 1 ? '' : 's'} ago`
}