import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useDAO } from '../lib/dao'
import { updateDAOTrackedTokens, db } from '../lib/firebase'
import { Banknote, Coins, Wallet2, PlusCircle, Pencil, Trash2, X, Check, Droplets, AlertTriangle, RotateCw } from 'lucide-react'
import { doc, onSnapshot } from 'firebase/firestore'
import { ethers } from 'ethers'
import { getReadProvider } from '../lib/chain'
import AuthInline from '../components/AuthInline'
import { useAuth } from 'amvault-connect'
import { getAINByOwner } from '../lib/chainReads'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

function shortAddr(a?: string, lead = 6, tail = 6) {
  if (!a) return ''
  return a.slice(0, lead) + '…' + a.slice(-tail)
}
function fmtUsd(n?: number) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}
function safeNum(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN)
  return Number.isFinite(n) ? n : 0
}
function isEthAddr(s: string) { return /^0x[a-fA-F0-9]{40}$/.test(s) }

type TokenForm = {
  isNative: boolean
  address: string
  symbol: string
  decimals: string
  priceUsd: string
}

type ResolvedToken = {
  type: 'native' | 'erc20'
  address: string // '' for native
  symbol: string
  decimals: number
  balance: number   // human units
  priceUsd?: number
}

export default function Treasury() {
  const { session } = useAuth()
  const { current, loading } = useDAO()
  const daoId = current?.id ?? null

  const [adminAIN, setAdminAIN] = useState<string | null>(null)

  useEffect(() => {
    if (!current?.admin) return

    async function fetchAdminAIN() {
      const result = await getAINByOwner(current.admin)
      console.log('[Treasury] getAINByOwner result:', result)
      setAdminAIN(result.ainString)
    }

    fetchAdminAIN()
  }, [current?.admin])

  const isAdmin =
    adminAIN &&
    session?.ain &&
    adminAIN.toLowerCase() === session.ain.toLowerCase()

  // Live DAO doc => instant UI refresh after writes
  const [daoLive, setDaoLive] = useState<any | null>(null)
  useEffect(() => {
    if (!current?.id) return
    const ref = doc(db, 'daos', current.id)
    const unsub = onSnapshot(ref, (snap) => {
      setDaoLive(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null)
    })
    return unsub
  }, [current?.id])

  const treasury = daoLive?.treasury ?? current?.treasury
  const bank = daoLive?.bank ?? (current as any)?.bank           // 👈 NEW: bank field
  const holder = bank || treasury                                // 👈 NEW: where funds are actually held

  const tokensConf = (daoLive?.trackedTokens ?? current?.trackedTokens ?? []) as any[]

  // Make tokens list stable for effect deps
  const tokensKey = useMemo(() => {
    try {
      const list = tokensConf as any[]
      const minimal = list.slice(0, 3).map(t => ({
        type: t.type ?? (t.address ? 'erc20' : 'native'),
        address: (t.address || '').toLowerCase(),
        symbol: t.symbol || '',
        decimals: typeof t.decimals === 'number' ? t.decimals : 18,
        priceUsd: t.priceUsd ?? null,
      }))
      return JSON.stringify(minimal)
    } catch { return '[]' }
  }, [daoLive?.trackedTokens, current?.trackedTokens])

  // Editor + actions
  const [actionError, setActionError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | 'new' | null>(null)
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null)
  const [form, setForm] = useState<TokenForm>({ isNative: false, address: '', symbol: '', decimals: '18', priceUsd: '' })

  // Read provider (no wallet)
  const provider = useMemo(() => {
    try { return getReadProvider() } catch { return null }
  }, [])
  const [providerMissing, setProviderMissing] = useState(false)

  // On-chain balances
  const [resolved, setResolved] = useState<ResolvedToken[]>([])
  const [resolving, setResolving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0) // manual refresh trigger

  // DAO-switch: hard reset transient UI
  useEffect(() => {
    setResolved([])
    setEditingIndex(null)
    setActionError(null)
    setConfirmDeleteIdx(null)
    setResolving(false)
    setRefreshKey(k => k + 1)
  }, [daoId])

  // Timeout helper for RPC safety
  function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), ms))
    ])
  }

  useEffect(() => {
    let cancelled = false

    async function run() {
      setProviderMissing(!provider)
      setResolving(true)
      try {
        // Require a valid holder (bank or treasury)
        if (!holder || !provider || !isEthAddr(String(holder))) {
          setResolved([])
          return
        }

        const results: ResolvedToken[] = []
        const list = tokensConf.slice(0, 3)

        await Promise.all(
          list.map(async (t: any) => {
            const type: 'native' | 'erc20' = (t.type ?? (t.address ? 'erc20' : 'native')) as any
            const symbolConf = t.symbol || (type === 'native' ? 'AKE' : 'TOK')
            const decimalsConf = typeof t.decimals === 'number' ? t.decimals : 18
            const priceUsd = t.priceUsd !== undefined ? safeNum(t.priceUsd) : undefined

            try {
              if (type === 'native') {
                const bal = await withTimeout(provider.getBalance(holder))
                const human = Number(ethers.formatUnits(bal, decimalsConf))
                results.push({ type, address: '', symbol: symbolConf || 'AKE', decimals: decimalsConf, balance: human, priceUsd })
              } else {
                if (!isEthAddr(t.address || '')) throw new Error('Bad token address')
                const erc20 = new ethers.Contract(t.address, ERC20_ABI, provider)
                const [rawBal, decMaybe, symMaybe] = await Promise.all([
                  withTimeout(erc20.balanceOf(holder)),
                  t.decimals ? Promise.resolve(t.decimals) : withTimeout(erc20.decimals()).catch(() => decimalsConf),
                  t.symbol ? Promise.resolve(t.symbol) : withTimeout(erc20.symbol()).catch(() => symbolConf),
                ])
                const dec = Number(decMaybe ?? decimalsConf) || 18
                const sym = (symMaybe || symbolConf || 'TOK') as string
                const human = Number(ethers.formatUnits(rawBal, dec))
                results.push({ type, address: t.address, symbol: sym, decimals: dec, balance: human, priceUsd })
              }
            } catch {
              results.push({
                type,
                address: type === 'native' ? '' : (t.address || ''),
                symbol: symbolConf,
                decimals: decimalsConf,
                balance: NaN,
                priceUsd,
              })
            }
          })
        )

        if (!cancelled) setResolved(results)
      } finally {
        if (!cancelled) setResolving(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [holder, tokensKey, provider, refreshKey, daoId])   // 👈 depend on holder now

  const totals = useMemo(() => {
    const totalUsd = resolved.reduce((sum, r) => {
      const v = Number.isFinite(r.balance) && r.priceUsd ? r.balance * r.priceUsd : 0
      return sum + v
    }, 0)
    return { totalUsd, count: resolved.length }
  }, [resolved])

  const canAddMore = (tokensConf?.length ?? 0) < 3

  function resetForm(preset?: Partial<TokenForm>) {
    setForm({ isNative: false, address: '', symbol: '', decimals: '18', priceUsd: '', ...preset })
  }
  function beginAdd() { setActionError(null); resetForm(); setEditingIndex('new'); setConfirmDeleteIdx(null) }
  function beginTrackAKE() { setActionError(null); resetForm({ isNative: true, symbol: 'AKE', decimals: '18' }); setEditingIndex('new'); setConfirmDeleteIdx(null) }
  function beginTrackVoteToken() {
    if (!current?.votesToken) { setActionError('This DAO has no votesToken set.'); return }
    if (!isEthAddr(current.votesToken)) { setActionError('votesToken is not a valid 0x address.'); return }
    setActionError(null); resetForm({ isNative: false, address: current.votesToken, symbol: 'VOTE', decimals: '18' })
    setEditingIndex('new'); setConfirmDeleteIdx(null)
  }
  function beginEdit(i: number) {
    const t = tokensConf[i]
    const type = (t?.type ?? (t?.address ? 'erc20' : 'native')) as 'native' | 'erc20'
    resetForm({
      isNative: type === 'native',
      address: t?.address || '',
      symbol: t?.symbol || (type === 'native' ? 'AKE' : ''),
      decimals: String(typeof t?.decimals === 'number' ? t.decimals : 18),
      priceUsd: t?.priceUsd != null ? String(t.priceUsd) : '',
    })
    setEditingIndex(i)
    setConfirmDeleteIdx(null)
  }

  async function onRemove(i: number) {
    if (!current) return
    setActionError(null)
    try {
      const next = tokensConf.filter((_: any, idx: number) => idx !== i)
      setUpdating(true)
      await updateDAOTrackedTokens(current.id, next as any)
      setConfirmDeleteIdx(null)
    } catch (e: any) {
      setActionError(e?.message || 'Failed to remove token.')
    } finally {
      setUpdating(false)
    }
  }

  function validateForm(): string | null {
    if (!form.isNative && !isEthAddr(form.address.trim())) return 'Please provide a valid 0x token address.'
    if (!form.symbol.trim()) return 'Symbol is required.'
    if (!/^\d+$/.test(form.decimals.trim())) return 'Decimals must be a whole number.'
    if (!holder || !isEthAddr(String(holder))) return 'DAO bank/treasury address is not set.'
    return null
  }

  async function onSave() {
    if (!current) return
    const err = validateForm()
    if (err) { setActionError(err); return }
    setActionError(null)
    try {
      const entry = form.isNative
        ? { type: 'native' as const, symbol: form.symbol.trim(), decimals: Number(form.decimals.trim()) }
        : { type: 'erc20' as const, address: form.address.trim(), symbol: form.symbol.trim(), decimals: Number(form.decimals.trim()) }
      if (form.priceUsd) (entry as any).priceUsd = form.priceUsd.trim()

      // Deduplicate: only one native; erc20 by address
      const existing = tokensConf.filter((t: any) => {
        const tType = t.type ?? (t.address ? 'erc20' : 'native')
        if (entry.type === 'native') return tType !== 'native'
        return !(tType === 'erc20' && (t.address || '').toLowerCase() === (entry as any).address.toLowerCase())
      })

      let next = existing
      if (editingIndex === 'new') next = [entry, ...existing]
      else if (typeof editingIndex === 'number') { next = [...existing]; next.splice(editingIndex, 0, entry) }
      if (next.length > 3) next = next.slice(0, 3)

      setUpdating(true)
      await updateDAOTrackedTokens(current.id, next as any)
      setEditingIndex(null)
      setRefreshKey((k) => k + 1)
    } catch (e: any) {
      setActionError(e?.message || 'Failed to save token.')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="card p-6 animate-pulse">
          <div className="h-6 w-32 bg-brand-line/50 rounded mb-2" />
          <div className="h-4 w-72 bg-brand-line/40 rounded" />
        </div>
      </div>
    )
  }
  if (!current) {
    return (
      <div className="space-y-6">
        <div className="card p-6">
          <h1 className="text-2xl font-semibold">Treasury</h1>
          <div className="mt-2 text-slate">Select a DAO to view its treasury.</div>
        </div>
      </div>
    )
  }

  const invalidHolder = !!holder && !isEthAddr(String(holder))

  return (
    <div className="space-y-6">
      {(!provider || providerMissing || invalidHolder || !holder) && (
        <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm flex items-center gap-2">
          <AlertTriangle size={16} />
          {(!provider || providerMissing)
            ? <>Unable to create a read-only RPC provider from <code>CHAIN.rpcUrl</code>. Check your RPC endpoint.</>
            : !holder
              ? <>DAO bank/treasury address is not set.</>
              : invalidHolder
                ? <>Funds holder looks invalid: <code className="font-mono">{String(holder)}</code></>
                : null
          }
        </div>
      )}

      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Treasury</h1>
            <div className="mt-2 text-slate break-words">
              Treasury (timelock):{' '}
              <span className="font-mono break-all">{treasury ? treasury : '—'}</span>
            </div>
            <div className="mt-1 text-slate break-words">
              Bank (accounts):{' '}
              <span className="font-mono break-all">{bank ? bank : '—'}</span>
            </div>
            {isAdmin && !bank && (
              <div className="mt-2 text-xs text-slate flex items-center gap-2">
                <AlertTriangle size={13} />
                <span>
                  No bank created yet. In v2, you&apos;ll be able to deploy a DAO Bank directly from here.
                </span>
              </div>
            )}
            {isAdmin && bank && (
              <div className="mt-2 inline-flex items-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <Check size={12} className="mr-1" /> Bank active (balances below use the bank contract)
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && !bank && (
              <button
                className="btn opacity-60 cursor-not-allowed"
                disabled
                title="Coming in v2 – you already created the bank manually."
              >
                <Banknote size={16} className="mr-2" /> Create DAO Bank
              </button>
            )}
            <button className="btn" onClick={() => setRefreshKey(k => k + 1)} disabled={resolving}>
              <RotateCw size={16} className="mr-2" /> {resolving ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={<Banknote size={18} />}
          label="Total Value (USD)"
          value={fmtUsd(totals.totalUsd)}
          sub={resolved.length ? 'Across tracked tokens' : 'No tokens tracked'}
        />
        <StatCard
          icon={<Coins size={18} />}
          label="Tracked Tokens"
          value={`${resolved.length} / 3`}
          sub="Max 3"
        />
        <StatCard
          icon={<Wallet2 size={18} />}
          label={bank ? 'Bank Address' : 'Treasury Address'}          // 👈 dynamic label
          value={holder ? shortAddr(holder) : '—'}
          sub={bank ? 'Bank contract (community funds)' : 'Timelock treasury'}
        />
      </div>

      {actionError && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {actionError}
        </div>
      )}

      {/* Manage tokens */}
      <motion.section
        className="card p-5"
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-xl font-semibold">Tracked assets</h2>
          {isAdmin && (
            <AuthInline action="manage Assets" compact>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <button className="btn" onClick={beginTrackAKE} disabled={updating || !canAddMore}>
                  <Droplets size={16} className="mr-2" /> Track AKE (native)
                </button>
                <button className="btn" onClick={beginTrackVoteToken} disabled={updating || !canAddMore}>
                  <PlusCircle size={16} className="mr-2" /> Track vote token
                </button>
                <button className="btn" onClick={beginAdd} disabled={updating || !canAddMore}>
                  <PlusCircle size={16} className="mr-2" /> Add token
                </button>
              </div>
            </AuthInline>
          )}
        </div>

        {!canAddMore && (
          <div className="mt-3 text-xs text-slate">
            Limit reached (3). Edit or remove a token to add another.
          </div>
        )}

        {/* Inline editor */}
        {isAdmin && editingIndex !== null && (
          <div className="mt-4 border rounded-xl p-4 bg-brand-bg">
            <div className="grid md:grid-cols-6 gap-3">
              <div className="md:col-span-2 flex items-center gap-2">
                <input
                  id="isNative"
                  type="checkbox"
                  className="w-4 h-4"
                  checked={form.isNative}
                  onChange={(e) =>
                    setForm(f => ({ ...f, isNative: e.target.checked, address: e.target.checked ? '' : f.address }))
                  }
                />
                <label htmlFor="isNative" className="text-sm">Native token (AKE)</label>
              </div>

              {!form.isNative && (
                <div className="md:col-span-3">
                  <div className="label">Token address</div>
                  <input
                    className="input font-mono"
                    placeholder="0x…"
                    value={form.address}
                    onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                  />
                </div>
              )}

              <div>
                <div className="label">Symbol</div>
                <input
                  className="input"
                  placeholder={form.isNative ? 'AKE' : 'USDC'}
                  value={form.symbol}
                  onChange={(e) => setForm(f => ({ ...f, symbol: e.target.value }))}
                />
              </div>

              <div>
                <div className="label">Decimals</div>
                <input
                  className="input"
                  placeholder="18"
                  value={form.decimals}
                  onChange={(e) => setForm(f => ({ ...f, decimals: e.target.value }))}
                />
              </div>

              <div>
                <div className="label">Price (USD)</div>
                <input
                  className="input"
                  placeholder="optional"
                  value={form.priceUsd}
                  onChange={(e) => setForm(f => ({ ...f, priceUsd: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button className="btn-cta inline-flex items-center" onClick={onSave} disabled={updating}>
                <Check size={16} className="mr-2" /> {updating ? 'Saving…' : 'Save'}
              </button>
              <button className="btn inline-flex items-center" onClick={() => setEditingIndex(null)} disabled={updating}>
                <X size={16} className="mr-2" /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {resolved.length === 0 ? (
          <div className="mt-4 text-slate text-sm">
            Nothing tracked yet. Use <strong>Track AKE (native)</strong> for your network’s base asset,
            <strong> Track vote token</strong> for the DAO’s governance token, or
            <strong> Add token</strong> to track any ERC-20 by address.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate">
                <tr className="border-b border-brand-line">
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Token</th>
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3 text-right">Balance</th>
                  <th className="py-2 pr-3 text-right">Price (USD)</th>
                  <th className="py-2 pr-3 text-right">Value (USD)</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((r, i) => {
                  const valueUsd = Number.isFinite(r.balance) && r.priceUsd ? r.balance * r.priceUsd : NaN
                  return (
                    <tr key={`${r.symbol}-${r.address || 'native'}-${i}`} className="border-b border-brand-line/70">
                      <td className="py-3 pr-3">{r.type === 'native' ? 'Native' : 'ERC-20'}</td>
                      <td className="py-3 pr-3 font-medium">{r.symbol}</td>
                      <td className="py-3 pr-3 font-mono">
                        {r.type === 'native' ? '—' : (r.address ? shortAddr(r.address) : '—')}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {resolving ? '…' : Number.isFinite(r.balance) ? r.balance.toLocaleString() : '—'}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {r.priceUsd != null && !Number.isNaN(r.priceUsd) ? fmtUsd(r.priceUsd) : '—'}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {resolving ? '…' : Number.isFinite(valueUsd) ? fmtUsd(valueUsd) : '—'}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {isAdmin && (
                          <div className="inline-flex items-center gap-2">
                            <button className="btn" onClick={() => beginEdit(i)} disabled={updating}>
                              <Pencil size={14} className="mr-1" /> Edit
                            </button>
                            {confirmDeleteIdx === i ? (
                              <button
                                className="btn bg-red-600 text-white"
                                onClick={() => onRemove(i)}
                                disabled={updating}
                              >
                                Confirm
                              </button>
                            ) : (
                              <button
                                className="btn"
                                onClick={() => setConfirmDeleteIdx(i)}
                                disabled={updating}
                              >
                                <Trash2 size={14} className="mr-1" /> Remove
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-3 pr-3 font-semibold" colSpan={5}>Total</td>
                  <td className="py-3 pr-3 text-right font-semibold">{fmtUsd(totals.totalUsd)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </motion.section>
    </div>
  )
}

/* --- helpers --- */
function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <motion.div
      className="card p-4"
      whileHover={{ y: -2, boxShadow: '0 16px 40px rgba(15,23,42,0.12)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <div className="text-slate text-xs flex items-center gap-2">{icon} {label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {!!sub && <div className="mt-2 text-xs text-slate">{sub}</div>}
    </motion.div>
  )
}
