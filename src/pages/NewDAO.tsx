// src/pages/NewDAO.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createDAO } from '../lib/firebase'
import { useDAO } from '../lib/dao'
import { CHAIN } from '../lib/chain'
import { useAuth } from 'amvault-connect'
import { deployDAO_viaFactory } from '../lib/daoDeploy'
import { parseEther } from 'ethers'

type Form = {
    address: string      // DAO (manual path only)
    treasury: string     // Treasury (manual path only)
    name: string
    about: string
    daoImpl: string      // display-only (from env)
    treasImpl: string    // display-only (from env)
    admin: string
    votesToken: string
    votingDelayBlocks: string
    votingPeriodBlocks: string
    timelockDelaySeconds: string
    quorumBps: string
    deployNow: boolean
    minBondAKE: string
}

const FACTORY_ADDR = String(import.meta.env.VITE_AMID_DAO_FACTORY || '').trim()
const DAO_IMPL_DEFAULT = String(import.meta.env.VITE_AMID_DAO_IMPL || '').trim()
const TREAS_IMPL_DEFAULT = String(import.meta.env.VITE_AMID_TREAS_IMPL || '').trim()

const initial: Form = {
    address: '',
    treasury: '',
    name: '',
    about: '',
    daoImpl: DAO_IMPL_DEFAULT,
    treasImpl: TREAS_IMPL_DEFAULT,
    admin: '',
    votesToken: '',
    votingDelayBlocks: '12',
    votingPeriodBlocks: '43200',
    timelockDelaySeconds: String(48 * 3600),
    quorumBps: '1000',
    deployNow: true,
    minBondAKE: '0.10',
}

function isHexAddress(v: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(v.trim())
}

