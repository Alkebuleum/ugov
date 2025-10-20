// src/lib/daoProposals.ts
import { ethers } from 'ethers'
import { CHAIN } from './chain'
import { sendTransaction } from 'amvault-connect'
import { Hex } from './firebase'
import { BOND_MGR_ABI, DAO_ABI, TOKEN_ABI, TREASURY_ABI } from './abi'

// daoProposals.ts (patch)


const DaoI = new ethers.Interface(DAO_ABI)
export const BLOCK_TIME_SEC = 10
const iface = new ethers.Interface(DAO_ABI)

//type PopupOpt = { popup?: Window | null; timeoutMs?: number }
type PopupOpt = { timeoutMs?: number }

// Contract enums
export const SUPPORT = { no: 0, yes: 1, abstain: 2 } as const // AGAINST=0, FOR=1, ABSTAIN=2
export type VoteSupportName = keyof typeof SUPPORT
export type VoteSupport = 0 | 1 | 2

export const STATE = {
  DRAFT: 0, VOTING: 1, SUCCEEDED: 2, DEFEATED: 3, QUEUED: 4, EXECUTED: 5, CANCELED: 6
} as const
export type DaoState = typeof STATE[keyof typeof STATE]

// Reads
const provider = () => new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)

export async function getState(dao: string, id: bigint | number | string): Promise<DaoState> {
  const data = iface.encodeFunctionData('state', [BigInt(id as any)])
  const ret = await provider().call({ to: dao, data })
  return Number(iface.decodeFunctionResult('state', ret)[0]) as DaoState
}
export async function getWindow(dao: string, id: bigint | number | string) {
  const data = iface.encodeFunctionData('getWindow', [BigInt(id as any)])
  const ret = await provider().call({ to: dao, data })
  const [voteStart, voteEnd, quorumBps] = iface.decodeFunctionResult('getWindow', ret)
  return { voteStart: Number(voteStart), voteEnd: Number(voteEnd), quorumBps: Number(quorumBps) }
}
export async function getTally(dao: string, id: bigint | number | string) {
  const data = iface.encodeFunctionData('getTally', [BigInt(id as any)])
  const ret = await provider().call({ to: dao, data })
  const [againstVotes, forVotes, abstainVotes] = iface.decodeFunctionResult('getTally', ret)
  return {
    againstVotes: BigInt(againstVotes), forVotes: BigInt(forVotes), abstainVotes: BigInt(abstainVotes)
  }
}
export async function getActions(dao: string, id: bigint | number | string) {
  const data = iface.encodeFunctionData('getActions', [BigInt(id as any)])
  const ret = await provider().call({ to: dao, data })
  const [targets, values, calldatas, descriptionHash] = iface.decodeFunctionResult('getActions', ret)
  return { targets, values: values.map((v: any) => BigInt(v)), calldatas, descriptionHash }
}

/** Did a specific voter already vote? If so, what support/weight? */
export async function getMyVote(
  daoAddress: string,
  id: bigint | number | string,
  voter: string
): Promise<{ hasVoted: boolean; support?: VoteSupport; weight?: bigint; txHash?: string }> {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const ev = iface.getEvent('VoteCast')
  const topics = iface.encodeFilterTopics(ev, [BigInt(id as any), ethers.getAddress(voter), null])
  const { voteStart } = await getWindow(daoAddress, id)
  const logs = await prov.getLogs({
    address: daoAddress,
    topics,
    fromBlock: Math.max(voteStart, 0),
    toBlock: 'latest',
  })
  if (!logs.length) return { hasVoted: false }
  const last = logs[logs.length - 1]
  const parsed = iface.parseLog(last)
  const support = Number(parsed.args.support) as VoteSupport
  const weight = BigInt(parsed.args.weight)
  return { hasVoted: true, support, weight, txHash: last.transactionHash }
}




