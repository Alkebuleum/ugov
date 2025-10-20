# amvault-connect

A tiny React SDK to connect to **AmVault** via a popup, verify a signed message,
and restore a short-lived session. Built from production patterns used in uGov.

## Install

```bash
npm i amvault-connect
# peer deps
npm i react ethers
```

## Quick start

```tsx
// main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from 'amvault-connect'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthProvider
    config={
      appName: 'AkeOutlet',
      chainId: 12345,
      amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
      debug: !!import.meta.env.VITE_AUTH_DEBUG,
      registry: {
        // Optional: wire your on-chain registry lookups here
        isRegistered: async (addr) => true,
        getAin: async (addr) => null,
      }
    }
  >
    <App/>
  </AuthProvider>
)
```

```tsx
// in any component
import { useAuth } from 'amvault-connect'
const { session, signin, signout, status, error } = useAuth()
```

- `signin()` opens AmVault and resolves a session (`address`, `ain`).
- `status` is `'idle' | 'checking' | 'ready' | 'failed'`.
- `error` contains the latest human-readable error, if any.

## Sending transactions

```ts
import { sendTransaction } from 'amvault-connect'

await sendTransaction(
  { chainId: 12345, to: '0x...', data: '0x...', value: 0 },
  { app: 'AkeOutlet', amvaultUrl: import.meta.env.VITE_AMVAULT_URL }
)
```

## Environment variables

- `VITE_AMVAULT_URL` – e.g., `https://amvault.example.com/router`
- `VITE_AUTH_DEBUG` – `true` to enable verbose logs

## Registry integration

Pass `registry` functions to enforce registration / fetch AINs. This keeps the SDK
lean (no ABI baked in) while letting you swap implementations.

## Example project

See `examples/react-vite` for a minimal Vite app wiring this SDK.

---

© 2025 amvault-connect. MIT License.
