// src/lib/chainReads.ts
import { ethers } from 'ethers'
import { CHAIN } from './chain'
import { DAO_ABI, TREASURY_ABI } from './abi'

export type GovernanceConfig = {
    admin: string
    token: string
    treasury: string
    votingDelayBlocks: number
    votingPeriodBlocks: number
    quorumBps: number
    timelockDelaySec: number | null
}

export async function readGovernanceConfig(
    daoAddress: string,
    opts?: { provider?: ethers.Provider }
): Promise<GovernanceConfig> {
    const provider = opts?.provider ?? new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
    const dao = new ethers.Contract(daoAddress, DAO_ABI, provider)

    const [admin, token, treasury, delayB, periodB, qbps] = await Promise.all([
        dao.admin() as Promise<string>,
        dao.token() as Promise<string>,
        dao.treasury() as Promise<string>,
        dao.votingDelayBlocks() as Promise<number | bigint>,
        dao.votingPeriodBlocks() as Promise<number | bigint>,
        dao.quorumBps() as Promise<number | bigint>,
    ])

    let timelockDelaySec: number | null = null
    if (treasury && treasury !== ethers.ZeroAddress) {
        try {
            const tl = new ethers.Contract(treasury, TREASURY_ABI, provider)
            // if contract doesn’t expose delay(), this will throw and we fall back to null
            timelockDelaySec = Number(await tl.delay())
        } catch {
            timelockDelaySec = null
        }
    }

    return {
        admin,
        token,
        treasury,
        votingDelayBlocks: Number(delayB),
        votingPeriodBlocks: Number(periodB),
        quorumBps: Number(qbps),
        timelockDelaySec,
    }
}
