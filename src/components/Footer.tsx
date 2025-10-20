import { useState } from 'react'
import AboutDialog from './AboutDialog'

export default function Footer() {
  const [open, setOpen] = useState(false)
  const year = new Date().getFullYear()
  const contact = import.meta.env.VITE_CONTACT_EMAIL as string | undefined

  return (
    <>
      <footer className="mt-10 border-t border-brand-line">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-slate flex flex-col md:flex-row items-center justify-between gap-3">
          <div>© {year} Alkebuleum · uGov</div>

          <nav className="flex items-center gap-4">
            <button onClick={() => setOpen(true)} className="hover:text-ink underline-offset-2 hover:underline">
              About
            </button>
            {contact && (
              <a href={`mailto:${contact}`} className="hover:text-ink">
                Contact
              </a>
            )}
            {/* Docs / GitHub / Socials removed for now */}
          </nav>
        </div>
      </footer>

      <AboutDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