function decodeRevert(e: any, ifaces: ethers.Interface[] = [iface]) {
  const data = e?.data ?? e?.error?.data ?? e?.error?.error?.data ?? e?.info?.error?.data
  if (typeof data === 'string') {
    // Error(string) selector 0x08c379a0
    if (data.startsWith('0x08c379a0') && data.length >= 138) {
      try {
        const reason = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10))
        return String(reason[0])
      } catch { }
    }
    // Try custom errors on provided interfaces
    for (const I of ifaces) {
      try {
        const dec = I.parseError(data)
        if (dec?.name) return dec.name
      } catch { }
    }
  }
  const msg = e?.shortMessage || e?.message || 'execution reverted'
  return msg
}

/** Live (current block) delegated power — no snapshot calls */
export async function readCurrentDelegatedPower(
  daoAddress: string,
  voter: string
): Promise<{
  nowVotes: bigint;
  delegatedTo: string | null;
  token: string;
  balance: bigint;
  chainBlock: number;
  decimals: number;
  symbol: string;
}> {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const token = await getTokenAddress(daoAddress)
  const T = new ethers.Interface(TOKEN_ABI)

  const [nowHex, delHex, balHex, decHex, symHex, chainBlock] = await Promise.all([
    prov.call({ to: token, data: T.encodeFunctionData('getVotes', [voter]) }),
    prov.call({ to: token, data: T.encodeFunctionData('delegates', [voter]) }).catch(() => '0x'),
    prov.call({ to: token, data: T.encodeFunctionData('balanceOf', [voter]) }),
    prov.call({ to: token, data: T.encodeFunctionData('decimals', []) }),
    prov.call({ to: token, data: T.encodeFunctionData('symbol', []) }).catch(() => '0x'),
    prov.getBlockNumber(),
  ])

  const nowVotes = BigInt(T.decodeFunctionResult('getVotes', nowHex)[0])
  const balance = BigInt(T.decodeFunctionResult('balanceOf', balHex)[0])
  const decimals = Number(T.decodeFunctionResult('decimals', decHex)[0])
  const symbol = symHex !== '0x' ? String(T.decodeFunctionResult('symbol', symHex)[0]) : ''

  let delegatedTo: string | null = null
  if (delHex !== '0x') {
    //try { delegatedTo = ethers.getAddress(ethers.AbiCoder.defaultAbiCoder().decode(['address'], delHex)[0]) } catch { }
    try {
      const raw = ethers.AbiCoder.defaultAbiCoder().decode(['address'], delHex)[0] as string
      const addr = ethers.getAddress(raw)
      delegatedTo = (addr === ethers.ZeroAddress) ? null : addr   // 👈 normalize zero -> null
    } catch { }
  }
  return { nowVotes, delegatedTo, token, balance, chainBlock, decimals, symbol }
}
export type VotingFlags = {
  nowBlock: number
  voteStart: number
  voteEnd: number
  quorumBps: number
  hasStarted: boolean
  hasEnded: boolean
  isOpen: boolean
  blocksUntilStart: number
  blocksUntilEnd: number
  secondsUntilStart: number
  secondsUntilEnd: number
}

export async function getVotingFlags(dao: string, id: bigint | number | string): Promise<VotingFlags> {
  const { voteStart, voteEnd, quorumBps } = await getWindow(dao, id)
  const bn = await provider().getBlockNumber()

  const hasStarted = bn >= voteStart
  const hasEnded = bn > voteEnd
  const isOpen = bn >= voteStart && bn <= voteEnd

  const blocksUntilStart = Math.max(voteStart - bn, 0)
  const blocksUntilEnd = Math.max(voteEnd - bn, 0)

  return {
    nowBlock: bn,
    voteStart,
    voteEnd,
    quorumBps,
    hasStarted,
    hasEnded,
    isOpen,
    blocksUntilStart,
    blocksUntilEnd,
    // helpful approximations for UI
    secondsUntilStart: blocksUntilStart * BLOCK_TIME_SEC,
    secondsUntilEnd: blocksUntilEnd * BLOCK_TIME_SEC,
  }
}


