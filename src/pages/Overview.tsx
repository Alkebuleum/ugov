// src/pages/Overview.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useDAO } from '../lib/dao'
import { useDaoProposals } from '../lib/useDaoProposals'
import { useDaoCounts } from '../lib/useDaoCounts'
import { db, refreshTreasuryCache } from '../lib/firebase'
import { doc, onSnapshot } from 'firebase/firestore'
import { MessageSquare, SquareCheckBig, Rocket, Plus, BarChart3, ChevronRight, RotateCw, Info, Settings } from 'lucide-react'
import ProposalRow from '../components/ProposalRow'

//--------------- query
import { BLOCK_TIME_SEC as BLOCK_TIME_SEC_ } from '../lib/daoProposals'
import { CHAIN } from '../lib/chain'
import { readGovernanceConfig } from '../lib/chainReads'
import React from 'react'
const SEC_PER_BLOCK = Number(BLOCK_TIME_SEC_) || 2
/** ---------- Voting helpers (REPLACE your previous helpers with this) ---------- */

function toNum(x: any): number | undefined {
  const n = Number(x)
  return Number.isFinite(n) ? n : undefined
}

function fromPctToBps(pct?: number) {
  return pct == null ? undefined : Math.round(pct * 100)
}

/** Return { seconds?: number, blocks?: number } from a mix of sec/blocks fields */
function pickTime(alt: {
  secA?: any; secB?: any; secC?: any; blocksA?: any; blocksB?: any; blocksC?: any;
}) {
  const seconds =
    toNum(alt.secA) ??
    toNum(alt.secB) ??
    toNum(alt.secC)

  const blocks =
    toNum(alt.blocksA) ??
    toNum(alt.blocksB) ??
    toNum(alt.blocksC)

  return { seconds, blocks }
}

/** Be generous about field names/shapes so we always show something. */
function normalizeVotingConfig(dao: any) {
  const v0 = dao?.votingConfig || dao?.voting || dao?.config?.voting || {}

  // QUORUM
  // Accept bps, percentage, or fraction
  const quorumBps =
    toNum(v0.quorumBps) ??
    toNum(v0.quorumBP) ??
    (v0.quorumPct != null ? fromPctToBps(toNum(v0.quorumPct)) : undefined) ??
    // some schemas store 0.15 for 15%
    (v0.quorum != null && Number(v0.quorum) <= 1 ? fromPctToBps(toNum(v0.quorum)) : undefined) ??
    // or 15 (percent) or 1500 (bps). If between 1 and 100, assume percent; convert to bps.
    (v0.quorum != null && Number(v0.quorum) > 1 && Number(v0.quorum) <= 100
      ? fromPctToBps(toNum(v0.quorum))
      : (toNum(v0.quorum) ?? undefined))

  // THRESHOLD (absolute votes OR bps)
  const proposalThresholdAbs =
    toNum(v0.proposalThreshold) ??
    toNum(v0.threshold) ??
    toNum(v0.proposalThresholdVotes)

  const proposalThresholdBps =
    toNum(v0.proposalThresholdBps) ??
    (v0.proposalThresholdPct != null ? fromPctToBps(toNum(v0.proposalThresholdPct)) : undefined)

  // TIMES (prefer seconds but show blocks if that’s all we have)
  const delay = pickTime({
    secA: v0.votingDelaySec, secB: v0.delaySec, secC: v0.delay,
    blocksA: v0.votingDelayBlocks, blocksB: v0.delayBlocks, blocksC: v0.delayBlk
  })
  const period = pickTime({
    secA: v0.votingPeriodSec, secB: v0.periodSec, secC: v0.period,
    blocksA: v0.votingPeriodBlocks, blocksB: v0.periodBlocks, blocksC: v0.periodBlk
  })
  const timelock = pickTime({
    secA: v0.timelockSec, secB: v0.minDelaySec, secC: v0.executionDelaySec ?? v0.timelock,
    blocksA: v0.timelockBlocks, blocksB: v0.delayBlocks, blocksC: v0.execDelayBlocks
  })

  return {
    quorumBps,
    proposalThresholdAbs,
    proposalThresholdBps,
    delay,
    period,
    timelock,
    _raw: v0,
  }
}

