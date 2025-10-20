// src/components/StatusChip.tsx
import clsx from 'clsx'

export type ProposalStatus =
  | 'draft'
  | 'submitted'
  | 'voting'
  | 'succeeded'
  | 'queued'
  | 'executed'
  | 'failed'
  | 'canceled'

export default function StatusChip({ status }: { status: ProposalStatus }) {
  // normalize to lowercase for comparisons
  const s = (status as string).toLowerCase() as ProposalStatus

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
        {
          'bg-slate-100 text-slate-800': s === 'draft',
          'bg-blue-100 text-blue-800': s === 'submitted',
          'bg-indigo-100 text-indigo-800': s === 'voting',
          'bg-emerald-100 text-emerald-800': s === 'succeeded',
          'bg-amber-100 text-amber-800': s === 'queued',
          'bg-purple-100 text-purple-800': s === 'executed',
          'bg-red-100 text-red-800': s === 'failed',
          'bg-gray-200 text-gray-700': s === 'canceled',
        }
      )}
    >
      {s}
    </span>
  )
}
