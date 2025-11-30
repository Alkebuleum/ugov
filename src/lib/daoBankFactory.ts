// src/lib/daoBankFactory.ts
import { ethers } from 'ethers'
import { CHAIN } from './chain'
import { sendTransaction } from 'amvault-connect'
import { DAO_BANK_FACTORY_ABI } from './abi'

// -----------------------------------------------------------------------------
// Env / config
// -----------------------------------------------------------------------------

export const BANK_FACTORY_ADDRESS = String(
    import.meta.env.VITE_UGOV_BANK_FACTORY_ADDRESS || '',
).trim()

if (!BANK_FACTORY_ADDRESS) {
    console.warn('[uGov] VITE_UGOV_BANK_FACTORY_ADDRESS is not set')
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type DeployBankViaFactoryParams = {
    controller: string                 // treasury timelock (controller)
    deterministic?: boolean
    saltBytes32?: string               // used when deterministic = true
    gasLimit?: number
    maxFeePerGasGwei?: number
    maxPriorityFeePerGasGwei?: number
}

export type DeployBankViaFactoryResult = {
    bank: string
    txHash: string
}

type PopupOpt = { timeoutMs?: number }

// -----------------------------------------------------------------------------
// Low-level helpers
// -----------------------------------------------------------------------------

/** Local waitForTransaction helper (same pattern as daoDeployFactory.ts) */
async function waitReceipt(hash: string) {
    const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
    const rc = await provider.waitForTransaction(hash, 1, 180_000)
    if (!rc) throw new Error('No transaction receipt')
    if (rc.status === 0) throw new Error('Transaction reverted')
    return rc
}

/** Normalize any "label" or hex to bytes32; if already 0x+64, just return. */
export function toSaltBytes32(salt: string): string {
    if (salt.startsWith('0x') && salt.length === 66) return salt
    return ethers.id(salt) // keccak256(bytes(salt))
}

// Shared interface for encoding / log parsing
const factoryIface = new ethers.Interface(DAO_BANK_FACTORY_ABI)

// -----------------------------------------------------------------------------
// Read helpers (view-only)
// -----------------------------------------------------------------------------

export function getBankFactoryRead(provider?: ethers.Provider): ethers.Contract {
    const p = provider ?? new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
    return new ethers.Contract(BANK_FACTORY_ADDRESS, DAO_BANK_FACTORY_ABI, p)
}

/** View: implementation address used by the factory for clones. */
export async function readBankImplAddress(
    opts?: { provider?: ethers.Provider },
): Promise<string> {
    const p = opts?.provider ?? new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
    const factory = getBankFactoryRead(p)
    return factory.bankImpl() as Promise<string>
}

/**
 * Predict deterministic bank address for a given controller + salt.
 * `salt` can be:
 *   - 0x…32 bytes
 *   - any string (we keccak256 it to bytes32)
 */
export async function predictBankAddressForController(params: {
    controller: string
    salt: string
    provider?: ethers.Provider
}): Promise<string> {
    const { controller, salt, provider } = params
    if (!/^0x[a-fA-F0-9]{40}$/.test(controller)) {
        throw new Error('Bad controller address')
    }

    const p = provider ?? new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id)
    const factory = getBankFactoryRead(p)
    const saltBytes32 = toSaltBytes32(salt)

    return factory.predictBankAddress(controller, saltBytes32) as Promise<string>
}

// -----------------------------------------------------------------------------
// Direct deploy via AmVault (used by Treasury "Create DAO Bank")
// -----------------------------------------------------------------------------

export async function deployBank_viaFactory(
    p: DeployBankViaFactoryParams,
    opt?: PopupOpt,
): Promise<DeployBankViaFactoryResult> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(BANK_FACTORY_ADDRESS)) {
        throw new Error('Bad bank factory address (VITE_UGOV_BANK_FACTORY_ADDRESS)')
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(p.controller)) {
        throw new Error('Bad controller address (treasury)')
    }

    let data: string
    if (p.deterministic) {
        const salt = p.saltBytes32 ?? ethers.ZeroHash
        if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) {
            throw new Error('saltBytes32 must be 0x…32 bytes')
        }
        data = factoryIface.encodeFunctionData('createBankDeterministic', [
            p.controller,
            salt,
        ])
    } else {
        data = factoryIface.encodeFunctionData('createBank', [p.controller])
    }

    // 🔸 Send via AmVault SDK (same style as deployDAO_viaFactory)
    const txHash = await sendTransaction(
        {
            chainId: CHAIN.id,
            to: BANK_FACTORY_ADDRESS,
            data,
            gas: p.gasLimit ?? 400_000,
            maxFeePerGasGwei: p.maxFeePerGasGwei,
            maxPriorityFeePerGasGwei: p.maxPriorityFeePerGasGwei,
        },
        {
            app: 'uGov',
            amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
            timeoutMs: opt?.timeoutMs ?? 120_000,
        },
    )

    const rc = await waitReceipt(txHash)

    // Parse BankCreated → grab bank address
    let bank = ''
    for (const log of rc.logs ?? []) {
        try {
            const parsed = factoryIface.parseLog(log)
            if (parsed?.name === 'BankCreated') {
                bank = parsed.args.bank as string
                break
            }
        } catch {
            // ignore non-matching logs
        }
    }

    if (!bank || !/^0x[a-fA-F0-9]{40}$/.test(bank)) {
        throw new Error('BankCreated event not found')
    }

    return { bank, txHash }
}

// -----------------------------------------------------------------------------
// Calldata builders (for timelock actions / proposals)
// -----------------------------------------------------------------------------

/**
 * Encode `createBank(controller)` for inclusion as a treasury timelock action.
 */
export function encodeCreateBank(controller: string): string {
    if (!/^0x[a-fA-F0-9]{40}$/.test(controller)) {
        throw new Error('Bad controller address')
    }
    return factoryIface.encodeFunctionData('createBank', [controller])
}

/**
 * Encode `createBankDeterministic(controller, salt)` for timelock actions.
 * Use `predictBankAddressForController` in the UI to show future bank addr.
 */
export function encodeCreateBankDeterministic(params: {
    controller: string
    salt: string
}): string {
    const { controller, salt } = params
    if (!/^0x[a-fA-F0-9]{40}$/.test(controller)) {
        throw new Error('Bad controller address')
    }
    const saltBytes32 = toSaltBytes32(salt)
    return factoryIface.encodeFunctionData('createBankDeterministic', [
        controller,
        saltBytes32,
    ])
}