function fmtSecondsSmart(s?: number) {
  if (!Number.isFinite(s as number)) return undefined
  const n = Math.max(0, Math.round(s as number))
  if (n < 60) return `${n}s`
  const m = Math.round(n / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

function fmtTimeRow(t?: { seconds?: number; blocks?: number }) {
  if (!t || (t.seconds == null && t.blocks == null)) return '—'
  const s = fmtSecondsSmart(t.seconds)
  const b = Number.isFinite(t.blocks as number) ? `${t.blocks} blocks` : undefined
  // Show both if we have both; otherwise show whichever exists
  if (s && b) return `${s} (${b})`
  return s || b || '—'
}




/* --------------------------------- utils --------------------------------- */
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
function isAddr(s?: string) { return !!s && /^0x[a-fA-F0-9]{40}$/.test(s) }

function fmtUsdCompactSmart(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  const maxFrac = abs >= 1000 ? 1 : abs >= 100 ? 1 : 2
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: maxFrac,
  }).format(n)
}
function fmtUsdFull(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
}
function relTime(d?: Date) {
  if (!d) return '—'
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24); return `${days}d ago`
}

/* --------------------------------- types --------------------------------- */
type P = {
  id: string
  title: string
  status?: string
  phase?: 'discussion' | 'onchain'
  counters?: { comments: number; votes: number }
  amount?: string | null
  createdAt?: any
}
function derivePhase(r: any): 'discussion' | 'onchain' {
  if (r?.phase === 'discussion' || r?.phase === 'onchain') return r.phase
  const s = (r?.status || '').toLowerCase()
  return ['submitted', 'active', 'deciding', 'voting', 'confirming', 'ongoing'].includes(s) ? 'onchain' : 'discussion'
}

