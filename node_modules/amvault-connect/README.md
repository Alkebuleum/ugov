# amvault-connect

A tiny React SDK that lets your dApp authenticate users and send transactions through **AmVault** (popup signer). It provides:

- `<AuthProvider>` + `useAuth()` for sign-in with EIP-191 message signing
- `sendTransaction()` to route EVM transactions via AmVault popups
- Strong nonce / origin / chain checks and customizable sign-in messages
- Lightweight local session (no backend required)

> Built for apps like **AkeOutlet**, **uGov**, and any React dApp.

---

## Quick start

### 1) Install

```bash
npm i amvault-connect ethers
# TS users: npm i -D @types/react @types/react-dom
```

### 2) Configure env

Create `.env` in your app:

```
VITE_AMVAULT_URL=https://<your-amvault>/router
VITE_CHAIN_ID=237422
VITE_AUTH_DEBUG=true
```

Optional knobs your app may use:

```
VITE_RPC_URL=https://<rpc>
VITE_AKE_DECIMALS=18
VITE_AKE_TOKEN=0x...      # if testing ERC-20 transfer instead of native
VITE_MAX_FEE_GWEI=3
VITE_MAX_PRIORITY_GWEI=1
```

### 3) Wrap your app

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from 'amvault-connect'
import App from './App'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider
        config={{
          appName: 'AkeOutlet',
          chainId: Number(import.meta.env.VITE_CHAIN_ID),
          amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
          debug: String(import.meta.env.VITE_AUTH_DEBUG).toLowerCase()==='true',
          // Optional: customize the signin message
          // messageBuilder: ({ appName, origin, chainId, nonce }) => [
          //   `${new URL(origin).host} wants you to sign in with your account:`,
          //   '',
          //   `App: ${appName}`,
          //   `Nonce: ${nonce}`,
          //   `URI: ${origin}`,
          //   `Chain ID: ${chainId}`,
          //   `Version: 1`,
          // ].join('\n'),
          // enforceAppName: true,
          // registry: { isRegistered: async (addr)=>true, getAin: async (addr)=>null },
        }}
      >
        <App/>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
```

### 4) Sign in / out

```jsx
import React from 'react'
import { useAuth } from 'amvault-connect'

export default function Login() {
  const { session, signin, signout, status, error } = useAuth()
  return (
    <div>
      {!session ? (
        <button disabled={status==='checking'} onClick={signin}>
          {status==='checking' ? 'Connecting…' : 'Connect AmVault'}
        </button>
      ) : (
        <>
          <div>Signed in as {session.address} (AIN: {session.ain})</div>
          <button onClick={signout}>Sign out</button>
        </>
      )}
      {error && <div style={{color:'crimson'}}>{error}</div>}
    </div>
  )
}
```

### 5) Protect routes

```jsx
import { Navigate } from 'react-router-dom'
import { useAuth } from 'amvault-connect'

function Protected({ children }) {
  const { session, status } = useAuth()
  if (status === 'checking') return <div>Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}
```

---

## Sending transactions

### Native coin (value transfer)

```js
import { sendTransaction } from 'amvault-connect'
import { parseUnits } from 'ethers'

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID)
const DEST  = '0xYourDestination'
const DECIMALS = 18

async function sendNative(amount) {
  const value = parseUnits(String(amount), DECIMALS)    // BigInt
  const txHash = await sendTransaction(
    {
      chainId: CHAIN,
      to: DEST,
      value: value.toString(),                          // stringify BigInt
      gas: 21000,                                       // skip estimateGas if RPC balks
    },
    { app: 'YourApp', amvaultUrl: import.meta.env.VITE_AMVAULT_URL }
  )
  console.log('txHash', txHash)
}
```

### ERC-20 transfer

```js
import { sendTransaction } from 'amvault-connect'
import { Interface, parseUnits } from 'ethers'

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID)
const TOKEN = '0xErc20Address'
const DEST  = '0xRecipient'
const DECIMALS = 18
const iface = new Interface(['function transfer(address to, uint256 amount)'])

