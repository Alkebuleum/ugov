export type Session = {
    ain: string;
    address: string;
    issuedAt: number;
    expiresAt: number;
};
export type AuthStatus = 'idle' | 'checking' | 'ready' | 'failed';
export type AuthContextValue = {
    session: Session | null;
    signin: () => Promise<void>;
    signout: () => void;
    status: AuthStatus;
    error: string | null;
};
export type SigninArgs = {
    app: string;
    chainId: number;
    origin: string;
    nonce: string;
};
export type SigninResp = {
    ok: boolean;
    address: string;
    signature: string;
    chainId: number;
    nonce: string;
    ain?: string;
    amid?: string;
    error?: string;
    /** Optional: AmVault can echo back the exact message it asked the user to sign */
    message?: string;
};
export type TxReq = {
    chainId: number;
    to?: string;
    data?: string;
    value?: string | number | bigint;
    gas?: number;
    maxFeePerGasGwei?: number;
    maxPriorityFeePerGasGwei?: number;
};
export type SendTxResp = {
    ok: boolean;
    txHash?: string;
    error?: string;
    nonce: string;
    chainId: number;
};
export type RegistryAdapter = {
    isRegistered?: (address: string) => Promise<boolean>;
    isValidator?: (address: string) => Promise<boolean>;
    getAin?: (address: string) => Promise<string | null>;
};
export type AmvaultConnectConfig = {
    appName: string;
    chainId: number;
    amvaultUrl: string;
    debug?: boolean;
    storagePrefix?: string;
    sessionTtlMs?: number;
    registry?: RegistryAdapter;
    /** Optional override to construct the sign-in message */
    messageBuilder?: (info: {
        appName: string;
        origin: string;
        chainId: number;
        nonce: string;
    }) => string;
    /** When verifying a message returned from AmVault, require `App: appName` to match. Default true. */
    enforceAppName?: boolean;
};
