import { ShieldCheck, Clock } from 'lucide-react'

interface AccreditationBadgeProps {
  accredited: boolean
  accreditedLabel: string
  pendingLabel: string
  className?: string
}

// Small institution-trust badge used on credential cards, the issuer sidebar,
// and the verify page — the one place "accredited vs. not yet" is ever shown.
export default function AccreditationBadge({ accredited, accreditedLabel, pendingLabel, className = '' }: AccreditationBadgeProps) {
  const Icon = accredited ? ShieldCheck : Clock
  const classes = accredited
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${classes} ${className}`}
    >
      <Icon size={11} />
      {accredited ? accreditedLabel : pendingLabel}
    </span>
  )
}
