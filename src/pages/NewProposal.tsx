import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createProposal } from '../lib/firebase'
import { useRequireAuth } from '../lib/requireAuth'
import { useDAO } from '../lib/dao'
import Markdown from '../lib/markdown'
import { reserveDraftOnchain, computeOffchainRef, computeDescriptionHash } from '../lib/daoProposals'


type FormState = {
  title: string
  summary: string
  category: 'BUDGET' | 'VOTING_CONFIG' | 'SET_ADMIN' | 'SET_VOTE_TOKEN' | 'EMERGENCY_CANCEL'
  tags: string
  body: string

  // BUDGET
  budgetAmount?: string
  budgetAsset?: string
  recipient?: string

  // VOTING_CONFIG
  votingDelayBlocks?: string
  votingPeriodBlocks?: string
  quorumBps?: string // absolute quorum, basis points (e.g. 1000 == 10.00%)
  treasuryTimelockSec?: string

  // SET_ADMIN
  newAdmin?: string

  // SET_VOTE_TOKEN
  newToken?: string

  // EMERGENCY_CANCEL
  cancelTargetId?: string

  // meta
  references?: string
  discussionUrl?: string
}




const UI_CATEGORIES = [
  { code: 'BUDGET', label: 'Treasury Transfer' },
  { code: 'VOTING_CONFIG', label: 'Change Voting Rules' },
  { code: 'SET_ADMIN', label: 'Rotate Admin' },
  { code: 'SET_VOTE_TOKEN', label: 'Change Vote Token' },
  { code: 'EMERGENCY_CANCEL', label: 'Emergency Cancellation' },
] as const
type CategoryCode = (typeof UI_CATEGORIES)[number]['code']

const ASSETS = ['AKE', 'MAH', 'USDC', 'ETH'] as const

const MAX_TITLE = 120
const MAX_SUMMARY = 300

const isNonEmpty = (v?: string) => v != null && String(v).trim() !== '';
const numOrUndef = (v?: string) => (isNonEmpty(v) ? Number(v) : undefined);

const isEthAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s)
function isHex(s: string) {
  return /^0x[0-9a-fA-F]*$/.test(s)
}
const shortAddr = (a?: string, lead = 6, tail = 4) =>
  !a ? 'Anon' : a.slice(0, lead) + '…' + a.slice(-tail)

