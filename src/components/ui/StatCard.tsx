import { LucideIcon } from 'lucide-react'

type StatTone = 'neutral' | 'success' | 'warning' | 'danger'

const toneClasses: Record<StatTone, { badge: string; icon: string; value: string }> = {
  neutral: { badge: 'bg-indigo-50', icon: 'text-indigo-600', value: 'text-stone-900' },
  success: { badge: 'bg-emerald-50', icon: 'text-emerald-600', value: 'text-emerald-700' },
  warning: { badge: 'bg-amber-50', icon: 'text-amber-600', value: 'text-amber-700' },
  danger: { badge: 'bg-rose-50', icon: 'text-rose-600', value: 'text-rose-700' },
}

interface StatCardProps {
  icon: LucideIcon
  value: string | number
  label: string
  tone?: StatTone
}

// Small metric card — icon badge, big value, label underneath. Replaces the
// plain "number over caption, no icon" stat blocks scattered across the
// issuer/admin dashboards.
export default function StatCard({ icon: Icon, value, label, tone = 'neutral' }: StatCardProps) {
  const t = toneClasses[tone]
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
      <div className={`w-9 h-9 rounded-lg ${t.badge} flex items-center justify-center mb-3`}>
        <Icon size={18} className={t.icon} />
      </div>
      <div className={`text-2xl md:text-3xl font-extrabold tracking-tight ${t.value}`}>{value}</div>
      <div className="text-xs text-stone-500 font-semibold mt-1">{label}</div>
    </div>
  )
}
