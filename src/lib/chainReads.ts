// src/lib/chainReads.ts
import { ethers } from 'ethers'
import { CHAIN } from './chain'
import { DAO_ABI, TREASURY_ABI } from './abi'
import { AMID_REGISTRY_ABI } from './abi' // If defined in abi.ts


const REGISTRY_ADDRESS = import.meta.env.VITE_AMID_REGISTRY_ADDRESS

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


export async function getAINByOwner(
    ownerAddress: string,
    opts?: { provider?: ethers.Provider }
): Promise<{
    ainBytes32: string | null
    ainString: string | null
}> {
    if (!ownerAddress || !ethers.isAddress(ownerAddress)) {
        console.warn('[getAINByOwner] Invalid address:', ownerAddress)
        return { ainBytes32: null, ainString: null }
    }

    try {
        const provider = opts?.provider ?? new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
        const registry = new ethers.Contract(REGISTRY_ADDRESS, AMID_REGISTRY_ABI, provider)

        const ainBytes32: string = await registry.ownerToId(ownerAddress)

        if (ainBytes32 === ethers.ZeroHash) {
            return { ainBytes32: null, ainString: null }
        }

        let ainString: string | null = null
        try {
            ainString = ethers.decodeBytes32String(ainBytes32)
        } catch {
            // not a UTF-8 encoded bytes32 string
            ainString = null
        }

        return { ainBytes32, ainString }
    } catch (err) {
        console.error('[getAINByOwner] Failed to fetch AIN for:', ownerAddress, err)
        return { ainBytes32: null, ainString: null }
    }
}