export async function getVotingProgress(dao: string, id: bigint | number | string) {
  const [{ voteStart, voteEnd }, tallies, bn] = await Promise.all([
    getWindow(dao, id),
    getTally(dao, id),
    provider().getBlockNumber(),
  ])
  const total = Number(tallies.forVotes + tallies.againstVotes + tallies.abstainVotes)
  const windowLen = Math.max(voteEnd - voteStart, 1)
  const progressBlocks = Math.min(Math.max(bn - voteStart, 0), windowLen)
  return {
    ...tallies,
    totalVotes: BigInt(total),
    progressPct: Math.round((progressBlocks / windowLen) * 100),
    openNow: bn >= voteStart && bn <= voteEnd,
    blocksRemaining: Math.max(voteEnd - bn, 0),
  }
}

export async function getTokenAddress(daoAddress: string): Promise<string> {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const ret = await prov.call({ to: daoAddress, data: iface.encodeFunctionData('token', []) })
  const [addr] = ethers.AbiCoder.defaultAbiCoder().decode(['address'], ret)
  return ethers.getAddress(addr)
}

export async function readVotingPower(
  daoAddress: string,
  voter: string,
  localId: bigint | number | string
): Promise<{ nowVotes: bigint; snapshotVotes: bigint; snapshotBlock: number; delegatedTo: string | null }> {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const token = await getTokenAddress(daoAddress)

  // read snapshot (voteStart - 1)
  const winHex = await prov.call({ to: daoAddress, data: iface.encodeFunctionData('getWindow', [BigInt(localId as any)]) })
  const [voteStart] = iface.decodeFunctionResult('getWindow', winHex)
  const snapshot = Number(voteStart) - 1

  const T = new ethers.Interface(TOKEN_ABI)
  const [nowHex, snapHex, delHex] = await Promise.all([
    prov.call({ to: token, data: T.encodeFunctionData('getVotes', [voter]) }),
    prov.call({ to: token, data: T.encodeFunctionData('getPastVotes', [voter, snapshot]) }),
    prov.call({ to: token, data: T.encodeFunctionData('delegates', [voter]) }).catch(() => '0x'),
  ])

  const nowVotes = BigInt(T.decodeFunctionResult('getVotes', nowHex)[0])
  const snapshotVotes = BigInt(T.decodeFunctionResult('getPastVotes', snapHex)[0])
  let delegatedTo: string | null = null
  if (delHex !== '0x') {
    try {
      const raw = ethers.AbiCoder.defaultAbiCoder().decode(['address'], delHex)[0] as string
      const addr = ethers.getAddress(raw)
      delegatedTo = (addr === ethers.ZeroAddress) ? null : addr
    } catch { }
  }

  return { nowVotes, snapshotVotes, snapshotBlock: snapshot, delegatedTo }
}

/** Delegate voting power to self */
export async function delegateToSelf(
  daoAddress: string,
  voter: string,
  opt?: { timeoutMs?: number }
): Promise<{ txHash: string; blockNumber: number }> {
  const token = await getTokenAddress(daoAddress)
  const T = new ethers.Interface(TOKEN_ABI)
  const data = T.encodeFunctionData('delegate', [voter])

  const txHash = await sendTransaction(
    { chainId: CHAIN.id, to: token, data, gas: 120_000 },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )

  const rc = await waitReceipt(txHash)
  return { txHash, blockNumber: Number(rc.blockNumber) }
}


/** Read raw ERC20 balance of the DAO's vote token for an account */
export async function getVoteTokenBalance(
  daoAddress: string,
  account: string
): Promise<bigint> {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const token = await getTokenAddress(daoAddress)
  const T = new ethers.Interface(TOKEN_ABI)
  const hex = await prov.call({ to: token, data: T.encodeFunctionData('balanceOf', [account]) })
  const bal = T.decodeFunctionResult('balanceOf', hex)[0]
  return BigInt(bal)
}

/** One-shot diagnostic snapshot for debugging voting power issues */
export async function debugVotingPower(
  daoAddress: string,
  voter: string,
  localId: bigint | number | string
): Promise<{
  token: string;
  balance: bigint;
  chainBlock: number;
  voteStart: number;
  snapshotBlock: number;
  nowVotes: bigint;
  snapshotVotes: bigint;
  delegatedTo: string | null;
}> {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const token = await getTokenAddress(daoAddress)
  const [balance, chainBlock, win, pow] = await Promise.all([
    getVoteTokenBalance(daoAddress, voter),
    prov.getBlockNumber(),
    getWindow(daoAddress, localId),
    readVotingPower(daoAddress, voter, localId),
  ])
  return {
    token,
    balance,
    chainBlock,
    voteStart: win.voteStart,
    snapshotBlock: pow.snapshotBlock,
    nowVotes: pow.nowVotes,
    snapshotVotes: pow.snapshotVotes,
    delegatedTo: pow.delegatedTo,
  }
}

