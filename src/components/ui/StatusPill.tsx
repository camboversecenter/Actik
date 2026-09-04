import { LucideIcon, CheckCircle2, Clock, Lock, XCircle } from 'lucide-react'

// The app's one status vocabulary — exactly four states, each always paired
// with both a shape and a color (never color alone). Replaces the ad hoc
// inline status pills that had drifted slightly different per screen.
export type PillStatus = 'verified' | 'pending' | 'locked' | 'failed'

const config: Record<PillStatus, { icon: LucideIcon; classes: string }> = {
  verified: { icon: CheckCircle2, classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending: { icon: Clock, classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  locked: { icon: Lock, classes: 'bg-stone-100 text-stone-600 border-stone-200' },
  failed: { icon: XCircle, classes: 'bg-rose-50 text-rose-700 border-rose-200' },
}

interface StatusPillProps {
  status: PillStatus
  label: string
  className?: string
}

export default function StatusPill({ status, label, className = '' }: StatusPillProps) {
  const { icon: Icon, classes } = config[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${classes} ${className}`}
    >
      <Icon size={12} />
      {label}
    </span>
  )
}
