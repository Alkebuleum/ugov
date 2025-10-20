// src/lib/daoDeployFactory.ts
import { ethers } from 'ethers'
import { CHAIN } from './chain'
import { sendTransaction } from 'amvault-connect'

const FACTORY_ABI = [
    // NOTE: new 3rd param = minBond (uint256)
    'function createDAO(address admin,address token,uint256 minBond,uint32 votingDelayBlocks,uint32 votingPeriodBlocks,uint16 quorumBps,uint32 timelockDelaySeconds) returns (address dao,address treasury)',
    'function createDAODeterministic(address admin,address token,uint256 minBond,uint32 votingDelayBlocks,uint32 votingPeriodBlocks,uint16 quorumBps,uint32 timelockDelaySeconds,bytes32 salt) returns (address dao,address treasury)',
    // NOTE: event now includes timelockDelay, salt, minBond, bondManager
    'event DAOCreated(address indexed dao,address indexed treasury,address indexed token,address admin,uint32 votingDelayBlocks,uint32 votingPeriodBlocks,uint16 quorumBps,uint32 timelockDelay,bytes32 salt,uint256 minBond,address bondManager)',
] as const

export type DeployViaFactoryParams = {
    factory: string
    admin: string
    votesToken: string
    /** NEW: minimum bond in wei (pass bigint or hex string) */
    minBondWei: bigint | string
    votingDelayBlocks: number
    votingPeriodBlocks: number
    timelockDelaySeconds: number
    quorumBps: number
    deterministic?: boolean
    saltBytes32?: string
    gasLimit?: number
    maxFeePerGasGwei?: number
    maxPriorityFeePerGasGwei?: number
}

export type DeployViaFactoryResult = {
    treasury: string
    dao: string
    txHash: string
}

type PopupOpt = { popup?: Window | null; timeoutMs?: number }

async function waitReceipt(hash: string) {
    const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
    const rc = await provider.waitForTransaction(hash, 1, 180_000)
    if (!rc) throw new Error('No transaction receipt')
    if (rc.status === 0) throw new Error('Transaction reverted')
    return rc
}

export async function deployDAO_viaFactory(
    p: DeployViaFactoryParams,
    opt?: PopupOpt
): Promise<DeployViaFactoryResult> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(p.factory)) throw new Error('Bad factory address')
    if (!/^0x[a-fA-F0-9]{40}$/.test(p.admin)) throw new Error('Bad admin address')
    if (!/^0x[a-fA-F0-9]{40}$/.test(p.votesToken)) throw new Error('Bad votes token address')
    if (p.quorumBps < 0 || p.quorumBps > 10_000) throw new Error('quorumBps must be 0..10000')

    const iface = new ethers.Interface(FACTORY_ABI)

    // Normalize minBond to a BigInt for encoding
    const minBond =
        typeof p.minBondWei === 'string' ? BigInt(p.minBondWei) : (p.minBondWei as bigint)

    let data: string
    if (p.deterministic) {
        const salt = p.saltBytes32 ?? ethers.ZeroHash
        if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new Error('saltBytes32 must be 0x…32 bytes')
        data = iface.encodeFunctionData('createDAODeterministic', [
            p.admin,
            p.votesToken,
            minBond,
            Number(p.votingDelayBlocks),
            Number(p.votingPeriodBlocks),
            Number(p.quorumBps),
            Number(p.timelockDelaySeconds),
            salt,
        ])
    } else {
        data = iface.encodeFunctionData('createDAO', [
            p.admin,
            p.votesToken,
            minBond,
            Number(p.votingDelayBlocks),
            Number(p.votingPeriodBlocks),
            Number(p.quorumBps),
            Number(p.timelockDelaySeconds),
        ])
    }

    // 🔸 Send via SDK (SDK will open/close popup itself)
    const txHash = await sendTransaction(
        {
            chainId: CHAIN.id,
            to: p.factory,
            data,
            gas: p.gasLimit ?? 900_000,
            maxFeePerGasGwei: p.maxFeePerGasGwei,
            maxPriorityFeePerGasGwei: p.maxPriorityFeePerGasGwei,
        },
        {
            app: 'uGov',
            amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
            timeoutMs: opt?.timeoutMs ?? 120_000,
        }
    )

    const rc = await waitReceipt(txHash)

    // Parse DAOCreated → grab dao & treasury
    let dao = '',
        treasury = ''
    for (const log of rc.logs ?? []) {
        try {
            const parsed = iface.parseLog(log)
            if (parsed?.name === 'DAOCreated') {
                dao = parsed.args.dao
                treasury = parsed.args.treasury
                break
            }
        } catch { }
    }
    if (!dao || !treasury) throw new Error('DAOCreated event not found')

    return { dao, treasury, txHash }

}