function isHexAddr(s: string) { return /^0x[a-fA-F0-9]{40}$/.test(s) }
function isHex32(s: string) { return /^0x[0-9a-fA-F]{64}$/.test(s) }

// --- replace your current waitReceipt with this v6-safe version ---
async function waitReceipt(txHash: string) {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const rc = await prov.waitForTransaction(txHash)
  if (!rc) throw new Error('No transaction receipt')
  if (rc.status === 0) {
    const tx = await prov.getTransaction(txHash)
    if (rc.gasUsed && tx?.gasLimit && rc.gasUsed === tx.gasLimit) {
      throw new Error('Reverted: likely OutOfGas (hit gas limit)')
    }
    throw new Error('Reverted: execution reverted')
  }
  return rc
}





/** Reserve a proposal ID on-chain (Draft) using offchainRef (bytes32). */
export async function reserveDraftOnchain(
  daoAddress: string,
  offchainRefBytes32: string,
  opt?: { timeoutMs?: number }
): Promise<{ txHash: string; localId: string }> {
  if (!isHexAddr(daoAddress)) throw new Error('Bad DAO address')
  if (!isHex32(offchainRefBytes32)) throw new Error('offchainRef must be 0x…32')

  const data = iface.encodeFunctionData('createDraft', [offchainRefBytes32])

  const txHash = await sendTransaction(
    { chainId: CHAIN.id, to: daoAddress, data, gas: 120_000 },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )

  const rc = await waitReceipt(txHash)

  // ✅ Only parse logs from THIS DAO address
  const daoLogs = (rc.logs ?? []).filter(l => (l as any).address?.toLowerCase() === daoAddress.toLowerCase())

  for (const log of daoLogs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'DraftReserved') {
        const id = BigInt(parsed.args.localId as any)
        if (id > 0n) return { txHash, localId: id.toString(10) }
      }
    } catch { /* skip non-matching logs */ }
  }

  // 🔁 Fallback: read nextLocalId() after tx (should be >= 1)
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  try {
    const ret = await provider.call({ to: daoAddress, data: iface.encodeFunctionData('nextLocalId()', []) })
    const nextLocalId = BigInt(iface.decodeFunctionResult('nextLocalId()', ret)[0])
    if (nextLocalId > 0n) {
      // If you want to be extra cautious, you can store nextLocalId as the draft id.
      return { txHash, localId: nextLocalId.toString(10) }
    }
  } catch { /* ignore */ }

  throw new Error('DraftReserved event not found')

}







/** Helper: compute offchainRef (bytes32) from lightweight descriptor */
export function computeOffchainRef(payload: unknown): string {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return ethers.keccak256(ethers.toUtf8Bytes(s))
}

/** Helper: compute EIP-712-agnostic description hash (bytes32) from full markdown */
export function computeDescriptionHash(markdown: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(markdown))
}

// Compute keccak256(abi.encode(address[], uint256[], bytes[]))
export function computeActionsHash(params: {
  dao: string
  targets: string[]
  valuesWei: bigint[]
  calldatas: string[]
  title?: string
  desc?: string
}): `0x${string}` {
  const A = ethers.AbiCoder.defaultAbiCoder()
  const normDao = ethers.getAddress(params.dao)
  const normTargets = params.targets.map(ethers.getAddress)
  // NOTE: valuesWei are bigint; calldatas are 0x-prefixed hex strings
  const encoded = A.encode(
    ['address', 'address[]', 'uint256[]', 'bytes[]', 'string', 'string'],
    [normDao, normTargets, params.valuesWei, params.calldatas, params.title ?? '', params.desc ?? '']
  )
  return ethers.keccak256(encoded) as `0x${string}`
}

