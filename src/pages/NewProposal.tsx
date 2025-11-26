import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createProposal, updateProposal } from '../lib/firebase'
import { useRequireAuth } from '../lib/requireAuth'
import { useDAO } from '../lib/dao'
import Markdown from '../lib/markdown'
import { reserveDraftOnchain, computeOffchainRef, computeDescriptionHash } from '../lib/daoProposals'

const BANK_ACTIONS = [
  { value: 'SPEND', label: 'Spend from bank account' },
  { value: 'CONFIG', label: 'Update account / settings' },
  { value: 'CREATE', label: 'Create new bank account(s)' },
  { value: 'CLOSE', label: 'Close bank account' },
] as const

type BankAction = (typeof BANK_ACTIONS)[number]['value']

type BankNewAccountRow = {
  account: string   // id / name
  asset: string
  note: string
}

const MAX_BANK_NEW_ACCOUNTS = 5

type FormState = {
  title: string
  summary: string
  category: 'BUDGET' | 'VOTING_CONFIG' | 'SET_ADMIN' | 'SET_VOTE_TOKEN' | 'EMERGENCY_CANCEL' | 'BANK'
  tags: string
  body: string

  // BUDGET
  budgetAmount?: string
  budgetAsset?: string
  recipient?: string

  // VOTING_CONFIG
  votingDelayBlocks?: string
  votingPeriodBlocks?: string
  quorumBps?: string
  treasuryTimelockSec?: string

  // SET_ADMIN
  newAdmin?: string

  // SET_VOTE_TOKEN
  newToken?: string

  // EMERGENCY_CANCEL
  cancelTargetId?: string

  // BANK (single-action fields)
  bankAction?: BankAction
  bankAccount?: string
  bankAmount?: string
  bankAsset?: string
  bankRecipient?: string
  bankNote?: string

  // BANK (multi-create)
  bankNewAccounts: BankNewAccountRow[]

  // meta
  references?: string
  discussionUrl?: string
}






const UI_CATEGORIES = [
  { code: 'BUDGET', label: 'Treasury Transfer' },
  { code: 'VOTING_CONFIG', label: 'Change Voting Rules' },
  { code: 'SET_ADMIN', label: 'Rotate Admin' },
  { code: 'SET_VOTE_TOKEN', label: 'Change Vote Token' },
  { code: 'EMERGENCY_CANCEL', label: 'Emergency Cancellation' },
  { code: 'BANK', label: 'DAO Bank (spend / accounts)' },      // 👈 NEW
] as const
type CategoryCode = (typeof UI_CATEGORIES)[number]['code']

const ASSETS = ['AKE', 'MAH', 'USDC', 'ETH'] as const

const MAX_TITLE = 120
const MAX_SUMMARY = 300

const isNonEmpty = (v?: string) => v != null && String(v).trim() !== '';
const numOrUndef = (v?: string) => (isNonEmpty(v) ? Number(v) : undefined);

const isEthAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s)
function isHex(s: string) {
  return /^0x[0-9a-fA-F]*$/.test(s)
}
const shortAddr = (a?: string, lead = 6, tail = 4) =>
  !a ? 'Anon' : a.slice(0, lead) + '…' + a.slice(-tail)


function stripAutoHeader(full?: string): string {
  if (!full) return ''
  const lines = full.split('\n')

  // We only strip if it *looks* like our auto header: "# Title" on first line
  const first = lines[0] || ''
  if (!first.startsWith('# ')) return full

  // Find first completely blank line after header block
  const blankIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '')
  if (blankIdx === -1) return full

  // Everything after that blank line is treated as the real body
  return lines.slice(blankIdx + 1).join('\n')
}


