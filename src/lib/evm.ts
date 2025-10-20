// src/lib/evm.ts
import { ethers } from 'ethers'

const toBool = (v: string | undefined) =>
    String(v ?? '').toLowerCase() === 'true'

export const EVM = {
    RPC_URL: String(import.meta.env.VITE_EVM_RPC_URL || ''),
    CHAIN_ID: Number(import.meta.env.VITE_EVM_CHAIN_ID || 0),
    get CHAIN_HEX() { return '0x' + this.CHAIN_ID.toString(16) },
    REGISTRY_ADDRESS: String(import.meta.env.VITE_AMID_REGISTRY_ADDRESS || ''),
    SKIP_REGISTRY: toBool(import.meta.env.VITE_SKIP_REGISTRY || import.meta.env.VITE_SKIP_REGISTRY_CHECK),
}

// Optional registry contract accessor (only if you actually use it)
const REGISTRY_ABI = [
    'function isRegistered(address who) view returns (bool)'
]
export function registryContract() {
    if (!EVM.REGISTRY_ADDRESS) throw new Error('REGISTRY address not set')
    const provider = new ethers.JsonRpcProvider(EVM.RPC_URL, EVM.CHAIN_ID)
    return new ethers.Contract(EVM.REGISTRY_ADDRESS, REGISTRY_ABI, provider)
}