// Read what the chain thinks this proposal is (what was voted on)
export async function getProposalFingerprint(dao: string, id: string | number) {
  const c = new ethers.Contract(dao, DAO_ABI, new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id))
  const [targets, values, calldatas, descriptionHash] = await c.getActions(BigInt(id))
  return { descriptionHash: descriptionHash as `0x${string}`, targets, values, calldatas }
}




//--------------- testing /  simulating ------------


type SubmitArgs = {
  localId: number | bigint
  targets: string[]
  valuesWei: Array<bigint | number | string>
  calldatas: string[]
  descriptionHash: `0x${string}`
  bondValueWei: bigint
  cancelProposalId?: number | bigint // 0 if not emergency
  from?: string                      // caller (the proposer)
}

// keep your fixed bond (0.1 AKE)
const BOND_01_AKE = 100000000000000000n // 1e17

export async function simulateSubmitForVote(
  daoAddress: string,
  params: {
    localId: bigint | number | string
    targets: string[]
    valuesWei: (bigint | number | string)[]
    calldatas: string[]
    descriptionHash: string
  },
  from: string
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const iface = new ethers.Interface(DAO_ABI)
  const id = BigInt(params.localId as any)

  // — cheap reads & checks (same as before) —
  // ... your nextLocalId/state/minBond/treasury + LenMismatch checks ...

  const data = iface.encodeFunctionData('submitForVote', [
    id,
    params.targets,
    params.valuesWei.map(v => BigInt(v as any)),
    params.calldatas,
    params.descriptionHash,
    0n,
  ])
  const overrides = { to: daoAddress, from, data, value: BOND_01_AKE }

  try {
    await provider.estimateGas(overrides)
    return
  } catch {
    // If estimate fails, try a call to get a reason or prove it’s OK.
    try {
      await provider.call(overrides)
      console.warn('[preflight] estimateGas failed; proceeding (call succeeded)')
      return
    } catch (e2: any) {
      // decode a helpful reason if possible
      try {
        const decoded = iface.parseError(e2?.data ?? e2?.error?.data ?? e2)
        throw new Error(`Preflight: ${decoded?.name}`)
      } catch {
        const reason = e2?.shortMessage || e2?.data?.message || e2?.error?.message || e2?.message
        throw new Error(`Preflight: ${reason || 'execution reverted'}`)
      }
    }
  }
}




export async function submitForVoteOnchain(
  daoAddress: string,
  params: {
    localId: bigint | number | string
    targets: string[]
    valuesWei: (bigint | number | string)[]
    calldatas: string[]              // 0x…
    descriptionHash: string          // 0x…32
    cancelProposalId: bigint | number | string
    bondValueWei: bigint
  },
  opt?: PopupOpt
): Promise<{ txHash: string }> {
  if (!isHexAddr(daoAddress)) throw new Error('Bad DAO address')
  if (!isHex32(params.descriptionHash)) throw new Error('descriptionHash must be 0x…32')
  if (params.targets.length !== params.valuesWei.length || params.targets.length !== params.calldatas.length) {
    throw new Error('targets/values/calldatas length mismatch')
  }
  params.targets.forEach(a => { if (!isHexAddr(a)) throw new Error(`Bad target: ${a}`) })
  params.calldatas.forEach(cd => { if (!/^0x[0-9a-fA-F]*$/.test(cd)) throw new Error('Bad calldata hex') })

  const iface = new ethers.Interface(DAO_ABI)
  const values = params.valuesWei.map(v => BigInt(v as any))
  const localId = BigInt(params.localId as any)
  const cancelId = BigInt(params.cancelProposalId as any ?? 0n)

  const data = iface.encodeFunctionData('submitForVote', [
    localId,
    params.targets,
    values,
    params.calldatas,
    params.descriptionHash,
    cancelId,
  ])

  // 🔒 Fixed bond: 0.1 AKE
  //const bondValueWei = 100000000000000000n // 1e17

  // 🔥 Max gas: ~95% of latest block gas limit (with a sane cap)
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  let gasLimitBn: bigint
  try {
    const latest = await prov.getBlock('latest')
    const blockLimit: bigint =
      (latest as any)?.gasLimit ?? 30_000_000n // ethers v6 returns bigint
    gasLimitBn = (blockLimit * 120n) / 100n     // leave 5% headroom
  } catch {
    gasLimitBn = 15_000_000n                   // fallback if RPC hiccups
  }
  // Optional hard cap to avoid ridiculous values on private chains
  const HARD_CAP = 25_000_000n
  if (gasLimitBn > HARD_CAP) gasLimitBn = HARD_CAP

  const gasLimitNum = Number(gasLimitBn)
  if (!Number.isFinite(gasLimitNum)) throw new Error('gasLimit overflow')

  const txHash = await sendTransaction(
    {
      chainId: CHAIN.id,
      to: daoAddress,
      data,
      value: ethers.toBeHex(params.bondValueWei), // include the bond
      gas: gasLimitNum,
    },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )
  await waitReceipt(txHash)
  return { txHash }
}



