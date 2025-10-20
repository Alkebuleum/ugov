// src/lib/chain.ts
import { ethers } from 'ethers'

export const CHAIN = {
    id: 237422,
    name: 'Alkebuleum',
    rpcUrl: 'https://rpc.alkebuleum.com',
    explorerBase: 'https://explorer.alkebuleum.com',
}

export async function getBrowserProvider(): Promise<ethers.BrowserProvider> {
    const eth = (window as any).ethereum
    if (!eth) throw new Error('No EVM wallet found. Please install AmVault or MetaMask.')
    return new ethers.BrowserProvider(eth)
}


export async function ensureChain(provider: ethers.BrowserProvider) {
    const net = await provider.getNetwork()
    if (Number(net.chainId) === CHAIN.id) return
    try {
        await provider.send('wallet_switchEthereumChain', [{ chainId: ethers.toBeHex(CHAIN.id) }])
    } catch (e: any) {
        if (e?.code === 4902 /* unknown chain */) {
            await provider.send('wallet_addEthereumChain', [{
                chainId: ethers.toBeHex(CHAIN.id),
                chainName: CHAIN.name,
                rpcUrls: [CHAIN.rpcUrl],
                nativeCurrency: { name: 'AKE', symbol: 'AKE', decimals: 18 },
                blockExplorerUrls: [CHAIN.explorerBase],
            }])
        } else {
            throw e
        }
    }
}


// --- add these helpers to your existing chain.ts ---

// Read-only JSON-RPC provider (no wallet required)
export function getReadProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(CHAIN.rpcUrl)
}

// Convenience: try RPC; if it fails you can fall back to browser wallet elsewhere
export function tryReadProvider(): ethers.JsonRpcProvider | null {
    try { return getReadProvider() } catch { return null }
}