export default function NewProposal() {
  const { session, status } = useRequireAuth()
  const { current } = useDAO()
  const nav = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const loc = useLocation() as any

  useEffect(() => {
    const pf = loc?.state?.prefill
    if (!pf) return
    setForm(f => ({
      ...f,
      // only overwrite the fields we know
      category: 'EMERGENCY_CANCEL',
      title: pf.title ?? f.title,
      summary: pf.summary ?? f.summary,
      tags: pf.tags ?? f.tags,
      body: pf.body ?? f.body,
      cancelTargetId: pf.cancelTargetId ?? f.cancelTargetId,
    }))
    // optional: clear the state so a refresh doesn't re-apply
    if (history.replaceState) {
      history.replaceState({}, document.title, location.pathname)
    }
  }, [loc?.state])


  // Autosave per-DAO
  const STORAGE_KEY = useMemo(() => `ugov.draft.${current?.id ?? 'unknown'}`, [current?.id])
  const [form, setForm] = useState<FormState>(() => {
    const base: FormState = {
      title: '',
      summary: '',
      category: 'BUDGET',
      tags: '',
      body: '',
      // sensible defaults
      budgetAmount: '',
      budgetAsset: ASSETS[0],
      recipient: '',
      votingDelayBlocks: '',
      votingPeriodBlocks: '',
      quorumBps: '',
      treasuryTimelockSec: '',
      newAdmin: '',
      newToken: '',
      references: '',
      discussionUrl: '',
      cancelTargetId: '',
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? { ...base, ...(JSON.parse(raw) as FormState) } : base
    } catch {
      return base
    }
  })

  const fmtDurationSec = (s?: string) => {
    const n = Number(s || 0)
    if (!n || isNaN(n)) return '0s'
    const d = Math.floor(n / 86400)
    const h = Math.floor((n % 86400) / 3600)
    const m = Math.floor((n % 3600) / 60)
    const parts = []
    if (d) parts.push(`${d}d`)
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}m`)
    if (parts.length === 0) parts.push(`${n}s`)
    return `${parts.join(' ')} (${n}s)`
  }




  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
  }, [STORAGE_KEY, form])

  // Cmd/Ctrl+Enter submit
  const formRef = useRef<HTMLFormElement | null>(null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') formRef.current?.requestSubmit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (status !== 'ready') return <div className="text-slate">Checking session…</div>
  if (!session) return null
  if (!current) {
    return (
      <div className="card p-6 max-w-2xl">
        <h2 className="text-xl font-semibold mb-2">No DAO selected</h2>
        <p className="text-slate">Select or create a DAO before creating a proposal.</p>
      </div>
    )
  }

  // Category flags
  const isBudget = form.category === 'BUDGET'
  const isVotingCfg = form.category === 'VOTING_CONFIG'
  const isSetAdmin = form.category === 'SET_ADMIN'
  const isSetVoteToken = form.category === 'SET_VOTE_TOKEN'
  const isEmergencyCancel = form.category === 'EMERGENCY_CANCEL'


  function validate(): string | null {
    if (!form.title.trim()) return 'Title is required.'
    if (form.title.length > MAX_TITLE) return `Title must be ≤ ${MAX_TITLE} characters.`
    if (!form.summary.trim()) return 'Short summary is required.'
    if (form.summary.length > MAX_SUMMARY) return `Summary must be ≤ ${MAX_SUMMARY} characters.`
    if (!form.body.trim()) return 'Description is required.'

    if (isBudget) {
      if (!form.budgetAmount?.trim()) return 'Budget amount is required.'
      if (isNaN(Number(form.budgetAmount))) return 'Budget amount must be a number.'
      if (!form.budgetAsset?.trim()) return 'Please choose an asset.'
      if (!form.recipient?.trim()) return 'Recipient address is required.'
      if (!isEthAddr(form.recipient.trim())) return 'Recipient must be a valid 0x address.'
    }

    if (isVotingCfg) {
      if (!form.votingDelayBlocks?.trim()) return 'Voting delay (blocks) is required.'
      if (!/^\d+$/.test(form.votingDelayBlocks)) return 'Voting delay must be an integer.'
      if (!form.votingPeriodBlocks?.trim()) return 'Voting period (blocks) is required.'
      if (!/^\d+$/.test(form.votingPeriodBlocks)) return 'Voting period must be an integer.'
      if (!form.quorumBps?.trim()) return 'Quorum (bps) is required.'
      if (!/^\d+$/.test(form.quorumBps)) return 'Quorum must be basis points (e.g., 1000 = 10.00%).'
      if (!form.treasuryTimelockSec?.trim()) return 'Treasury timelock (seconds) is required.'
      if (!/^\d+$/.test(form.treasuryTimelockSec)) return 'Treasury timelock must be an integer number of seconds.'


    }

    if (isEmergencyCancel) {
      if (!form.cancelTargetId?.trim()) return 'Target proposal number is required.'
      if (!/^\d+$/.test(form.cancelTargetId.trim())) return 'Target proposal number must be an integer.'
    }


    if (isSetAdmin) {
      if (!form.newAdmin?.trim()) return 'New admin address is required.'
      if (!isEthAddr(form.newAdmin.trim())) return 'New admin must be a valid 0x address.'
    }

    if (isSetVoteToken) {
      if (!form.newToken?.trim()) return 'New vote token address is required.'
      if (!isEthAddr(form.newToken.trim())) return 'New vote token must be a valid 0x address.'
    }

    if (form.references) {
      const urls = form.references.split('\n').map(s => s.trim()).filter(Boolean)
      const bad = urls.find(u => !/^https?:\/\//i.test(u))
      if (bad) return `Reference must be a valid URL: ${bad}`
    }
    if (form.discussionUrl && !/^https?:\/\//i.test(form.discussionUrl))
      return 'Discussion URL must be a valid link.'
    return null
  }

  const previewMd = useMemo(() => {
    const refs = form.references
      ? form.references
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .map(u => `- ${u}`)
        .join('\n')
      : ''

    const header: string[] = [
      `# ${form.title || 'Untitled Proposal'}`,
      '',
      `**Category:** ${form.category}${form.tags ? `   **Tags:** ${form.tags}` : ''}`,
      form.summary ? `> ${form.summary}` : '',
    ]

    if (isBudget && form.budgetAmount) {
      header.push(`**Requested Transfer:** ${form.budgetAmount} ${form.budgetAsset}`)
      if (form.recipient) header.push(`**Recipient:** \`${form.recipient}\``)
    }

    if (isVotingCfg) {
      if (form.votingDelayBlocks) header.push(`**Voting Delay:** ${form.votingDelayBlocks} blocks`)
      if (form.votingPeriodBlocks) header.push(`**Voting Period:** ${form.votingPeriodBlocks} blocks`)
      if (form.quorumBps) header.push(`**Quorum:** ${(Number(form.quorumBps) / 100).toFixed(2)}%`)
      if (form.treasuryTimelockSec)
        header.push(`**Treasury Timelock:** ${fmtDurationSec(form.treasuryTimelockSec)}`)

    }
    if (isEmergencyCancel && form.cancelTargetId) {
      header.push(`**Emergency Cancel Target:** #${form.cancelTargetId}`)
    }

    if (isSetAdmin && form.newAdmin) {
      header.push(`**New Admin:** \`${form.newAdmin}\``)
    }

    if (isSetVoteToken && form.newToken) {
      header.push(`**New Vote Token:** \`${form.newToken}\``)
    }

    if (form.discussionUrl) header.push(`**Discussion:** ${form.discussionUrl}`)
    if (refs) header.push('', '**References:**', refs)

    return `${header.filter(Boolean).join('\n')}\n\n${form.body}`
  }, [form, isBudget, isVotingCfg, isSetAdmin, isSetVoteToken])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true)
    try {
      // Build offchainRef + description hash
      const metaForRef: any = {
        dao: current.address,
        title: form.title.trim(),
        summary: form.summary.trim(),
        category: form.category,
        tags: form.tags,
        author: session.address,
        createdAt: Date.now(),
      }
      if (isBudget) {
        metaForRef.budget = {
          amount: Number(form.budgetAmount),
          asset: form.budgetAsset,
          recipient: form.recipient?.trim(),
        }
      }
      if (isVotingCfg) {
        metaForRef.votingDelayBlocks = Number(form.votingDelayBlocks)
        metaForRef.votingPeriodBlocks = Number(form.votingPeriodBlocks)
        metaForRef.quorumBps = Number(form.quorumBps)
        metaForRef.treasuryTimelockSec = Number(form.treasuryTimelockSec)

      }
      if (isEmergencyCancel) {
        metaForRef.cancelTargetId = Number(form.cancelTargetId)
      }
      if (isSetAdmin) metaForRef.newAdmin = form.newAdmin?.trim()
      if (isSetVoteToken) metaForRef.newToken = form.newToken?.trim()

      const offchainRef = computeOffchainRef(metaForRef)
      const descriptionHash = computeDescriptionHash(previewMd)

      // Reserve on-chain localId up-front (required)
      //const popup = preOpenAmvaultPopup()
      let onchainLocalId: string | null = null
      try {
        const out = await reserveDraftOnchain(current.address, offchainRef, { timeoutMs: 120_000 })
        onchainLocalId = out.localId
      } finally {
      }

      const category = form.category as 'BUDGET' | 'VOTING_CONFIG' | 'SET_ADMIN' | 'SET_VOTE_TOKEN' | 'EMERGENCY_CANCEL';

      // Save to Firebase
      await createProposal(current.id, {
        title: form.title.trim(),
        summary: form.summary.trim(),
        category,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        bodyMd: previewMd,

        // Category-specific fields (only include if present)
        ...(category === 'BUDGET' && isNonEmpty(form.budgetAmount) && form.budgetAsset && isNonEmpty(form.recipient) ? {
          budget: {
            amount: Number(form.budgetAmount),
            asset: form.budgetAsset,
            recipient: form.recipient.trim(),
          },
        } : {}),

        ...(category === 'VOTING_CONFIG' ? {
          ...(numOrUndef(form.votingDelayBlocks) != null ? { votingDelayBlocks: numOrUndef(form.votingDelayBlocks)! } : {}),
          ...(numOrUndef(form.votingPeriodBlocks) != null ? { votingPeriodBlocks: numOrUndef(form.votingPeriodBlocks)! } : {}),
          ...(numOrUndef(form.quorumBps) != null ? { quorumBps: numOrUndef(form.quorumBps)! } : {}),
          ...(numOrUndef(form.treasuryTimelockSec) != null ? { treasuryTimelockSec: numOrUndef(form.treasuryTimelockSec)! } : {}),
        } : {}),

        ...(category === 'EMERGENCY_CANCEL' && isNonEmpty(form.cancelTargetId) ? {
          cancelTargetId: Number(form.cancelTargetId),
        } : {}),


        ...(category === 'SET_ADMIN' && isNonEmpty(form.newAdmin) ? { newAdmin: form.newAdmin!.trim() } : {}),
        ...(category === 'SET_VOTE_TOKEN' && isNonEmpty(form.newToken) ? { newToken: form.newToken!.trim() } : {}),

        // On-chain linkage
        daoAddress: current.address,
        ...(offchainRef ? { offchainRef: offchainRef as `0x${string}` } : {}),
        descriptionHash: null,
        ...(onchainLocalId ? { reservedId: onchainLocalId } : {}),
        onchainReserved: true,

        // Extras
        discussionUrl: form.discussionUrl || null,
        references: form.references
          ? form.references.split('\n').map(s => s.trim()).filter(Boolean)
          : [],

        // author / denorms
        author: {
          name: session.ain,
          address: session.address,
          avatar: Math.max(1, (parseInt((session.address || '0x0').slice(2, 10), 16) % 4) + 1),
        },
        daoName: current.name ?? null,
      })

      localStorage.removeItem(STORAGE_KEY)
      nav('/proposals')
    } catch (err: any) {
      console.error('[proposal:create] failed:', err)
      setError(err?.message || 'Submission failed.')
    } finally {
      setLoading(false)
    }
  }

  const titleCount = `${form.title.length}/${MAX_TITLE}`
  const summaryCount = `${form.summary.length}/${MAX_SUMMARY}`

  return (
    <div className="card p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Create Proposal</h1>
        <div className="text-xs text-slate-500">Draft autosaved • Cmd/Ctrl+Enter to publish</div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <form ref={formRef} className="space-y-5" onSubmit={onSubmit}>
        {/* Title */}
        <div>
          <div className="label flex items-center justify-between">
            <span>Title</span>
            <span className="text-xs text-slate-500">{titleCount}</span>
          </div>
          <input
            className="input"
            placeholder="Proposal title"
            value={form.title}
            maxLength={MAX_TITLE}
            onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
            required
          />
        </div>

        {/* Summary */}
        <div>
          <div className="label flex items-center justify-between">
            <span>Short Summary</span>
            <span className="text-xs text-slate-500">{summaryCount}</span>
          </div>
          <textarea
            className="textarea"
            placeholder="One-paragraph summary (what / why / impact)"
            value={form.summary}
            maxLength={MAX_SUMMARY}
            onChange={(e) => setForm(f => ({ ...f, summary: e.target.value }))}
            required
          />
        </div>

        {/* Category + Tags */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="label">Category</div>
            <select
              className="select"
              value={form.category as CategoryCode}
              onChange={(e) => setForm(f => ({ ...f, category: e.target.value as CategoryCode }))}
            >
              {UI_CATEGORIES.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="label">Tags (comma-separated)</div>
            <input
              className="input"
              placeholder="eg. foundation, launch, governance"
              value={form.tags}
              onChange={(e) => setForm(f => ({ ...f, tags: e.target.value }))}
            />
          </div>
        </div>

        {/* --------- Category-specific blocks --------- */}

        {/* BUDGET */}
        {isBudget && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="label">Amount</div>
              <input
                className="input"
                placeholder="e.g., 10000"
                value={form.budgetAmount}
                onChange={(e) => setForm(f => ({ ...f, budgetAmount: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Asset</div>
              <select
                className="select"
                value={form.budgetAsset}
                onChange={(e) => setForm(f => ({ ...f, budgetAsset: e.target.value }))}
              >
                {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <div className="label">Recipient Address</div>
              <input
                className="input font-mono"
                placeholder="0x…"
                value={form.recipient}
                onChange={(e) => setForm(f => ({ ...f, recipient: e.target.value }))}
              />
            </div>
          </div>
        )}

        {/* VOTING_CONFIG */}
        {isVotingCfg && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <div className="label">Voting Delay (blocks)</div>
              <input
                className="input"
                placeholder="e.g., 20"
                value={form.votingDelayBlocks}
                onChange={(e) => setForm(f => ({ ...f, votingDelayBlocks: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Voting Period (blocks)</div>
              <input
                className="input"
                placeholder="e.g., 200"
                value={form.votingPeriodBlocks}
                onChange={(e) => setForm(f => ({ ...f, votingPeriodBlocks: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Quorum (bps)</div>
              <input
                className="input"
                placeholder="1000 = 10.00%"
                value={form.quorumBps}
                onChange={(e) => setForm(f => ({ ...f, quorumBps: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Treasury Timelock (seconds)</div>
              <input
                className="input"
                placeholder="86400 = 1 day"
                value={form.treasuryTimelockSec}
                onChange={(e) => setForm(f => ({ ...f, treasuryTimelockSec: e.target.value }))}
              />
            </div>
          </div>
        )}
        {/* SET_EMERGENCYCANCEL */}
        {isEmergencyCancel && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label">Target Proposal # (localId)</div>
              <input
                className="input"
                placeholder="e.g., 123"
                value={form.cancelTargetId}
                onChange={(e) => setForm(f => ({ ...f, cancelTargetId: e.target.value }))}
              />
            </div>
            <div className="text-xs text-slate self-end">
              This draft will go to a vote proposing to cancel the selected proposal.
            </div>
          </div>
        )}



        {/* SET_ADMIN */}
        {isSetAdmin && (
          <div>
            <div className="label">New Admin Address</div>
            <input
              className="input font-mono"
              placeholder="0x…"
              value={form.newAdmin}
              onChange={(e) => setForm(f => ({ ...f, newAdmin: e.target.value }))}
            />
          </div>
        )}

        {/* SET_VOTE_TOKEN */}
        {isSetVoteToken && (
          <div>
            <div className="label">New Vote Token Address</div>
            <input
              className="input font-mono"
              placeholder="0x…"
              value={form.newToken}
              onChange={(e) => setForm(f => ({ ...f, newToken: e.target.value }))}
            />
          </div>
        )}

        {/* References + Discussion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="label">Discussion URL (optional)</div>
            <input
              className="input"
              placeholder="https://forum.example.com/thread/123"
              value={form.discussionUrl}
              onChange={(e) => setForm(f => ({ ...f, discussionUrl: e.target.value }))}
            />
          </div>
          <div>
            <div className="label">References (one URL per line)</div>
            <textarea
              className="textarea font-mono"
              placeholder="https://alkebuleum.org/whitepaper.pdf"
              value={form.references}
              onChange={(e) => setForm(f => ({ ...f, references: e.target.value }))}
              rows={3}
            />
          </div>
        </div>

        {/* Editor / Preview */}
        <div className="flex gap-2">
          <button type="button"
            className={`px-3 py-1 rounded-lg border ${tab === 'edit' ? 'bg-slate-100' : ''}`}
            onClick={() => setTab('edit')}>Editor</button>
          <button type="button"
            className={`px-3 py-1 rounded-lg border ${tab === 'preview' ? 'bg-slate-100' : ''}`}
            onClick={() => setTab('preview')}>Preview</button>
        </div>

        {tab === 'edit' ? (
          <div>
            <div className="label">Description (Markdown)</div>
            <textarea
              className="textarea"
              placeholder="Describe your proposal (Markdown supported)"
              value={form.body}
              onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
              rows={10}
              required
            />
          </div>
        ) : (
          <div className="prose max-w-none border rounded-xl p-4 bg-white">
            <Markdown>{previewMd}</Markdown>
          </div>
        )}

        {/* Reserve on-chain now (required) */}
        <div className="flex items-center gap-2 opacity-70">
          <input id="reserveOnchain" type="checkbox" className="checkbox" checked readOnly disabled />
          <label htmlFor="reserveOnchain" className="text-sm text-slate-700">
            Reserve on-chain proposal number (required)
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-cta" type="submit" disabled={loading}>
            {loading ? 'Publishing…' : 'Publish'}
          </button>
          <button
            className="px-4 py-2 rounded-xl border border-brand-line"
            type="button"
            onClick={() => nav(-1)}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