//------------------------------------    vote

export async function simulateCastVote(
  daoAddress: string,
  params: { localId: bigint | number | string; support: 0 | 1 | 2; voter?: string }
): Promise<void> {
  if (!isHexAddr(daoAddress)) throw new Error('Bad DAO address')
  const id = BigInt(params.localId as any)
  const supportNum = Number(params.support)
  if (![0, 1, 2].includes(supportNum)) throw new Error('support must be 0|1|2')

  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)

  // 1) Window + state gating (gives friendly messages before any revert)
  const [winData, bnHex] = await Promise.all([
    prov.call({ to: daoAddress, data: iface.encodeFunctionData('getWindow', [id]) }).catch(() => null),
    prov.getBlockNumber(),
  ])
  if (!winData) throw new Error('Preflight: NotSubmitted') // mirrors NotSubmitted/BadId before submit
  const [voteStart, voteEnd] = iface.decodeFunctionResult('getWindow', winData) as any
  const vs = Number(voteStart), ve = Number(voteEnd), bn = Number(bnHex)
  if (bn < vs || bn > ve) throw new Error('Preflight: VotingNotWindow')

  // 2) Use the actual voter as msg.sender in the staticcall.
  const from = params.voter && isHexAddr(params.voter) ? params.voter : undefined
  // If we don't have a valid from, skip the staticcall to avoid false NoPower.
  if (!from) return

  // 3) Final staticcall to surface AlreadyVoted / others precisely
  const data = iface.encodeFunctionData('castVote', [id, supportNum])
  try {
    await prov.call({ to: daoAddress, from, data })
  } catch (e: any) {
    throw new Error('Preflight: ' + decodeRevert(e, [iface]))
  }
}

export async function castVoteOnchain(
  daoAddress: string,
  params: { localId: bigint | number | string; support: VoteSupport | VoteSupportName },
  opt?: { timeoutMs?: number }
): Promise<{ txHash: string }> {
  if (!isHexAddr(daoAddress)) throw new Error('Bad DAO address')
  const supportNum: VoteSupport =
    (typeof params.support === 'string' ? SUPPORT[params.support] : params.support) as VoteSupport
  if (![0, 1, 2].includes(supportNum)) throw new Error('support must be 0|1|2')

  const id = BigInt(params.localId as any)
  const data = iface.encodeFunctionData('castVote', [id, supportNum])

  const txHash = await sendTransaction(
    { chainId: CHAIN.id, to: daoAddress, data, gas: 120_000 },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )
  await waitReceipt(txHash)
  return { txHash }
}


// ------------------------------------  finalize vote
export async function finalizeOnchain(
  daoAddress: string,
  id: bigint | number | string,
  opt?: { timeoutMs?: number }
): Promise<{ txHash: string }> {
  const data = iface.encodeFunctionData('finalize', [BigInt(id as any)])
  const txHash = await sendTransaction(
    { chainId: CHAIN.id, to: daoAddress, data, gas: 150_000 },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )
  await waitReceipt(txHash)
  return { txHash }
}

