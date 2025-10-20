// src/lib/buildActionsFromDraft.ts
import { ethers } from 'ethers'
import { CHAIN } from './chain'
import { computeDescriptionHash } from './daoProposals' // if you need it elsewhere; not required here
import { DAO_ABI, ERC20_ABI, TREASURY_ABI } from './abi'



/* -------------------------------- Types ---------------------------------- */

export type DraftCategory =
    | 'SET_VOTING_CONFIG'          // absolute values
    | 'QUORUM_RELATIVE_CHANGE_BPS' // delta bps (reads chain)
    | 'SET_ADMIN'
    | 'SET_VOTE_TOKEN'
    | 'TREASURY_NATIVE_TRANSFER'   // send ETH from treasury
    | 'TREASURY_ERC20_TRANSFER'    // ERC20.transfer(...) from treasury
    | 'MULTI'                       // array of sub-actions

export type BuildDraftParams =
    | {
        category: 'SET_VOTING_CONFIG'
        daoAddress: string
        newDelayBlocks: number
        newPeriodBlocks: number
        newQuorumBps: number // 0..10000
        newTimelock: number
    }
    | {
        category: 'QUORUM_RELATIVE_CHANGE_BPS'
        daoAddress: string
        deltaBps: number // e.g. +250 or -100
    }
    | {
        category: 'SET_ADMIN'
        daoAddress: string
        newAdmin: string
    }
    | {
        category: 'SET_VOTE_TOKEN'
        daoAddress: string
        newToken: string
    }
    | {
        category: 'TREASURY_NATIVE_TRANSFER'
        // NOTE: this will execute from Treasury, which supplies the value (ETH)
        to: string
        valueWei: bigint | number | string
    }
    | {
        category: 'TREASURY_ERC20_TRANSFER'
        token: string       // ERC20 address
        to: string
        amount: bigint | number | string // raw units
    }
    | {
        category: 'MULTI'
        items: BuildDraftParams[]
    }

/* ------------------------- Low-level encoders ----------------------------- */

function ensureAddr(a: string, label: string) {
    try { return ethers.getAddress(a) } catch { throw new Error(`Bad address for ${label}: ${a}`) }
}

const DaoI = new ethers.Interface(DAO_ABI)
const Erc20I = new ethers.Interface(ERC20_ABI)
const TreasI = new ethers.Interface(TREASURY_ABI)


/* A single, normalized action unit */
type Action = { target: string; valueWei: bigint; calldata: string }

/* -------------------------- Public entry points -------------------------- */

/**
 * Synchronous builder (no chain reads). Use this when all params are absolute.
 */
export function buildActionsFromDraft(input: BuildDraftParams): {
    targets: string[]
    valuesWei: bigint[]
    calldatas: string[]
} {
    const actions = flattenActions(input)
    return toArrays(actions)
}

/**
 * Async builder that can **read the chain** when needed (e.g., relative quorum changes).
 * Provide a custom provider if you like; defaults to CHAIN.rpcUrl.
 */
export async function buildActionsFromDraftAsync(
    input: BuildDraftParams,
    provider: ethers.JsonRpcProvider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
): Promise<{ targets: string[]; valuesWei: bigint[]; calldatas: string[] }> {
    const actions = await flattenActionsAsync(input, provider)
    return toArrays(actions)
}

/* ------------------------------- Internals -------------------------------- */

function toArrays(actions: Action[]) {
    return {
        targets: actions.map(a => a.target),
        valuesWei: actions.map(a => a.valueWei),
        calldatas: actions.map(a => a.calldata),
    }
}

function flattenActions(input: BuildDraftParams): Action[] {
    switch (input.category) {
        case 'SET_VOTING_CONFIG': {
            const dao = ensureAddr(input.daoAddress, 'daoAddress')
            if (input.newQuorumBps < 0 || input.newQuorumBps > 10_000) throw new Error('newQuorumBps out of range')
            const data = DaoI.encodeFunctionData('setVotingConfig', [
                input.newDelayBlocks >>> 0,
                input.newPeriodBlocks >>> 0,
                input.newQuorumBps >>> 0,
            ])
            return [{ target: dao, valueWei: 0n, calldata: data }]
        }

        case 'SET_ADMIN': {
            const dao = ensureAddr(input.daoAddress, 'daoAddress')
            const admin = ensureAddr(input.newAdmin, 'newAdmin')
            const data = DaoI.encodeFunctionData('setAdmin', [admin])
            return [{ target: dao, valueWei: 0n, calldata: data }]
        }

        case 'SET_VOTE_TOKEN': {
            const dao = ensureAddr(input.daoAddress, 'daoAddress')
            const token = ensureAddr(input.newToken, 'newToken')
            const data = DaoI.encodeFunctionData('setVoteToken', [token])
            return [{ target: dao, valueWei: 0n, calldata: data }]
        }

        case 'TREASURY_NATIVE_TRANSFER': {
            const to = ensureAddr(input.to, 'to')
            const v = BigInt(input.valueWei as any)
            if (v < 0n) throw new Error('valueWei must be >= 0')
            // Native ETH transfer from Treasury: target = recipient, value = amount, calldata empty
            return [{ target: to, valueWei: v, calldata: '0x' }]
        }

        case 'TREASURY_ERC20_TRANSFER': {
            const token = ensureAddr(input.token, 'token')
            const to = ensureAddr(input.to, 'to')
            const amount = BigInt(input.amount as any)
            const data = Erc20I.encodeFunctionData('transfer', [to, amount])
            // Treasury calls token.transfer(to, amount) with 0 value
            return [{ target: token, valueWei: 0n, calldata: data }]
        }

        case 'MULTI': {
            const out: Action[] = []
            for (const it of input.items) out.push(...flattenActions(it))
            return out
        }

        case 'QUORUM_RELATIVE_CHANGE_BPS':
            // needs chain read → handled in async variant
            throw new Error('Use buildActionsFromDraftAsync for QUORUM_RELATIVE_CHANGE_BPS')

        default:
            const _exhaustiveCheck: never = input
            throw new Error(`Unsupported category: ${(input as any).category}`)
    }
}

