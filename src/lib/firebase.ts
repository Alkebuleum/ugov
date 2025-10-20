import { ethers } from 'ethers'
import { initializeApp } from 'firebase/app'
import {
  getFirestore, connectFirestoreEmulator,
  doc, getDoc, collection, addDoc, updateDoc, serverTimestamp, increment,
  getDocs, onSnapshot, orderBy, query, Timestamp, where, limit as qlimit, FieldValue,
  setDoc,
  arrayUnion,
  writeBatch,
  arrayRemove
} from 'firebase/firestore'
import {
  getFunctions, connectFunctionsEmulator, httpsCallable
} from 'firebase/functions'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getReadProvider } from './chain'
import { STATE } from './daoProposals'


/* -------------------------------------------------------------------------- */
/*  Init                                                                      */
/* -------------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const functions = getFunctions(app)
export const storage = getStorage(app)

export const PROPOSAL_PHASES = { Draft: 'discussion', Onchain: 'onchain' } as const
export const PROPOSAL_STATUS = { Draft: 'draft', Submitted: 'submitted' } as const

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}

// -------------------------- hash helpers

// hex.ts
export type Hex = `0x${string}`;

/** Assert a 0x-prefixed 32-byte hex string (e.g. keccak256) */
export function asHex32(s: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error(`Expected 32-byte hex, got: ${s}`);
  }
  return s as Hex;
}

/** Assert a generic 0x hex (no fixed length) */
export function asHex(s: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(s)) {
    throw new Error(`Expected hex string, got: ${s}`);
  }
  return s as Hex;
}

// Always normalize before hashing so repeats are stable
export function normalizeActions(
  dao: string,
  targets: string[],
  valuesWei: bigint[],
  calldatas: string[],
) {
  return {
    dao: ethers.getAddress(dao), // checksum case
    targets: targets.map(ethers.getAddress),
    valuesWeiHex: valuesWei.map(v => ethers.toBeHex(v)),     // canonical hex
    calldatasHex: calldatas.map(d => d.toLowerCase() as Hex), // canonical 0x hex
  }
}

/**
 * Deterministic actions fingerprint. We include:
 * - dao address
 * - targets / values / calldatas (normalized)
 * - lightweight human context (title, desc) so UI changes are caught
 */
export function computeActionsHash(input: {
  dao: string
  targets: string[]
  valuesWei: bigint[]
  calldatas: string[]
  title: string
  desc: string
}): Hex {
  const { dao, targets, valuesWei, calldatas, title, desc } = input
  const n = normalizeActions(dao, targets, valuesWei, calldatas)

  // Encode with ABI coder for solidity-parity
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address[]', 'uint256[]', 'bytes[]', 'string', 'string'],
    [n.dao, n.targets, n.valuesWeiHex, n.calldatasHex, title, desc]
  )
  return ethers.keccak256(encoded) as Hex
}

// For Firestore audit (no bigint)
export function serializeActionsSnapshot(
  targets: string[],
  valuesWei: bigint[],
  calldatas: string[],
) {
  return {
    targets,
    valuesWei: valuesWei.map(v => v.toString()), // decimal strings
    calldatas,
  }
}


/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

export type TreasuryCache = {
  totalUsd: number
  perToken?: Array<{
    type: 'native' | 'erc20'
    address: string        // '' for native
    symbol: string
    decimals: number
    balance: string        // human units as string
    priceUsd?: number
    valueUsd?: number
  }>
  updatedAt?: Timestamp
}



// --- Types (adjust to match your app)
export type ProposalPhase = 'discussion' | 'onchain'
export type ProposalStatus =
  | 'draft'
  | 'submitted'
  | 'voting'
  | 'succeeded'
  | 'queued'
  | 'executed'
  | 'failed'
  | 'canceled'

export type ProposalPatch = {
  phase?: ProposalPhase
  status?: ProposalStatus
  // hashes/refs captured on submit
  txHash?: `0x${string}`
  offchainRef?: `0x${string}`
  descriptionHash?: `0x${string}`
  bodyMd?: string
  // optional chain/timing metadata you may want to persist
  chain?: {
    blockNumber?: number
    voteStart?: number
    voteEnd?: number
  }
  // optional final tallies to freeze after finalize/execute
  tally?: {
    forVotes?: string // store as string to avoid precision loss
    againstVotes?: string
    abstainVotes?: string
    totalVotes?: string
    quorumBps?: number
  }
  // you can add any other fields you want to merge
  [k: string]: any
}