export async function queueOnchain(
  daoAddress: string,
  id: bigint | number | string,
  opt?: { timeoutMs?: number }
): Promise<{ txHash: string }> {
  const data = iface.encodeFunctionData('queue', [BigInt(id as any)])
  const txHash = await sendTransaction(
    { chainId: CHAIN.id, to: daoAddress, data, gas: 180_000 },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )
  await waitReceipt(txHash)
  return { txHash }
}



/** Seconds remaining until executable, or null if unknown. */
export async function getQueuedEtaSec(
  daoAddress: string,
  localId: string | number,
  opts?: { provider?: ethers.Provider }
): Promise<number | null> {
  const provider = opts?.provider ?? new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const dao = new ethers.Contract(daoAddress, DAO_ABI, provider)

  // Read the exact actions that were queued
  const [targets, values, calldatas, descriptionHash] = await dao.getActions(BigInt(localId))

  // Resolve treasury and read its operation’s ETA
  const treasury: string = await dao.treasury()
  if (!treasury || treasury === ethers.ZeroAddress) return null

  // Compute the same opId the treasury uses internally
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address[]', 'uint256[]', 'bytes[]', 'bytes32'],
    [targets, values, calldatas, descriptionHash]
  )
  const opId = ethers.keccak256(encoded)

  const treasuryC = new ethers.Contract(treasury, TREASURY_ABI, provider)
  const op = await treasuryC.operations(opId) // { queued: bool, eta: uint64 }
  const eta = Number(op?.eta ?? 0)
  if (!eta) return null

  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, eta - now)
}




// ------------------------------------------------- Action Builders


// Build actions that target the DAO itself
export function buildAction_setVotingConfig(dao: string, {
  newDelayBlocks,
  newPeriodBlocks,
  newQuorumBps,
}: { newDelayBlocks: number; newPeriodBlocks: number; newQuorumBps: number }) {
  const I = new ethers.Interface(DAO_ABI)
  const data = I.encodeFunctionData('setVotingConfig', [newDelayBlocks, newPeriodBlocks, newQuorumBps])
  return { target: dao, valueWei: 0n, calldata: data }
}

export function buildAction_setAdmin(dao: string, newAdmin: string) {
  const I = new ethers.Interface(DAO_ABI)
  const data = I.encodeFunctionData('setAdmin', [newAdmin])
  return { target: dao, valueWei: 0n, calldata: data }
}

export function buildAction_setVoteToken(dao: string, newToken: string) {
  const I = new ethers.Interface(DAO_ABI)
  const data = I.encodeFunctionData('setVoteToken', [newToken])
  return { target: dao, valueWei: 0n, calldata: data }
}




//---------------------------------------- onExecution 

/**
 * Simulate the whole Execute path:
 *  1) DAO-level simulate (catches NotQueued/AlreadyExecuted/etc)
 *  2) Read on-chain actions + simulate Treasury.execute(...) for deep revert reasons
 *
 * Throws with a readable message if something would revert.
 */
function extractRevertReason(e: any): string {
  return (
    e?.shortMessage ??
    e?.reason ??
    e?.info?.error?.message ??
    e?.error?.message ??
    e?.message ??
    'execution reverted'
  ).replace(/^execution reverted:? ?/i, '').trim()
}

/**
 * Version-proof preflight for Execute:
 *  - First, low-level call to DAO.execute(id)
 *  - If it reverts with EXEC_FAIL, decode actions and call Treasury.execute(...)
 *    to surface the *deep* revert reason.
 *  - Throws with a readable error if anything would fail on-chain.
 */
