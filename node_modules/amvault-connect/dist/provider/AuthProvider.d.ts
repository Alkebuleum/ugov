import React from 'react';
import type { AmvaultConnectConfig, AuthContextValue } from '../types';
export declare const makeStorageKeys: (prefix: string) => {
    session: string;
    nonce: string;
};
export declare const AuthContext: React.Context<AuthContextValue>;
export declare function AuthProvider({ children, config }: {
    children: React.ReactNode;
    config: AmvaultConnectConfig;
}): import("react/jsx-runtime").JSX.Element;