export default function NewDAO() {
    const nav = useNavigate()
    const { setCurrent } = useDAO()
    const { session } = useAuth()

    const [f, setF] = useState<Form>(initial)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [stage, setStage] = useState<string>('')

    const update =
        (k: keyof Form) =>
            (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setF((s) => ({
                    ...s,
                    [k]:
                        e.target.type === 'checkbox'
                            ? (e.target as HTMLInputElement).checked
                            : e.target.value,
                }))

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        // Basic validation
        if (!f.name.trim()) return setError('Name is required.')
        if (!isHexAddress(f.admin)) return setError('Admin must be a valid EVM address.')
        if (!isHexAddress(f.votesToken)) return setError('Votes token must be a valid EVM address.')

        const votingDelayBlocks = Number(f.votingDelayBlocks)
        const votingPeriodBlocks = Number(f.votingPeriodBlocks)
        const timelockDelaySeconds = Number(f.timelockDelaySeconds)
        const quorumBps = Number(f.quorumBps)
        let minBondWei: bigint

        if ([votingDelayBlocks, votingPeriodBlocks, timelockDelaySeconds, quorumBps].some((n) => Number.isNaN(n) || n < 0)) {
            return setError('Numeric fields must be non-negative.')
        }
        if (quorumBps > 10000) return setError('quorumBps is basis points (0–10000).')

        try {
            minBondWei = parseEther((f.minBondAKE || '0').trim())
        } catch {
            return setError('Minimum bond must be a valid number (AKE).')
        }

        setSaving(true)
        setStage('')

        try {
            let daoAddr = f.address.trim()
            let treasAddr = f.treasury.trim()

            if (f.deployNow) {
                if (!session?.address) {
                    setSaving(false)
                    return setError('Please connect AmVault first.')
                }
                if (!isHexAddress(FACTORY_ADDR)) {
                    setSaving(false)
                    return setError('Factory address missing/invalid (VITE_AMID_DAO_FACTORY).')
                }

                // Open popup in the user gesture path (before any await)
                //const popup = preOpenAmvaultPopup()
                try {
                    setStage('Creating DAO via Factory (single tx)…')

                    const out = await deployDAO_viaFactory(
                        {
                            factory: FACTORY_ADDR,
                            admin: f.admin.trim(),
                            votesToken: f.votesToken.trim(),
                            minBondWei,
                            votingDelayBlocks,
                            votingPeriodBlocks,
                            timelockDelaySeconds,
                            quorumBps,
                            deterministic: false,   // add a UI toggle + salt if you want deterministic addresses
                            gasLimit: 900_000,
                        },
                        { timeoutMs: 120_000 }
                    )

                    daoAddr = out.dao
                    treasAddr = out.treasury
                    setStage('On-chain deploy complete. Saving DAO…')
                } finally {
                }
            } else {
                // Manual addresses path
                if (!isHexAddress(daoAddr)) return setError('Enter a valid DAO address or choose “Deploy on chain now”.')
                if (!isHexAddress(treasAddr)) return setError('Enter a valid Treasury address or choose “Deploy on chain now”.')
            }

            // Save to Firebase
            const { id } = await createDAO({
                address: daoAddr,
                name: f.name.trim(),
                about: f.about.trim(),
                daoImpl: f.daoImpl.trim(),       // display/record only; factory already knows impls
                treasImpl: f.treasImpl.trim(),   // display/record only
                admin: f.admin.trim(),
                votesToken: f.votesToken.trim(),
                votingDelayBlocks,
                votingPeriodBlocks,
                timelockDelaySeconds,
                quorumBps,
                treasury: treasAddr,
                chainId: CHAIN.id,
            } as any)

            // Cache locally and navigate
            setCurrent({
                id,
                address: daoAddr,
                name: f.name.trim(),
                about: f.about.trim(),
                daoImpl: f.daoImpl.trim(),
                treasImpl: f.treasImpl.trim(),
                admin: f.admin.trim(),
                votesToken: f.votesToken.trim(),
                votingDelayBlocks,
                votingPeriodBlocks,
                timelockDelaySeconds,
                quorumBps,
            } as any)

            nav('/', { replace: true })
        } catch (e: any) {
            setError(e?.message || 'Failed to create DAO.')
        } finally {
            setSaving(false)
            setStage('')
        }
    }

    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-semibold">Create a new DAO</h1>
            <p className="text-slate">Deploy your DAO on the Alkebuleum network and save it to uGov.</p>

            {error && (
                <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm">
                    {error}
                </div>
            )}
            {stage && (
                <div className="p-3 rounded-xl border border-brand-line bg-brand-line/30 text-sm">
                    {stage}
                </div>
            )}

            <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={onSubmit}>
                {/* Basics */}
                <div className="md:col-span-2 card p-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="label">Display name</label>
                            <input
                                className="input"
                                value={f.name}
                                onChange={update('name')}
                                placeholder="e.g., Core DAO"
                            />
                        </div>
                        <div>
                            <label className="label">About</label>
                            <input
                                className="input"
                                value={f.about}
                                onChange={update('about')}
                                placeholder="Short description…"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="label inline-flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    className="rounded"
                                    checked={f.deployNow}
                                    onChange={update('deployNow')}
                                />
                                Deploy on chain now
                            </label>

                            {!f.deployNow && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                                    <div>
                                        <label className="label">DAO address</label>
                                        <input
                                            className="input"
                                            value={f.address}
                                            onChange={update('address')}
                                            placeholder="0x…"
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Treasury address</label>
                                        <input
                                            className="input"
                                            value={f.treasury}
                                            onChange={update('treasury')}
                                            placeholder="0x…"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Contracts */}
                <div className="card p-5">
                    <h3 className="font-semibold mb-3">Contracts</h3>
                    <div className="space-y-3">
                        <div>
                            <label className="label">Admin</label>
                            <input
                                className="input"
                                value={f.admin}
                                onChange={update('admin')}
                                placeholder="0x…"
                            />
                        </div>
                        <div>
                            <label className="label">Votes token</label>
                            <input
                                className="input"
                                value={f.votesToken}
                                onChange={update('votesToken')}
                                placeholder="0x…"
                            />
                        </div>
                        {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="label">DAO implementation (from env)</label>
                                <input
                                    className="input opacity-60"
                                    value={f.daoImpl}
                                    onChange={update('daoImpl')}
                                    placeholder="0x…"
                                    readOnly
                                />
                            </div>
                            <div>
                                <label className="label">Treasury implementation (from env)</label>
                                <input
                                    className="input opacity-60"
                                    value={f.treasImpl}
                                    onChange={update('treasImpl')}
                                    placeholder="0x…"
                                    readOnly
                                />
                            </div>
                        </div> */}
                        {/*   <div>
                            <label className="label">Factory (from env)</label>
                            <input
                                className="input opacity-60"
                                value={FACTORY_ADDR}
                                readOnly
                            />
                        </div> */}
                    </div>
                </div>

                {/* Governance params */}
                <div className="card p-5">
                    <h3 className="font-semibold mb-3">Governance parameters</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="label">Voting delay (blocks)</label>
                            <input
                                className="input"
                                value={f.votingDelayBlocks}
                                onChange={update('votingDelayBlocks')}
                                inputMode="numeric"
                            />
                        </div>
                        <div>
                            <label className="label">Voting period (blocks)</label>
                            <input
                                className="input"
                                value={f.votingPeriodBlocks}
                                onChange={update('votingPeriodBlocks')}
                                inputMode="numeric"
                            />
                        </div>
                        <div>
                            <label className="label">Timelock delay (seconds)</label>
                            <input
                                className="input"
                                value={f.timelockDelaySeconds}
                                onChange={update('timelockDelaySeconds')}
                                inputMode="numeric"
                            />
                        </div>
                        <div>
                            <label className="label">Quorum (bps)</label>
                            <input
                                className="input"
                                value={f.quorumBps}
                                onChange={update('quorumBps')}
                                inputMode="numeric"
                                placeholder="e.g., 4000 = 40%"
                            />
                        </div>
                        <div>
                            <label className="label">Minimum bond (AKE)</label>
                            <input
                                className="input"
                                value={f.minBondAKE}
                                onChange={update('minBondAKE')}
                                inputMode="decimal"
                                placeholder="e.g., 0.10"
                            />
                        </div>
                    </div>
                </div>

                <div className="md:col-span-2 flex items-center gap-2">
                    <button className="btn-cta" type="submit" disabled={saving}>
                        {saving ? 'Working…' : f.deployNow ? 'Deploy & Create' : 'Create DAO'}
                    </button>
                    <button type="button" className="btn" onClick={() => nav(-1)} disabled={saving}>
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    )
}