export async function simulateExecute(
  daoAddress: string,
  args: { localId: string | number },
  opts?: { provider?: ethers.Provider }
): Promise<void> {
  const provider =
    opts?.provider ?? new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)

  const daoIface = new ethers.Interface(DAO_ABI)

  // --- DAO-level simulate (version-agnostic)
  const daoData = daoIface.encodeFunctionData('execute', [BigInt(args.localId)])
  try {
    await provider.call({ to: daoAddress, data: daoData })
    return // simulation ok; nothing will revert
  } catch (e: any) {
    const reason = extractRevertReason(e)

    // If DAO says EXEC_FAIL, run a deeper treasury preflight to get the real reason
    if (/EXEC_FAIL/i.test(reason)) {
      const dao = new ethers.Contract(daoAddress, DAO_ABI, provider)
      const [targets, values, calldatas, descHash] = await dao.getActions(
        BigInt(args.localId)
      )
      const treasuryAddr: string = await dao.treasury()

      const treasIface = new ethers.Interface(TREASURY_ABI)
      const treasData = treasIface.encodeFunctionData('execute', [
        targets,
        values,
        calldatas,
        descHash as Hex,
      ])

      try {
        await provider.call({ to: treasuryAddr, data: treasData })
        // Treasury succeeded; original EXEC_FAIL likely came from a different DAO require
        throw new Error(`Preflight (DAO) failed: ${reason}`)
      } catch (e2: any) {
        throw new Error(`Preflight (Treasury) failed: ${extractRevertReason(e2)}`)
      }
    }

    // Other DAO errors (NotQueued, AlreadyExecuted, etc.)
    throw new Error(`Preflight (DAO) failed: ${reason}`)
  }
}

// --- actual execution
export async function executeOnchain(
  daoAddress: string,
  id: bigint | number | string,
  opt?: { timeoutMs?: number }
): Promise<{ txHash: string }> {
  const data = iface.encodeFunctionData('execute', [BigInt(id as any)])
  const txHash = await sendTransaction(
    { chainId: CHAIN.id, to: daoAddress, data, gas: 400_000 },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )
  await waitReceipt(txHash)
  return { txHash }
}




//--------------------------------- Cancel Proposal ---------------------------

export async function cancelByAuthorOnchain(
  daoAddr: string,
  localId: bigint | number | string,
  opt?: PopupOpt
): Promise<{ txHash: string; blockNumber: number }> {
  const iface = new ethers.Interface(DAO_ABI)
  const data = iface.encodeFunctionData('cancelByAuthor', [BigInt(localId as any)])

  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)

  // near-max gas fallback
  let gasNum = 1_500_000
  try {
    const latest = await prov.getBlock('latest')
    const lim = ((latest as any)?.gasLimit ?? 30_000_000n) as bigint
    gasNum = Number((lim * 95n) / 100n)
  } catch { }

  const txHash = await sendTransaction(
    { chainId: CHAIN.id, to: daoAddr, data, gas: gasNum },
    {
      app: 'uGov',
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      timeoutMs: opt?.timeoutMs ?? 120_000,
    }
  )
  const rc = await waitReceipt(txHash)
  return { txHash, blockNumber: Number(rc.blockNumber) }
}


export async function simulateCancelByAuthor(daoAddr: string, localId: bigint | number | string) {
  const prov = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const I = new ethers.Interface(DAO_ABI)
  await prov.call({ to: daoAddr, data: I.encodeFunctionData('cancelByAuthor', [BigInt(localId as any)]) })
}


// --- On-chain hold readers (direct, lightweight)
/* export async function readHoldCountOnChain(daoAddr: string, localId: number | string | bigint): Promise<number> {
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  // Minimal ABI so we don't depend on DAO_ABI
  const dao = new ethers.Contract(daoAddr, ['function holdCount(uint64) view returns (uint32)'], provider)
  return Number(await dao.holdCount(BigInt(localId as any)))
}

export async function readHeldTargetOnChain(daoAddr: string, emergencyLocalId: number | string | bigint): Promise<number> {
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
  const dao = new ethers.Contract(daoAddr, ['function holdsTarget(uint64) view returns (uint64)'], provider)
  return Number(await dao.holdsTarget(BigInt(emergencyLocalId as any)))
} */

export async function readHeldTargetOnChain(daoAddr: string, emergencyLocalId: number): Promise<number> {
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id);
  const dao = new ethers.Contract(daoAddr, DAO_ABI, provider);
  const v: bigint = await dao.holdsTarget(emergencyLocalId);
  return Number(v);
}

export async function readHoldCountOnChain(daoAddr: string, targetLocalId: number): Promise<number> {
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id);
  const dao = new ethers.Contract(daoAddr, DAO_ABI, provider);
  const v: bigint = await dao.holdCount(targetLocalId);
  return Number(v);
}