/**
 * Production updater: merges patch into the proposal doc and stamps updatedAt.
 * Throws on error; no alerts, no read-back.
 */
export async function updateProposal(
  proposalId: string,
  patch: ProposalPatch
): Promise<void> {
  if (!proposalId) throw new Error('Missing proposalId')
  const ref = doc(db, 'proposals', proposalId)
  const payload = {
    ...patch,
    updatedAt: serverTimestamp(),
  }
  await setDoc(ref, payload, { merge: true })
}


// Replace your debug updater with this production one
export async function markProposalSubmitted(
  proposalId: string,
  patch: SubmissionPatch
): Promise<void> {
  if (!proposalId) throw new Error('Missing proposalId')
  if (!patch?.txHash) throw new Error('Missing txHash')

  const payload: Partial<ProposalDoc> & {
    phase: 'onchain'
    status: 'Submitted' | string
    txHash: `0x${string}`
    updatedAt: any
  } = {
    phase: 'onchain',
    status: 'Submitted',
    txHash: patch.txHash,
    // optional
    ...(patch.offchainRef !== undefined ? { offchainRef: patch.offchainRef } : {}),
    ...(patch.descriptionHash !== undefined ? { descriptionHash: patch.descriptionHash } : {}),
    ...(typeof patch.bodyMd === 'string' ? { bodyMd: patch.bodyMd } : {}),
    // NEW optional fields
    ...(patch.fingerprintInputs ? { fingerprintInputs: patch.fingerprintInputs } : {}),
    ...(patch.actionsSnapshot ? { actionsSnapshot: patch.actionsSnapshot } : {}),
    updatedAt: patch.updatedAt ?? serverTimestamp(),
  }

  const ref = doc(db, 'proposals', proposalId)
  await setDoc(ref, payload, { merge: true })
}

export const markVoting = (proposalId: string) =>
  updateProposal(proposalId, { phase: 'onchain', status: 'voting' })

export const markSucceeded = (proposalId: string) =>
  updateProposal(proposalId, { phase: 'onchain', status: 'succeeded' })

export const markQueued = (proposalId: string) =>
  updateProposal(proposalId, { phase: 'onchain', status: 'queued' })

export const markExecuted = (proposalId: string) =>
  updateProposal(proposalId, { phase: 'onchain', status: 'executed' })

export const markFailed = (proposalId: string) =>
  updateProposal(proposalId, { phase: 'onchain', status: 'failed' })

export const markCanceled = (proposalId: string) =>
  updateProposal(proposalId, { phase: 'onchain', status: 'canceled' })



// Status helpers (you already have some of these; add the missing ones)
// If you already export markCanceled/markExecuted/markSucceeded, keep them.
// New: markDefeated + small helpers to release/remove hold links.

export async function markDefeated(docId: string) {
  await updateDoc(doc(db, 'proposals', docId), {
    status: 'defeated',
    updatedAt: serverTimestamp(),
  });
}

