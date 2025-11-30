// src/pages/ProposalDetail.tsx
// imports (top of detail page file)
//import { preOpenAmvaultPopup, closeSharedPopup, closePopupThenNav } from '../lib/amvaultPopup'

import {
  buildActionsFromDraft,
  buildActionsFromDraftAsync,
  Actions,
} from '../lib/buildActionsFromDraft'
import { useAuth } from 'amvault-connect'
import {
  simulateCastVote, castVoteOnchain, SUPPORT,
  getVotingFlags, finalizeOnchain, queueOnchain, executeOnchain,
  STATE,
  getState,
  delegateToSelf,
  BLOCK_TIME_SEC,
  VotingFlags,
  //debugVotingPower,
  readVotingPower,
  getMyVote,
  readCurrentDelegatedPower,
  getVotingProgress,
  computeActionsHash,
  getProposalFingerprint,
  simulateExecute,
  getQueuedEtaSec,
  cancelByAuthorOnchain,
  readHeldTargetOnChain,
  readHoldCountOnChain,
} from '../lib/daoProposals'
import {
  Hex,
  markCanceled,
  markDefeated,
  markExecuted,
  markProposalSubmitted,
  markQueued,
  markSucceeded,
  markVoting,
  releaseHoldForTarget,
  removeHeldLink,
  serializeActionsSnapshot,
  setProposalHoldPair

} from '../lib/firebase'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Markdown from '../lib/markdown'
import { formatLocalId, formatTimeAgo } from '../lib/format'
//import Avatar from '../components/Avatar'
import StatusChip from '../components/StatusChip'
import { submitForVoteOnchain } from '../lib/daoProposals'
import {
  addComment,
  fetchProposal,
  derivePhase,
  db,
} from '../lib/firebase'
import {
  doc,
  onSnapshot,
  collection,
  orderBy,
  query,
  Timestamp,
  getDoc,
  getDocs,
  where,
  limit,
} from 'firebase/firestore'
import {
  ArrowLeft,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Rocket,
  Share2,
  Link as LinkIcon,
  Bell,
  Tag,
  Banknote,
  IdCard,
  Activity,
  Loader2,
  GaugeCircle,
  MinusCircle,
  XCircle,
  CircleHelp,
  Settings2,
  Coins,
  ChevronDown,
} from 'lucide-react'
import AuthInline from '../components/AuthInline'
import { ethers } from 'ethers'
import { CHAIN } from '../lib/chain'
import IdentityChip from '../components/IdentityChip'
import { DAO_ABI, ERC20_ABI } from '../lib/abi'

type Comment = {
  id: string
  text: string
  author?: { name: string }
  createdAt?: Timestamp
}
type Sort = 'new' | 'old'


// Feature flags
const ENABLE_SUBSCRIPTIONS = false;


// Brand-danger for "No"
const NO_BG = '#D61F45';

// Tiny swatch + label chip used in the legend
const LegendChip: React.FC<{
  swatchClass?: string;
  swatchStyle?: React.CSSProperties;
  label: string;
  pct?: number;
  className?: string;
}> = ({ swatchClass = '', swatchStyle, label, pct, className = '' }) => (
  <span className={`inline-flex items-center gap-2 px-2 py-1 rounded-full border bg-white text-slate border-brand-line text-xs ${className}`}>
    <span className={`h-2.5 w-2.5 rounded-sm ${swatchClass}`} style={swatchStyle} />
    <span className="whitespace-nowrap">
      {label}{typeof pct === 'number' && <span className="opacity-70"> ({pct.toFixed(1)}%)</span>}
    </span>
  </span>
);



// One horizontal bar segmented by vote shares
const TallyStrip: React.FC<{
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  total: bigint;
  fmt: (v: bigint) => string;
  symbol?: string;
}> = ({ forVotes, againstVotes, abstainVotes, total, fmt, symbol = '' }) => {
  const totalNum = Math.max(0, Number(total));
  const pct = (n: bigint) => (totalNum > 0 ? (Number(n) / totalNum) * 100 : 0);
  const forPct = pct(forVotes);
  const againstPct = pct(againstVotes);
  const abstainPct = pct(abstainVotes);

  return (
    <div className="w-full">
      {/* segmented bar */}
      <div className="relative h-3 w-full rounded-full bg-gray-200 overflow-hidden">
        <div className="absolute left-0 top-0 h-full bg-emerald-500" style={{ width: `${forPct}%` }} />
        <div className="absolute top-0 h-full" style={{ left: `${forPct}%`, width: `${againstPct}%`, backgroundColor: NO_BG }} />
        <div className="absolute top-0 h-full bg-slate-400" style={{ left: `${forPct + againstPct}%`, width: `${abstainPct}%` }} />
      </div>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <LegendChip swatchClass="bg-emerald-500" label={`For: ${fmt(forVotes)} ${symbol}`} pct={forPct} />
        <LegendChip swatchStyle={{ backgroundColor: NO_BG }} label={`Against: ${fmt(againstVotes)} ${symbol}`} pct={againstPct} />
        <LegendChip swatchClass="bg-slate-400" label={`Abstain: ${fmt(abstainVotes)} ${symbol}`} pct={abstainPct} />
        <span className="ml-auto px-2 py-1 rounded-full border bg-white text-slate border-brand-line text-xs">
          Total: {fmt(total)} {symbol}
        </span>
      </div>
    </div>
  );
};


const bpsToPct = (bps?: number | null) =>
  typeof bps === 'number' ? `${(bps / 100).toFixed(2)}%` : '—'


// ------------------------------------------------------