export default function NewProposal() {
  const { session, status } = useRequireAuth()
  const { current } = useDAO()
  const nav = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const loc = useLocation() as any

  const prefill = (loc as any)?.state?.prefill || {};
  const editId = (prefill?.proposalId as string | undefined) || undefined
  const isEditMode = !!editId
  const reservedId = prefill.reservedId;

  useEffect(() => {
    const pf = (loc as any)?.state?.prefill
    if (!pf) return

    setForm(f => ({
      ...f,
      // use category from prefill if provided, otherwise keep current
      ...(pf.category ? { category: pf.category as CategoryCode } : {}),

      // core fields
      title: pf.title ?? f.title,
      summary: pf.summary ?? f.summary,
      tags: pf.tags ?? f.tags,
      body: pf.body ? stripAutoHeader(pf.body) : f.body,

      // Budget
      budgetAmount:
        pf.budget?.amount != null
          ? String(pf.budget.amount)
          : f.budgetAmount,
      budgetAsset: pf.budget?.asset ?? f.budgetAsset,
      recipient: pf.budget?.recipient ?? f.recipient,

      // Voting config
      votingDelayBlocks:
        pf.votingDelayBlocks != null
          ? String(pf.votingDelayBlocks)
          : f.votingDelayBlocks,
      votingPeriodBlocks:
        pf.votingPeriodBlocks != null
          ? String(pf.votingPeriodBlocks)
          : f.votingPeriodBlocks,
      quorumBps:
        pf.quorumBps != null ? String(pf.quorumBps) : f.quorumBps,
      treasuryTimelockSec:
        pf.treasuryTimelockSec != null
          ? String(pf.treasuryTimelockSec)
          : f.treasuryTimelockSec,

      // Other action payloads
      newAdmin: pf.newAdmin ?? f.newAdmin,
      newToken: pf.newToken ?? f.newToken,
      cancelTargetId: pf.cancelTargetId ?? f.cancelTargetId,

      // BANK (multi-create)
      bankNewAccounts:
        Array.isArray(pf.bank?.createAccounts) && pf.bank.createAccounts.length
          ? pf.bank.createAccounts.map((r: any) => ({
            account: r.account ?? '',
            asset: r.asset ?? ASSETS[0],
            note: r.note ?? '',
          }))
          : (f.bankNewAccounts?.length
            ? f.bankNewAccounts
            : [{ account: '', asset: ASSETS[0], note: '' }]),


      // meta
      discussionUrl: pf.discussionUrl ?? f.discussionUrl,
      references: pf.references ?? f.references,
    }))

    if (history.replaceState) {
      history.replaceState({}, document.title, location.pathname)
    }
  }, [loc])




  // Autosave per-DAO
  const STORAGE_KEY = useMemo(() => `ugov.draft.${current?.id ?? 'unknown'}`, [current?.id])
  const [form, setForm] = useState<FormState>(() => {
    const base: FormState = {
      title: '',
      summary: '',
      category: 'BUDGET',
      tags: '',
      body: '',
      // sensible defaults
      budgetAmount: '',
      budgetAsset: ASSETS[0],
      recipient: '',
      votingDelayBlocks: '',
      votingPeriodBlocks: '',
      quorumBps: '',
      treasuryTimelockSec: '',
      newAdmin: '',
      newToken: '',
      references: '',
      discussionUrl: '',
      cancelTargetId: '',

      // BANK
      bankAction: undefined,
      bankAccount: '',
      bankAmount: '',
      bankAsset: ASSETS[0],
      bankRecipient: '',
      bankNote: '',
      bankNewAccounts: [
        { account: '', asset: ASSETS[0], note: '' },
      ],
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? { ...base, ...(JSON.parse(raw) as FormState) } : base
    } catch {
      return base
    }
  })

  const fmtDurationSec = (s?: string) => {
    const n = Number(s || 0)
    if (!n || isNaN(n)) return '0s'
    const d = Math.floor(n / 86400)
    const h = Math.floor((n % 86400) / 3600)
    const m = Math.floor((n % 3600) / 60)
    const parts = []
    if (d) parts.push(`${d}d`)
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}m`)
    if (parts.length === 0) parts.push(`${n}s`)
    return `${parts.join(' ')} (${n}s)`
  }




  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
  }, [STORAGE_KEY, form])

  // Cmd/Ctrl+Enter submit
  const formRef = useRef<HTMLFormElement | null>(null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') formRef.current?.requestSubmit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (status !== 'ready') return <div className="text-slate">Checking session…</div>
  if (!session) return null
  if (!current) {
    return (
      <div className="card p-6 max-w-2xl">
        <h2 className="text-xl font-semibold mb-2">No DAO selected</h2>
        <p className="text-slate">Select or create a DAO before creating a proposal.</p>
      </div>
    )
  }

  // Category flags
  const isBudget = form.category === 'BUDGET'
  const isVotingCfg = form.category === 'VOTING_CONFIG'
  const isSetAdmin = form.category === 'SET_ADMIN'
  const isSetVoteToken = form.category === 'SET_VOTE_TOKEN'
  const isEmergencyCancel = form.category === 'EMERGENCY_CANCEL'
  const isBank = form.category === 'BANK'


  function validate(): string | null {
    if (!form.title.trim()) return 'Title is required.'
    if (form.title.length > MAX_TITLE) return `Title must be ≤ ${MAX_TITLE} characters.`
    if (!form.summary.trim()) return 'Short summary is required.'
    if (form.summary.length > MAX_SUMMARY) return `Summary must be ≤ ${MAX_SUMMARY} characters.`
    if (!form.body.trim()) return 'Description is required.'

    if (isBudget) {
      if (!form.budgetAmount?.trim()) return 'Budget amount is required.'
      if (isNaN(Number(form.budgetAmount))) return 'Budget amount must be a number.'
      if (!form.budgetAsset?.trim()) return 'Please choose an asset.'
      if (!form.recipient?.trim()) return 'Recipient address is required.'
      if (!isEthAddr(form.recipient.trim())) return 'Recipient must be a valid 0x address.'
    }

    if (isBank) {
      if (!form.bankAction) return 'Select a bank action (spend / update / create / close).'

      if (form.bankAction === 'SPEND') {
        if (!form.bankAccount?.trim()) return 'Bank account is required.'
        if (!form.bankAmount?.trim()) return 'Bank amount is required.'
        if (isNaN(Number(form.bankAmount))) return 'Bank amount must be a number.'
        if (!form.bankAsset?.trim()) return 'Please choose a bank asset.'
        if (!form.bankRecipient?.trim()) return 'Bank recipient address is required.'
        if (!isEthAddr(form.bankRecipient.trim())) return 'Bank recipient must be a valid 0x address.'
      }

      if (form.bankAction === 'CONFIG') {
        if (!form.bankAccount?.trim()) return 'Bank account is required for configuration.'
        if (!form.bankNote?.trim()) return 'Describe the bank account update.'
      }

      if (form.bankAction === 'CLOSE') {
        if (!form.bankAccount?.trim()) return 'Bank account is required to close.'
      }

      if (form.bankAction === 'CREATE') {
        const rows = form.bankNewAccounts || []
        const used = rows.filter(r => r.account.trim())
        if (!used.length) return 'Add at least one bank account to create.'
        if (used.length > MAX_BANK_NEW_ACCOUNTS) {
          return `You can create at most ${MAX_BANK_NEW_ACCOUNTS} accounts per proposal.`
        }
        const badAsset = used.find(r => !r.asset?.trim())
        if (badAsset) return 'Each new account must have an asset selected.'
      }
    }




    if (isVotingCfg) {
      if (!form.votingDelayBlocks?.trim()) return 'Voting delay (blocks) is required.'
      if (!/^\d+$/.test(form.votingDelayBlocks)) return 'Voting delay must be an integer.'
      if (!form.votingPeriodBlocks?.trim()) return 'Voting period (blocks) is required.'
      if (!/^\d+$/.test(form.votingPeriodBlocks)) return 'Voting period must be an integer.'
      if (!form.quorumBps?.trim()) return 'Quorum (bps) is required.'
      if (!/^\d+$/.test(form.quorumBps)) return 'Quorum must be basis points (e.g., 1000 = 10.00%).'
      if (!form.treasuryTimelockSec?.trim()) return 'Treasury timelock (seconds) is required.'
      if (!/^\d+$/.test(form.treasuryTimelockSec)) return 'Treasury timelock must be an integer number of seconds.'


    }

    if (isEmergencyCancel) {
      if (!form.cancelTargetId?.trim()) return 'Target proposal number is required.'
      if (!/^\d+$/.test(form.cancelTargetId.trim())) return 'Target proposal number must be an integer.'
    }


    if (isSetAdmin) {
      if (!form.newAdmin?.trim()) return 'New admin address is required.'
      if (!isEthAddr(form.newAdmin.trim())) return 'New admin must be a valid 0x address.'
    }

    if (isSetVoteToken) {
      if (!form.newToken?.trim()) return 'New vote token address is required.'
      if (!isEthAddr(form.newToken.trim())) return 'New vote token must be a valid 0x address.'
    }

    if (form.references) {
      const urls = form.references.split('\n').map(s => s.trim()).filter(Boolean)
      const bad = urls.find(u => !/^https?:\/\//i.test(u))
      if (bad) return `Reference must be a valid URL: ${bad}`
    }
    if (form.discussionUrl && !/^https?:\/\//i.test(form.discussionUrl))
      return 'Discussion URL must be a valid link.'
    return null
  }

  const previewMd = useMemo(() => {
    const refs = form.references
      ? form.references
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .map(u => `- ${u}`)
        .join('\n')
      : ''

    const header: string[] = [
      `# ${form.title || 'Untitled Proposal'}`,
      '',
      `**Category:** ${form.category}${form.tags ? `   **Tags:** ${form.tags}` : ''}`,
      form.summary ? `> ${form.summary}` : '',
    ]

    if (isBudget && form.budgetAmount) {
      header.push(`**Requested Transfer:** ${form.budgetAmount} ${form.budgetAsset}`)
      if (form.recipient) header.push(`**Recipient:** \`${form.recipient}\``)
    }

    if (isBank) {
      if (form.bankAction === 'SPEND') {
        header.push(
          `**Bank Action:** Spend ${form.bankAmount || '?'} ${form.bankAsset || ''} ` +
          `from account "${form.bankAccount || '?'}" to \`${form.bankRecipient || '0x…'}\``
        )
      } else if (form.bankAction === 'CONFIG') {
        header.push(
          `**Bank Action:** Update account "${form.bankAccount || '?'}"${form.bankNote ? ` – ${form.bankNote}` : ''
          }`
        )
      } else if (form.bankAction === 'CLOSE') {
        header.push(
          `**Bank Action:** Close account "${form.bankAccount || '?'}"`
        )
      } else if (form.bankAction === 'CREATE') {
        const used = (form.bankNewAccounts || []).filter(r => r.account.trim())
        if (used.length) {
          header.push('**Bank Action:** Create new account(s):')
          used.slice(0, MAX_BANK_NEW_ACCOUNTS).forEach((row, idx) => {
            header.push(
              `- #${idx + 1}: "${row.account}" (${row.asset || 'AKE'})${row.note ? ` – ${row.note}` : ''
              }`
            )
          })
        }
      }
    }




    if (isVotingCfg) {
      if (form.votingDelayBlocks) header.push(`**Voting Delay:** ${form.votingDelayBlocks} blocks`)
      if (form.votingPeriodBlocks) header.push(`**Voting Period:** ${form.votingPeriodBlocks} blocks`)
      if (form.quorumBps) header.push(`**Quorum:** ${(Number(form.quorumBps) / 100).toFixed(2)}%`)
      if (form.treasuryTimelockSec)
        header.push(`**Treasury Timelock:** ${fmtDurationSec(form.treasuryTimelockSec)}`)

    }
    if (isEmergencyCancel && form.cancelTargetId) {
      header.push(`**Emergency Cancel Target:** #${form.cancelTargetId}`)
    }

    if (isSetAdmin && form.newAdmin) {
      header.push(`**New Admin:** \`${form.newAdmin}\``)
    }

    if (isSetVoteToken && form.newToken) {
      header.push(`**New Vote Token:** \`${form.newToken}\``)
    }

    if (form.discussionUrl) header.push(`**Discussion:** ${form.discussionUrl}`)
    if (refs) header.push('', '**References:**', refs)

    return `${header.filter(Boolean).join('\n')}\n\n${form.body}`
  }, [form, isBudget, isVotingCfg, isSetAdmin, isSetVoteToken, isBank])



  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true)
    try {
      const category = form.category as CategoryCode

      const tagsArray = form.tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)

      const refsArray = form.references
        ? form.references.split('\n').map(s => s.trim()).filter(Boolean)
        : []

      // 🔹 EDIT MODE: update existing draft, no new on-chain reserve
      if (editId) {
        const patch: any = {
          title: form.title.trim(),
          summary: form.summary.trim(),
          category,
          tags: tagsArray,
          bodyMd: previewMd,
          discussionUrl: form.discussionUrl || null,
          references: refsArray,

          ...(category === 'BANK'
            ? {
              bank: {
                actionType: form.bankAction || null,
                account: form.bankAction === 'CREATE'
                  ? null
                  : form.bankAccount?.trim() || null,
                amount: form.bankAction === 'SPEND'
                  ? (form.bankAmount ? Number(form.bankAmount) : null)
                  : null,
                asset: form.bankAction === 'SPEND'
                  ? form.bankAsset || null
                  : null,
                recipient: form.bankAction === 'SPEND'
                  ? form.bankRecipient?.trim() || null
                  : null,
                note:
                  form.bankAction === 'CONFIG' || form.bankAction === 'CLOSE'
                    ? form.bankNote?.trim() || null
                    : null,
                createAccounts:
                  form.bankAction === 'CREATE'
                    ? (form.bankNewAccounts || [])
                      .filter(r => r.account.trim())
                      .slice(0, MAX_BANK_NEW_ACCOUNTS)
                      .map(r => ({
                        account: r.account.trim(),
                        asset: r.asset || null,
                        note: r.note?.trim() || null,
                      }))
                    : null,
              },
            }
            : { bank: null }),


          // Category-specific fields, same logic as create
          ...(category === 'BUDGET' && isNonEmpty(form.budgetAmount) && form.budgetAsset && isNonEmpty(form.recipient)
            ? {
              budget: {
                amount: Number(form.budgetAmount),
                asset: form.budgetAsset,
                recipient: form.recipient.trim(),
              },
            }
            : { budget: null }),

          ...(category === 'VOTING_CONFIG'
            ? {
              ...(numOrUndef(form.votingDelayBlocks) != null
                ? { votingDelayBlocks: numOrUndef(form.votingDelayBlocks)! }
                : {}),
              ...(numOrUndef(form.votingPeriodBlocks) != null
                ? { votingPeriodBlocks: numOrUndef(form.votingPeriodBlocks)! }
                : {}),
              ...(numOrUndef(form.quorumBps) != null
                ? { quorumBps: numOrUndef(form.quorumBps)! }
                : {}),
              ...(numOrUndef(form.treasuryTimelockSec) != null
                ? { treasuryTimelockSec: numOrUndef(form.treasuryTimelockSec)! }
                : {}),
            }
            : {}),

          ...(category === 'EMERGENCY_CANCEL' && isNonEmpty(form.cancelTargetId)
            ? { cancelTargetId: String(form.cancelTargetId) }
            : {}),

          ...(category === 'SET_ADMIN' && isNonEmpty(form.newAdmin)
            ? { newAdmin: form.newAdmin!.trim() }
            : { newAdmin: null }),

          ...(category === 'SET_VOTE_TOKEN' && isNonEmpty(form.newToken)
            ? { newToken: form.newToken!.trim() }
            : { newToken: null }),
        }

        await updateProposal(editId, patch)
        localStorage.removeItem(STORAGE_KEY)
        nav(`/proposals/${editId}`)
        return
      }

      // 🔹 CREATE MODE: original flow (reserve + create)
      const metaForRef: any = {
        dao: current.address,
        title: form.title.trim(),
        summary: form.summary.trim(),
        category: form.category,
        tags: form.tags,
        author: session.address,
        createdAt: Date.now(),
      }
      if (isBudget) {
        metaForRef.budget = {
          amount: Number(form.budgetAmount),
          asset: form.budgetAsset,
          recipient: form.recipient?.trim(),
        }
      }
      if (isBank) {
        const bankPayload: any = {
          actionType: form.bankAction,
        }

        if (form.bankAction === 'SPEND') {
          bankPayload.account = form.bankAccount?.trim() || null
          bankPayload.amount = form.bankAmount ? Number(form.bankAmount) : null
          bankPayload.asset = form.bankAsset || null
          bankPayload.recipient = form.bankRecipient?.trim() || null
          bankPayload.note = form.bankNote?.trim() || null
        } else if (form.bankAction === 'CONFIG') {
          bankPayload.account = form.bankAccount?.trim() || null
          bankPayload.note = form.bankNote?.trim() || null
        } else if (form.bankAction === 'CLOSE') {
          bankPayload.account = form.bankAccount?.trim() || null
          bankPayload.note = form.bankNote?.trim() || null
        } else if (form.bankAction === 'CREATE') {
          const rows = (form.bankNewAccounts || [])
            .filter(r => r.account.trim())
            .slice(0, MAX_BANK_NEW_ACCOUNTS)

          bankPayload.createAccounts = rows.map(r => ({
            account: r.account.trim(),
            asset: r.asset || null,
            note: r.note?.trim() || null,
          }))
        }

        metaForRef.bank = bankPayload
      }


      if (isVotingCfg) {
        metaForRef.votingDelayBlocks = Number(form.votingDelayBlocks)
        metaForRef.votingPeriodBlocks = Number(form.votingPeriodBlocks)
        metaForRef.quorumBps = Number(form.quorumBps)
        metaForRef.treasuryTimelockSec = Number(form.treasuryTimelockSec)
      }
      if (isEmergencyCancel) {
        metaForRef.cancelTargetId = Number(form.cancelTargetId)
      }
      if (isSetAdmin) metaForRef.newAdmin = form.newAdmin?.trim()
      if (isSetVoteToken) metaForRef.newToken = form.newToken?.trim()

      const offchainRef = computeOffchainRef(metaForRef)
      const descriptionHash = computeDescriptionHash(previewMd)

      let onchainLocalId: string | null = null
      try {
        const out = await reserveDraftOnchain(current.address, offchainRef, { timeoutMs: 120_000 })
        onchainLocalId = out.localId
      } finally {
      }

      await createProposal(current.id, {
        title: form.title.trim(),
        summary: form.summary.trim(),
        category,
        tags: tagsArray,
        bodyMd: previewMd,

        ...(category === 'BUDGET' && isNonEmpty(form.budgetAmount) && form.budgetAsset && isNonEmpty(form.recipient)
          ? {
            budget: {
              amount: Number(form.budgetAmount),
              asset: form.budgetAsset,
              recipient: form.recipient.trim(),
            },
          }
          : {}),
        ...(category === 'BANK'
          ? {
            bank: {
              actionType: form.bankAction || null,
              account: form.bankAccount?.trim() || null,
              amount: form.bankAmount ? Number(form.bankAmount) : null,
              asset: form.bankAsset || null,
              recipient: form.bankRecipient?.trim() || null,
              note: form.bankNote?.trim() || null,
              createAccounts:
                form.bankAction === 'CREATE'
                  ? (form.bankNewAccounts || [])
                    .filter(r => r.account.trim())
                    .slice(0, MAX_BANK_NEW_ACCOUNTS)
                    .map(r => ({
                      account: r.account.trim(),
                      asset: r.asset || null,
                      note: r.note?.trim() || null,
                    }))
                  : null,
            },
          }
          : {}),


        ...(category === 'VOTING_CONFIG'
          ? {
            ...(numOrUndef(form.votingDelayBlocks) != null
              ? { votingDelayBlocks: numOrUndef(form.votingDelayBlocks)! }
              : {}),
            ...(numOrUndef(form.votingPeriodBlocks) != null
              ? { votingPeriodBlocks: numOrUndef(form.votingPeriodBlocks)! }
              : {}),
            ...(numOrUndef(form.quorumBps) != null ? { quorumBps: numOrUndef(form.quorumBps)! } : {}),
            ...(numOrUndef(form.treasuryTimelockSec) != null
              ? { treasuryTimelockSec: numOrUndef(form.treasuryTimelockSec)! }
              : {}),
          }
          : {}),

        ...(category === 'EMERGENCY_CANCEL' && isNonEmpty(form.cancelTargetId)
          ? { cancelTargetId: Number(form.cancelTargetId) }
          : {}),

        ...(category === 'SET_ADMIN' && isNonEmpty(form.newAdmin) ? { newAdmin: form.newAdmin!.trim() } : {}),
        ...(category === 'SET_VOTE_TOKEN' && isNonEmpty(form.newToken) ? { newToken: form.newToken!.trim() } : {}),

        daoAddress: current.address,
        ...(offchainRef ? { offchainRef: offchainRef as `0x${string}` } : {}),
        descriptionHash: null, // you can switch to descriptionHash later if you want
        ...(onchainLocalId ? { reservedId: onchainLocalId } : {}),
        onchainReserved: true,

        discussionUrl: form.discussionUrl || null,
        references: refsArray,

        author: {
          name: session.ain,
          address: session.address,
          avatar: Math.max(1, (parseInt((session.address || '0x0').slice(2, 10), 16) % 4) + 1),
        },
        daoName: current.name ?? null,
      })

      localStorage.removeItem(STORAGE_KEY)
      nav('/proposals')
    } catch (err: any) {
      console.error('[proposal:create] failed:', err)
      setError(err?.message || 'Submission failed.')
    } finally {
      setLoading(false)
    }
  }


  const titleCount = `${form.title.length}/${MAX_TITLE}`
  const summaryCount = `${form.summary.length}/${MAX_SUMMARY}`

  return (
    <div className="card p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">
          {isEditMode ? 'Edit Proposal' : 'Create Proposal'}
        </h1>
        <div className="text-xs text-slate-500">Draft autosaved • Cmd/Ctrl+Enter to publish</div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <form ref={formRef} className="space-y-5" onSubmit={onSubmit}>
        {/* Title */}
        <div>
          <div className="label flex items-center justify-between">
            <span>Title</span>
            <span className="text-xs text-slate-500">{titleCount}</span>
          </div>
          <input
            className="input"
            placeholder="Proposal title"
            value={form.title}
            maxLength={MAX_TITLE}
            onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
            required
          />
        </div>

        {/* Summary */}
        <div>
          <div className="label flex items-center justify-between">
            <span>Short Summary</span>
            <span className="text-xs text-slate-500">{summaryCount}</span>
          </div>
          <textarea
            className="textarea"
            placeholder="One-paragraph summary (what / why / impact)"
            value={form.summary}
            maxLength={MAX_SUMMARY}
            onChange={(e) => setForm(f => ({ ...f, summary: e.target.value }))}
            required
          />
        </div>

        {/* Category + Tags */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="label">Category</div>
            <select
              className="select"
              value={form.category as CategoryCode}
              onChange={(e) => setForm(f => ({ ...f, category: e.target.value as CategoryCode }))}
            >
              {UI_CATEGORIES.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="label">Tags (comma-separated)</div>
            <input
              className="input"
              placeholder="eg. foundation, launch, governance"
              value={form.tags}
              onChange={(e) => setForm(f => ({ ...f, tags: e.target.value }))}
            />
          </div>
        </div>

        {/* --------- Category-specific blocks --------- */}

        {/* BUDGET */}
        {isBudget && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="label">Amount</div>
              <input
                className="input"
                placeholder="e.g., 10000"
                value={form.budgetAmount}
                onChange={(e) => setForm(f => ({ ...f, budgetAmount: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Asset</div>
              <select
                className="select"
                value={form.budgetAsset}
                onChange={(e) => setForm(f => ({ ...f, budgetAsset: e.target.value }))}
              >
                {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <div className="label">Recipient Address</div>
              <input
                className="input font-mono"
                placeholder="0x…"
                value={form.recipient}
                onChange={(e) => setForm(f => ({ ...f, recipient: e.target.value }))}
              />
            </div>
          </div>
        )}

        {/* VOTING_CONFIG */}
        {isVotingCfg && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <div className="label">Voting Delay (blocks)</div>
              <input
                className="input"
                placeholder="e.g., 20"
                value={form.votingDelayBlocks}
                onChange={(e) => setForm(f => ({ ...f, votingDelayBlocks: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Voting Period (blocks)</div>
              <input
                className="input"
                placeholder="e.g., 200"
                value={form.votingPeriodBlocks}
                onChange={(e) => setForm(f => ({ ...f, votingPeriodBlocks: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Quorum (bps)</div>
              <input
                className="input"
                placeholder="1000 = 10.00%"
                value={form.quorumBps}
                onChange={(e) => setForm(f => ({ ...f, quorumBps: e.target.value }))}
              />
            </div>
            <div>
              <div className="label">Treasury Timelock (seconds)</div>
              <input
                className="input"
                placeholder="86400 = 1 day"
                value={form.treasuryTimelockSec}
                onChange={(e) => setForm(f => ({ ...f, treasuryTimelockSec: e.target.value }))}
              />
            </div>
          </div>
        )}
        {/* SET_EMERGENCYCANCEL */}
        {isEmergencyCancel && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label">Target Proposal # (localId)</div>
              <input
                className="input"
                placeholder="e.g., 123"
                value={form.cancelTargetId}
                onChange={(e) => setForm(f => ({ ...f, cancelTargetId: e.target.value }))}
              />
            </div>
            <div className="text-xs text-slate self-end">
              This draft will go to a vote proposing to cancel the selected proposal.
            </div>
          </div>
        )}
        {/* BANK */}
        {isBank && (
          <div className="space-y-4 border rounded-xl p-4 bg-slate-50/60">
            <div className="text-sm text-slate-700">
              These actions operate on the DAO&apos;s <strong>Bank contract</strong>,
              not directly on the timelock treasury.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="label">Bank Action</div>
                <select
                  className="select"
                  value={form.bankAction || ''}
                  onChange={e =>
                    setForm(f => ({
                      ...f,
                      bankAction: (e.target.value || undefined) as BankAction,
                    }))
                  }
                >
                  <option value="">Select…</option>
                  {BANK_ACTIONS.map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>

              {/* Account input for non-CREATE actions */}
              {form.bankAction && form.bankAction !== 'CREATE' && (
                <div>
                  <div className="label">Bank Account ID</div>
                  <input
                    className="input"
                    placeholder="e.g., 1, 2, grants-1"
                    value={form.bankAccount}
                    onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))}
                  />
                </div>
              )}

              {form.bankAction === 'SPEND' && (
                <div>
                  <div className="label">Recipient Address</div>
                  <input
                    className="input font-mono"
                    placeholder="0x…"
                    value={form.bankRecipient}
                    onChange={e => setForm(f => ({ ...f, bankRecipient: e.target.value }))}
                  />
                </div>
              )}
            </div>

            {form.bankAction === 'SPEND' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="label">Amount</div>
                  <input
                    className="input"
                    placeholder="e.g., 2500"
                    value={form.bankAmount}
                    onChange={e => setForm(f => ({ ...f, bankAmount: e.target.value }))}
                  />
                </div>
                <div>
                  <div className="label">Asset</div>
                  <select
                    className="select"
                    value={form.bankAsset}
                    onChange={e => setForm(f => ({ ...f, bankAsset: e.target.value }))}
                  >
                    {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="text-xs text-slate self-end">
                  This will propose a transfer from the selected bank account to the recipient.
                </div>
              </div>
            )}

            {form.bankAction === 'CONFIG' && (
              <div>
                <div className="label">Account Change Summary</div>
                <textarea
                  className="textarea"
                  placeholder="Describe the limit / routing / account configuration change."
                  rows={3}
                  value={form.bankNote}
                  onChange={e => setForm(f => ({ ...f, bankNote: e.target.value }))}
                />
              </div>
            )}

            {form.bankAction === 'CLOSE' && (
              <div className="text-xs text-red-700">
                This will propose closing the selected bank account.
                Ensure balances are settled before closing.
              </div>
            )}

            {form.bankAction === 'CREATE' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="label">New Accounts (up to {MAX_BANK_NEW_ACCOUNTS})</div>
                  <button
                    type="button"
                    className="btn px-3 py-1 text-xs"
                    disabled={form.bankNewAccounts.length >= MAX_BANK_NEW_ACCOUNTS}
                    onClick={() =>
                      setForm(f => {
                        if (f.bankNewAccounts.length >= MAX_BANK_NEW_ACCOUNTS) return f
                        return {
                          ...f,
                          bankNewAccounts: [
                            ...f.bankNewAccounts,
                            { account: '', asset: ASSETS[0], note: '' },
                          ],
                        }
                      })
                    }
                  >
                    + Add account
                  </button>
                </div>

                <div className="space-y-3">
                  {form.bankNewAccounts.map((row, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-3 gap-3 border rounded-lg p-3 bg-white/70"
                    >
                      <div>
                        <div className="label">Account ID / Name #{idx + 1}</div>
                        <input
                          className="input"
                          placeholder="e.g., grants-1"
                          value={row.account}
                          onChange={e =>
                            setForm(f => {
                              const next = [...f.bankNewAccounts]
                              next[idx] = { ...next[idx], account: e.target.value }
                              return { ...f, bankNewAccounts: next }
                            })
                          }
                        />
                      </div>
                      <div>
                        <div className="label">Asset</div>
                        <select
                          className="select"
                          value={row.asset}
                          onChange={e =>
                            setForm(f => {
                              const next = [...f.bankNewAccounts]
                              next[idx] = { ...next[idx], asset: e.target.value }
                              return { ...f, bankNewAccounts: next }
                            })
                          }
                        >
                          {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div className="md:col-span-3">
                        <div className="label flex items-center justify-between">
                          <span>Note / Purpose</span>
                          {form.bankNewAccounts.length > 1 && (
                            <button
                              type="button"
                              className="text-xs text-red-600"
                              onClick={() =>
                                setForm(f => ({
                                  ...f,
                                  bankNewAccounts: f.bankNewAccounts.filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <textarea
                          className="textarea"
                          rows={2}
                          placeholder="Describe how this account will be used."
                          value={row.note}
                          onChange={e =>
                            setForm(f => {
                              const next = [...f.bankNewAccounts]
                              next[idx] = { ...next[idx], note: e.target.value }
                              return { ...f, bankNewAccounts: next }
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}






        {/* SET_ADMIN */}
        {isSetAdmin && (
          <div>
            <div className="label">New Admin Address</div>
            <input
              className="input font-mono"
              placeholder="0x…"
              value={form.newAdmin}
              onChange={(e) => setForm(f => ({ ...f, newAdmin: e.target.value }))}
            />
          </div>
        )}

        {/* SET_VOTE_TOKEN */}
        {isSetVoteToken && (
          <div>
            <div className="label">New Vote Token Address</div>
            <input
              className="input font-mono"
              placeholder="0x…"
              value={form.newToken}
              onChange={(e) => setForm(f => ({ ...f, newToken: e.target.value }))}
            />
          </div>
        )}

        {/* References + Discussion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="label">Discussion URL (optional)</div>
            <input
              className="input"
              placeholder="https://forum.example.com/thread/123"
              value={form.discussionUrl}
              onChange={(e) => setForm(f => ({ ...f, discussionUrl: e.target.value }))}
            />
          </div>
          <div>
            <div className="label">References (one URL per line)</div>
            <textarea
              className="textarea font-mono"
              placeholder="https://alkebuleum.org/whitepaper.pdf"
              value={form.references}
              onChange={(e) => setForm(f => ({ ...f, references: e.target.value }))}
              rows={3}
            />
          </div>
        </div>

        {/* Editor / Preview */}
        <div className="flex gap-2">
          <button type="button"
            className={`px-3 py-1 rounded-lg border ${tab === 'edit' ? 'bg-slate-100' : ''}`}
            onClick={() => setTab('edit')}>Editor</button>
          <button type="button"
            className={`px-3 py-1 rounded-lg border ${tab === 'preview' ? 'bg-slate-100' : ''}`}
            onClick={() => setTab('preview')}>Preview</button>
        </div>

        {tab === 'edit' ? (
          <div>
            <div className="label">Description (Markdown)</div>
            <textarea
              className="textarea"
              placeholder="Describe your proposal (Markdown supported)"
              value={form.body}
              onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
              rows={10}
              required
            />
          </div>
        ) : (
          <div className="prose max-w-none border rounded-xl p-4 bg-white">
            <Markdown>{previewMd}</Markdown>
          </div>
        )}

        {/* Reserve on-chain now (create mode only) */}
        {!isEditMode && (
          <div className="flex items-center gap-2 opacity-70">
            <input
              id="reserveOnchain"
              type="checkbox"
              className="checkbox"
              checked
              readOnly
              disabled
            />
            <label htmlFor="reserveOnchain" className="text-sm text-slate-700">
              Reserve on-chain proposal number (required)
            </label>
          </div>
        )}

        {isEditMode && loc?.state?.prefill?.reservedId && (
          <div className="text-xs text-slate-500">
            On-chain proposal number already reserved: #{loc.state.prefill.reservedId}
          </div>
        )}


        <div className="flex items-center gap-2">
          <button className="btn-cta" type="submit" disabled={loading}>
            {loading ? (isEditMode ? 'Updating…' : 'Publishing…') : (isEditMode ? 'Save Changes' : 'Publish')}
          </button>

          <button
            className="px-4 py-2 rounded-xl border border-brand-line"
            type="button"
            onClick={() => nav(-1)}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
