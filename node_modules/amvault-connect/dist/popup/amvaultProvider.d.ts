import type { SigninResp } from '../types';
export declare function openSignin(args: {
    app: string;
    chainId: number;
    origin: string;
    nonce: string;
    amvaultUrl: string;
    debug?: boolean;
    message?: string;
}): Promise<SigninResp>;
export declare function sendTransaction(req: {
    chainId: number;
    to?: string;
    data?: string;
    value?: string | number | bigint;
    gas?: number;
    maxFeePerGasGwei?: number;
    maxPriorityFeePerGasGwei?: number;
}, opts: {
    app: string;
    amvaultUrl: string;
    timeoutMs?: number;
    debug?: boolean;
}): Promise<string>;