export default function ProposalDetail() {


  const [actionError, setActionError] = useState<string | null>(null)
  const { id } = useParams()
  const nav = useNavigate()

  const [chainUI, setChainUI] = useState<(VotingFlags & {
    state: number | null
    canVote: boolean
    showFinalize: boolean
    showQueue: boolean
    showExecute: boolean
    showFailed: boolean
    showCanceled: boolean
    secondsUntilExecute: number | null
  })>({
    // VotingFlags baseline
    nowBlock: 0,
    voteStart: 0,
    voteEnd: 0,
    quorumBps: 0,
    hasStarted: false,
    hasEnded: false,
    isOpen: false,
    blocksUntilStart: 0,
    blocksUntilEnd: 0,
    secondsUntilStart: 0,
    secondsUntilEnd: 0,
    // UI additions
    state: null,
    canVote: false,
    showFinalize: false,
    showQueue: false,
    showExecute: false,
    showFailed: false,
    showCanceled: false,
    secondsUntilExecute: null,
  })

  const flags = chainUI as any



  async function refreshChainUI(curr: any) {
    if (!curr?.daoAddress || !curr?.reservedId) { /* existing DRAFT reset */ return }

    let st: number = STATE.DRAFT
    let flags: VotingFlags = {
      nowBlock: 0, voteStart: 0, voteEnd: 0, quorumBps: 0,
      hasStarted: false, hasEnded: false, isOpen: false,
      blocksUntilStart: 0, blocksUntilEnd: 0, secondsUntilStart: 0, secondsUntilEnd: 0,
    }

    try {
      const [st_, flags_] = await Promise.all([
        getState(curr.daoAddress, curr.reservedId),
        getVotingFlags(curr.daoAddress, curr.reservedId),
      ])
      st = st_
      flags = flags_
    } catch {
      // keep st=DRAFT + zeroed flags to avoid crashing the page
    }

    let secondsUntilExecute: number | null = null
    if (st === STATE.QUEUED) {
      try { secondsUntilExecute = await getQueuedEtaSec(curr.daoAddress, curr.reservedId) } catch { }
    }

    const canVote = st === STATE.VOTING && flags.isOpen
    const showFinalize = st === STATE.VOTING && flags.hasEnded
    const showQueue = st === STATE.SUCCEEDED
    const showExecute = st === STATE.QUEUED && (secondsUntilExecute ?? 1) <= 0
    const showFailed = st === STATE.DEFEATED
    const showCanceled = st === STATE.CANCELED

    setChainUI({ ...flags, state: st, canVote, showFinalize, showQueue, showExecute, showFailed, showCanceled, secondsUntilExecute })
  }


  function stripAutoHeader(full: string | undefined): string {
    if (!full) return ''
    const idx = full.indexOf('\n\n') // header + "\n\n" + body
    if (idx === -1) return full
    return full.slice(idx + 2)
  }



  // 🔒 declare hooks first to keep order stable
  const [item, setItem] = useState<any | null>(null)
  const { session } = useAuth()
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [sort, setSort] = useState<Sort>('new')
  const commentInputRef = useRef<HTMLInputElement | null>(null)
  const [tMinusSec, setTMinusSec] = useState<number | null>(null)
  const [fixingPower, setFixingPower] = useState(false)
  const [submittingVote, setSubmittingVote] = useState<0 | 1 | 2 | null>(null)
  const [delegateNotice, setDelegateNotice] = useState<string | null>(null)
  const [delegationBlock, setDelegationBlock] = useState<number | null>(null)
  const [proposalVotes, setProposalVotes] = useState<bigint | null>(null)
  const [hasVoted, setHasVoted] = useState(false)
  const [myVote, setMyVote] = useState<null | { support: 0 | 1 | 2; weight: bigint }>(null)
  const [progress, setProgress] = useState<null | {
    forVotes: bigint; againstVotes: bigint; abstainVotes: bigint; totalVotes: bigint; progressPct: number
  }>(null)
  const [postAction, setPostAction] = useState<null | 'finalize' | 'queue' | 'execute'>(null);
  const [supplyInfo, setSupplyInfo] = useState<null | {
    totalNow: bigint;
    totalAtSnapshot: bigint | null;   // null if IVotes not supported
    quorumRequired: bigint | null;    // computed from (snapshot||current) * quorumBps/10_000
  }>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmBond, setConfirmBond] = useState<{ valueWei: bigint; pretty: string } | null>(null)
  const [confirmItem, setConfirmItem] = useState<any | null>(null)

  // near the other state hooks
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  type CancelMode = 'author' | 'emergency'
  const [cancelMode, setCancelMode] = useState<CancelMode>('author')

  const [isHeldChain, setIsHeldChain] = useState(false)




  useEffect(() => {
    if (!session?.address || !item?.daoAddress || !item?.reservedId) return
    if (chainUI.state === STATE.VOTING && chainUI.isOpen) {
      (async () => {
        try {
          const info = await readVotingPower(item.daoAddress, session.address, item.reservedId)
          setProposalVotes(info.snapshotVotes)  // this is what counts
        } catch { /* ignore */ }
      })()
    }
  }, [chainUI.state, chainUI.isOpen, session?.address, item?.daoAddress, item?.reservedId])

  useEffect(() => {
    if (!item?.daoAddress || !item?.reservedId) return;
    // While voting (poll each block) already handled above.
    // Here: when voting has ENDED, fetch once so we can render the final bar.
    if (chainUI.hasEnded) {
      (async () => {
        try {
          const p = await getVotingProgress(item.daoAddress, item.reservedId);
          setProgress(p);
        } catch { }
      })();
    }
  }, [item?.daoAddress, item?.reservedId, chainUI.hasEnded]);


  // when Emergency Hold is placed
  const [heldBy, setHeldBy] = useState<null | { id: string; title: string; status?: string }>(null);
  const [holdingList, setHoldingList] = useState<Array<{ id: string; title: string; status?: string }>>([]);

  // NEW — raw hold signal from chain or firestore
  const holdActive =
    !!(item?.onHold?.by && !item?.onHold?.releasedAt) || isHeldChain;

  // Show the banner only once voting is finished and the proposal has PASSED (SUCCEEDED) or is QUEUED
  const showHoldBanner =
    holdActive && (chainUI.state === STATE.SUCCEEDED || chainUI.state === STATE.QUEUED);

  // Block only post-vote lifecycle (queue/execute). Never block voting/finalize.
  const holdBlocksPostVote = showHoldBanner;



  // Fetch the holding proposal (B) if A is on hold
  useEffect(() => {
    if (!id || !item?.daoAddress || !item?.reservedId) return;

    const cat = String(item?.category || '').toUpperCase();
    const daoAddr = item.daoAddress;
    const localId = item.reservedId;

    (async () => {
      // ---------- B: Emergency proposal page -> ensure link to its target (A)
      if (cat === 'EMERGENCY_CANCEL') {
        try {
          const targetLocalId = await readHeldTargetOnChain(daoAddr, localId);
          if (targetLocalId > 0) {
            // find A by dao + reservedId
            const snap = await getDocs(query(
              collection(db, 'proposals'),
              where('daoId', '==', item.daoId),
              where('reservedId', '==', String(targetLocalId)),
              limit(1)
            ));
            const targetDocId = snap.empty ? null : snap.docs[0].id;
            if (targetDocId) {
              await setProposalHoldPair({
                daoAddress: daoAddr,
                targetReservedId: targetLocalId, // A.localId
                holdingDocId: id!,               // B.docId
                holdingReservedId: localId,      // B.localId
              });
              // optimistic UI (right rail “Holding these proposals”)
              const d = snap.docs[0].data() as any;
              setHoldingList([{ id: targetDocId, title: d?.title || `#${targetLocalId}`, status: d?.status }]);
            }
          }
        } catch { /* ignore */ }
        return;
      }

      // ---------- A: Normal proposal page -> detect if on hold and try to resolve B
      try {
        const count = await readHoldCountOnChain(daoAddr, localId);
        if (count > 0) {
          setIsHeldChain(true); // immediately lock UI + show generic banner

          // Try to discover the emergency that’s holding us (scan recent emergencies)
          const emergSnap = await getDocs(query(
            collection(db, 'proposals'),
            where('daoId', '==', item.daoId),
            where('category', '==', 'EMERGENCY_CANCEL'),
            orderBy('createdAt', 'desc'),
            limit(25)
          ));

          for (const docSnap of emergSnap.docs) {
            const d = docSnap.data() as any;
            const eLocalId = Number(d?.reservedId || 0);
            if (!eLocalId) continue;

            try {
              const target = await readHeldTargetOnChain(daoAddr, eLocalId);
              if (target === Number(localId)) {
                // Persist cross-link; harmless if already set.
                await setProposalHoldPair({
                  daoAddress: daoAddr,
                  targetReservedId: Number(localId), // A
                  holdingDocId: docSnap.id,         // B
                  holdingReservedId: eLocalId       // B.localId
                });

                // Make the banner clickable
                setHeldBy({ id: docSnap.id, title: d?.title || `#${eLocalId}`, status: d?.status });
                break; // one holder is enough for the UI
              }
            } catch { /* ignore this candidate */ }
          }
        }
      } catch { /* ignore */ }
    })();
  }, [id, item?.daoAddress, item?.reservedId, item?.daoId, item?.category]);





  // If we are on B, show the proposals it holds (A, A2…)
  useEffect(() => {
    let stop = false;
    (async () => {
      const ids: string[] = Array.isArray(item?.holdsIds) ? item!.holdsIds.slice(0, 10) : [];
      if (!ids.length) { setHoldingList([]); return; }
      try {
        const snaps = await Promise.all(ids.map(pid => getDoc(doc(db, 'proposals', pid))));
        if (stop) return;
        setHoldingList(snaps.filter(s => s.exists()).map(s => {
          const d = s.data() as any;
          return { id: s.id, title: d?.title || `#${s.id}`, status: d?.status };
        }));
      } catch { /* ignore */ }
    })();
    return () => { stop = true; };
  }, [item?.holdsIds]);




  // Refresh on mount / when proposal changes
  useEffect(() => {
    refreshChainUI(item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.daoAddress, item?.reservedId])

  // When voting opens, and while it's open, poll my-vote  progress once per block
  useEffect(() => {
    if (!session?.address || !item?.daoAddress || !item?.reservedId) return
    if (!(chainUI.state === STATE.VOTING)) return
    let stop = false
    const tick = async () => {
      try {
        const [p, mine] = await Promise.all([
          getVotingProgress(item.daoAddress, item.reservedId),
          getMyVote(item.daoAddress, item.reservedId, session.address),
        ])
        if (stop) return
        setProgress(p)
        if (mine.hasVoted) {
          setHasVoted(true)
          setMyVote({ support: mine.support!, weight: mine.weight! })
        }
      } catch { }
    }
    // run once immediately, then poll while the window is open
    tick()
    const timer = setInterval(() => {
      if (chainUI.isOpen) tick()
    }, BLOCK_TIME_SEC * 1000)
    return () => { stop = true; clearInterval(timer) }
  }, [chainUI.state, chainUI.isOpen, session?.address, item?.daoAddress, item?.reservedId]) // eslint-disable-line


  // ...treasury timelock effect
  useEffect(() => {
    let timer: any = null
    let mounted = true;

    (async () => {
      if (chainUI.state !== STATE.QUEUED || !item?.daoAddress || !item?.reservedId) {
        setChainUI(s => ({ ...s, secondsUntilExecute: null }))
        return
      }
      try {
        const sec = await getQueuedEtaSec(item.daoAddress, item.reservedId)
        if (!mounted) return
        setChainUI(s => ({ ...s, secondsUntilExecute: sec }))
      } catch {
        if (!mounted) return
        setChainUI(s => ({ ...s, secondsUntilExecute: null }))
      }
    })()

    if (chainUI.state === STATE.QUEUED) {
      timer = setInterval(() => {
        setChainUI(s => ({
          ...s,
          secondsUntilExecute:
            s.secondsUntilExecute == null ? null : Math.max(0, s.secondsUntilExecute - 1)
        }))
      }, 1000)
    }

    return () => { mounted = false; if (timer) clearInterval(timer) }
  }, [chainUI.state, item?.daoAddress, item?.reservedId])






  useEffect(() => {
    let tickTimer: any = null
    let pollTimer: any = null

    // Only run while we have a proposal and we're waiting for start
    const shouldWaitForStart =
      chainUI?.state === STATE.VOTING && !chainUI?.isOpen && !chainUI?.hasEnded

    if (item?.daoAddress && item?.reservedId && shouldWaitForStart) {
      // initialize t-minus from flags
      setTMinusSec(chainUI?.secondsUntilStart ?? null)

      // Per-second countdown for UX polish
      tickTimer = setInterval(() => {
        setTMinusSec((s) => (s === null ? null : Math.max(s - 1, 0)))
      }, 1000)

      // Poll chain roughly each block
      pollTimer = setInterval(() => {
        refreshChainUI(item)
      }, BLOCK_TIME_SEC * 1000)
    } else {
      setTMinusSec(null)
    }

    return () => {
      if (tickTimer) clearInterval(tickTimer)
      if (pollTimer) clearInterval(pollTimer)
    }
    // include fields that affect the waiting condition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.daoAddress, item?.reservedId, chainUI?.state, chainUI?.isOpen, chainUI?.hasEnded, chainUI?.secondsUntilStart])

  const fmtHMS = (total: number | null) => {
    if (total == null) return '—'
    const s = Math.max(0, Math.floor(total))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m ${sec}s`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }


  // Load proposal + realtime updates
  useEffect(() => {
    if (!id) return
    let unsub = () => { }
    let unsubComments = () => { }
    setLoading(true)

      ; (async () => {
        try {
          // Initial fetch to surface 404s quickly
          const data = await fetchProposal(id)
          setItem(data)

          // Live proposal doc
          const pref = doc(db, 'proposals', id)
          unsub = onSnapshot(pref, (snap) => {
            if (snap.exists()) setItem({ id: snap.id, ...(snap.data() as any) })
          })

          // Live comments
          const cref = collection(pref, 'comments')
          const q = query(cref, orderBy('createdAt', 'asc'))
          unsubComments = onSnapshot(q, (snap) => {
            setComments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
          })
        } catch (e: any) {
          setError(e?.message || 'Failed to load proposal')
        } finally {
          setLoading(false)
        }
      })()

    return () => {
      unsub()
      unsubComments()
    }
  }, [id])





  const phase = derivePhase(item)
  const authorName = (item?.author?.name ?? 'Unknown') as string
  const authorSeed = (item?.author?.avatar ?? 1) as number
  const stickyWrapClass = phase === 'onchain' ? '' : 'sticky top-16 z-10'

  const createdAtText = useMemo(() => {
    const ts = item?.createdAt as Timestamp | undefined
    if (!ts) return '—'
    try {
      return new Date(ts.toDate()).toLocaleString()
    } catch {
      return '—'
    }
  }, [item])

  const cat = String(item?.category || '').toUpperCase();
  const isEmergency = cat === 'EMERGENCY_CANCEL';

  useEffect(() => {
    if (!isEmergency) { setHoldingList([]); return; }   // <- add this guard
    let stop = false;
    (async () => {
      const ids: string[] = Array.isArray(item?.holdsIds) ? item!.holdsIds.slice(0, 10) : [];
      if (!ids.length) { setHoldingList([]); return; }
      try {
        const snaps = await Promise.all(ids.map(pid => getDoc(doc(db, 'proposals', pid))));
        if (stop) return;
        setHoldingList(snaps.filter(s => s.exists()).map(s => {
          const d = s.data() as any;
          return { id: s.id, title: d?.title || `#${s.id}`, status: d?.status };
        }));
      } catch { /* ignore */ }
    })();
    return () => { stop = true; };
  }, [item?.holdsIds, isEmergency]);  // include isEmergency




  const sortedComments = useMemo(() => {
    const arr = [...comments]
    if (sort === 'new') return arr.reverse()
    return arr
  }, [comments, sort])

  // Gate some action and views base on Cancelled or emergency hold

  // 2) Existing cancel gate
  const isCanceled =
    chainUI.showCanceled ||
    chainUI.state === STATE.CANCELED ||
    String(item?.status || '').toLowerCase() === 'canceled';

  // 3) One unified lock flag for all chain actions
  // NEW — holds do not lock voting/finalize, only queue/execute later
  const isLocked = isCanceled;

  const ui = {
    preOpen: chainUI.state === STATE.VOTING && !chainUI.isOpen && !chainUI.hasEnded,
    open: chainUI.isOpen,
    finalize: chainUI.showFinalize,          // still allowed while on hold
    queue: chainUI.showQueue && !isCanceled && !holdActive,
    execute: chainUI.showExecute && !isCanceled && !holdActive,
  };


  const updatedAt = (item?.updatedAt ?? item?.createdAt) as any
  const isDraft = ((item?.status as string | undefined) || '').toLowerCase() === 'draft'
  const timeLabel = updatedAt
    ? `${isDraft ? 'Last edited' : 'Updated'} ${formatTimeAgo(updatedAt)}`
    : ''


  const onShareClick = async () => {
    const url = window.location.href;
    const title = item?.title || 'Proposal';
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        // Fallback (same behavior as your current Share button)
        window.open(url, '_blank');
      }
    } catch {
      // user cancelled share — no-op
    }
  };

  // near other effects
  useEffect(() => {
    const byDocId = item?.onHold?.byDocId as string | undefined;
    if (!byDocId || isEmergency) return; // only hydrate on the target (A), not the emergency (B)

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'proposals', byDocId));
        if (snap.exists()) {
          const d = snap.data() as any;
          setHeldBy({
            id: snap.id,
            title: d?.title || `#${d?.reservedId ?? snap.id}`,
            status: d?.status,
          });
          setIsHeldChain(true); // make sure actions lock immediately
        }
      } catch {
        /* ignore */
      }
    })();
  }, [item?.onHold?.byDocId, isEmergency]);


  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { }
  }

  // resolve author's address from the doc in a tolerant way
  const authorAddrRaw =
    (item?.author?.address ??
      item?.authorAddress ??
      item?.createdBy ??
      '').toString()

  const authorAddr = ethers.isAddress(authorAddrRaw) ? ethers.getAddress(authorAddrRaw) : null
  const myAddr = session?.address ? ethers.getAddress(session.address) : null
  const isAuthor = !!(authorAddr && myAddr && authorAddr === myAddr)

  const isOnchain = phase === 'onchain' // matches your existing phase computation

  // Cancel button visibility rules
  const isQueuedOrExecuted =
    chainUI.state === STATE.QUEUED || chainUI.state === STATE.EXECUTED;

  // Author can cancel while on-chain any time before queue/execute
  const canAuthorCancel =
    isOnchain && isAuthor && !isCanceled && !isQueuedOrExecuted;

  // Non-author can trigger *emergency cancel* flow on normal proposals
  // (don’t allow emergency-cancel of an emergency proposal to avoid loops)
  const canEmergencyCancel =
    isOnchain && !isAuthor && !isEmergency && !isCanceled;

  const showCancelBtn = canAuthorCancel || canEmergencyCancel;






  function openCancelDialog() {
    setCancelMode(isAuthor ? 'author' : 'emergency')
    setCancelOpen(true)
  }

  const isCommentByAuthor = (c: any) => {
    const a = (item?.author?.name || '').trim().toLowerCase()
    const b = (c?.author?.name || '').trim().toLowerCase()
    return a && b && a === b
  }

  const renderActionSummary = (it: any) => {
    const cat = String(it?.category || '').toUpperCase()

    // BUDGET / TREASURY TRANSFER
    if (cat === 'BUDGET' || cat === 'TREASURY_PAYOUT' || cat === 'TREASURY_TRANSFER') {
      const b = it?.budget || {}
      return (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Banknote size={16} className="text-ink/80" />
            <span className="font-medium">Transfer funds</span>
          </div>
          <div className="pl-6">
            <div>
              <span className="text-slate">Amount:</span>{' '}
              <span className="font-mono">{b?.amount} {b?.asset}</span>
            </div>
            {b?.recipient && (
              <div className="flex items-start gap-2">
                <span className="text-slate shrink-0">Recipient:</span>
                <code
                  className="font-mono px-1.5 py-0.5 rounded bg-brand-bg border border-brand-line
                           max-w-full break-all text-xs sm:text-[13px]"
                  title={b.recipient}
                >
                  {b.recipient}
                </code>
              </div>

            )}
          </div>
        </div>
      )
    }

    // VOTING CONFIG
    if (cat === 'VOTING_CONFIG' || cat === 'SET_VOTING_CONFIG' || cat === 'GOV_PARAMS') {
      const delay = Number(it?.votingDelayBlocks ?? 0)
      const period = Number(it?.votingPeriodBlocks ?? 0)
      const quorumBps = Number(it?.quorumBps ?? 0)
      const timelockSec = it?.treasuryTimelockSec != null ? Number(it.treasuryTimelockSec) : null

      const mins = (blocks: number) => Math.round((blocks * BLOCK_TIME_SEC) / 60)

      const fmtDuration = (sec: number) => {
        if (sec <= 0) return 'none'
        const d = Math.floor(sec / 86400)
        const h = Math.floor((sec % 86400) / 3600)
        const m = Math.floor((sec % 3600) / 60)
        const parts: string[] = []
        if (d) parts.push(`${d}d`)
        if (h) parts.push(`${h}h`)
        // show minutes if any, or if nothing else was non-zero
        if (m || parts.length === 0) parts.push(`${m}m`)
        return parts.join(' ')
      }

      return (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-ink/80" />
            <span className="font-medium">Update voting parameters</span>
          </div>

          <div className="pl-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span className="text-slate">Voting delay:</span>{' '}
              <span className="font-mono">{delay.toLocaleString()}</span> blocks (~{mins(delay)} min)
            </div>

            <div>
              <span className="text-slate">Voting period:</span>{' '}
              <span className="font-mono">{period.toLocaleString()}</span> blocks (~{mins(period)} min)
            </div>

            <div>
              <span className="text-slate">Quorum:</span>{' '}
              <span className="font-mono">{(quorumBps / 100).toFixed(2)}%</span>
            </div>

            <div>
              <span className="text-slate">Treasury timelock:</span>{' '}
              {timelockSec != null ? (
                <>
                  <span className="font-mono">{timelockSec.toLocaleString()}</span> sec
                  {' '}(<span className="font-mono">{fmtDuration(timelockSec)}</span>)
                </>
              ) : (
                <span className="font-mono">—</span>
              )}
            </div>
          </div>
        </div>
      )
    }

    // SET ADMIN
    if (cat === 'SET_ADMIN' || cat === 'ADMIN_ROTATION') {
      return (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <IdCard size={16} className="text-ink/80" />
            <span className="font-medium">Change admin</span>
          </div>

          {/* min-w-0 lets text wrap inside flex layouts */}
          <div className="pl-6 min-w-0">
            <span className="text-slate">New admin:</span>{' '}
            <code
              className="px-1.5 py-0.5 rounded bg-brand-bg border border-brand-line
                     inline-block max-w-full break-all whitespace-normal align-middle"
              title={it?.newAdmin || '—'}
            >
              {it?.newAdmin || '—'}
            </code>
          </div>
        </div>
      )
    }


    // SET VOTE TOKEN
    if (cat === 'SET_VOTE_TOKEN' || cat === 'TOKEN_ROTATION') {
      return (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Coins size={16} className="text-ink/80" />
            <span className="font-medium">Change vote token</span>
          </div>

          {/* allow wrapping inside flex layout */}
          <div className="pl-6 min-w-0">
            <span className="text-slate">New token:</span>{' '}
            <code
              className="px-1.5 py-0.5 rounded bg-brand-bg border border-brand-line
                     inline-block max-w-full break-all whitespace-normal align-middle"
              title={it?.newToken || '—'}
            >
              {it?.newToken || '—'}
            </code>
          </div>
        </div>
      )
    }

    // BANK
    if (cat === 'BANK') {
      const b = it?.bank || {}
      const act = String(b.actionType || '').toUpperCase()

      // CREATE: multiple accounts
      if (act === 'CREATE') {
        const rows: any[] = Array.isArray(b.createAccounts)
          ? b.createAccounts.filter(r => (r?.account || '').trim())
          : []

        return (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Banknote size={16} className="text-ink/80" />
              <span className="font-medium">Create bank account(s)</span>
            </div>

            <div className="pl-6 space-y-1">
              {rows.length === 0 && (
                <div className="text-slate">No accounts configured.</div>
              )}
              {rows.map((row, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <span className="font-mono text-xs sm:text-sm">
                    #{i + 1}: {row.account}
                  </span>
                  <span className="text-slate text-xs sm:text-sm">
                    · Asset: {row.asset || 'AKE'}
                  </span>
                  {row.note && (
                    <span className="text-slate text-xs sm:text-sm">
                      · {row.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      }

      // SPEND
      if (act === 'SPEND') {
        return (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Banknote size={16} className="text-ink/80" />
              <span className="font-medium">Spend from bank account</span>
            </div>
            <div className="pl-6 space-y-1">
              <div>
                <span className="text-slate">Account:</span>{' '}
                <span className="font-mono">{b.account || '—'}</span>
              </div>
              <div>
                <span className="text-slate">Amount:</span>{' '}
                <span className="font-mono">
                  {b.amount ?? '—'} {b.asset || 'AKE'}
                </span>
              </div>
              {b.recipient && (
                <div className="flex items-start gap-2">
                  <span className="text-slate shrink-0">Recipient:</span>
                  <code className="font-mono px-1.5 py-0.5 rounded bg-brand-bg border border-brand-line max-w-full break-all text-xs sm:text-[13px]">
                    {b.recipient}
                  </code>
                </div>
              )}
              {b.note && (
                <div className="text-slate text-xs">Note: {b.note}</div>
              )}
            </div>
          </div>
        )
      }

      // CONFIG
      if (act === 'CONFIG') {
        return (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Settings2 size={16} className="text-ink/80" />
              <span className="font-medium">Update bank account</span>
            </div>
            <div className="pl-6 space-y-1">
              <div>
                <span className="text-slate">Account:</span>{' '}
                <span className="font-mono">{b.account || '—'}</span>
              </div>
              {b.note && (
                <div className="text-slate text-xs whitespace-pre-wrap">
                  {b.note}
                </div>
              )}
            </div>
          </div>
        )
      }

      // CLOSE
      if (act === 'CLOSE') {
        return (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Banknote size={16} className="text-ink/80" />
              <span className="font-medium">Close bank account</span>
            </div>
            <div className="pl-6 space-y-1">
              <div>
                <span className="text-slate">Account:</span>{' '}
                <span className="font-mono">{b.account || '—'}</span>
              </div>
              {b.note && (
                <div className="text-slate text-xs whitespace-pre-wrap">
                  {b.note}
                </div>
              )}
            </div>
          </div>
        )
      }
    }


    // MULTI (show a small list of sub-actions)
    if (cat === 'MULTI' && Array.isArray(it?.items) && it.items.length > 0) {
      return (
        <div className="space-y-3 text-sm">
          <div className="font-medium flex items-center gap-2">
            <Settings2 size={16} className="text-ink/80" />
            Multiple actions
          </div>
          <ol className="pl-5 list-decimal space-y-2">
            {it.items.map((sub: any, i: number) => (
              <li key={i} className="space-y-1">
                {renderActionSummary(sub)}
              </li>
            ))}
          </ol>
        </div>
      )
    }

    // Fallback
    return <div className="text-sm text-slate">No action details available.</div>
  }

  const fmtBps = (bps: number) => `${(bps / 100).toFixed(2)}%`


  const fmtUnits = (v: bigint, decimals = 18) => {
    const s = ethers.formatUnits(v, decimals);
    // add thousands separators, trim trailing zeros
    const [i, d] = s.split('.');
    const iFmt = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d ? `${iFmt}.${d.replace(/0+$/, '') || '0'}` : iFmt;
  };


  const [powerInfo, setPowerInfo] = useState<null | {
    nowVotes: bigint;
    delegatedTo: string | null;
    balance: bigint;
    token: string;
    chainBlock: number;
    decimals: number;
    symbol: string;
  }>(null)



  async function explainNoPower(itm: any) {
    if (!session?.address) return
    try {
      const info = await readCurrentDelegatedPower(itm.daoAddress, session.address)
      setPowerInfo(info)
      // optional banner if we see non-zero
      if (info.nowVotes > 0n) setDelegateNotice('Delegation recorded')
    } catch { }
  }

  // Auto-refresh power when user signs in or proposal context changes
  useEffect(() => {
    if (session?.address && item?.daoAddress && item?.reservedId) {
      explainNoPower(item)
    }
  }, [session?.address, item?.daoAddress, item?.reservedId])  // eslint-disable-line

  useEffect(() => {
    (async () => {
      try {
        if (!powerInfo?.token) return
        const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)

        // Minimal ABIs
        const erc20 = new ethers.Contract(
          powerInfo.token,
          ['function totalSupply() view returns (uint256)'],
          provider
        )

        const totalNow: bigint = await erc20.totalSupply()

        // Try IVotes.getPastTotalSupply; fallback to null if not supported
        let totalAtSnapshot: bigint | null = null
        const snapBlock = Math.max(0, (chainUI.voteStart ?? 0) - 1)
        if (snapBlock > 0) {
          try {
            const ivotes = new ethers.Contract(
              powerInfo.token,
              ['function getPastTotalSupply(uint256) view returns (uint256)'],
              provider
            )
            totalAtSnapshot = await ivotes.getPastTotalSupply(snapBlock)
          } catch {
            totalAtSnapshot = null // not an IVotes token
          }
        }

        // quorumRequired = base * quorumBps / 10_000
        const base = (totalAtSnapshot ?? totalNow)
        const qbps = BigInt(chainUI.quorumBps || 0)
        const quorumRequired = (base * qbps) / 10_000n

        setSupplyInfo({ totalNow, totalAtSnapshot, quorumRequired })
      } catch {
        setSupplyInfo(null)
      }
    })()
  }, [powerInfo?.token, chainUI.voteStart, chainUI.quorumBps])




  async function waitNextBlock(): Promise<number> {
    const p = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
    const start = await p.getBlockNumber()
    let bn = start
    const deadline = Date.now() + 20_000 // 20s safety
    while (bn <= start && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1_000))
      bn = await p.getBlockNumber()
    }
    return bn
  }

  const onFixDelegateToSelf = async (itm: any) => {
    if (!session?.address) { setError('Sign in first'); return }
    setFixingPower(true)
    setActionError(null)
    setDelegateNotice('Submitting delegation…')
    try {
      // (0) Optional optimistic hint: show “Updating…” right away
      // If you have setPowerInfo, uncomment the next block:
      // setPowerInfo((prev: any) => prev ? { ...prev, delegatedTo: session.address } : prev)
      // setDelegateNotice('Delegating… awaiting confirmation')

      // 1) Send delegate tx (waits for receipt) and capture the block
      const res = await delegateToSelf(itm.daoAddress, session.address)
      setDelegationBlock(res.blockNumber)

      // 2) Wait for at least one new block so the checkpoint exists
      await waitNextBlock()

      // 3) Re-check delegation + votes
      setDelegateNotice('Delegation recorded. Updating voting power…')
      await explainNoPower(itm) // this sets powerInfo via readVotingPower(...)

      // 3b) Belt & suspenders: refresh a couple more times to beat RPC lag/caching
      setTimeout(() => { void explainNoPower(itm) }, 1200)
      setTimeout(() => { void explainNoPower(itm) }, 3500)

      // 4) Surface a clear success banner
      setDelegateNotice('Delegation recorded ✅')
      setActionError(null)

      /*  // 5) Dump a compact debug line into the error box for quick inspection
       try {
         const d = await debugVotingPower(itm.daoAddress, session.address!, itm.reservedId)
         setActionError(
           [
             'Debug:',
             ` token=${d.token}`,
             ` balance=${d.balance.toString()}`,
             ` chainBlock=${d.chainBlock}`,
             ` voteStart=${d.voteStart}`,
             ` snapshotBlock=${d.snapshotBlock}`,
             ` nowVotes=${d.nowVotes.toString()}`,
             ` snapshotVotes=${d.snapshotVotes.toString()}`,
             ` delegatedTo=${d.delegatedTo ?? '—'}`,
             delegationBlock != null ? ` delegationTxBlock=${delegationBlock}` : '',
           ].filter(Boolean).join(' | ')
         )
       } catch { } */
    } catch (e: any) {
      setError(e?.message || 'Delegate failed.')
    } finally {
      setFixingPower(false)
    }
  }







  // Ensure the markdown used for hashing matches what users see
  function markdownForHash(item: any): string {
    // Prefer the composed markdown saved earlier
    if (typeof item.bodyMd === 'string' && item.bodyMd.length) return item.bodyMd

    const tags = Array.isArray(item.tags) ? item.tags.join(', ') : ''
    const header: string[] = []
    header.push(`# ${item.title || 'Untitled Proposal'}`)
    header.push('')
    header.push(`**Category:** ${item.category}${tags ? `   **Tags:** ${tags}` : ''}`)
    if (item.summary) header.push(`> ${item.summary}`)
    if (item.quorumChangeBps != null) {
      header.push(`**Requested Quorum:** ${(Number(item.quorumChangeBps) / 100).toFixed(2)}%`)
    }
    if (item.budget?.amount) {
      header.push(`**Requested Budget:** ${item.budget.amount} ${item.budget.asset}`)
      if (item.budget.recipient) {
        // no inline-code here so mobile can wrap naturally
        header.push(`**Recipient:** ${item.budget.recipient}`)
      }
    }

    if (item.discussionUrl) header.push(`**Discussion:** ${item.discussionUrl}`)
    if (Array.isArray(item.references) && item.references.length) {
      header.push('', '**References:**', ...item.references.map((u: string) => `- ${u}`))
    }
    header.push('', String(item.body || ''))
    return header.join('\n')
  }

  /**
 * Convert the proposal 'item' into the right action(s) for our contracts.
 * Supports:
 * - Relative quorum change (uses async builder; reads current on-chain params)
 * - Absolute voting config
 * - Admin / vote token rotation
 * - Treasury payouts: native (ETH) or ERC-20 (via tokenRegistry)
 */
  async function buildActionsForItem(item: any): Promise<{
    targets: string[]
    valuesWei: bigint[]
    calldatas: string[]
  }> {
    const dao = String(item.daoAddress || '')
    const cat = String(item.category || '').toUpperCase()

    // --- Helper: Budget -> Action (native or ERC-20)
    const budgetToAction = () => {
      const b = item.budget || {}
      const recipient = String(b.recipient || '').trim()
      const asset = String(b.asset || '').trim().toUpperCase()
      const amountStr = String(b.amount ?? '').trim()
      if (!recipient) throw new Error('Budget recipient is required')
      if (!amountStr) throw new Error('Budget amount is required')

      // Treat these as *native* symbols (include AKE)
      const NATIVE_ALIASES = new Set([
        'NATIVE', 'AKE',
        (CHAIN as any)?.nativeSymbol?.toUpperCase?.() || ''
      ].filter(Boolean))

      if (NATIVE_ALIASES.has(asset)) {
        const valueWei = ethers.parseEther(amountStr) // native units
        return Actions.nativeTransfer(recipient, valueWei)
      }

      // Otherwise treat as ERC-20; require address in registry
      const registry = item.tokenRegistry || {}
      const token = registry[asset]
      if (!token) throw new Error(`Unknown asset ${asset} — missing address in tokenRegistry`)
      const decimals = Number(b.decimals ?? 18)
      const amount = ethers.parseUnits(amountStr, decimals)
      return Actions.erc20Transfer(token, recipient, amount)
    }



    // --- Routing by category (normalized)
    switch (cat) {
      case 'QUORUM_RELATIVE_CHANGE':
      case 'QUORUM_RELATIVE_CHANGE_BPS':
      case 'QUORUM_DELTA':
      case 'CHANGE_QUORUM':
        // expects item.quorumChangeBps (delta in bps; e.g., +250 or -100)
        if (item.quorumChangeBps == null) throw new Error('Missing quorumChangeBps')
        return await buildActionsFromDraftAsync(Actions.quorumDelta(dao, Number(item.quorumChangeBps)))

      case 'SET_VOTING_CONFIG':
      case 'VOTING_CONFIG':
      case 'GOV_PARAMS': {
        // expects: item.votingDelayBlocks, item.votingPeriodBlocks, item.quorumBps
        // optional: item.treasuryTimelockSec (seconds)
        return await buildActionsFromDraftAsync(
          Actions.setVotingConfig(
            dao,
            Number(item.votingDelayBlocks ?? 0),
            Number(item.votingPeriodBlocks ?? 0),
            Number(item.quorumBps ?? 0),
            Number(item.treasuryTimelockSec ?? 0)
          )
        )
      }

      // in buildActionsForItem(...)
      case 'EMERGENCY_CANCEL': {
        const dao = String(item.daoAddress || '0x0000000000000000000000000000000000000000');
        // 1 "no-op": target=this DAO, value=0, empty calldata
        return {
          targets: [dao],
          valuesWei: [0n],
          calldatas: ['0x'],
        };
      }



      case 'SET_ADMIN':
      case 'ADMIN_ROTATION':
        if (!item.newAdmin) throw new Error('Missing newAdmin')
        return buildActionsFromDraft(Actions.setAdmin(dao, String(item.newAdmin)))

      case 'SET_VOTE_TOKEN':
      case 'TOKEN_ROTATION':
        if (!item.newToken) throw new Error('Missing newToken')
        return buildActionsFromDraft(Actions.setVoteToken(dao, String(item.newToken)))

      case 'BUDGET':
      case 'TREASURY_PAYOUT':
      case 'TREASURY_TRANSFER': {
        const action = budgetToAction()
        return buildActionsFromDraft(action)
      }

      case 'MULTI': {
        const items = Array.isArray(item.items) ? item.items : []
        if (items.length === 0) throw new Error('MULTI requires items[]')

        const mapped = items.map((sub) => {
          const subCat = String(sub.category || '').toUpperCase()

          if (subCat === 'TREASURY_PAYOUT' || subCat === 'TREASURY_TRANSFER' || subCat === 'BUDGET') {
            return budgetToAction()
          }
          if (subCat === 'SET_ADMIN') return Actions.setAdmin(dao, String(sub.newAdmin))
          if (subCat === 'SET_VOTE_TOKEN') return Actions.setVoteToken(dao, String(sub.newToken))

          if (subCat === 'SET_VOTING_CONFIG') {
            return Actions.setVotingConfig(
              dao,
              Number(sub.votingDelayBlocks ?? 0),
              Number(sub.votingPeriodBlocks ?? 0),
              Number(sub.quorumBps ?? 0),
              // 👇 prefer sub override, fall back to parent default if provided
              Number(sub.treasuryTimelockSec ?? item.treasuryTimelockSec ?? 0)
            )
          }

          throw new Error(`Unsupported sub-action category: ${subCat}`)
        })

        // IMPORTANT: async builder so nested voting-config gets timelock update
        return await buildActionsFromDraftAsync(Actions.multi(mapped))
      }

      case 'BANK': {
        const bankCfg = item.bank || {}
        const act = String(bankCfg.actionType || '').toUpperCase()

        // Get DAO bank address (from payload or DAO)
        const bankAddress =
          bankCfg.bankAddress || (await fetchDaoBank(item.daoAddress))
        if (!bankAddress) {
          throw new Error('BANK: missing bank address for this DAO')
        }

        // Default asset symbol if not provided
        const asset = String(bankCfg.asset || 'AKE').trim()

        if (act === 'CREATE') {
          const rows: any[] = Array.isArray(bankCfg.createAccounts)
            ? bankCfg.createAccounts.filter((r) => (r?.account || '').trim())
            : []

          if (!rows.length) throw new Error('BANK: no accounts configured to create')

          const bankActions = rows.map((row) =>
            Actions.bankCreateAccount(
              bankAddress,
              String(row.account).trim(),
              String(row.asset || asset).trim(),
              BigInt(row.budgetWei ?? 0n),
              BigInt(row.annualLimitWei ?? 0n),
            )
          )

          return await buildActionsFromDraftAsync(Actions.multi(bankActions))
        }

        if (act === 'SPEND') {
          if (!bankCfg.account) throw new Error('BANK SPEND: missing account id')
          if (bankCfg.amount == null) throw new Error('BANK SPEND: missing amount')
          if (!bankCfg.recipient) throw new Error('BANK SPEND: missing recipient')

          const spendAction = Actions.bankSpendFromAccount(
            bankAddress,
            String(bankCfg.account).trim(),
            asset,
            String(bankCfg.recipient).trim(),
            bankCfg.amount, // will be converted → wei
          )

          return await buildActionsFromDraftAsync(spendAction)
        }

        if (act === 'CONFIG') {
          if (!bankCfg.account) throw new Error('BANK CONFIG: missing account id')

          const budgetStr = bankCfg.budgetWei
          const annualStr = bankCfg.annualLimitWei

          if (!budgetStr && !annualStr) {
            throw new Error(
              'BANK CONFIG: no budget/annualLimit change configured on proposal'
            )
          }

          const cfgAction = Actions.bankUpdateAccountBudget(
            bankAddress,
            String(bankCfg.account).trim(),
            asset,
            budgetStr ?? 0n,
            annualStr ?? 0n,
          )

          return await buildActionsFromDraftAsync(cfgAction)
        }

        if (act === 'CLOSE') {
          if (!bankCfg.account) throw new Error('BANK CLOSE: missing account id')

          const closeAction = Actions.bankCloseAccount(
            bankAddress,
            String(bankCfg.account).trim(),
            asset,
          )

          return await buildActionsFromDraftAsync(closeAction)
        }

        throw new Error(`Unsupported BANK actionType: ${bankCfg.actionType || 'unknown'}`)
      }



      // Fallback: if the draft only sets quorumChangeBps without a formal category
      default: {
        if (item.quorumChangeBps != null) {
          return await buildActionsFromDraftAsync(Actions.quorumDelta(dao, Number(item.quorumChangeBps)))
        }
        // Or budget-only draft without category
        if (item.budget) {
          return buildActionsFromDraft(budgetToAction())
        }
        throw new Error(`Unsupported category: ${cat}`)
      }
    }
  }



  async function onSubmitToVote(item: any) {
    if (!item?.daoAddress) { setActionError('Missing DAO address'); return }
    if (!item?.reservedId) { setActionError('Draft is not reserved on-chain'); return }


    setActionError(null)

    try {
      // Read required bond (wei) from DAO
      const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
      const daoRead = new ethers.Contract(item.daoAddress, DAO_ABI, provider)
      const bondValueWei: bigint = await daoRead.minBond()
      if (bondValueWei <= 0n) throw new Error('DAO minBond is zero; cannot submit.')

      // Open branded confirmation dialog (no window.confirm)
      const bondAKE = ethers.formatEther(bondValueWei)
      setConfirmBond({ valueWei: bondValueWei, pretty: bondAKE })
      setConfirmItem(item)
      setConfirmOpen(true)

      // stop here; proceed only if user confirms

      return
    } catch (err: any) {
      console.error('[proposal:submitToVote] prep failed:', err)
      setActionError(err?.message || 'Submission prep failed.')
    } finally {
      // keep setLoading(false) above when opening the modal
    }
  }



  async function handleConfirmSubmit() {
    if (!confirmBond || !confirmItem) return
    setConfirmOpen(false)

    setPromoting(true)

    // 🔧 Toggle this to false when you're ready to send real txs
    const DRY_RUN = false

    try {
      // (A) Build the exact actions
      const { targets, valuesWei, calldatas } = await buildActionsForItem(confirmItem)
      const cancelId = Number(confirmItem.cancelTargetId ?? 0)

      // (B) Compute the fingerprint
      const descriptionHash = computeActionsHash({
        dao: confirmItem.daoAddress,
        targets,
        valuesWei,
        calldatas,
        title: String(confirmItem.title || ''),
        desc: String(confirmItem.summary || ''),
      })

      // 🧪 DRY RUN: just log what we *would* send and bail out
      if (DRY_RUN) {
        console.log('[uGov] DRY RUN – submitForVote payload:', {
          daoAddress: confirmItem.daoAddress,
          localId: confirmItem.reservedId,
          targets,
          // bigint → string for readability
          valuesWei: valuesWei.map((v) => v.toString()),
          calldatas,
          descriptionHash,
          bondValueWei: confirmBond.valueWei.toString(),
          cancelProposalId: cancelId,
        })

        // You can also pretty-print each call if you like:
        calldatas.forEach((cd, i) => {
          console.log(`  call[${i}] →`, {
            target: targets[i],
            valueWei: valuesWei[i].toString(),
            calldata: cd,
          })
        })

        setPromoting(false)
        return
      }

      // (C) Preflight (optional, still commented out)
      /*
      await simulateSubmitForVote(confirmItem.daoAddress, {
        localId: confirmItem.reservedId,
        targets,
        valuesWei,
        calldatas,
        descriptionHash,
      }, session.address!)
      */

      // (D) Submit payable tx (REAL THING – only runs when DRY_RUN === false)
      const { txHash } = await submitForVoteOnchain(
        confirmItem.daoAddress,
        {
          localId: confirmItem.reservedId,
          targets,
          valuesWei,
          calldatas,
          descriptionHash,
          bondValueWei: confirmBond.valueWei,
          cancelProposalId: cancelId,
        },
        { timeoutMs: 120_000 }
      )

      // (E) Persist exactly what we used
      await markProposalSubmitted(id!, {
        txHash: txHash as `0x${string}`,
        offchainRef: confirmItem.offchainRef as `0x${string}` | undefined,
        descriptionHash,
        bodyMd: confirmItem.bodyMd,
        fingerprintInputs: {
          title: String(confirmItem.title || ''),
          desc: String(confirmItem.summary || ''),
        },
        actionsSnapshot: serializeActionsSnapshot(targets, valuesWei, calldatas),
      })

      if (
        String(confirmItem.category).toUpperCase() === 'EMERGENCY_CANCEL' &&
        cancelId > 0
      ) {
        await setProposalHoldPair({
          daoAddress: confirmItem.daoAddress,
          targetReservedId: cancelId,
          holdingDocId: id!,
          holdingReservedId: confirmItem.reservedId,
        })
      }

      nav('/proposals')
    } catch (err: any) {
      console.error('[proposal:submitToVote] failed:', err)
      setActionError(err?.message || 'Submission failed.')
    } finally {
      setPromoting(false)
    }
  }





  // ---------------------------------- Voting ---
  const onVote = async (itm: any, support: 0 | 1 | 2) => {
    if (!itm?.daoAddress) { setActionError('Missing DAO address'); return }
    if (!itm?.reservedId) { setActionError('Missing proposal id'); return }

    setLoading(true)
    setSubmittingVote(support)
    setActionError(null)

    try {
      await simulateCastVote(itm.daoAddress, { localId: itm.reservedId, support, voter: session?.address })
      //const popup = preOpenAmvaultPopup()
      try {
        await castVoteOnchain(itm.daoAddress, { localId: itm.reservedId, support }, { timeoutMs: 120_000 })
        await markVoting(id!)
      } finally {
        //closeSharedPopup()
      }
      // Re-read everything important for the UI
      await refreshChainUI(itm)
      try {
        const [p, mine] = await Promise.all([
          getVotingProgress(itm.daoAddress, itm.reservedId),
          getMyVote(itm.daoAddress, itm.reservedId, session!.address!),
        ])
        setProgress(p)
        if (mine.hasVoted) {
          setHasVoted(true)
          setMyVote({ support: mine.support!, weight: mine.weight! })
        }
      } catch { }
    } catch (err: any) {
      const msg = String(err?.message || '')
      setActionError(msg || 'Vote failed.')
      if (msg.includes('NoPower')) {
        await explainNoPower(itm)       // show inline explainer + delegate button
      }
    } finally {
      setLoading(false)
      setSubmittingVote(null)
    }
  }
  const onVoteYes = (itm: any) => onVote(itm, SUPPORT.yes)
  const onVoteNo = (itm: any) => onVote(itm, SUPPORT.no)
  const onVoteAbstain = (itm: any) => onVote(itm, SUPPORT.abstain)

  const onFinalize = async (itm: any) => {
    if (!itm?.daoAddress || !itm?.reservedId) { setActionError('Missing DAO address or id'); return }
    setLoading(true)
    setActionError(null)
    setPostAction('finalize')

    const isEmergency = String(itm?.category || '').toUpperCase() === 'EMERGENCY_CANCEL'

    // capture the on-chain link BEFORE finalize clears it
    let targetLocalId: number | null = null
    if (isEmergency) {
      try {
        const t = await readHeldTargetOnChain(itm.daoAddress, itm.reservedId)
        targetLocalId = t > 0 ? t : null
      } catch { /* ignore */ }
    }

    // helper: resolve A’s docId from (daoId, reservedId)
    const findTargetDocId = async (): Promise<string | null> => {
      if (!targetLocalId) return null
      const snap = await getDocs(query(
        collection(db, 'proposals'),
        where('daoId', '==', itm.daoId),
        where('reservedId', '==', String(targetLocalId)),
        limit(1)
      ))
      return snap.empty ? null : snap.docs[0].id
    }

    try {
      //const popup = preOpenAmvaultPopup()
      try {
        await finalizeOnchain(itm.daoAddress, itm.reservedId, { timeoutMs: 120_000 })
      } finally {
        //closeSharedPopup()
      }

      const st = await getState(itm.daoAddress, itm.reservedId)

      if (isEmergency) {
        const targetDocId = await findTargetDocId()

        if (st === STATE.EXECUTED) {
          // Emergency PASSED → target canceled on-chain; mirror to Firestore
          if (targetDocId) {
            await markCanceled(targetDocId)
            await releaseHoldForTarget(targetDocId)        // turns off banner on A
            await removeHeldLink(id!, targetDocId)         // remove A from B.holdsIds
          }
          await markExecuted(id!)                          // B shows Executed
        } else if (st === STATE.DEFEATED) {
          // Emergency FAILED → release the hold locally & mark defeated
          if (targetDocId) {
            await releaseHoldForTarget(targetDocId)
            await removeHeldLink(id!, targetDocId)
          }
          await markDefeated(id!)
        } else if (st === STATE.SUCCEEDED) {
          // Should not happen for emergency; ignore
        }
      } else {
        // Normal proposal
        if (st === STATE.SUCCEEDED) {
          await markSucceeded(id!)
        } else if (st === STATE.DEFEATED) {
          await markDefeated(id!)
        }
      }

      await refreshChainUI(itm)
    } catch (e: any) {
      setActionError(e?.message || 'Finalize failed.')
    } finally {
      setLoading(false)
      setPostAction(null)
    }
  }


  const onQueue = async (itm: any) => {
    if (!itm?.daoAddress || !itm?.reservedId) { setActionError('Missing DAO address or id'); return }
    setLoading(true)
    setActionError(null)
    setPostAction('queue')
    try {
      //const popup = preOpenAmvaultPopup()
      try {
        await queueOnchain(itm.daoAddress, itm.reservedId, { timeoutMs: 120_000 })
        await markQueued(id!)
      } finally { }
      await refreshChainUI(itm)
    } catch (e: any) {
      setActionError(e?.message || 'Queue failed.')
    } finally {
      setLoading(false)
      setPostAction(null)
    }
  }












  async function fetchDaoTreasury(daoAddr: string): Promise<string | null> {
    try {
      const daosRef = collection(db, 'daos');

      // Primary: exact match on stored address
      const q = query(daosRef, where('address', '==', daoAddr), limit(1));
      let snap = await getDocs(q);
      if (!snap.empty) {
        const t = (snap.docs[0].data() as any)?.treasury;
        if (t && ethers.isAddress(t)) return t;
      }
    } catch {
      // ignore and fall through
    }
    return null;
  }

  async function fetchDaoBank(daoAddr: string): Promise<string | null> {
    try {
      const daosRef = collection(db, 'daos')

      // Exact match on DAO address (same pattern as fetchDaoTreasury)
      const q = query(daosRef, where('address', '==', daoAddr), limit(1))
      const snap = await getDocs(q)

      if (!snap.empty) {
        const data = snap.docs[0].data() as any
        const bank = data?.bank as string | undefined

        if (bank && ethers.isAddress(bank)) {
          // normalize checksum just like with treasury
          return ethers.getAddress(bank)
        }
      }
    } catch {
      // swallow and fall through to null
    }
    return null
  }



  const onExecute = async (itm: any) => {
    if (!itm?.daoAddress || !itm?.reservedId) {
      setActionError('Missing DAO address or id')
      return
    }

    setLoading(true)
    setActionError(null)
    setPostAction('execute')

    try {
      // 0) Rebuild the actions from *current* doc
      const { targets, valuesWei, calldatas } = await buildActionsForItem(itm)

      // 1) Recompute the *same* actions fingerprint used at submit time
      const actionsHashNow = computeActionsHash({
        dao: itm.daoAddress,
        targets,
        valuesWei,
        calldatas,
        title: String(itm.title || ''),
        desc: String(itm.summary || ''),
      })

      // 2) Read the on-chain hash that was actually voted on
      const fp = await getProposalFingerprint(itm.daoAddress, itm.reservedId) // must at least return { descriptionHash }
      const onchainHash = (fp?.descriptionHash || '0x') as `0x${string}`

      // (Optional) also check Firestore's saved descriptionHash if present
      const storedHash = (itm.descriptionHash || '') as `0x${string}`

      const mismatches: string[] = []
      if (onchainHash.toLowerCase() !== actionsHashNow.toLowerCase()) {
        mismatches.push(`On-chain fingerprint differs (on-chain ${onchainHash} vs now ${actionsHashNow}).`)
      }
      if (storedHash && storedHash.toLowerCase() !== actionsHashNow.toLowerCase()) {
        mismatches.push(`Stored fingerprint differs (stored ${storedHash} vs now ${actionsHashNow}).`)
      }
      if (mismatches.length) {
        setActionError(
          `Cannot execute: proposal content changed since voting started. ` +
          mismatches.join(' ') + ` Re-submit a new proposal with the updated content.`
        )
        return
      }

      // 3) Resolve the treasury and check balances
      const executor = await fetchDaoTreasury(itm.daoAddress)
      const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)

      const insuff: string[] = []

      // Native need
      const nativeNeeded = valuesWei.reduce((a, b) => a + (b ?? 0n), 0n)
      if (nativeNeeded > 0n) {
        const haveWei = await provider.getBalance(executor)
        if (haveWei < nativeNeeded) {
          const sym = (CHAIN as any)?.nativeSymbol || 'ETH'
          insuff.push(`Needs ${ethers.formatEther(nativeNeeded)} ${sym}, has ${ethers.formatEther(haveWei)} ${sym}.`)
        }
      }

      // ERC-20 needs (parse standard transfer calldatas)
      const erc20Iface = new ethers.Interface(ERC20_ABI)
      const erc20Needed: Record<string, bigint> = {}

      for (let i = 0; i < targets.length; i++) {
        const data = calldatas[i] ?? '0x'
        try {
          const tx = erc20Iface.parseTransaction({ data })
          if (tx?.name === 'transfer') {
            const token = targets[i]
            const amount = BigInt(tx.args?.[1] ?? 0)
            erc20Needed[token] = (erc20Needed[token] ?? 0n) + amount
          }
        } catch { /* non-ERC20; ignore */ }
      }

      for (const [tokenAddr, need] of Object.entries(erc20Needed)) {
        try {
          const erc = new ethers.Contract(tokenAddr, ERC20_ABI, provider)
          const [dec, sym, have] = await Promise.all([
            erc.decimals().catch(() => 18),
            erc.symbol().catch(() => 'TOKEN'),
            erc.balanceOf(executor).catch(() => 0n),
          ])
          if (have < need) {
            const fmt = (v: bigint) => ethers.formatUnits(v, dec)
            insuff.push(`Needs ${fmt(need)} ${sym} at ${tokenAddr}, has ${fmt(have)} ${sym}.`)
          }
        } catch {
          insuff.push(`Unable to verify balance for token ${tokenAddr}.`)
        }
      }

      if (insuff.length) {
        setActionError(
          `Cannot execute: the treasury (${executor}) is insufficiently funded. ` +
          insuff.join(' ') + ' Please fund the treasury and try again later.'
        )
        return
      }

      // 4  preflight (throws with a readable reason on failure)

      await simulateExecute(itm.daoAddress, { localId: itm.reservedId })

      // 5) Execute
      try {
        await executeOnchain(itm.daoAddress, itm.reservedId, { timeoutMs: 120_000 })
        await markExecuted(id!)
      } finally {
        //closeSharedPopup()
      }
      await refreshChainUI(itm)
    } catch (e: any) {
      setActionError(e?.message || 'Execute failed.')
    } finally {
      setLoading(false)
      setPostAction(null)
    }
  }











  /*   if (loading) return <div className="text-slate">Loading…</div>
    if (error) return <div className="text-red-600">{error}</div> */
  if (!item) return <div className="text-slate">Not found.</div>

  return (
    <div className="space-y-6">
      {/* Breadcrumb / Back */}
      <div className="flex items-center gap-3 text-sm">
        <button className="text-brand-primary hover:underline flex items-center gap-2" onClick={() => nav(-1)}>
          <ArrowLeft size={16} /> Back
        </button>
        <span className="text-slate">/</span>
        <Link to="/proposals" className="text-brand-primary hover:underline">Proposals</Link>
        <span className="text-slate">/</span>
        <span className="text-slate">#{id}</span>
      </div>

      {loading && (
        <div className="p-3 rounded-lg bg-gray-50 text-slate text-sm">
          Working… please confirm in AmVault if prompted.
        </div>
      )}
      {actionError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {actionError}
        </div>
      )}


      {/* Title & status */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="text-slate text-sm">#{formatLocalId(item.reservedId) ?? id}</div>
          <div className="flex items-center gap-2">
            <StatusChip status={item.status as any} />
            {showHoldBanner && (
              <Link
                to={heldBy ? `/proposals/${heldBy.id}` : '#'}
                className="px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 text-xs"
                title="Emergency hold is active; queue/execute are blocked"
              >
                On hold
              </Link>
            )}
          </div>
        </div>


        <h1 className="mt-2 text-2xl md:text-3xl font-semibold">{item.title}</h1>

        {/* Summary (new) */}
        {item.summary && (
          <p className="mt-2 mb-1 text-slate">{item.summary}</p>
        )}

        {/* Author */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-slate-600">
          <IdentityChip
            ain={item.author?.name}
            verified={!!item.author?.verified}
            size="sm"
            outlined={false}
            copyable={false}
          />

          {timeLabel && (
            <>
              <span className="opacity-40">•</span>
              <span className="whitespace-nowrap opacity-70">
                {timeLabel}
              </span>
            </>
          )}
        </div>


        {/* Tags (new) */}
        {Array.isArray(item.tags) && item.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.tags.map((t: string, i: number) => (
              <span key={`${t}-${i}`} className="px-2 py-1 rounded-lg bg-brand-line/60 text-xs flex items-center gap-1">
                <Tag size={12} /> {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* When on Hold or Holding */}
      {!isEmergency && showHoldBanner && heldBy && (
        <div className="mt-3 p-3 rounded-lg border bg-amber-50 text-amber-800">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-block w-2 h-2 rounded-full bg-amber-500" />
            <div className="text-sm">
              <div className="font-semibold">This proposal is currently on hold</div>
              <div className="mt-1">
                {heldBy ? (
                  <>It was placed on hold by{' '}
                    <Link className="underline font-medium" to={`/proposals/${heldBy.id}`}>
                      {heldBy.title}
                    </Link>
                    {item?.onHold?.reason ? <> — {item.onHold.reason}</> : null}.
                  </>
                ) : (
                  <>An emergency review is in progress. Actions are temporarily disabled.</>
                )}
              </div>
            </div>
          </div>
        </div>
      )}




      <AuthInline action={phase === 'onchain' ? 'vote' : 'send this draft on-chain'}>
        <div className={stickyWrapClass}>
          <div className="card p-3 flex flex-wrap items-center gap-2">
            {phase === 'onchain' ? (
              <>

                {/* --- Scheduled window (pre-open) --- */}
                {/* was: chainUI.state === STATE.VOTING && !chainUI.isOpen && !chainUI.hasEnded */}
                {ui.preOpen && (

                  <div className="w-full p-3 rounded-lg border bg-white/50">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">Voting is scheduled</div>
                      <div className="text-sm text-slate">
                        Starts in <span className="font-semibold">{fmtHMS(tMinusSec ?? chainUI.secondsUntilStart)}</span>
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-slate">
                      Start block: <span className="font-mono">{chainUI.voteStart}</span>{" "}
                      (≈ {Math.max(1, Math.ceil((tMinusSec ?? chainUI.secondsUntilStart) / 60))} min)
                    </div>

                    {chainUI.blocksUntilStart > 0 && (
                      <div className="mt-2">
                        <div className="h-2 w-full rounded bg-gray-200 overflow-hidden">
                          <div
                            className="h-2 bg-brand-primary transition-[width] duration-1000 ease-linear"
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min(
                                  100,
                                  ((chainUI.secondsUntilStart - (tMinusSec ?? chainUI.secondsUntilStart)) /
                                    Math.max(chainUI.secondsUntilStart, 1)) * 100
                                )
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="mt-1 text-xs text-slate">
                          ~{chainUI.blocksUntilStart} blocks ({BLOCK_TIME_SEC}s/block)
                        </div>
                      </div>
                    )}

                    {/* Delegate / live power */}
                    <div className="mt-3 p-3 rounded-lg border bg-white">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm">
                          <div className="font-medium">Make your votes count</div>
                        </div>

                        <button
                          className="px-3 py-2 rounded-lg border hover:bg-brand-line/40 disabled:opacity-50 shrink-0"
                          disabled={!session?.address || fixingPower}
                          onClick={() => onFixDelegateToSelf(item)}
                          title={!session?.address ? "Sign in to delegate" : "Delegate votes to myself"}
                        >
                          {fixingPower ? "Delegating…" : "Delegate to myself"}
                        </button>
                      </div>

                      {/* Live delegated power (current block) */}
                      <div className="mt-2 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {powerInfo ? (
                              <span
                                className={`px-2 py-0.5 rounded-full border ${powerInfo.nowVotes > 0n
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                                  }`}
                              >
                                Delegated now: {fmtUnits(powerInfo.nowVotes, powerInfo.decimals)} {powerInfo.symbol || ""}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-gray-50 text-slate border border-gray-200">
                                Not checked
                              </span>
                            )}

                            {/* <-- Insert here */}
                            {fixingPower && (
                              <span className="px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
                                Updating…
                              </span>
                            )}

                            {powerInfo && (
                              <div className="opacity-80 text-slate">
                                {" • "}Balance:{" "}
                                <span className="font-mono">
                                  {fmtUnits(powerInfo.balance, powerInfo.decimals)} {powerInfo.symbol || ""}
                                </span>
                                {" • "}Delegated to: {powerInfo.delegatedTo ?? "—"}
                                {" • "}Block: <span className="font-mono">#{powerInfo.chainBlock}</span>
                              </div>
                            )}
                          </div>


                          <button
                            className="text-brand-primary hover:underline disabled:opacity-50"
                            disabled={!session?.address}
                            onClick={() => explainNoPower(item)}
                          >
                            Refresh
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-emerald-700">
                        Tip: leave at least one block between delegation and the start block to ensure the checkpoint is recorded.
                      </div>
                    </div>
                  </div>

                )}

                {/* --- OPEN window: compact controls + info --- */}
                {ui.open && (
                  <>
                    {/* Row A — buttons + voting power (left), ends-in (right) */}
                    <div className="w-full flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        {!hasVoted && (
                          <>
                            {/* YES — brand primary */}
                            <button
                              onClick={() => onVoteYes(item)}
                              disabled={!!submittingVote}
                              className="flex items-center px-4 py-2 rounded-lg text-white bg-brand-primary hover:bg-brand-primary/90 focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:opacity-60"
                            >
                              {submittingVote === SUPPORT.yes ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Voting…
                                </>
                              ) : (
                                <>
                                  <ThumbsUp size={16} className="mr-2" /> Vote Yes
                                </>
                              )}
                            </button>

                            {/* NO — on-brand danger (inline styles) */}
                            <button
                              onClick={() => onVoteNo(item)}
                              disabled={!!submittingVote}
                              className="flex items-center px-4 py-2 rounded-lg text-white focus:outline-none focus:ring-2 disabled:opacity-60"
                              style={{ backgroundColor: '#D61F45', ['--tw-ring-color' as any]: '#D61F45' }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#B71A39')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#D61F45')}
                            >
                              {submittingVote === SUPPORT.no ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Voting…
                                </>
                              ) : (
                                <>
                                  <ThumbsDown size={16} className="mr-2" /> Vote No
                                </>
                              )}
                            </button>

                            {/* ABSTAIN — neutral outline */}
                            <button
                              onClick={() => onVoteAbstain(item)}
                              disabled={!!submittingVote}
                              className="flex items-center px-4 py-2 rounded-lg border border-brand-line text-ink bg-white hover:bg-brand-line/30 focus:outline-none focus:ring-2 focus:ring-brand-line/60 disabled:opacity-60"
                            >
                              {submittingVote === SUPPORT.abstain ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Voting…
                                </>
                              ) : (
                                <>
                                  <MinusCircle size={16} className="mr-2" /> Abstain
                                </>
                              )}
                            </button>
                            {/* Voting power chip */}
                            {proposalVotes != null && powerInfo && (
                              <span className="ml-1 px-2 py-1 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 text-sm">
                                Voting power: {fmtUnits(proposalVotes, powerInfo.decimals)} {powerInfo.symbol || ''}
                              </span>
                            )}
                          </>
                        )}




                        {hasVoted && myVote && powerInfo && (
                          <span className="ml-1 px-2 py-1 rounded-full border  text-emerald-700 border-emerald-200 text-sm">
                            My vote: <strong className="ml-1">
                              {myVote.support === SUPPORT.yes ? 'Yes' : myVote.support === SUPPORT.no ? 'No' : 'Abstain'}
                            </strong>
                            {' · '}
                            {fmtUnits(myVote.weight, powerInfo.decimals)} {powerInfo.symbol || ''}
                          </span>
                        )}
                      </div>

                      {/* Ends in */}
                      <span className="shrink-0 px-3 py-1 rounded-full border bg-white text-slate border-brand-line text-sm">
                        Ends in <span className="font-semibold">{fmtHMS(chainUI.secondsUntilEnd)}</span>
                      </span>
                    </div>

                    {/* Divider */}
                    <div className="w-full h-[6px] rounded bg-brand-line/60 mt-3" />

                    {/* Row B — segmented tally + chips */}
                    {progress && powerInfo && (
                      <div className="w-full mt-3">
                        <TallyStrip
                          forVotes={progress.forVotes}
                          againstVotes={progress.againstVotes}
                          abstainVotes={progress.abstainVotes}
                          total={progress.totalVotes}
                          fmt={(v) => fmtUnits(v, powerInfo.decimals)}
                          symbol={powerInfo.symbol || ''}
                        />
                      </div>
                    )}

                  </>
                )}

                {/* {!chainUI.isOpen && chainUI.hasEnded && progress && powerInfo && (
                  <div className="w-full mt-3">
                    {ui.finalize && (
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded-full border text-xs ${chainUI.state === STATE.SUCCEEDED || chainUI.state === STATE.QUEUED || chainUI.state === STATE.EXECUTED
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                        >
                          {chainUI.state === STATE.SUCCEEDED || chainUI.state === STATE.QUEUED || chainUI.state === STATE.EXECUTED ? 'Passed' : 'Failed'}
                        </span>
                        <span className="text-slate text-xs">Final results</span>
                      </div>
                    )}

                    <TallyStrip
                      forVotes={progress.forVotes}
                      againstVotes={progress.againstVotes}
                      abstainVotes={progress.abstainVotes}
                      total={progress.totalVotes}
                      fmt={(v) => fmtUnits(v, powerInfo.decimals)}
                      symbol={powerInfo.symbol || ''}
                    />
                  </div>
                )} */}
                {!chainUI.isOpen && chainUI.hasEnded && progress && powerInfo && (
                  <div className="w-full mt-3">
                    {(() => {
                      // compute outcome like Success Criteria
                      let passed: boolean | null = null

                      if (supplyInfo) {
                        const forV = progress.forVotes ?? 0n
                        const agV = progress.againstVotes ?? 0n
                        const abV = progress.abstainVotes ?? 0n

                        const quorumReq = supplyInfo.quorumRequired ?? 0n
                        const turnoutForQuorum = forV + abV
                        const reachedQuorum = turnoutForQuorum >= quorumReq
                        const majorityFor = forV > agV

                        passed = reachedQuorum && majorityFor
                      }

                      const isPass =
                        passed !== null
                          ? passed
                          : (chainUI.state === STATE.SUCCEEDED ||
                            chainUI.state === STATE.QUEUED ||
                            chainUI.state === STATE.EXECUTED)

                      return (
                        <>
                          <div className="mb-2 flex items-center gap-2">
                            <span
                              className={`px-2 py-1 rounded-full border text-xs ${isPass
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}
                            >
                              {isPass ? 'Passed' : 'Failed'}
                            </span>
                            <span className="text-slate text-xs">Final results</span>
                          </div>

                          <TallyStrip
                            forVotes={progress.forVotes}
                            againstVotes={progress.againstVotes}
                            abstainVotes={progress.abstainVotes}
                            total={progress.totalVotes}
                            fmt={(v) => fmtUnits(v, powerInfo.decimals)}
                            symbol={powerInfo.symbol || ''}
                          />
                        </>
                      )
                    })()}
                  </div>
                )}


                {/* --- When Cancelled --- */}
                {chainUI.showCanceled && (
                  <span className="px-2 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200 text-sm">
                    Canceled
                  </span>
                )}


                {/* --- Post-vote lifecycle --- */}
                {chainUI.showFinalize && (
                  <button
                    onClick={() => onFinalize(item)}
                    className="px-4 py-2 rounded-lg border hover:bg-brand-line/40 disabled:opacity-60"
                    disabled={postAction !== null}
                  >
                    {postAction === 'finalize'
                      ? (<span className="inline-flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finalizing…</span>)
                      : 'Finalize'}
                  </button>
                )}
                {/* was: chainUI.showQueue */}
                {ui.queue && (
                  <button
                    onClick={() => onQueue(item)}
                    className="px-4 py-2 rounded-lg border hover:bg-brand-line/40 disabled:opacity-60"
                    disabled={postAction !== null}
                  >
                    {postAction === 'queue'
                      ? (<span className="inline-flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Queuing…</span>)
                      : 'Queue'}
                  </button>
                )}
                {chainUI.state === STATE.QUEUED && !chainUI.showExecute && chainUI.secondsUntilExecute != null && (
                  <span className="px-2 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200 text-sm">
                    Executable in <span className="font-semibold">{fmtHMS(chainUI.secondsUntilExecute)}</span>
                  </span>
                )}
                {/* was: chainUI.showExecute */}
                {ui.execute && (
                  <button
                    onClick={() => onExecute(item)}
                    className="px-4 py-2 rounded-lg border hover:bg-brand-line/40 disabled:opacity-60"
                    disabled={postAction !== null}
                  >
                    {postAction === 'execute'
                      ? (<span className="inline-flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Executing…</span>)
                      : 'Execute'}
                  </button>
                )}



              </>
            ) : (
              <>
                {isAuthor && (
                  <button
                    type="button"
                    className="px-3 py-2 rounded-xl border border-brand-line hover:bg-brand-line/40 mr-2"
                    onClick={() => {
                      const cat = String(item.category || '').toUpperCase()

                      const prefill: any = {
                        proposalId: id,
                        reservedId: item.reservedId,
                        title: item.title,
                        summary: item.summary,
                        category: item.category,
                        tags: Array.isArray(item.tags) ? item.tags.join(', ') : '',
                        body: stripAutoHeader(item.bodyMd),

                        // category-specific
                        budget: item.budget || null,
                        votingDelayBlocks: item.votingDelayBlocks,
                        votingPeriodBlocks: item.votingPeriodBlocks,
                        quorumBps: item.quorumBps,
                        treasuryTimelockSec: item.treasuryTimelockSec,
                        newAdmin: item.newAdmin,
                        newToken: item.newToken,
                        cancelTargetId: item.cancelTargetId ? String(item.cancelTargetId) : '',

                        // meta
                        discussionUrl: item.discussionUrl || '',
                        references: Array.isArray(item.references)
                          ? item.references.join('\n')
                          : '',
                      }

                      // 🏦 BANK create-account prefill
                      if (cat === 'BANK') {
                        const bank = item.bank || {}
                        prefill.bank = {
                          actionType: bank.actionType || 'CREATE',
                          // keep the rows exactly as stored so the editor can show them
                          createAccounts: Array.isArray(bank.createAccounts)
                            ? bank.createAccounts
                            : [],
                          // if you also store single-account fields for CONFIG/SPEND/CLOSE,
                          // they can be forwarded too:
                          account: bank.account || '',
                          asset: bank.asset || 'AKE',
                          amount: bank.amount || '',
                          annualLimit: bank.annualLimit || '',
                          note: bank.note || '',
                        }
                      }

                      nav('/proposals/new', { state: { prefill } })
                    }}
                  >
                    Edit draft
                  </button>
                )}


                <button
                  className="btn"
                  disabled={promoting || !isAuthor}
                  onClick={async () => {
                    if (!isAuthor) { setError('Only the author can submit this draft.'); return }
                    setPromoting(true); setError(null);
                    try { await onSubmitToVote(item!) } catch (e: any) {
                      setError(e?.message || 'Failed to send to chain');
                    } finally { setPromoting(false) }
                    await refreshChainUI(item)
                  }}
                  title={isAuthor ? 'Submit this draft on-chain' : 'Only the author can submit'}
                >
                  <Rocket size={16} className="mr-2" />
                  {promoting ? 'Sending…' : 'Submit for Vote'}
                </button>

                {isAuthor && (
                  <div className="text-slate text-sm">Draft in discussion</div>
                )}
                {!isAuthor && (
                  <div className="text-xs text-slate mt-1">Only the author can submit this draft.</div>
                )}
              </>
            )}


            {/* right-side actions */}
            <div className="ml-auto flex items-center gap-2">
              {ENABLE_SUBSCRIPTIONS && (
                <button
                  className={`px-3 py-2 rounded-xl border ${subscribed ? 'bg-brand-line/70' : 'hover:bg-brand-line/40'}`}
                  onClick={() => setSubscribed(v => !v)}
                  title={subscribed ? 'Unsubscribe' : 'Subscribe'}
                >
                  <Bell size={16} className="mr-2 inline" />
                  {subscribed ? 'Subscribed' : 'Subscribe'}
                </button>
              )}


              {/* NEW: Cancel button — only when on-chain (holds do NOT hide it) */}
              {showCancelBtn && (
                <button
                  className="px-3 py-2 rounded-xl border hover:bg-brand-line/40"
                  onClick={openCancelDialog}
                  title={
                    isAuthor
                      ? 'Cancel my proposal (author action)'
                      : 'Request emergency cancellation (malicious content)'
                  }
                  disabled={postAction !== null}
                >
                  <XCircle size={16} className="mr-2 inline" />
                  Cancel
                </button>
              )}

              <button
                className="px-3 py-2 rounded-xl border hover:bg-brand-line/40"
                onClick={onShareClick}
              >
                <Share2 size={16} className="mr-2 inline" />
                Share
              </button>

              <button
                className="px-3 py-2 rounded-xl border hover:bg-brand-line/40"
                onClick={onCopyLink}
              >
                <LinkIcon size={16} className="mr-2 inline" />
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>

          </div>
        </div>
      </AuthInline>






      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Body */}
          <motion.section
            className="card p-6"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-xl font-semibold mb-3">Overview</h2>
            <div className="prose max-w-none text-slate break-words [&_code]:break-all">
              {item.bodyMd ? <Markdown>{item.bodyMd}</Markdown> : <p>No description.</p>}
            </div>

            {/* Discussion URL + References (new) */}
            {(item.discussionUrl || (Array.isArray(item.references) && item.references.length > 0)) && (
              <div className="mt-6 space-y-3 text-sm">
                {item.discussionUrl && (
                  <div>
                    <div className="font-semibold mb-1">Discussion</div>
                    <a className="text-brand-primary underline break-all" href={item.discussionUrl} target="_blank" rel="noreferrer">
                      {item.discussionUrl}
                    </a>
                  </div>
                )}
                {Array.isArray(item.references) && item.references.length > 0 && (
                  <div>
                    <div className="font-semibold mb-1">References</div>
                    <ul className="list-disc pl-5 space-y-1">
                      {item.references.map((u: string, i: number) => (
                        <li key={`${u}-${i}`}>
                          <a className="text-brand-primary underline break-all" href={u} target="_blank" rel="noreferrer">
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </motion.section>

          {/* Comments */}
          <motion.section
            className="card p-6"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >

            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Discussion</h2>

              <div className="flex items-center gap-2 text-sm">
                <label htmlFor="comment-sort" className="text-slate shrink-0">Sort</label>

                <div className="relative">
                  <select
                    id="comment-sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    className="
        select !w-auto min-w-[120px] pl-3 pr-8 py-1.5 bg-white
        !appearance-none [-webkit-appearance:none] [-moz-appearance:none]
        !bg-none [background-image:none]
      "
                  >
                    <option value="new">Newest</option>
                    <option value="old">Oldest</option>
                  </select>

                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
                  />
                </div>
              </div>
            </div>


            {/* New comment box — inline auth (compact) */}
            <div className="mt-4">
              <AuthInline action="comment" compact>
                <form
                  className="flex items-center gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const input = e.currentTarget.elements.namedItem('comment') as HTMLInputElement
                    const text = input.value.trim()
                    if (!text) return
                    setPosting(true)
                    setError(null)
                    try {
                      await addComment(id!, text, session.ain)
                      input.value = ''
                      commentInputRef.current?.focus()
                    } catch (err: any) {
                      setError(err?.message || 'Failed to comment')
                    } finally {
                      setPosting(false)
                    }
                  }}
                >
                  <input
                    name="comment"
                    ref={commentInputRef}
                    className="input flex-1"
                    placeholder="Write a comment… (Markdown supported: **bold**, _italics_, [link](https://example.com))"
                    disabled={posting}
                  />
                  <button className="btn" type="submit" disabled={posting}>
                    <MessageSquare size={16} className="mr-2" />
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </form>
              </AuthInline>
            </div>



            <div className="mt-4 space-y-3">
              {sortedComments.length === 0 && <div className="text-slate text-sm">No comments yet.</div>}
              {sortedComments.map((c) => (
                <div key={c.id} className="p-3 rounded-xl border border-brand-line bg-brand-bg">
                  <div className="text-sm mb-1 flex items-center gap-2">
                    <IdentityChip
                      ain={c.author?.name ?? 'user'}
                      size="xs"
                      font="sans"                       // 👈 no monospace in comments
                      outlined
                      copyable={false}
                      rounded="md"
                      chipClassName="bg-white text-slate-800"  // 👈 tune colors
                      textClassName="font-medium"              // 👈 tune weight
                      iconSize={14}                            // 👈 smaller identicon
                      className="align-middle"
                    />

                    {/* Optional: crown for the proposal author */}
                    {isCommentByAuthor(c) && (
                      <span className="px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 text-[11px]">
                        👑 Author
                      </span>
                    )}

                    {c.createdAt && (
                      <span className="text-slate ml-auto">
                        {new Date((c.createdAt as Timestamp).toDate()).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="text-ink whitespace-pre-wrap">{c.text}</div>
                </div>
              ))}
            </div>
          </motion.section>
        </div>

        {/* Right rail */}
        {/* If Holding*/}
        <div className="space-y-6">
          {isEmergency && holdingList.length > 0 && (
            <section className="card p-5">
              <h3 className="font-semibold flex items-center gap-2">
                <CircleHelp size={16} /> Holding these proposals
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                {holdingList.map(p => (
                  <li key={p.id} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <Link to={`/proposals/${p.id}`} className="underline">
                      {p.title}
                    </Link>
                    {p.status && <span className="ml-2 text-slate">· {String(p.status)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}



          {/* Status & timeline */}
          <section className="card p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity size={16} /> Status
            </h3>
            <div className="mt-3 flex items-center gap-2">
              <StatusChip status={item.status as any} />
              <span className="text-sm text-slate">{phase === 'onchain' ? 'On-chain' : 'In discussion'}</span>
            </div>
            <div className="mt-4">
              <div className="text-sm text-slate">Timeline</div>
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-primary" /> Created · {createdAtText}
                </div>
                {phase === 'onchain' && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-brand-primary" /> Submitted on-chain
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Author */}
          <section className="card p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <IdCard size={16} /> Author
            </h3>
            <IdentityChip
              ain={item?.author?.name}
              verified={!!item?.author?.verified}
              size="sm"
              outlined={false}     // default, can omit
              copyable={false}     // default, can omit
            />
          </section>



          {/* Proposal action (replaces the old “Budget” card) */}
          <section className="card p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings2 size={16} /> Proposal action
            </h3>
            {/* Category chip */}
            <div className="mt-2">
              <span className="px-2 py-0.5 rounded-full border bg-white text-slate border-brand-line text-xs">
                {String(item?.category || 'General')}
              </span>
            </div>
            {/* Action summary */}
            <div className="mt-3">
              {renderActionSummary(item)}
            </div>
          </section>


          {/* Success criteria (contract-accurate) */}
          <section className="card p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <GaugeCircle size={16} /> Success Criteria
            </h3>

            {/* Outcome */}
            <div className="mt-3 text-sm">
              {progress && supplyInfo && powerInfo ? (() => {
                // Phase flags
                const isPreOpen = chainUI?.state === STATE.VOTING && !chainUI?.isOpen && !chainUI?.hasEnded
                const isOpen = chainUI?.isOpen && !chainUI?.hasEnded
                const isEnded = !!chainUI?.hasEnded

                // Contract semantics
                const quorumReq = supplyInfo.quorumRequired ?? 0n
                const turnoutForQuorum = (progress.forVotes ?? 0n) + (progress.abstainVotes ?? 0n)
                const reachedQuorum = turnoutForQuorum >= quorumReq
                const majorityFor = (progress.forVotes ?? 0n) > (progress.againstVotes ?? 0n)
                const passed = reachedQuorum && majorityFor

                // Badge + subline by phase
                let badgeText = '—'
                let badgeCls = 'bg-slate-100 text-slate-800 border-slate-200'
                let subline: React.ReactNode = null

                if (isPreOpen) {
                  badgeText = 'Scheduled'
                  subline = <>Voting starts in <span className="font-semibold">{fmtHMS(chainUI.secondsUntilStart)}</span></>
                } else if (isOpen) {
                  badgeText = 'Voting'
                  badgeCls = 'bg-amber-50 text-amber-700 border-amber-200'
                  subline = <>So far: {reachedQuorum ? 'Quorum reached' : 'Quorum not reached'} · Majority {majorityFor ? 'for' : 'against'}</>
                } else if (isEnded) {
                  badgeText = passed ? 'Passed' : 'Failed'
                  badgeCls = passed
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                  subline = <>{reachedQuorum ? 'Quorum reached' : 'Quorum not reached'} · Majority {majorityFor ? 'for' : 'against'}</>
                } else {
                  // Fallback (e.g., draft/off-chain)
                  badgeText = 'Draft'
                  subline = <>Not on-chain yet</>
                }

                return (
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full border text-sm ${badgeCls}`}>{badgeText}</span>
                    <span className="text-slate">{subline}</span>
                  </div>
                )
              })() : (
                <div className="text-slate">—</div>
              )}
            </div>

            {/* One-bar segmented tally */}
            {progress && powerInfo && (
              <div className="mt-3">
                {(() => {
                  const forV = progress.forVotes ?? 0n
                  const agV = progress.againstVotes ?? 0n
                  const abV = progress.abstainVotes ?? 0n

                  // Total for bar percentage (all votes)
                  const allVotes = forV + agV + abV

                  const pct = (n: bigint, d: bigint) => {
                    if (d === 0n) return 0
                    // 1 decimal percentage without float drift
                    return Number((n * 1000n) / d) / 10
                  }
                  const forPct = pct(forV, allVotes)
                  const agPct = pct(agV, allVotes)
                  const abPct = pct(abV, allVotes)

                  return (
                    <>
                      <div className="w-full h-3 rounded overflow-hidden bg-gray-200 flex">
                        <div className="h-full" style={{ width: `${forPct}%`, background: '#10b981' }} />
                        <div className="h-full" style={{ width: `${agPct}%`, background: '#D61F45' }} />
                        <div className="h-full" style={{ width: `${abPct}%`, background: '#94a3b8' }} />
                      </div>

                      {/* Labels below bar */}
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="flex flex-col">
                          <span>For</span>
                          <span className="font-mono">
                            {fmtUnits(forV, powerInfo.decimals)} {powerInfo.symbol || ''}<span className="opacity-70"> ({forPct}%)</span>
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span>Against</span>
                          <span className="font-mono">
                            {fmtUnits(agV, powerInfo.decimals)} {powerInfo.symbol || ''}<span className="opacity-70"> ({agPct}%)</span>
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span>Abstain</span>
                          <span className="font-mono">
                            {fmtUnits(abV, powerInfo.decimals)} {powerInfo.symbol || ''}<span className="opacity-70"> ({abPct}%)</span>
                          </span>
                        </div>

                        {/* Use precise bigint sums for the two totals */}
                        <div className="flex flex-col">
                          <span>Turnout (for + abstain)</span>
                          <span className="font-mono">
                            {fmtUnits(forV + abV, powerInfo.decimals)} {powerInfo.symbol || ''}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span>All votes (for + against + abstain)</span>
                          <span className="font-mono">
                            {fmtUnits(allVotes, powerInfo.decimals)} {powerInfo.symbol || ''}
                          </span>
                        </div>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* Quorum math */}
            <div className="mt-4 text-sm">
              <div className="text-slate">Quorum required</div>
              <div className="mt-1 font-mono">
                {supplyInfo && powerInfo ? (
                  <>
                    {fmtUnits(supplyInfo.quorumRequired ?? 0n, powerInfo.decimals)} {powerInfo.symbol || ''}{' '}
                    <span className="opacity-70">
                      ({fmtBps(chainUI.quorumBps)} of {supplyInfo.totalAtSnapshot != null
                        ? <>snapshot supply {fmtUnits(supplyInfo.totalAtSnapshot, powerInfo.decimals)} {powerInfo.symbol || ''} @ block #{Math.max((chainUI.voteStart ?? 0) - 1, 0)}</>
                        : <>current supply {fmtUnits(supplyInfo.totalNow, powerInfo.decimals)} {powerInfo.symbol || ''}</>
                      })
                    </span>
                  </>
                ) : '—'}
              </div>

              {supplyInfo && powerInfo && (
                <div className="mt-2 text-xs text-slate">
                  Current total supply:&nbsp;
                  <span className="font-mono">
                    {fmtUnits(supplyInfo.totalNow, powerInfo.decimals)} {powerInfo.symbol || ''}
                  </span>
                  {supplyInfo.totalAtSnapshot == null && (
                    <span className="ml-1 opacity-70">(token doesn’t expose snapshot supply; quorum uses current supply)</span>
                  )}
                </div>
              )}
            </div>
          </section>




          {/* On-chain (smart) */}
          <section className="card p-5">
            <h3 className="font-semibold">On-chain</h3>

            {(() => {
              const onchainish =
                (item?.phase === 'onchain') ||
                !!item?.onchainReserved ||
                !!item?.reservedId ||
                !!item?.txHash ||
                (chainUI?.state != null && chainUI.state !== STATE.DRAFT);

              if (!onchainish) {
                return (
                  <div className="mt-2 text-sm text-slate">
                    Reference, track ID, and extrinsic hash will appear here once submitted.
                  </div>
                )
              }

              const codeCls =
                "inline-block max-w-full break-all px-1.5 py-0.5 rounded bg-brand-bg border border-brand-line align-middle";
              const pill = (txt: string, ok?: boolean) =>
                <span className={`px-2 py-0.5 rounded-full border text-xs ${ok === undefined ? 'bg-slate-100 text-slate-800 border-slate-200'
                  : ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>{txt}</span>;

              const state = chainUI?.state;
              const windowLine = (() => {
                if (!chainUI) return '—';
                const a = chainUI.voteStart, b = chainUI.voteEnd;
                const when =
                  chainUI.isOpen ? ` (ends in ${fmtHMS(chainUI.secondsUntilEnd)})` :
                    chainUI.hasEnded ? ' (ended)' :
                      (state === STATE.VOTING ? ` (starts in ${fmtHMS(chainUI.secondsUntilStart)})` : '');
                return `#${a ?? '—'} → #${b ?? '—'}${when}`;
              })();

              return (
                <div className="mt-3 text-sm space-y-2">

                  <div className="grid sm:grid-cols-2 gap-2 mt-1">
                    <div>
                      <span className="text-slate">DAO:</span>{' '}
                      <code className={codeCls}>{item?.daoAddress || '—'}</code>
                    </div>
                    <div>
                      <span className="text-slate">Proposal ID:</span>{' '}
                      <code className={codeCls}>#{item?.reservedId ?? '—'}</code>
                    </div>
                    <div>
                      <span className="text-slate">Submit Tx:</span>{' '}
                      <code className={codeCls}>{item?.txHash || '—'}</code>
                    </div>
                    <div>
                      <span className="text-slate">Description hash:</span>{' '}
                      <code className={codeCls}>{item?.descriptionHash || '—'}</code>
                    </div>

                    <div className="sm:col-span-2">
                      <span className="text-slate">Voting window:</span>{' '}
                      <code className={codeCls}>{windowLine}</code>
                    </div>
                  </div>
                </div>
              )
            })()}
          </section>

        </div>
      </div>
      <CancelProposalModal
        open={cancelOpen}
        mode={cancelMode}
        bondAKE={'0.1'}           // or read from DAO `minBond()` and format; this is just display
        symbol="AKE"
        busy={cancelBusy}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async () => {
          if (!item?.daoAddress || !item?.reservedId) { setCancelOpen(false); return }
          setCancelBusy(true)
          setActionError(null)

          //const popup = preOpenAmvaultPopup()
          try {
            if (cancelMode === 'author') {
              // TODO: wire to your real on-chain function
              await cancelByAuthorOnchain(item.daoAddress, item.reservedId, { timeoutMs: 120_000 })
              await markCanceled(id!)
            } else {
              // TODO: wire to your real on-chain function
              setCancelOpen(false)
              nav('/proposals/new', {
                state: {
                  prefill: {
                    category: 'EMERGENCY_CANCEL',
                    title: `Emergency cancel of #${item.reservedId}`,
                    summary: `Request to cancel proposal #${item.reservedId} due to suspected malicious or harmful content.`,
                    tags: 'emergency,cancel,security',
                    body: [
                      '## Why this should be canceled',
                      '',
                      '- Describe the malicious/unsafe behavior clearly.',
                      '- Add links or on-chain evidence.',
                      '',
                      '## Evidence',
                      '- Tx / contract refs:',
                      '',
                      '## Impact if not canceled',
                      '- …',
                      '',
                    ].join('\n'),
                    cancelTargetId: String(item.reservedId),   // 👈 the proposal to cancel
                  }
                }
              })
            }
            setCancelOpen(false)
            await refreshChainUI(item)

          } catch (e: any) {
            setActionError(e?.message || 'Cancellation failed.')
          } finally {
            setCancelBusy(false)
            //closeSharedPopup()
          }
        }}
      />

      <ConfirmBondModal
        open={confirmOpen}
        bondAKE={confirmBond?.pretty ?? '0'}
        symbol="AKE"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmSubmit}
      />
    </div>

  )
}
function toHex32(offchainRef: string): `0x${string}` {
  throw new Error('Function not implemented.')
}




// ---------------------------------------- Dialogs / Models

function ConfirmBondModal({
  open,
  bondAKE,
  symbol = 'AKE',
  onConfirm,
  onCancel,
}: {
  open: boolean
  bondAKE: string
  symbol?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-2xl bg-white shadow-xl border p-5">
        <h3 className="text-lg font-semibold">Submit proposal</h3>
        <p className="mt-2 text-sm text-slate">
          To submit a proposal in this DAO, you must pay a bond of{" "}
          <span className="font-medium">{bondAKE} {symbol}</span>.
        </p>
        <div className="mt-3 text-sm">
          <div className="font-medium mb-1">Refund rules</div>
          <ul className="list-disc pl-5 space-y-1 text-slate">
            <li><b>100%</b> refunded if your proposal passes.</li>
            <li><b>90%</b> refunded if your proposal fails.</li>
            <li><b>95%</b> refunded if you cancel your proposal.</li>
            <li><b>0%</b> refunded if it’s found malicious.</li>
          </ul>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={onCancel}>Cancel</button>
          <button className="btn-cta" onClick={onConfirm}>Submit Proposal</button>
        </div>
      </div>
    </div>
  )
}



function CancelProposalModal({
  open,
  mode,
  bondAKE,
  symbol = 'AKE',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  mode: 'author' | 'emergency'
  bondAKE: string           // show expected bond amount for emergency (e.g., 0.1)
  symbol?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  const isAuthor = mode === 'author'
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-2xl bg-white shadow-xl border p-5">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <XCircle size={18} /> {isAuthor ? 'Cancel proposal' : 'Emergency cancellation'}
        </h3>

        {isAuthor ? (
          <div className="mt-3 text-sm text-slate">
            <p>If you cancel this proposal now:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>You can re-work it and submit a new proposal later.</li>
              <li>You will <b>lose 5%</b> of your bond; <b>95%</b> will be refunded.</li>
            </ul>
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate">
            <p>This triggers an <b>emergency cancellation</b> process intended for <b>malicious</b> proposals.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>You must post a bond (e.g., <b>{bondAKE} {symbol}</b>).</li>
              <li>If a democratic majority agrees it is malicious, the proposal will be canceled and your bond refunded per DAO rules.</li>
              <li>If the DAO disagrees, <b>you lose your bond</b>.</li>
            </ul>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={onCancel} disabled={busy}>
            Close
          </button>
          <button
            className="px-3 py-2 rounded-lg text-white"
            style={{ backgroundColor: isAuthor ? '#D61F45' : '#0F172A' }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <span className="inline-flex items-center">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isAuthor ? 'Canceling…' : 'Submitting emergency…'}
              </span>
            ) : (
              isAuthor ? 'Cancel proposal' : 'Submit emergency cancel'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}