// src/components/TopBar.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Menu, Wallet2, LogOut, ChevronDown, Plus, Copy, Check, Landmark } from 'lucide-react'
import { useAuth } from 'amvault-connect'
import { useDAO } from '../lib/dao'
import { setUserPrefsByAmid } from '../lib/firebase'
import Identicon from './Identicon'
import logo from '../assets/logotext.svg'
import type { DAO as DAOType } from '../lib/dao'
import { FLAGS, isDaoAdmin } from '../lib/flags'


//type TopBarProps = { onMenu?: () => void }
type TopBarProps = { onMenu?: () => void; menuOpen?: boolean }

function shortAddr(a: string, lead = 6, tail = 4) {
  if (!a) return ''
  return a.slice(0, lead) + '…' + a.slice(-tail)
}
function isDebug(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('debug') === '1') return true
    if (localStorage.getItem('ugov.debug') === '1') return true
    // @ts-ignore
    if (import.meta?.env?.VITE_DEBUG === 'true') return true
  } catch { }
  return false
}
function dlog(...args: any[]) { if (isDebug()) console.log('[uGov]', ...args) }

/** Tiny deterministic seed (1..4) from a string (AIN) — kept for future variants */
function seedFromString(s?: string): 1 | 2 | 3 | 4 {
  if (!s) return 1
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return ((h % 4) + 1) as 1 | 2 | 3 | 4
}


