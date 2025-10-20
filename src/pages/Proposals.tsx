// src/pages/Proposals.tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import StatusChip from '../components/StatusChip'
import { MessageSquare, ThumbsUp, ThumbsDown, SquareCheckBig, Rocket } from 'lucide-react'
import { motion } from 'framer-motion'
import Markdown from '../lib/markdown'
import { useDAO } from '../lib/dao'
import { useDaoProposals } from '../lib/useDaoProposals'
import ProposalRow from '../components/ProposalRow'

type Mode = 'rows' | 'posts'
type Tab = 'discussion' | 'onchain'

function derivePhase(r: any): Tab {
  if (r?.phase === 'discussion' || r?.phase === 'onchain') return r.phase
  const s = (r?.status || '').toLowerCase()
  return ['submitted', 'active', 'deciding', 'voting', 'confirming', 'ongoing'].includes(s)
    ? 'onchain'
    : 'discussion'
}

function isActiveStatus(status?: string) {
  const s = (status || '').toLowerCase()
  if (!s) return true
  const inactive = new Set(['completed', 'rejected', 'failed', 'closed', 'withdrawn', 'canceled', 'timed out'])
  return !inactive.has(s)
}

export default function Proposals() {
  const [mode, setMode] = useState<Mode>('rows')
  const [tab, setTab] = useState<Tab>('discussion')
  const [promoting, setPromoting] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const nav = useNavigate()
  const initialTabSet = useRef(false)

  const { current } = useDAO()
  const { items, loading, error } = useDaoProposals(current?.id, { limit: 50 })

  // Decide initial tab once data is ready (prefer onchain if there are active on-chain items)
  useEffect(() => {
    if (initialTabSet.current) return
    if (loading) return
    const hasActiveOnchain = items.some(
      (r: any) => derivePhase(r) === 'onchain' && isActiveStatus(r.status)
    )
    setTab(hasActiveOnchain ? 'onchain' : 'discussion')
    initialTabSet.current = true
  }, [loading, items])

  // Filter according to active tab
  const list = items.filter((r) => derivePhase(r) === tab)

  const renderMeta = (r: any) => {
    const authorName = (r.author?.name ?? r.author) as string
    const authorSeed = (r.author?.avatar ?? r.avatar ?? 1) as number
    const time = (r.time ?? 'now') as string
    const comments = r.counters?.comments ?? r.comments ?? 0
    const votes = r.counters?.votes ?? r.votes ?? 0
    return (
      <div className="mt-1 flex items-center gap-2 text-sm text-slate">
        <Avatar name={authorName} seed={authorSeed} />
        <span className="font-medium">{authorName}</span> · {time} · <StatusChip status={r.status as any} /> ·{' '}
        <MessageSquare size={14} /> {comments} · <SquareCheckBig size={14} /> {votes}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Proposals</h1>
        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-2 rounded-lg border ${mode === 'rows' ? 'bg-brand-line/50 border-brand-line' : 'border-transparent hover:bg-brand-line/40'
              }`}
            onClick={() => setMode('rows')}
          >
            Row View
          </button>
          <button
            className={`px-3 py-2 rounded-lg border ${mode === 'posts' ? 'bg-brand-line/50 border-brand-line' : 'border-transparent hover:bg-brand-line/40'
              }`}
            onClick={() => setMode('posts')}
          >
            Post View
          </button>
          <Link className="btn-cta" to="/proposals/new">
            + Create Proposal
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-brand-line flex gap-6">
        <button
          className={`py-2 -mb-px border-b-2 ${tab === 'discussion' ? 'border-brand-accent text-ink' : 'border-transparent text-slate'
            }`}
          onClick={() => setTab('discussion')}
        >
          DRAFT
        </button>
        <button
          className={`py-2 -mb-px border-b-2 ${tab === 'onchain' ? 'border-brand-accent text-ink' : 'border-transparent text-slate'
            }`}
          onClick={() => setTab('onchain')}
        >
          ON-CHAIN
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}
      {actionError && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {actionError}
        </div>
      )}

      {/* Row View */}
      {mode === 'rows' ? (
        <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {loading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : list.length > 0 ? (
            list.map((r, i) => (
              <ProposalRow
                key={r.id ?? i}
                data={{
                  ...r,
                  amountNum: r.amountNum ?? r.amount,   // if your data has `amount`
                  amountUnit: r.amountUnit ?? 'USDC',
                  author: {
                    name: r.orgName ?? r.author?.name ?? r.author,
                    avatar: r.author?.avatar ?? r.avatar,
                    org: r.orgName ?? r.author?.name ?? r.author,
                    verified: true,                      // toggle per data
                  },
                  badges: r.badges ?? [],                // e.g., [{label:'Small Spender', variant:'orange'}]
                  progressPct: r.progressPct ?? 0,
                }}
                withDivider={i < list.length - 1}
                onClick={() => r.id && nav(`/proposals/${r.id}`)}
              />
            ))
          ) : (
            <div className="px-4 py-6 text-slate">No items yet.</div>
          )}
        </motion.div>
      ) : (
        // Post View
        <div className="space-y-4">
          {loading ? (
            <>
              <PostSkeleton />
              <PostSkeleton />
            </>
          ) : list.length > 0 ? (
            list.map((r, i) => (
              <motion.article
                key={r.id ?? i}
                className="card p-5"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                whileHover={{ y: -2 }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-slate text-sm">#{r.id}</div>
                  <StatusChip status={r.status as any} />
                </div>
                <h3 className="mt-2 text-xl font-semibold">
                  <Link to={`/proposals/${r.id}`} className="hover:underline">
                    {r.title}
                  </Link>
                </h3>
                {renderMeta(r)}
                <div className="mt-3 text-slate">
                  {r.bodyMd ? <Markdown>{r.bodyMd}</Markdown> : <p>Short preview of the proposal body.</p>}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  {derivePhase(r) === 'onchain' ? (
                    <>
                      <button className="btn bg-brand-primary">
                        <ThumbsUp size={14} className="mr-2" /> Vote Yes
                      </button>
                      <button className="btn bg-gray-700">
                        <ThumbsDown size={14} className="mr-2" /> Vote No
                      </button>
                      <button className="btn bg-stone-500">Abstain</button>
                      {r.amount && <div className="ml-auto text-ink font-semibold">{r.amount}</div>}
                    </>
                  ) : (
                    <>
                      <button
                        className="btn"
                        disabled={promoting === (r.id as string)}
                        onClick={async () => {
                          if (!r.id) return
                          setActionError(null)
                          setPromoting(r.id as string)
                          try {
                            // await promoteProposal(r.id as string)
                            // Realtime hook will reflect status/phase change.
                            setTab('onchain') // optional: jump to on-chain after promoting
                          } catch (e: any) {
                            setActionError(e?.message || 'Failed to promote proposal.')
                          } finally {
                            setPromoting(null)
                          }
                        }}
                      >
                        <Rocket size={16} className="mr-2" />
                        {promoting === (r.id as string) ? 'Sending…' : 'Send to Chain'}
                      </button>
                      <div className="text-slate text-sm">Draft in discussion</div>
                    </>
                  )}
                </div>
                <div className="mt-4">
                  <Link to={`/proposals/${r.id}`} className="btn">
                    <MessageSquare size={16} className="mr-2" />
                    Comment
                  </Link>
                </div>
              </motion.article>
            ))
          ) : (
            <div className="card p-6 text-slate">No items yet.</div>
          )}
        </div>
      )}
    </div>
  )
}

/* Skeleton loaders */
function RowSkeleton() {
  return (
    <div className="px-4 py-4 border-b border-brand-line animate-pulse">
      <div className="h-3 w-16 bg-brand-line rounded mb-2" />
      <div className="h-4 w-2/3 bg-brand-line rounded mb-2" />
      <div className="h-3 w-1/3 bg-brand-line rounded" />
    </div>
  )
}

function PostSkeleton() {
  return (
    <div className="card p-5 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-3 w-20 bg-brand-line rounded" />
        <div className="h-6 w-24 bg-brand-line rounded" />
      </div>
      <div className="h-5 w-3/4 bg-brand-line rounded mb-3" />
      <div className="space-y-2">
        <div className="h-3 w-full bg-brand-line rounded" />
        <div className="h-3 w-5/6 bg-brand-line rounded" />
        <div className="h-3 w-2/3 bg-brand-line rounded" />
      </div>
    </div>
  )
}
