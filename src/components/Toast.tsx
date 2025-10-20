import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

type ToastAction = { label: string; onClick: () => void }
type Toast = { id: number; title: string; desc?: string; action?: ToastAction; duration?: number }

type ToastCtx = {
    show: (t: Omit<Toast, 'id'>) => void
    dismiss: (id: number) => void
}

const ToastContext = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [items, setItems] = useState<Toast[]>([])

    const dismiss = useCallback((id: number) => {
        setItems((xs) => xs.filter((x) => x.id !== id))
    }, [])

    const show = useCallback((t: Omit<Toast, 'id'>) => {
        const id = Date.now() + Math.floor(Math.random() * 1000)
        const toast: Toast = { id, duration: 4500, ...t }
        setItems((xs) => [...xs, toast])
        if (toast.duration && toast.duration > 0) {
            setTimeout(() => dismiss(id), toast.duration)
        }
    }, [dismiss])

    const value = useMemo(() => ({ show, dismiss }), [show, dismiss])

    return (
        <ToastContext.Provider value={value}>
            {children}
            {createPortal(
                <div className="fixed bottom-4 left-0 right-0 pointer-events-none z-[1000]">
                    <div className="max-w-6xl mx-auto px-4 flex flex-col items-end gap-2">
                        <AnimatePresence>
                            {items.map((t) => (
                                <motion.div
                                    key={t.id}
                                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 16, scale: 0.98 }}
                                    className="pointer-events-auto w-full sm:max-w-sm rounded-xl border border-brand-line bg-white shadow-xl p-3"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="flex-1">
                                            <div className="text-sm font-semibold">{t.title}</div>
                                            {t.desc && <div className="text-xs text-slate mt-0.5">{t.desc}</div>}
                                        </div>
                                        <button
                                            className="text-slate hover:text-ink text-sm px-2"
                                            onClick={() => dismiss(t.id)}
                                            aria-label="Dismiss"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    {t.action && (
                                        <div className="mt-2">
                                            <button
                                                className="btn px-3 py-1 text-sm"
                                                onClick={() => { dismiss(t.id); t.action!.onClick() }}
                                            >
                                                {t.action.label}
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    )
}

export function useToast() {
    const ctx = useContext(ToastContext)
    if (!ctx) throw new Error('useToast must be used within ToastProvider')
    return ctx
}
