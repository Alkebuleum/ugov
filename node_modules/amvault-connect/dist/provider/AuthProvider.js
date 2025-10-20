import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useEffect, useMemo, useState } from 'react';
import { verifyMessage } from 'ethers';
import { openSignin } from '../popup/amvaultProvider';
const DEFAULT_TTL = 24 * 60 * 60 * 1000;
export const makeStorageKeys = (prefix) => ({
    session: `${prefix}.session`,
    nonce: `${prefix}.nonce`
});
export const AuthContext = createContext({
    session: null, signin: async () => { }, signout: () => { }, status: 'idle', error: null
});
export function AuthProvider({ children, config }) {
    var _a;
    const ttl = (_a = config.sessionTtlMs) !== null && _a !== void 0 ? _a : DEFAULT_TTL;
    const keys = useMemo(() => makeStorageKeys(config.storagePrefix || 'amvault'), [config.storagePrefix]);
    const [session, setSession] = useState(null);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState(null);
    // restore
    useEffect(() => {
        setStatus('checking');
        try {
            const raw = localStorage.getItem(keys.session);
            if (raw) {
                const s = JSON.parse(raw);
                if (Date.now() < s.expiresAt) {
                    setSession(s);
                    setStatus('ready');
                    return;
                }
            }
            setStatus('ready');
        }
        catch (e) {
            setStatus('failed');
            setError('Failed to load session');
        }
    }, [keys.session]);
    const signout = () => {
        localStorage.removeItem(keys.session);
        setSession(null);
    };
    const makeNonce = () => {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
    };
    const buildMessage = (nonce) => {
        const origin = window.location.origin;
        if (typeof config.messageBuilder === 'function') {
            return config.messageBuilder({
                appName: config.appName,
                origin,
                chainId: config.chainId,
                nonce
            });
        }
        const domain = window.location.host;
        return [
            `${domain} wants you to sign in with your account:`,
            ``,
            `App: ${config.appName}`,
            `Nonce: ${nonce}`,
            `URI: ${origin}`,
            `Chain ID: ${config.chainId}`,
            `Version: 1`,
        ].join('\\n');
    };
    const signin = async () => {
        var _a, _b, _c;
        try {
            setError(null);
            setStatus('checking');
            const nonce = makeNonce();
            localStorage.setItem(keys.nonce, nonce);
            const msg = buildMessage(nonce);
            const resp = await openSignin({
                app: config.appName,
                chainId: config.chainId,
                origin: window.location.origin,
                nonce,
                amvaultUrl: config.amvaultUrl,
                debug: !!config.debug,
                message: msg
            });
            if (!(resp === null || resp === void 0 ? void 0 : resp.ok))
                throw new Error((resp === null || resp === void 0 ? void 0 : resp.error) || 'Sign-in rejected');
            const { address, signature, chainId, nonce: got } = resp;
            if (!address || !signature || !chainId || !got)
                throw new Error('Malformed response');
            if (got !== nonce)
                throw new Error('Nonce mismatch');
            if (Number(chainId) !== config.chainId)
                throw new Error(`Wrong network: got ${chainId}, expected ${config.chainId}`);
            // If AmVault returns the exact message it showed the user, verify against that,
            // then sanity-check fields (nonce/origin/chainId/app).
            const origin = window.location.origin;
            const toVerify = typeof resp.message === 'string' && resp.message.trim() ? resp.message : msg;
            const recovered = verifyMessage(toVerify, signature).toLowerCase();
            if (recovered !== String(address).toLowerCase())
                throw new Error('Signature invalid (recovered != address)');
            // Sanity checks if using returned message
            if (toVerify !== msg) {
                if (!toVerify.includes(`Nonce: ${nonce}`))
                    throw new Error('Signed message missing expected nonce');
                if (!toVerify.includes(`URI: ${origin}`))
                    throw new Error('Signed message missing expected origin');
                if (!toVerify.includes(`Chain ID: ${config.chainId}`))
                    throw new Error('Signed message missing expected chain id');
                const enforce = (_a = config.enforceAppName) !== null && _a !== void 0 ? _a : true;
                if (enforce && !toVerify.includes(`App: ${config.appName}`)) {
                    throw new Error('Signed message app does not match configuration');
                }
            }
            // Optional registry checks
            if ((_b = config.registry) === null || _b === void 0 ? void 0 : _b.isRegistered) {
                const ok = await config.registry.isRegistered(address);
                if (!ok)
                    throw new Error('Address not registered');
            }
            // Resolve AIN
            let ain = '';
            if (typeof resp.ain === 'string' && resp.ain.trim())
                ain = resp.ain.trim();
            else if (typeof resp.amid === 'string' && resp.amid.trim())
                ain = resp.amid.trim();
            if (!ain && ((_c = config.registry) === null || _c === void 0 ? void 0 : _c.getAin)) {
                try {
                    const gotAin = await config.registry.getAin(address);
                    if (gotAin)
                        ain = gotAin;
                }
                catch { }
            }
            if (!ain)
                ain = `ain-${address.slice(2, 8)}`;
            const now = Date.now();
            const sess = { ain, address, issuedAt: now, expiresAt: now + ttl };
            localStorage.setItem(keys.session, JSON.stringify(sess));
            setSession(sess);
            setStatus('ready');
        }
        catch (e) {
            setError((e === null || e === void 0 ? void 0 : e.message) || 'Sign-in failed');
            setStatus('ready');
        }
        finally {
            localStorage.removeItem(keys.nonce);
        }
    };
    const value = useMemo(() => ({
        session, signin, signout, status, error
    }), [session, status, error]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