/* --------------------------------- page ---------------------------------- */
export default function Overview() {
  const { daos, current, loading } = useDAO()
  // NEW: live DAO doc (mirrors what you did in Treasury)
  const [daoLive, setDaoLive] = useState<any | null>(null)
  const [showDaoInfo, setShowDaoInfo] = useState(false)
  useEffect(() => {
    if (!current?.id) { setDaoLive(null); return }
    const ref = doc(db, 'daos', current.id)
    const unsub = onSnapshot(ref, (snap) => {
      setDaoLive(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null)
    })
    return unsub
  }, [current?.id])


  const nav = useNavigate()

  // Latest proposals (small list for activity)
  const { items, loading: loadingItems, error: itemsError } = useDaoProposals(current?.id, { limit: 3 })

  // Counts for “Passed”
  const { passed, activeOnchain } = useDaoCounts(current?.id)

  /* ------------------------ treasury cache (read/refresh) ------------------------ */
  const treasAddr =
    (daoLive as any)?.treasury ??
    (current as any)?.treasury ??        // fallback
    (daoLive as any)?.treasAddr ??       // legacy fallback
    (current as any)?.treasAddr          // legacy fallback

  const treasAddrValid = isAddr(treasAddr)

  // Prefer live trackedTokens; fall back to current; include legacy key just in case
  const trackedTokens =
    (daoLive as any)?.trackedTokens ??
    (current as any)?.trackedTokens ??
    (daoLive as any)?.trackingTokens ??   // if you ever had this older field
    []

  const trackedCount = Array.isArray(trackedTokens) ? trackedTokens.length : 0

  const daoAddr: string | undefined = (() => {
    const cand =
      (daoLive as any)?.daoAddress ||
      (current as any)?.daoAddress ||
      (daoLive as any)?.address ||
      (current as any)?.address ||
      (isAddr((current as any)?.id) ? (current as any)?.id : undefined)
    return isAddr(cand) ? cand : undefined
  })()


  // Prefer live treasuryCache
  const treasuryTotal = (daoLive as any)?.treasuryCache?.totalUsd ??
    (current as any)?.treasuryCache?.totalUsd

  const tsAny = (daoLive as any)?.treasuryCache?.updatedAt ??
    (current as any)?.treasuryCache?.updatedAt

  const tsMs = (daoLive as any)?.treasuryCache?.updatedAtMs ??
    (current as any)?.treasuryCache?.updatedAtMs

  const lastRefreshed: Date | undefined = (() => {
    try {
      if (tsAny?.toDate) return tsAny.toDate() as Date
      if (typeof tsMs === 'number' && Number.isFinite(tsMs)) return new Date(tsMs)
    } catch { }
    return undefined
  })()



  const [treasuryRefreshing, setTreasuryRefreshing] = useState(false)
  const [treasuryError, setTreasuryError] = useState<string | null>(null)

  type ChainParams = {
    admin: string
    treasury: string
    token: string
    votingDelayBlocks: number
    votingPeriodBlocks: number
    quorumBps: number
  }

  const [chainParams, setChainParams] = useState<ChainParams | null>(null)
  const [chainParamsLoading, setChainParamsLoading] = useState(false)
  const [chainParamsError, setChainParamsError] = useState<string | null>(null)

  // In-memory cache for this component instance
  const chainParamsCacheRef = useRef<Record<string, ChainParams>>({})
  // Track last key we fetched to avoid duplicate calls while open
  const lastFetchedKeyRef = useRef<string | null>(null)

  async function openDaoInfo() {
    setShowDaoInfo(true)
    if (!daoAddr) return
    const key = `${CHAIN.id}:${daoAddr.toLowerCase()}`
    // Serve from cache if present
    if (chainParamsCacheRef.current[key]) {
      setChainParams(chainParamsCacheRef.current[key])
      setChainParamsError(null)
      setChainParamsLoading(false)
      return
    }
    // Avoid double-fetch while open
    if (lastFetchedKeyRef.current === key && chainParamsLoading) return

    try {
      lastFetchedKeyRef.current = key
      setChainParamsLoading(true)
      setChainParamsError(null)
      const p = await readGovernanceConfig(daoAddr)
      chainParamsCacheRef.current[key] = p
      setChainParams(p)
    } catch (e: any) {
      setChainParamsError(e?.message || 'Failed to read DAO params')
    } finally {
      setChainParamsLoading(false)
    }
  }


  // Auto-refresh ONCE per DAO per session if config makes sense
  const didRefreshRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    const id = current?.id
    if (!id) return
    if (!treasAddrValid || trackedCount === 0) return
    if (didRefreshRef.current[id]) return

    didRefreshRef.current[id] = true
      ; (async () => {
        try {
          setTreasuryError(null)
          setTreasuryRefreshing(true)
          dlog('Overview: auto-refresh treasury cache for', id)
          await refreshTreasuryCache(id)
        } catch (e: any) {
          console.warn('[Overview] auto-refresh failed:', e)
          setTreasuryError(e?.message || 'Failed to refresh treasury.')
        } finally {
          setTreasuryRefreshing(false)
        }
      })()
  }, [current?.id, treasAddrValid, trackedCount])

  async function onManualRefresh() {
    if (!current?.id) return
    try {
      setTreasuryError(null)
      setTreasuryRefreshing(true)
      await refreshTreasuryCache(current.id)
    } catch (e: any) {
      setTreasuryError(e?.message || 'Failed to refresh treasury.')
    } finally {
      setTreasuryRefreshing(false)
    }
  }

  /* --------------------------------- stats --------------------------------- */
  const forYou = useMemo(() => {
    return [...items]
      .sort((a, b) => (b?.createdAt?.toMillis?.() ?? 0) - (a?.createdAt?.toMillis?.() ?? 0))
      .slice(0, 4)
  }, [items])

  /* ----------------------------- loading/empty UI ---------------------------- */
  if (loading) {
    return (
      <div className="space-y-6">
        <section className="card p-6 animate-pulse">
          <div className="h-6 w-52 bg-brand-line/50 rounded mb-3" />
          <div className="h-4 w-96 bg-brand-line/40 rounded" />
        </section>
      </div>
    )
  }

  if (!loading && daos.length === 0) {
    return (
      <div className="flex items-center justify-center h-[56vh]">
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl font-semibold">Create your first DAO</h1>
          <p className="text-slate mt-2 max-w-[60ch]">
            You don’t have any DAOs yet. Start by creating one to enable proposals, treasury, and governance.
          </p>
          <button onClick={() => nav('/daos/new')} className="btn-cta inline-flex items-center mt-5">
            <Plus size={16} className="mr-2" /> Create DAO
          </button>
        </div>
      </div>
    )
  }

  /* --------------------------------- render -------------------------------- */
  const treasuryValue = treasAddrValid && trackedCount > 0 && !treasuryRefreshing
    ? fmtUsdCompactSmart(treasuryTotal)
    : (!treasAddrValid ? 'Setup' : (trackedCount === 0 ? 'Setup' : 'Fetching…'))

  const treasurySub =
    !treasAddrValid ? 'Add treasury address'
      : trackedCount === 0 ? 'Track up to 3 tokens'
        : (treasuryRefreshing ? 'Updating…' : (lastRefreshed ? `Updated ${relTime(lastRefreshed)}` : 'Not yet refreshed'))

  return (
    <div className="space-y-6">
      {/* HERO */}
      <motion.section
        className="card p-6 hero overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const mx = Math.round(e.clientX - rect.left - rect.width / 2) / 10
          const my = Math.round(e.clientY - rect.top) / 10
          e.currentTarget.style.setProperty('--mx', `${mx}px`)
          e.currentTarget.style.setProperty('--my', `${my}px`)
        }}
      >
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 md:gap-8">
          {/* Left: text */}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold">
              {current?.name ? `${current.name} Governance` : 'DAO Governance'}
            </h1>
            <p className="text-slate mt-1 md:max-w-[60ch]">
              The Alkebuleum governance hub for this DAO — propose ideas, discuss, and vote on decisions.
              <button
                className="ml-2 inline-flex items-center text-brand-primary hover:underline text-sm align-baseline"
                onClick={openDaoInfo}
              >
                <Info size={14} className="mr-1" /> About this DAO
              </button>

            </p>

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <Link to="/proposals/new" className="btn-cta inline-flex items-center">
                <Plus size={16} className="mr-2" /> Create Proposal
              </Link>
              <Link to="/proposals" className="btn inline-flex items-center">
                <BarChart3 size={16} className="mr-2" /> View Proposals
              </Link>
            </div>
          </div>

          {/* Right: summary stats */}
          <div className="shrink-0 w-full md:w-[420px]">
            <div className="grid grid-cols-3 md:grid-cols-3 gap-3">
              <StatCard
                label="Treasury"
                value={treasuryValue}
                valueTitle={fmtUsdFull(treasuryTotal)}
                sub={treasurySub}
                onRefresh={(treasAddrValid && trackedCount > 0) ? onManualRefresh : undefined}
                refreshing={treasuryRefreshing}
              />
              <StatCard
                label="Active"
                value={String(activeOnchain)}
                sub="On-chain now"
              />
              <StatCard
                label="Passed"
                value={String(passed)}
                sub="All-time"
              />
            </div>

            {treasuryError && (
              <div className="mt-2 text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                {treasuryError}
              </div>
            )}

            {!treasAddrValid && (
              <div className="mt-2 text-[11px]">
                <Link to="/treasury" className="text-brand-primary hover:underline">Set a treasury address</Link> to enable the summary.
              </div>
            )}
            {treasAddrValid && trackedCount === 0 && (
              <div className="mt-2 text-[11px]">
                <Link to="/treasury" className="text-brand-primary hover:underline">Track tokens</Link> (AKE / vote token / ERC-20) to compute a total.
              </div>
            )}
          </div>
        </div>
      </motion.section>

      {/* QUICK ACTIONS */}
      <section className="grid sm:grid-cols-3 gap-3">
        <QuickAction icon={<Plus size={16} />} title="Start a draft" desc="Open a discussion before submitting." onClick={() => nav('/proposals/new')} />
        <QuickAction icon={<Rocket size={16} />} title="Send to chain" desc="Move a draft to on-chain voting." onClick={() => nav('/proposals')} />
        <QuickAction icon={<BarChart3 size={16} />} title="See what’s trending" desc="Active proposals & hot discussions." onClick={() => nav('/proposals')} />
      </section>

      {/* ACTIVITIES */}
      <motion.section className="card p-5" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Activities</h2>
          <Link to="/proposals" className="text-brand-primary inline-flex items-center">
            View all <ChevronRight size={16} className="ml-1" />
          </Link>
        </div>

        {itemsError && (
          <div className="mt-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            <strong>Failed to load proposals:</strong> {itemsError}
          </div>
        )}

        <div className="mt-2">
          {loadingItems && (
            <>
              <ProposalRow.Skeleton withDivider />
              <ProposalRow.Skeleton withDivider />
              <ProposalRow.Skeleton />
            </>
          )}

          {!loadingItems && !itemsError && forYou.length === 0 && (
            <div className="py-6 text-slate text-sm">No items yet. Be the first to create a proposal.</div>
          )}

          {!itemsError && forYou.map((r, i) => (
            <ProposalRow
              key={r.id}
              withDivider={i < forYou.length - 1}
              onClick={() => r.id && nav(`/proposals/${r.id}`)}
              data={{
                id: r.id,
                reservedId: r.reservedId ?? r.id,                 // show nice left-rail #
                title: r.title,
                status: r.status,
                // choose one of these amount inputs:
                amountText: r.amount,                       // e.g. "57.54K USDC" (string)
                // OR use numeric+unit if you have them:
                // amountNum: r.amountNum, amountUnit: r.amountUnit,

                author: {
                  name: r.orgName ?? r.author?.name ?? r.author,
                  avatar: r.author?.avatar ?? r.avatar,
                  org: r.orgName ?? r.author?.org,
                  verified: r.author?.verified ?? true,
                },
                time: r.time,
                counters: { comments: r.counters?.comments ?? 0 },
                badges: r.badges,                           // optional: [{label:'Small Spender',variant:'orange'}]
                progressPct: r.progressPct ?? 0,            // optional tiny progress
              }}
            />
          ))}
        </div>
      </motion.section>

      {/* LIGHT OVERVIEW */}
      <section className="grid md:grid-cols-2 gap-6">
        <motion.div className="card p-5" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <h3 className="font-semibold">Overview</h3>
          <ul className="mt-3 text-sm text-slate space-y-2">
            <li className="flex items-center justify-between">
              <span>On-chain proposals</span>
              <span className="font-semibold text-ink">{items.filter((p) => derivePhase(p) === 'onchain').length}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Discussions</span>
              <span className="font-semibold text-ink">{items.filter((p) => derivePhase(p) === 'discussion').length}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Total items</span>
              <span className="font-semibold text-ink">{items.length}</span>
            </li>
          </ul>
        </motion.div>

        <motion.div className="card p-5" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <h3 className="font-semibold">Quick tips</h3>
          <ul className="mt-3 text-sm text-slate list-disc pl-5 space-y-1">
            <li>Use <span className="font-medium">Discussion</span> for drafts.</li>
            <li>Promote when ready to <span className="font-medium">Proposals</span> (on-chain).</li>
            <li>Write in Markdown for clean formatting.</li>
          </ul>
        </motion.div>
      </section>
      <DaoInfoModal
        open={showDaoInfo}
        onClose={() => setShowDaoInfo(false)}
        dao={daoLive || current}
        treasAddr={treasAddrValid ? treasAddr : undefined}
        trackedTokens={trackedTokens}
        daoAddr={daoAddr}
        chainParams={chainParams}
        chainParamsLoading={chainParamsLoading}
        chainParamsError={chainParamsError}
      />


    </div>
  )
}