async function sendErc20(amount) {
  const value = parseUnits(String(amount), DECIMALS)
  const data  = iface.encodeFunctionData('transfer', [DEST, value])
  const txHash = await sendTransaction(
    {
      chainId: CHAIN,
      to: TOKEN,
      data,
      value: 0,                // number zero is JSON-safe
      gas: 100_000,
    },
    { app: 'YourApp', amvaultUrl: import.meta.env.VITE_AMVAULT_URL }
  )
  console.log('txHash', txHash)
}
```

---

## API Reference

### `<AuthProvider config={{...}}>`

| Prop | Type | Required | Default | Description |
|---|---|---:|---|---|
| `appName` | `string` | ✅ | — | Your app’s display name; enforced in message by default. |
| `chainId` | `number` | ✅ | — | EVM chain id used for sign-in checks. |
| `amvaultUrl` | `string` | ✅ | — | AmVault router URL for popups. |
| `debug` | `boolean` | — | `false` | Extra console logging. |
| `sessionTtlMs` | `number` | — | `86400000` | Local session TTL (ms). |
| `storagePrefix` | `string` | — | `'amvault'` | localStorage prefix. |
| `registry` | `{ isRegistered(addr):Promise<boolean>, getAin(addr):Promise<string|null> }` | — | — | Optional on-chain checks to attach roles/AIN. |
| `messageBuilder` | `(info) => string` | — | default SIWE-like | Build the exact sign-in message your app wants the user to sign. |
| `enforceAppName` | `boolean` | — | `true` | Require a `App: <appName>` line in signed message. |

### `useAuth()`

```ts
type Session = { ain: string; address: string; issuedAt: number; expiresAt: number }

{
  session: Session | null,
  signin: () => Promise<void>,
  signout: () => void,
  status: 'idle' | 'checking' | 'ready' | 'failed',
  error: string | null
}
```

### `sendTransaction(req, opts)`

```ts
// req
{
  chainId: number,
  to?: string,
  data?: string,                  // 0x…
  value?: string | number,        // decimal string for large values
  gas?: number,
  maxFeePerGasGwei?: number,
  maxPriorityFeePerGasGwei?: number,
}

// opts
{
  app: string,
  amvaultUrl: string,
  timeoutMs?: number,
}
```

Returns `Promise<string>` (transaction hash).

---

## Custom sign-in message

The SDK sends **the exact message** to AmVault to sign. AmVault echoes it back so verification uses the same string.

```jsx
<AuthProvider
  config={{
    appName: 'YourApp',
    chainId: Number(import.meta.env.VITE_CHAIN_ID),
    amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
    messageBuilder: ({ appName, origin, chainId, nonce }) => [
      `${new URL(origin).host} wants you to sign in with your account:`,
      '',
      `App: ${appName}`,
      `Nonce: ${nonce}`,
      `URI: ${origin}`,
      `Chain ID: ${chainId}`,
      `Version: 1`,
    ].join('\n'),
    enforceAppName: true,
  }}
/>
```

---

## Troubleshooting

- **Signature invalid (recovered != address):** Sign-in message mismatch. Ensure `appName` / `messageBuilder` matches what the vault signs. The SDK verifies the message echoed by AmVault.
- **UI shows `\n` in message:** Upgrade the vault—new builds normalize JSON-escaped newlines.
- **Do not know how to serialize a BigInt:** `parseUnits()` returns BigInt. Use `value: big.toString()`. Use `0` (number) for zero.
- **estimateGas -32603 Internal error:** Provide `gas` manually (e.g., `21000` native, `100000` ERC-20). Ensure native balance for gas, correct `chainId`, valid contract address.

---

## Security notes

- SDK verifies **nonce**, **origin**, and **chainId** for sign-in.
- Signing **does not** move funds.
- For server backends, you can also verify the signature server-side if needed.

---

## Links

- Repo: https://github.com/Alkebuleum/amvault-connect
- Issues: https://github.com/Alkebuleum/amvault-connect/issues
- Example app: `examples/react-vite` (coming soon)

## License

See [LICENSE](./LICENSE). © 2025 Alkebuleum Technology LLC.
