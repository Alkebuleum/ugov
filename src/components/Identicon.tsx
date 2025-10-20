// src/components/Identicon.tsx
import React from 'react'

function xmur3(str: string) {
    let h = 1779033703 ^ str.length
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507)
        h = Math.imul(h ^ (h >>> 13), 3266489909)
        return (h ^= h >>> 16) >>> 0
    }
}

function randColor(seedFn: () => number) {
    // pastel-ish HSL -> RGB
    const h = seedFn() % 360
    const s = 60 + (seedFn() % 20) // 60–79
    const l = 55 + (seedFn() % 10) // 55–64
    return `hsl(${h} ${s}% ${l}%)`
}

export default function Identicon({
    value,
    size = 20,
    radius = 6,
    className = '',
}: {
    value: string
    size?: number
    radius?: number
    className?: string
}) {
    const seed = xmur3(value || 'identicon')
    const fg = randColor(seed)
    const bg = 'hsl(210 20% 96%)'      // light background
    const cells = 5
    const cell = size / cells

    // Build 5x5 mirrored grid (only compute 3 cols, mirror to 5)
    const bits: boolean[] = []
    for (let y = 0; y < cells; y++) {
        const row: boolean[] = []
        for (let x = 0; x < Math.ceil(cells / 2); x++) {
            const bit = (seed() & 1) === 1
            row.push(bit)
        }
        // mirror
        const mirror = row.slice(0, Math.floor(cells / 2)).reverse()
        bits.push(...row.concat(mirror))
    }

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className={className}
            style={{ borderRadius: radius }}
            aria-hidden="true"
        >
            <rect width={size} height={size} fill={bg} rx={radius} ry={radius} />
            {bits.map((on, i) => {
                if (!on) return null
                const x = (i % cells) * cell
                const y = Math.floor(i / cells) * cell
                return <rect key={i} x={x} y={y} width={cell} height={cell} fill={fg} />
            })}
        </svg>
    )
}