/* --- helpers --- */
function StatCard({
  label, value, valueTitle, sub, onRefresh, refreshing,
}: {
  label: string
  value: string
  valueTitle?: string
  sub: string
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const timerRef = useRef<number | null>(null)

  function revealTemporarily() {
    if (!onRefresh) return
    setRevealed(true)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setRevealed(false), 2500)
  }
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  return (
    <motion.div
      className="card p-4 group relative"
      whileHover={{ y: -2, boxShadow: '0 16px 40px rgba(15,23,42,0.12)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onClick={revealTemporarily}
      onKeyDown={(e) => {
        if (!onRefresh) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); revealTemporarily() }
      }}
      tabIndex={onRefresh ? 0 : -1}
    >
      <div className="text-slate text-xs flex items-center justify-between">
        <span>{label}</span>
        {onRefresh && (
          <button
            className={[
              'inline-flex items-center text-xs px-2 py-1 rounded border border-brand-line',
              'hover:bg-brand-line/40 transition-opacity',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              revealed ? 'opacity-100' : '',
            ].join(' ')}
            onClick={(e) => { e.stopPropagation(); onRefresh() }}
            disabled={refreshing}
            title="Refresh from chain"
          >
            <RotateCw size={12} className={`mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {/* number formatting + layout stability */}
      <div
        className="text-2xl font-bold mt-1 whitespace-nowrap overflow-hidden text-ellipsis tabular-nums tracking-tight"
        title={valueTitle || value}
      >
        {value}
      </div>
      <div className="mt-2 text-xs text-slate">{sub}</div>
    </motion.div>
  )
}

function QuickAction({ icon, title, desc, onClick }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} className="card p-4 text-left hover:bg-brand-line/40 transition">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-brand-line/70">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="font-medium truncate">{title}</div>
          <div className="text-xs text-slate">{desc}</div>
        </div>
      </div>
    </button>
  )
}


function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-brand-line last:border-none">
      <div className="text-xs text-slate">{label}</div>
      <div className="text-xs font-medium text-ink text-right break-all">{value}</div>
    </div>
  )
}

function TokenList({ tokens }: { tokens?: any[] }) {
  if (!Array.isArray(tokens) || tokens.length === 0) return null
  return (
    <div className="space-y-1">
      {tokens.map((t, i) => (
        <div key={i} className="text-xs font-medium text-ink break-all">
          {typeof t === 'string' ? t : (t?.address || JSON.stringify(t))}
        </div>
      ))}
    </div>
  )
}

function fmtSeconds(s?: number) {
  if (!s || !Number.isFinite(s)) return undefined
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

function DaoInfoModal({
  open, onClose, dao, treasAddr, trackedTokens,
  daoAddr, chainParams, chainParamsLoading, chainParamsError,
}: {
  open: boolean
  onClose: () => void
  dao: any
  treasAddr?: string
  trackedTokens?: any[]
  daoAddr?: string
  chainParams?: {
    admin: string
    treasury: string
    token: string
    votingDelayBlocks: number
    votingPeriodBlocks: number
    quorumBps: number
    /** optional if you wired it in getParams() */
    timelockDelaySec?: number
  } | null
  chainParamsLoading?: boolean
  chainParamsError?: string | null
}) {
  if (!open) return null

  // fallbacks from DAO doc
  const daoAddress = daoAddr || dao?.daoAddress || dao?.address || dao?.id
  const voteTokenDoc = dao?.voteToken || dao?.votesToken
  const network = dao?.chainName || dao?.network || dao?.chainId

  // Normalize *doc* voting fields (quorum/delay/period/timelock) as a fallback
  const norm = normalizeVotingConfig(dao)

  // Prefer on-chain params when available
  const view = React.useMemo(() => {
    if (chainParams) {
      return {
        quorumBps: chainParams.quorumBps,
        delay: {
          seconds: chainParams.votingDelayBlocks * SEC_PER_BLOCK,
          blocks: chainParams.votingDelayBlocks,
        },
        period: {
          seconds: chainParams.votingPeriodBlocks * SEC_PER_BLOCK,
          blocks: chainParams.votingPeriodBlocks,
        },
        timelock: {
          seconds: chainParams.timelockDelaySec,
          blocks: undefined as number | undefined,
        },
      }
    }
    return {
      quorumBps: norm.quorumBps,
      delay: norm.delay,
      period: norm.period,
      timelock: norm.timelock,
    }
  }, [chainParams, norm])

  const treasuryDisplay = chainParams?.treasury ?? treasAddr
  const voteTokenDisplay = chainParams?.token ?? voteTokenDoc
  const adminDisplay = chainParams?.admin

  const bpsToPct = (bps?: number) =>
    bps == null ? undefined : `${(bps / 100).toFixed(2)}%`

  return (
    <div
      className="fixed inset-0 z-[100] flex"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-[101] mx-auto my-auto w-[96vw] max-w-[640px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Card container: header + scrollable body + footer */}
        <div className="card p-0 shadow-2xl max-h-[80vh] flex flex-col">
          {/* Header (outside scroller) */}
          <div className="px-5 pt-5 pb-3 bg-white/90 backdrop-blur border-b border-brand-line flex items-center justify-between sticky top-0">
            <div className="flex items-center gap-2">
              <Settings size={18} />
              <h3 className="font-semibold">About this DAO</h3>
            </div>
            <button
              className="text-slate hover:text-ink"
              aria-label="Close"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          {/* Body (scrollable) */}
          <div className="px-5 py-4 overflow-y-auto">
            {/* Basics */}
            <Row label="Name" value={dao?.name || '—'} />
            <Row label="DAO Address" value={daoAddress || '—'} />
            <Row label="Treasury" value={treasuryDisplay || '—'} />
            <Row label="Vote Token" value={voteTokenDisplay || '—'} />
            {adminDisplay && <Row label="Admin (on-chain)" value={adminDisplay} />}

            {/* Voting settings */}
            <div className="mt-5 text-[11px] text-slate font-semibold uppercase tracking-wide">
              Voting Settings
            </div>

            {chainParamsLoading && !chainParams && (
              <div className="mt-1 text-xs text-slate">Reading from chain…</div>
            )}
            {chainParamsError && (
              <div className="mt-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                {chainParamsError}
              </div>
            )}

            <div className="mt-1">
              <Row
                label="Quorum"
                value={
                  view.quorumBps != null
                    ? `${view.quorumBps} bps (${bpsToPct(view.quorumBps)})`
                    : '—'
                }
              />
              <Row label="Voting Delay" value={fmtTimeRow(view.delay)} />
              <Row label="Voting Period" value={fmtTimeRow(view.period)} />
              <Row
                label="Timelock"
                value={
                  view.timelock?.seconds != null || view.timelock?.blocks != null
                    ? fmtTimeRow(view.timelock)
                    : '—'
                }
              />
            </div>
          </div>

          {/* Footer (outside scroller) */}
          <div className="px-5 py-3 bg-white/90 backdrop-blur border-t border-brand-line flex items-center justify-end gap-2 sticky bottom-0">
            <button className="btn-cta text-sm" onClick={onClose}>Close</button>
          </div>
        </div>
      </motion.div>
    </div>
  )

}