export async function releaseHoldForTarget(targetDocId: string) {
  // turns off the banner in the target (A)
  await updateDoc(doc(db, 'proposals', targetDocId), {
    'onHold.releasedAt': serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function removeHeldLink(holdingDocId: string, targetDocId: string | null) {
  if (!targetDocId) return;
  // remove A from B.holdsIds (right-rail list on the emergency proposal)
  await updateDoc(doc(db, 'proposals', holdingDocId), {
    holdsIds: arrayRemove(targetDocId),
    updatedAt: serverTimestamp(),
  });
}





//--------------------------------------------------------------------------------------------------------


// keep your existing sanitizeForFirestore

function numOrNull(v: any): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : null
}

/** Reads chain balances for treasury + trackedTokens and caches results on the DAO doc. */
export async function refreshTreasuryCache(daoId: string) {
  const ref = doc(db, 'daos', daoId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('DAO not found')

  const d = snap.data() as any
  const treasury: string | undefined = d.treasury
  const tokens: any[] = Array.isArray(d.trackedTokens) ? d.trackedTokens.slice(0, 3) : []
  if (!treasury || !/^0x[a-fA-F0-9]{40}$/.test(treasury)) {
    throw new Error('DAO treasury address not set or invalid.')
  }

  const provider = getReadProvider()
  const rows: TreasuryCache['perToken'] = []

  for (const t of tokens) {
    const type: 'native' | 'erc20' = (t?.type ?? (t?.address ? 'erc20' : 'native')) as any
    const decimals = Number.isFinite(t?.decimals) ? Number(t.decimals) : 18
    const symbol: string = (t?.symbol || (type === 'native' ? 'AKE' : 'TOK')) as string
    const priceUsd = numOrNull(t?.priceUsd)

    try {
      if (type === 'native') {
        const bal = await provider.getBalance(treasury)         // bigint
        const human = ethers.formatUnits(bal, decimals)         // string
        const valueUsd = priceUsd != null ? Number(human) * priceUsd : null
        rows.push({
          type, address: '', symbol, decimals, balance: human,
          ...(priceUsd != null ? { priceUsd } : {}),
          ...(valueUsd != null ? { valueUsd } : {}),
        })
      } else {
        const addr = String(t?.address || '')
        if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) throw new Error('Bad token address')
        const erc20 = new ethers.Contract(addr, ERC20_ABI, provider)
        const rawBal: bigint = await erc20.balanceOf(treasury)
        const human = ethers.formatUnits(rawBal, decimals)
        const valueUsd = priceUsd != null ? Number(human) * priceUsd : null
        rows.push({
          type, address: addr, symbol, decimals, balance: human,
          ...(priceUsd != null ? { priceUsd } : {}),
          ...(valueUsd != null ? { valueUsd } : {}),
        })
      }
    } catch {
      rows.push({
        type,
        address: type === 'native' ? '' : (String(t?.address || '')),
        symbol, decimals, balance: '0',
        ...(priceUsd != null ? { priceUsd } : {}),
      })
    }
  }

  const totalUsd = rows.reduce((sum, r: any) => sum + (Number.isFinite(r.valueUsd) ? Number(r.valueUsd) : 0), 0)

  const payload = sanitizeForFirestore({
    treasuryCache: {
      totalUsd,
      perToken: rows,
      updatedAt: serverTimestamp(),  // 🔐 server-resolved
      updatedAtMs: Date.now(),       // ⚡ instant fallback for UI
    },
  })

  await updateDoc(ref, payload)
  return { totalUsd }
}

// Add this new type:
export type TrackedToken = {
  address: string
  symbol: string
  decimals?: number
  // Balance should be in human units (already divided by 10^decimals).
  // If you store a string, we'll parse it in the UI.
  balance?: number | string
  priceUsd?: number | string
  updatedAt?: Timestamp
}

export async function updateDAOTrackedTokens(
  daoId: string,
  tokens: Array<{
    type?: 'erc20' | 'native'
    address?: string
    symbol: string
    decimals?: number
    balance?: number | string
    priceUsd?: number | string
  }>
) {
  const ref = doc(db, 'daos', daoId)
  const trimmed = (tokens || [])
    .slice(0, 3)
    .map((t) => {
      const out: any = {
        type: t.type ?? (t.address ? 'erc20' : 'native'),
        address: t.address ? String(t.address).toLowerCase() : '',
        symbol: t.symbol,
        decimals: Number.isFinite(t.decimals) ? Number(t.decimals) : 18,
      }
      if (t.balance !== undefined) out.balance = t.balance
      if (t.priceUsd !== undefined) {
        const n = numOrNull(t.priceUsd)
        if (n === null) out.priceUsd = null
        else out.priceUsd = n
      }
      return out
    })

  await updateDoc(ref, sanitizeForFirestore({ trackedTokens: trimmed }))
}


export type DAO = {
  id: string
  address: string
  name?: string
  about?: string
  isDefault: boolean
  treasury: string
  admin: string
  votesToken: string
  votingDelayBlocks: number
  votingPeriodBlocks: number
  timelockDelaySeconds: number
  quorumBps: number
  createdAt?: Timestamp
  trackedTokens?: TrackedToken[]  // keep length ≤ 3
}

// ---- Types (lightweight, align with what ProposalDetail expects) ----
type CategoryCode = 'BUDGET' | 'VOTING_CONFIG' | 'SET_ADMIN' | 'SET_VOTE_TOKEN' | 'EMERGENCY_CANCEL'

export type Phase = 'discussion' | 'onchain'
type Budget = {
  amount: number
  asset: string
  recipient: string
  decimals?: number
}

type Author = {
  name: string
  address: string
  avatar?: number
}

export type NewProposal = {
  // Core
  title: string
  summary?: string
  category: CategoryCode
  tags?: string[]
  bodyMd: string
  discussionUrl?: string | null
  references?: string[]

  // Voting Config knobs (optional; saved when category === 'VOTING_CONFIG')
  votingDelayBlocks?: number | null
  votingPeriodBlocks?: number | null
  quorumBps?: number | null
  treasuryTimelockSec?: number | null

  // Other action payloads
  budget?: Budget | null               // BUDGET
  newAdmin?: string | null             // SET_ADMIN
  newToken?: string | null             // SET_VOTE_TOKEN

  // Denorms
  author?: Author
  daoAddress?: string | null
  daoName?: string | null

  // On-chain linkage
  offchainRef?: `0x${string}` | null
  descriptionHash?: `0x${string}` | null
  reservedId?: string | null
  txHash?: `0x${string}` | null
  onchainReserved?: boolean
  cancelTargetId?: string | number
}

export type HoldLink = {
  by: string;            // proposalId of the proposal that placed the hold (B)
  reason?: string | null;
  since?: any;           // serverTimestamp()
  releasedAt?: any | null;
};

export async function setProposalHold(heldId: string, byId: string, reason?: string) {
  const heldRef = doc(db, 'proposals', heldId);
  const byRef = doc(db, 'proposals', byId);

  await Promise.all([
    setDoc(heldRef, {
      onHold: { by: byId, reason: reason ?? null, since: serverTimestamp(), releasedAt: null }
    }, { merge: true }),
    setDoc(byRef, { holdsIds: arrayUnion(heldId) }, { merge: true })
  ]);
}

export async function releaseProposalHold(heldId: string) {
  const heldRef = doc(db, 'proposals', heldId);
  await setDoc(heldRef, { 'onHold.releasedAt': serverTimestamp() }, { merge: true });
}

// What we actually store (minimal, inferred)
type ProposalDoc = {
  daoId: string
  title: string
  summary: string
  category: CategoryCode
  tags: string[]
  bodyMd: string
  discussionUrl: string | null
  references: string[]

  // Config knobs (persisted only if provided)
  votingDelayBlocks?: number
  votingPeriodBlocks?: number
  quorumBps?: number
  treasuryTimelockSec?: number

  // Action payloads
  budget: Budget | null
  newAdmin?: string | null
  newToken?: string | null

  // Denorms
  author: Author
  phase: 'discussion' | 'onchain'
  status: 'Draft' | 'Submitted' | 'Voting' | 'Queued' | 'Executed' | 'Failed' | 'Canceled'
  counters: { comments: number; votes: number }
  createdAt: any

  daoAddress: string | null
  daoName: string | null

  // On-chain linkage
  fingerprintInputs?: { title: string; desc: string } | null
  actionsSnapshot?: {
    targets: string[]
    valuesWei: string[]        // bigint serialized to decimal strings
    calldatas: string[]
  } | null
  txHash?: Hex | null
  offchainRef?: Hex | null
  descriptionHash?: Hex | null
  onchainReserved: boolean
  reservedId: string | null

  //Emergency hold
  cancelTargetId?: string | null
  onHold?: {
    byDocId?: string              // B's Firestore doc id
    byReservedId?: string         // B's reservedId
    at?: Timestamp | FieldValue
    releasedAt?: Timestamp | FieldValue | null
  }
  holdsTarget?: {
    docId?: string                // A's Firestore doc id
    reservedId?: string           // A's reservedId
  }
}

export async function createProposal(daoId: string, p: NewProposal) {
  try {
    // sanitize helpers
    const arr = (v?: string[]) => Array.isArray(v) ? v.filter(Boolean) : []
    const num = (v: any) => (typeof v === 'number' ? v : v == null ? undefined : Number(v))
    const numOrNull = (v: any) => (v == null ? null : Number(v))
    const strOrNull = (v: any) => (v == null || v === '' ? null : String(v))

    const docData: ProposalDoc = {
      daoId,
      title: p.title,
      summary: p.summary ?? '',
      category: p.category,
      tags: arr(p.tags),
      bodyMd: p.bodyMd,
      discussionUrl: strOrNull(p.discussionUrl),
      references: arr(p.references),

      // Voting config knobs (persist only when defined)
      ...(num(p.votingDelayBlocks) != null ? { votingDelayBlocks: num(p.votingDelayBlocks)! } : {}),
      ...(num(p.votingPeriodBlocks) != null ? { votingPeriodBlocks: num(p.votingPeriodBlocks)! } : {}),
      ...(num(p.quorumBps) != null ? { quorumBps: num(p.quorumBps)! } : {}),
      ...(num(p.treasuryTimelockSec) != null ? { treasuryTimelockSec: num(p.treasuryTimelockSec)! } : {}),


      // Action payloads
      budget: p.budget
        ? {
          amount: Number(p.budget.amount),
          asset: p.budget.asset,
          recipient: p.budget.recipient,
          ...(p.budget.decimals != null ? { decimals: Number(p.budget.decimals) } : {}),
        }
        : null,
      ...(p.newAdmin !== undefined ? { newAdmin: strOrNull(p.newAdmin) } : {}),
      ...(p.newToken !== undefined ? { newToken: strOrNull(p.newToken) } : {}),

      // Denorms
      author: p.author ?? { name: 'AmID-xxxx', address: '0x...', avatar: Math.floor(Math.random() * 4) + 1 },
      phase: 'discussion',
      status: 'Draft',
      counters: { comments: 0, votes: 0 },
      createdAt: serverTimestamp(),

      daoAddress: p.daoAddress ?? null,
      daoName: p.daoName ?? null,

      // On-chain linkage
      offchainRef: (p.offchainRef as any) ?? null,
      descriptionHash: (p.descriptionHash as any) ?? null,
      reservedId: p.reservedId ?? null,
      txHash: (p.txHash as any) ?? null,
      onchainReserved: !!p.onchainReserved,

      cancelTargetId: p.cancelTargetId != null ? String(p.cancelTargetId) : null,
    }

    const ref = await addDoc(collection(db, 'proposals'), docData)
    return { id: ref.id }
  } catch (err: any) {
    throw new Error(err?.message || String(err))
  }
}



export async function findProposalIdByReservedId(
  daoAddress: string,
  reservedId: string | number
): Promise<string | null> {
  const qref = query(
    collection(db, 'proposals'),
    where('daoAddress', '==', daoAddress),
    where('reservedId', '==', String(reservedId)),
    qlimit(1)
  )
  const snap = await getDocs(qref)
  if (snap.empty) return null
  return snap.docs[0].id
}

export async function setProposalHoldPair(params: {
  daoAddress: string
  targetReservedId: string | number   // A (the proposal being put on hold)
  holdingDocId: string                // B (this emergency-cancel proposal) – Firestore doc id
  holdingReservedId: string | number  // B’s reservedId
}): Promise<boolean> {
  const { daoAddress, targetReservedId, holdingDocId, holdingReservedId } = params

  const targetDocId = await findProposalIdByReservedId(daoAddress, targetReservedId)
  if (!targetDocId) throw new Error(`Target proposal not found: ${daoAddress} #${targetReservedId}`)

  const batch = writeBatch(db)
  const targetRef = doc(db, 'proposals', targetDocId)     // A
  const holdingRef = doc(db, 'proposals', holdingDocId)   // B

  // A ← mark as on-hold, pointing to B
  batch.set(targetRef, {
    onHold: {
      byDocId: holdingDocId,
      byReservedId: String(holdingReservedId),
      at: serverTimestamp(),
      releasedAt: null,
    }
  }, { merge: true })

  // B ← remember which proposal it is holding (A)
  batch.set(holdingRef, {
    cancelTargetId: String(targetReservedId),
    holdsTarget: {
      docId: targetDocId,
      reservedId: String(targetReservedId),
    }
  }, { merge: true })

  await batch.commit()
  return true
}



/* -------------------------------------------------------------------------- */
/*  DAO                                                                       */
/* -------------------------------------------------------------------------- */
export async function createDAO(data: Omit<DAO, 'id' | 'createdAt'>) {
  const ref = await addDoc(collection(db, 'daos'), {
    ...data,
    createdAt: serverTimestamp(),
  })
  return { id: ref.id }
}

export async function fetchDAOs() {
  const snap = await getDocs(query(collection(db, 'daos'), orderBy('createdAt', 'asc')))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DAO[]
}

/* -------------------------------------------------------------------------- */
/*  Proposals (TOP-LEVEL)                                                     */
/* -------------------------------------------------------------------------- */

/* export async function createProposal(daoId: string, p: NewProposal) {
  try {

    const docData: ProposalDoc = {
      daoId,
      title: p.title,
      summary: p.summary ?? '',
      category: p.category ?? 'General',
      tags: p.tags ?? [],
      bodyMd: p.bodyMd,
      discussionUrl: p.discussionUrl ?? null,
      references: p.references ?? [],
      budget: p.budget ?? null,
      author: p.author ?? { name: 'AmID-xxxx', address: '0x...', avatar: Math.floor(Math.random() * 4) + 1 },
      phase: 'discussion',
      status: 'Draft',
      counters: { comments: 0, votes: 0 },
      createdAt: serverTimestamp(),

      daoAddress: p.daoAddress ?? null,
      daoName: p.daoName ?? null,

      // 🔗 on-chain linkage
      offchainRef: p.offchainRef ?? null,
      descriptionHash: p.descriptionHash ?? null,
      reservedId: p.reservedId ?? null,
      txHash: p.txHash ?? null,
      onchainReserved: p.onchainReserved ?? false,
    }


    const ref = await addDoc(collection(db, 'proposals'), docData)
    return { id: ref.id }

  } catch (err: any) {
    throw new Error(err?.message || String(err))
  }
} */

export type SubmissionPatch = {
  txHash: Hex
  offchainRef?: Hex | null
  descriptionHash?: Hex | null
  bodyMd?: string
  fingerprintInputs?: { title: string; desc: string } | null
  actionsSnapshot?: { targets: string[]; valuesWei: string[]; calldatas: string[] } | null
  updatedAt?: any
}
/* 
export async function promoteProposal(id: string, patch: SubmissionPatch): Promise<{ id: string }>
export async function promoteProposal(_daoId: string, id: string, patch: SubmissionPatch): Promise<{ id: string }>
export async function promoteProposal(a: string, b: any, c?: SubmissionPatch): Promise<{ id: string }> {
  const isThreeArgs = typeof c === 'object'
  const proposalId = (isThreeArgs ? b : a) as string
  const p = (isThreeArgs ? c : b) as SubmissionPatch

  if (!proposalId) throw new Error('promoteProposal: missing proposal id')
  if (!p?.txHash) throw new Error('promoteProposal: missing submitTxHash')

  const payload = {
    phase: 'onchain',
    status: 'submitted',
    submitTxHash: p.txHash,
    ...(p.offchainRef ? { offchainRef: p.offchainRef } : {}),
    ...(p.descriptionHash ? { descriptionHash: p.descriptionHash } : {}),
    ...(typeof p.bodyMd === 'string' ? { bodyMd: p.bodyMd } : {}),
    updatedAt: p.updatedAt ?? serverTimestamp(),
  }

  console.debug('[promoteProposal] writing to Firestore', { proposalId, payload })

  const ref = doc(db, 'proposals', proposalId)
  await setDoc(ref, payload, { merge: true })

  return { id: proposalId }
} */


/* export async function debugPromoteProposalUpdate(proposalId: string, patch: SubmissionPatch) {
  if (!proposalId) {
    alert('❌ Missing proposalId');
    return false
  }
  if (!patch?.txHash) {
    alert('❌ Missing submitTxHash in patch');
    return false
  }

  const payload: any = {
    phase: 'onchain',
    status: 'submitted',
    txHash: patch.txHash,
    ...(patch.offchainRef ? { offchainRef: patch.offchainRef } : {}),
    ...(patch.descriptionHash ? { descriptionHash: patch.descriptionHash } : {}),
    ...(typeof patch.bodyMd === 'string' ? { bodyMd: patch.bodyMd } : {}),
    updatedAt: patch.updatedAt ?? serverTimestamp(),
  }

  const ref = doc(db, 'proposals', proposalId)

  try {
    // Write (same as your promoteProposal)
    await setDoc(ref, payload, { merge: true })

    // Read back a few fields so you can confirm what landed
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      alert(`⚠️ Wrote, but doc not found on read: proposals/${proposalId}`)
      return false
    }

    const d = snap.data() as any
    const updatedAtIso =
      d?.updatedAt instanceof Timestamp ? d.updatedAt.toDate().toISOString() : String(d?.updatedAt)

    const summary = {
      id: proposalId,
      phase: d?.phase,
      status: d?.status,
      txHash: d?.txHash,
      offchainRef: d?.offchainRef,
      descriptionHash: d?.descriptionHash,
      bodyMdLen: typeof d?.bodyMd === 'string' ? d.bodyMd.length : 0,
      updatedAt: updatedAtIso,
    }

    alert(`✅ promote dummy update SUCCESS\n\n${JSON.stringify(summary, null, 2)}`)
    console.log('[debugPromoteProposalUpdate] success', { summary, full: d })
    return true
  } catch (e: any) {
    const msg = `[promote dummy] ❌ ERROR
Name: ${e?.name}
Code: ${e?.code}
Message: ${e?.message}`
    alert(msg)
    console.error(msg, e)
    return false
  }
} */

export function derivePhase(r: any): Phase {
  if (r?.phase === 'discussion' || r?.phase === 'onchain') return r.phase
  const s = (r?.status || '').toLowerCase()
  return ['submitted', 'active', 'deciding', 'approved', 'queued', 'executed'].includes(s)
    ? 'onchain'
    : 'discussion'
}

/* export function derivePhase(
  r: any,
  chain?: { state?: number | null }
): Phase {
  if (chain?.state !== undefined && chain?.state !== null) {
    // DRAFT stays discussion; everything else is onchain
    return chain.state === STATE.DRAFT ? 'discussion' : 'onchain'
  }
  const s = (r?.status || '').toLowerCase()
  return ['submitted', 'active', 'deciding', 'approved', 'rejected', 'queued', 'executed'].includes(s)
    ? 'onchain'
    : 'discussion'
} */

export async function fetchProposals(limitCount?: number, daoId?: string, phase?: Phase): Promise<any[]>
export async function fetchProposals(daoId: string, phase?: Phase): Promise<any[]>
export async function fetchProposals(a?: number | string, b?: string | Phase, c?: Phase) {
  const isPhase = (v: any): v is Phase => v === 'discussion' || v === 'onchain'
  let limitN = 30
  let daoId: string | undefined
  let phase: Phase | undefined

  if (typeof a === 'string') {
    daoId = a
    phase = isPhase(b) ? b : undefined
  } else {
    limitN = typeof a === 'number' ? a : 30
    daoId = typeof b === 'string' ? b : undefined
    phase = isPhase(c) ? c : isPhase(b) ? (b as Phase) : undefined
  }

  let qref = query(collection(db, 'proposals'))
  if (daoId) qref = query(qref, where('daoId', '==', daoId))
  if (phase) qref = query(qref, where('phase', '==', phase))
  qref = query(qref, orderBy('createdAt', 'desc'), qlimit(limitN))

  const snap = await getDocs(qref)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
}

export async function fetchProposal(id: string) {
  const ref = doc(db, 'proposals', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Proposal not found')
  return { id: snap.id, ...(snap.data() as any) }
}

/* -------------------------------------------------------------------------- */
/*  Comments: /proposals/{proposalId}/comments                                */
/* -------------------------------------------------------------------------- */
// Overloads
export async function addComment(proposalId: string, text: string, author?: string): Promise<boolean>
export async function addComment(_daoId: string, proposalId: string, text: string, author?: string): Promise<boolean>

// Impl
export async function addComment(a: string, b: string, c?: string, d?: string): Promise<boolean> {
  let proposalId: string
  let content: string
  let authorName: string

  if (d !== undefined) {
    // 4-arg form: (daoId, proposalId, text, author?)
    proposalId = b
    content = c ?? ''
    authorName = d ?? 'AIN-xxxx'
  } else {
    // 2/3-arg form: (proposalId, text, author?)
    proposalId = a
    content = b
    authorName = c ?? 'AIN-xxxx'
  }

  // Normalize author name (avoid null/undefined and keep it short-ish)
  authorName = String(authorName).slice(0, 64)

  const pref = doc(db, 'proposals', proposalId)
  const cref = collection(pref, 'comments')

  await addDoc(cref, {
    text: content,
    author: { name: authorName },
    createdAt: serverTimestamp(),
  })

  // Use setDoc(..., {merge:true}) with increment so it works even if the parent doc doesn’t exist yet
  await setDoc(
    pref,
    { counters: { comments: increment(1) } },
    { merge: true }
  )

  return true
}

// Sanitize


// src/lib/sanitize.ts
function isPlainObject(v: any) {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Remove undefined keys, coerce bad numbers to null, preserve Firestore sentinels. */
export function sanitizeForFirestore<T = any>(v: T): T {
  if (v === undefined) return undefined as any
  if (v === null) return v
  if (typeof v === 'number') return Number.isFinite(v) ? (v as any) : (null as any)
  if (Array.isArray(v)) return v.map((x) => sanitizeForFirestore(x)) as any

  // 🔑 Preserve non-plain objects (FieldValue.serverTimestamp(), Timestamp, GeoPoint…)
  if (!isPlainObject(v)) return v as any

  const out: any = {}
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue // drop undefined
    const s = sanitizeForFirestore(val as any)
    if (s !== undefined) out[k] = s
  }
  return out
}



// --- Users / preferences (AmID-centered) ------------------------------------
export type UserDoc = {
  // identity
  amid: string;                         // AmID (doc id)
  address?: string;                     // latest wallet used
  addresses?: string[];                 // history of wallets
  avatar?: number;                      // 1..4 (or your range)
  createdAt?: Timestamp | FieldValue;

  // app preferences
  prefs?: {
    lastOpenDaoId?: string;
    defaultDaoId?: string;
    theme?: 'light' | 'dark';
  };
};

function userKeyAmid(amid: string) {
  return String(amid || '').trim();
}
function userRefByAmid(amid: string) {
  return doc(db, 'users', userKeyAmid(amid));
}
function randomAvatar() {
  return Math.floor(Math.random() * 4) + 1; // adjust if you have more avatars
}

/**
 * Ensure a user doc exists at /users/{amid}.
 * If it exists, optionally update latest wallet `address` and append to `addresses[]`.
 */
export async function ensureUserByAmid(amid: string, address?: string) {
  const id = userKeyAmid(amid);
  if (!id) throw new Error('ensureUserByAmid: missing AmID');

  const ref = userRefByAmid(id);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      amid: id,
      address: address || null,
      addresses: address ? [address] : [],
      avatar: randomAvatar(),
      createdAt: serverTimestamp(),
      prefs: {},
    } satisfies UserDoc);
  } else if (address) {
    // Update latest address and maintain a history (dedup via arrayUnion)
    await setDoc(ref, {
      address,
      addresses: arrayUnion(address),
    }, { merge: true });
  }

  return ref;
}