export default function TopBar({ onMenu, menuOpen = false }: TopBarProps) {
  const nav = useNavigate()
  const loc = useLocation()
  const { session, signin, signout, status, error } = useAuth()
  const { daos, current, setCurrent, loading } = useDAO()

  const hasDAO = !loading && daos.length > 0

  // Pick a default DAO once data is ready (only if none selected)
  useEffect(() => {
    if (loading || !hasDAO || current) return
    const preferred = daos.find(d => d.isDefault) ?? daos[0]
    dlog('TopBar default pick', { preferred: preferred?.id })
    setCurrent(preferred ?? null)
  }, [loading, hasDAO, current, daos, setCurrent])

  // Route-guard when no DAO exists
  useEffect(() => {
    if (loading || hasDAO) return
    const allowed = ['/', '/daos/new']
    const path = loc.pathname.toLowerCase()
    if (!allowed.includes(path)) {
      dlog('TopBar guard redirect', { from: path, to: '/' })
      nav('/', { replace: true })
    }
  }, [loading, hasDAO, loc.pathname, nav])

  // Global runtime error banner (debug)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  useEffect(() => {
    function onError(ev: ErrorEvent) {
      setRuntimeError(ev.error?.message || ev.message || 'Unknown runtime error')
      console.error('[uGov] window error', ev.error || ev)
    }
    function onRejection(ev: PromiseRejectionEvent) {
      const msg = (ev.reason && (ev.reason.message || ev.reason.toString())) || 'Unhandled promise rejection'
      setRuntimeError(msg)
      console.error('[uGov] unhandledrejection', ev.reason || ev)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  const ain = session?.ain

  const canCreateDAO = FLAGS.canCreateDAO || isDaoAdmin(ain)

  // AIN popover state
  const [ainOpen, setAinOpen] = useState(false)
  const ainBtnRef = useRef<HTMLButtonElement | null>(null)
  const ainPopRef = useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = useState<'ain' | 'addr' | null>(null)

  useEffect(() => {
    if (!ainOpen) return
    function onDoc(e: MouseEvent) {
      if (!ainPopRef.current || !ainBtnRef.current) return
      if (ainPopRef.current.contains(e.target as Node)) return
      if (ainBtnRef.current.contains(e.target as Node)) return
      setAinOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setAinOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [ainOpen])

  async function copy(value: string, which: 'ain' | 'addr') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), 1200)
    } catch { /* ignore */ }
  }

  // DAO select handler (persist to users/{ain}.prefs.lastOpenDaoId)
  const handleSelectDao = async (d: DAOType) => {
    dlog('TopBar select DAO', { id: d.id })
    setCurrent(d)
    try {
      if (session?.ain) {
        await setUserPrefsByAmid(session.ain, { lastOpenDaoId: d.id })
      }
    } catch (e) {
      console.warn('[TopBar] persist lastOpenDaoId failed:', e)
    }
    // Re-render current route (no navigation change)
    nav(loc.pathname + loc.search, { replace: true })
  }

  useEffect(() => {
    if (menuOpen) setAinOpen(false)
  }, [menuOpen])


  return (
    <header
      className={
        `topbar sticky top-0 ${menuOpen ? 'z-10 md:z-40' : 'z-40'} ` +
        'bg-brand-bg/95 backdrop-blur supports-[backdrop-filter]:bg-brand-bg/80 border-b border-brand-line'
      }
    >

      <div className="max-w-6xl mx-auto px-4">
        {/* ROW 1: menu/logo + (connect/ain) */}
        <div className="min-h-14 py-2 flex items-center justify-between gap-2">
          {/* Left: menu + logo + (desktop DAO selector) */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-brand-line hover:bg-brand-line/40"
              onClick={onMenu}
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <Menu size={18} />
            </button>

            <button onClick={() => nav('/')} className="shrink-0" title="Go to Overview">
              <img src={logo} className="h-9" alt="uGov" />
            </button>

            {/* Desktop/Tablet: inline DAO selector */}
            <div className="ml-1 hidden sm:block">
              {hasDAO ? (
                <DaoSelector
                  daos={daos}
                  current={current ?? undefined}
                  onSelect={handleSelectDao}
                  onCreate={() => {
                    if (!canCreateDAO) {
                      alert('Only DAO admins can create new DAOs in this version.')
                      return
                    }
                    nav('/daos/new')
                  }}
                />

              ) : !loading ? (
                <button
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-brand-line hover:bg-brand-line/30 text-sm"
                  onClick={() => {
                    if (!canCreateDAO) {
                      alert('Only DAO admins can create new DAOs in this version.')
                      return
                    }
                    nav('/daos/new')
                  }}
                  disabled={!canCreateDAO}
                  title={canCreateDAO ? 'Create your first DAO' : 'Only DAO admins can create DAOs'}
                >
                  <Plus size={16} /> <span className="hidden md:inline">Create DAO</span>
                </button>

              ) : null}
            </div>

            {/* Main nav (desktop) */}
            <nav
              className={
                'hidden md:flex items-center gap-1 ml-2 ' +
                (!hasDAO ? 'pointer-events-none opacity-50 select-none' : '')
              }
              aria-hidden={!hasDAO}
            >
              <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                Overview
              </NavLink>
              <NavLink to="/proposals" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                Proposals
              </NavLink>
              <NavLink to="/treasury" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                Treasury
              </NavLink>
            </nav>
          </div>

          {/* Right: auth controls (stack on mobile) */}
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 shrink-0 mt-1 sm:mt-0">
            {!session ? (
              <button
                className="btn inline-flex items-center shrink-0"
                onClick={signin}
                disabled={status === 'checking'}
                title="Connect via AmVault"
              >
                <Wallet2 size={16} className="mr-2" />
                {status === 'checking' ? 'Checking…' : 'Connect'}
              </button>
            ) : (
              <div className="relative">
                {/* AIN Chip with identicon (truncate to avoid overflow) */}
                <button
                  ref={ainBtnRef}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-brand-line bg-white/60 hover:bg-white transition text-sm max-w-[55vw] sm:max-w-none"
                  onClick={() => setAinOpen((v) => !v)}
                  title="Account"
                >
                  <Identicon value={ain || session.address} size={16} className="shrink-0" />
                  <span className="font-medium truncate">{ain || shortAddr(session.address)}</span>
                  <ChevronDown size={14} className="opacity-70 shrink-0" />
                </button>

                {ainOpen && (
                  <div
                    ref={ainPopRef}
                    className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-brand-line bg-white/95 backdrop-blur shadow-lg p-3 z-50"
                    role="dialog"
                    aria-label="Account"
                  >
                    <div className="flex items-center gap-3">
                      <Identicon value={ain || session.address} size={28} className="shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs text-slate">AIN</div>
                        <div className="font-mono text-sm truncate">{ain || '—'}</div>
                      </div>
                      <button
                        className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border hover:bg-brand-line/40"
                        onClick={() => ain && copy(ain, 'ain')}
                        disabled={!ain}
                        title="Copy AIN"
                      >
                        {copied === 'ain' ? <Check size={14} /> : <Copy size={14} />} Copy
                      </button>
                    </div>

                    <div className="mt-3 flex items-start gap-3">
                      <div className="text-xs text-slate mt-0.5">Wallet</div>
                      <div className="font-mono text-sm break-all">{session.address}</div>
                      <button
                        className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border hover:bg-brand-line/40"
                        onClick={() => copy(session.address, 'addr')}
                        title="Copy address"
                      >
                        {copied === 'addr' ? <Check size={14} /> : <Copy size={14} />} Copy
                      </button>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <button
                        className="btn inline-flex items-center"
                        onClick={() => {
                          setAinOpen(false)
                          signout()
                          nav('/', { replace: true })
                        }}
                        title="Logout"
                      >
                        <LogOut size={16} className="mr-2" /> Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ROW 2 (mobile-only): full-width DAO selector */}
        {/* ROW 2 (mobile-only): full-width DAO selector — hidden when menu is open */}

        <div className="sm:hidden pb-2">
          {hasDAO ? (
            <DaoSelector
              daos={daos}
              current={current ?? undefined}
              onSelect={handleSelectDao}
              onCreate={() => {
                if (!canCreateDAO) {
                  alert('Only DAO admins can create new DAOs in this version.')
                  return
                }
                nav('/daos/new')
              }}
              fullWidth
            />

          ) : !loading ? (
            <button
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-brand-line hover:bg-brand-line/30 text-sm"
              onClick={() => {
                if (!canCreateDAO) {
                  alert('Only DAO admins can create new DAOs in this version.')
                  return
                }
                nav('/daos/new')
              }}
              disabled={!canCreateDAO}
              title={canCreateDAO ? 'Create your first DAO' : 'Only DAO admins can create DAOs'}
            >
              <Plus size={16} /> Create DAO
            </button>

          ) : null}
        </div>



        {/* Auth/runtime banners unchanged */}
        {error && (
          <div className="mb-2 -mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        {runtimeError && isDebug() && (
          <div className="mb-2 -mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <strong>Runtime error:</strong> {runtimeError}
            <button className="ml-3 underline" onClick={() => setRuntimeError(null)} aria-label="Clear runtime error">
              Clear
            </button>
          </div>
        )}
        {isDebug() && (
          <div className="mb-2 -mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <strong>DAO debug</strong> · loading={String(loading)} · daos={daos.length} · current={current?.id ?? 'null'} · path={loc.pathname}
          </div>
        )}
      </div>
    </header>
  )

}

/* -----------------------------------------------------------------------------
 * DAO Selector (inline)
 * ---------------------------------------------------------------------------*/


type DaoSelectorProps = {
  daos: DAOType[]
  current?: DAOType
  onSelect: (dao: DAOType) => void
  onCreate: () => void
  fullWidth?: boolean
}

function DaoSelector({ daos, current, onSelect, onCreate, fullWidth }: DaoSelectorProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)

  const label = useMemo(() => {
    if (!current) return 'Select DAO'
    return current.name ?? shortAddr(current.address)
  }, [current])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!popRef.current || !btnRef.current) return
      if (popRef.current.contains(e.target as Node)) return
      if (btnRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className={`relative ${fullWidth ? 'w-full' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          'inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-brand-line bg-transparent hover:bg-brand-line/30 text-sm ' +
          (fullWidth ? 'w-full justify-between' : 'whitespace-nowrap max-w-[220px]')
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current?.address ?? 'Choose DAO'}
      >
        <span className="block sm:hidden">
          <Landmark size={16} className="opacity-70" />
        </span>
        <span className={`truncate ${fullWidth ? 'max-w-[70vw]' : 'max-w-[180px] sm:max-w-[200px]'}`}>
          {label}
        </span>
        <ChevronDown size={16} className="opacity-70 shrink-0" />
      </button>

      {open && (
        <div
          ref={popRef}
          role="listbox"
          className="absolute z-50 mt-2 w-[min(16rem,calc(100vw-2rem))] sm:w-64 rounded-xl border border-brand-line bg-white/95 backdrop-blur shadow-lg overflow-hidden right-0"
        >
          <div className="max-h-80 overflow-auto py-1">
            {daos.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-500">No DAOs yet</div>
            )}

            {daos.map((d) => {
              const isCurrent = current?.id === d.id
              return (
                <button
                  key={d.id}
                  className={
                    'w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-brand-line/20 ' +
                    (isCurrent ? 'bg-brand-line/30' : '')
                  }
                  onClick={() => { onSelect(d); setOpen(false) }}
                  role="option"
                  aria-selected={isCurrent}
                  title={d.address}
                >
                  <span className="truncate max-w-[12rem]">{d.name ?? shortAddr(d.address)}</span>
                  {isCurrent && <span className="text-xs ml-2 opacity-70">current</span>}
                </button>
              )
            })}

            <div className="my-1 h-px bg-brand-line/60" />

            <button
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-brand-line/20"
              onClick={() => { setOpen(false); onCreate() }}
            >
              <Plus size={16} />
              Create new DAO
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