async function flattenActionsAsync(
    input: BuildDraftParams,
    provider: ethers.JsonRpcProvider
): Promise<Action[]> {
    // Handle QUORUM_RELATIVE_CHANGE_BPS (existing code) OR SET_VOTING_CONFIG (new) OR MULTI
    switch (input.category) {
        case 'QUORUM_RELATIVE_CHANGE_BPS': {
            const dao = ensureAddr(input.daoAddress, 'daoAddress')
            // read current quorum
            const quorumData = await provider.call({ to: dao, data: DaoI.encodeFunctionData('quorumBps', []) }).catch(() => null)
            if (!quorumData) throw new Error('Failed to read quorumBps()')
            const [curBps] = ethers.AbiCoder.defaultAbiCoder().decode(['uint16'], quorumData)
            let next = Number(curBps) + Number(input.deltaBps)
            if (next < 0) next = 0
            if (next > 10_000) next = 10_000

            // preserve delay/period
            const [delayHex, periodHex] = await Promise.all([
                provider.call({ to: dao, data: DaoI.encodeFunctionData('votingDelayBlocks', []) }),
                provider.call({ to: dao, data: DaoI.encodeFunctionData('votingPeriodBlocks', []) }),
            ])
            const [delay] = ethers.AbiCoder.defaultAbiCoder().decode(['uint32'], delayHex)
            const [period] = ethers.AbiCoder.defaultAbiCoder().decode(['uint32'], periodHex)

            const cfgData = DaoI.encodeFunctionData('setVotingConfig', [
                Number(delay) >>> 0,
                Number(period) >>> 0,
                next >>> 0,
            ])
            return [{ target: dao, valueWei: 0n, calldata: cfgData }]
        }

        case 'SET_VOTING_CONFIG': {
            const dao = ensureAddr(input.daoAddress, 'daoAddress')
            if (input.newQuorumBps < 0 || input.newQuorumBps > 10_000) throw new Error('newQuorumBps out of range')

            // 1) DAO.setVotingConfig(...)
            const cfgData = DaoI.encodeFunctionData('setVotingConfig', [
                input.newDelayBlocks >>> 0,
                input.newPeriodBlocks >>> 0,
                input.newQuorumBps >>> 0,
            ])
            const actions: Action[] = [{ target: dao, valueWei: 0n, calldata: cfgData }]

            // 2) Treasury self-call to updateDelay(newTimelock) if provided
            const newDelaySec = Number(input.newTimelock ?? 0)
            if (newDelaySec > 0) {
                const treasData = await provider.call({
                    to: dao,
                    data: DaoI.encodeFunctionData('treasury', [])
                }).catch(() => null)
                if (!treasData) throw new Error('Failed to read treasury()')
                const [treasuryAddr] = ethers.AbiCoder.defaultAbiCoder().decode(['address'], treasData)
                const treasury = ensureAddr(String(treasuryAddr), 'treasury')

                const tlData = TreasI.encodeFunctionData('updateDelay', [newDelaySec >>> 0])
                actions.push({ target: treasury, valueWei: 0n, calldata: tlData })
            }

            return actions
        }

        case 'MULTI': {
            // Recursively build; ensures nested SET_VOTING_CONFIG also adds timelock op
            const out: Action[] = []
            for (const it of input.items) {
                const built = await flattenActionsAsync(it, provider).catch(async () => flattenActions(it))
                out.push(...built)
            }
            return out
        }

        default:
            // Fall back to sync for trivial cases
            return flattenActions(input)
    }
}


/* ---------------------------- Convenience utils --------------------------- */

// Optional: tiny sugar helpers you can use in UI when composing MULTI
export const Actions = {
    setVotingConfig(dao: string, newDelayBlocks: number, newPeriodBlocks: number, newQuorumBps: number, newTimelock: number): BuildDraftParams {
        return { category: 'SET_VOTING_CONFIG', daoAddress: dao, newDelayBlocks, newPeriodBlocks, newQuorumBps, newTimelock }
    },
    setAdmin(dao: string, newAdmin: string): BuildDraftParams {
        return { category: 'SET_ADMIN', daoAddress: dao, newAdmin }
    },
    setVoteToken(dao: string, newToken: string): BuildDraftParams {
        return { category: 'SET_VOTE_TOKEN', daoAddress: dao, newToken }
    },
    nativeTransfer(to: string, valueWei: bigint | number | string): BuildDraftParams {
        return { category: 'TREASURY_NATIVE_TRANSFER', to, valueWei }
    },
    erc20Transfer(token: string, to: string, amount: bigint | number | string): BuildDraftParams {
        return { category: 'TREASURY_ERC20_TRANSFER', token, to, amount }
    },
    multi(items: BuildDraftParams[]): BuildDraftParams { return { category: 'MULTI', items } },
    quorumDelta(dao: string, deltaBps: number): BuildDraftParams {
        return { category: 'QUORUM_RELATIVE_CHANGE_BPS', daoAddress: dao, deltaBps }
    },
}