/** Merge-only prefs update under /users/{amid}.prefs */
export async function setUserPrefsByAmid(amid: string, partial: Partial<UserDoc['prefs']>) {
  const ref = userRefByAmid(amid);
  await setDoc(ref, { prefs: partial }, { merge: true });
}

/** Update profile fields (currently only avatar; amid is immutable) */
export async function setUserProfileByAmid(amid: string, partial: Partial<Pick<UserDoc, 'avatar' | 'address'>>) {
  const ref = userRefByAmid(amid);
  await setDoc(ref, partial, { merge: true });
}

/** Realtime listener for /users/{amid} */
export function listenUserByAmid(amid: string, cb: (doc: (UserDoc & { id: string }) | null) => void) {
  const ref = userRefByAmid(amid);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) { cb(null); return; }
    cb({ id: snap.id, ...(snap.data() as UserDoc) });
  }, (e) => {
    console.error('[users] listen error:', e);
    cb(null);
  });
}




export async function upsertDaoChainParams(
  daoId: string,
  p: {
    daoAddress?: string
    admin: string
    token: string
    treasury: string
    votingDelayBlocks: number
    votingPeriodBlocks: number
    quorumBps: number
    timelockDelaySec: number | null
  }
) {
  const ref = doc(db, 'daos', daoId)
  await setDoc(
    ref,
    {
      ...(p.daoAddress ? { daoAddress: p.daoAddress } : {}),
      // simple mirrors
      admin: p.admin,
      token: p.token,
      treasury: p.treasury,
      // normalized voting config bucket (what normalizeVotingConfig() already reads)
      votingConfig: {
        votingDelayBlocks: p.votingDelayBlocks,
        votingPeriodBlocks: p.votingPeriodBlocks,
        quorumBps: p.quorumBps,
        timelockSec: p.timelockDelaySec, // seconds
      },
      chainParamsUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}
