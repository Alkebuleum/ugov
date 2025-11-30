// src/lib/daoBank.ts
import { ethers } from 'ethers'
import { DAO_BANK_ABI, ERC20_ABI } from './abi'
import { CHAIN, getReadProvider, getBrowserProvider } from './chain'

// 👇 ADD THIS
const DEFAULT_DECIMALS = 18 // ALKE native / typical ERC20

export function toWei(
    amount: bigint | number | string,
    decimals: number = DEFAULT_DECIMALS
): bigint {
    // Always treat input as "token units", never raw wei
    return ethers.parseUnits(String(amount), decimals)
}

export type BankAccountInfo = {
    exists: boolean
    budget: bigint
    annualLimit: bigint
    spentThisYear: bigint
    yearIndex: bigint
}

export type AssetBudgetState = {
    balance: bigint
    totalBudget: bigint
    unallocated: bigint
}

/** Normalize an account id into bytes32.
 *  - If already 0x...66, use as-is
 *  - Otherwise keccak256(string) so we can use human labels in UI.
 */
export function toAccountIdBytes32(id: string): string {
    if (id.startsWith('0x') && id.length === 66) return id
    return ethers.id(id)
}

/** Read-only contract handle */
export function getBankRead(
    bankAddress: string,
    provider?: ethers.Provider,
): ethers.Contract {
    const p = provider ?? getReadProvider()
    return new ethers.Contract(bankAddress, DAO_BANK_ABI, p)
}

/** Signer-backed contract handle (for controller / manual ops) */
export async function getBankWrite(bankAddress: string): Promise<ethers.Contract> {
    const browserProv = await getBrowserProvider()
    const signer = await browserProv.getSigner()
    return new ethers.Contract(bankAddress, DAO_BANK_ABI, signer)
}

/** Read a single logical account */
export async function readBankAccount(
    bankAddress: string,
    accountId: string,
    asset: string,
    opts?: { provider?: ethers.Provider },
): Promise<BankAccountInfo> {
    const p = opts?.provider ?? getReadProvider()
    const bank = getBankRead(bankAddress, p)
    const accountKey = toAccountIdBytes32(accountId)

    const [exists, budget, annualLimit, spentThisYear, yearIndex] =
        (await bank.getAccountInfo(accountKey, asset)) as [
            boolean,
            bigint,
            bigint,
            bigint,
            bigint,
        ]

    return { exists, budget, annualLimit, spentThisYear, yearIndex }
}



/** Read overall asset state (balance / totalBudget / unallocated) */
export async function readAssetBudgetState(
    bankAddress: string,
    asset: string,
    opts?: { provider?: ethers.Provider },
): Promise<AssetBudgetState> {
    const p = opts?.provider ?? getReadProvider()
    const bank = getBankRead(bankAddress, p)

    const [balance, totalBudget, unallocated] =
        (await bank.getAssetBudgetState(asset)) as [bigint, bigint, bigint]

    return { balance, totalBudget, unallocated }
}

/** Read controller address for a bank */
export async function readBankController(
    bankAddress: string,
    opts?: { provider?: ethers.Provider },
): Promise<string> {
    const p = opts?.provider ?? getReadProvider()
    const bank = getBankRead(bankAddress, p)
    return bank.controller() as Promise<string>
}

/* -------------------- Deposits (user-facing) -------------------- */

/** Deposit native ALKE into the bank (anyone can do this). */
export async function depositNativeToBank(
    bankAddress: string,
    amountWei: bigint,
): Promise<ethers.TransactionResponse> {
    const browserProv = await getBrowserProvider()
    const signer = await browserProv.getSigner()
    const bank = new ethers.Contract(bankAddress, DAO_BANK_ABI, signer)

    // Use the explicit deposit function so we get the event
    return bank.depositNative({ value: amountWei })
}

/** Deposit ERC20 (e.g. MAh) into the bank.
 *  Caller must have already `approve`d the bank for at least `amount`.
 */
export async function depositERC20ToBank(
    bankAddress: string,
    tokenAddress: string,
    amount: bigint,
): Promise<ethers.TransactionResponse> {
    const browserProv = await getBrowserProvider()
    const signer = await browserProv.getSigner()

    const bank = new ethers.Contract(bankAddress, DAO_BANK_ABI, signer)
    // transferFrom is executed inside the bank, so here we just call depositERC20
    return bank.depositERC20(tokenAddress, amount)
}

/* -------------------- Encoding helpers for proposals -------------------- */

const bankIface = new ethers.Interface(DAO_BANK_ABI)

export function encodeCreateAccount(params: {
    accountId: string
    asset: string
    // 👇 allow human numbers too
    budget: bigint | number | string
    annualLimit: bigint | number | string
}): string {
    const budgetWei = toWei(params.budget, DEFAULT_DECIMALS)
    const annualWei =
        params.annualLimit ? toWei(params.annualLimit, DEFAULT_DECIMALS) : 0n

    return bankIface.encodeFunctionData('createAccount', [
        toAccountIdBytes32(params.accountId),
        params.asset,
        budgetWei,
        annualWei,
    ])
}


export function encodeUpdateAccountBudget(params: {
    accountId: string
    asset: string
    newBudget: bigint | number | string
    newAnnualLimit: bigint | number | string
}): string {
    const newBudgetWei = toWei(params.newBudget, DEFAULT_DECIMALS)
    const newAnnualWei =
        params.newAnnualLimit ? toWei(params.newAnnualLimit, DEFAULT_DECIMALS) : 0n

    return bankIface.encodeFunctionData('updateAccountBudget', [
        toAccountIdBytes32(params.accountId),
        params.asset,
        newBudgetWei,
        newAnnualWei,
    ])
}


export function encodeUpdateAnnualCap(params: {
    accountId: string
    asset: string
    newAnnualLimit: bigint
}): string {
    return bankIface.encodeFunctionData('updateAnnualCap', [
        toAccountIdBytes32(params.accountId),
        params.asset,
        params.newAnnualLimit,
    ])
}

export function encodeCloseAccount(params: {
    accountId: string
    asset: string
}): string {
    return bankIface.encodeFunctionData('closeAccount', [
        toAccountIdBytes32(params.accountId),
        params.asset,
    ])
}

export function encodeSpendFromAccount(params: {
    accountId: string
    asset: string
    to: string
    amount: bigint | number | string   // 👈 allow all
}): string {
    const amtWei = toWei(params.amount, DEFAULT_DECIMALS)
    return bankIface.encodeFunctionData('spendFromAccount', [
        toAccountIdBytes32(params.accountId),
        params.asset,
        params.to,
        amtWei,
    ])
}

