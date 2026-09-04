import { ReactNode } from 'react'
import { LucideIcon, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

type BannerTone = 'warning' | 'success' | 'error' | 'info'

const toneConfig: Record<BannerTone, { icon: LucideIcon; classes: string; iconClass: string }> = {
  warning: { icon: AlertTriangle, classes: 'bg-amber-50 border-amber-500 text-amber-800', iconClass: 'text-amber-600' },
  success: { icon: CheckCircle2, classes: 'bg-emerald-50 border-emerald-500 text-emerald-800', iconClass: 'text-emerald-600' },
  error: { icon: XCircle, classes: 'bg-rose-50 border-rose-500 text-rose-800', iconClass: 'text-rose-600' },
  info: { icon: Info, classes: 'bg-indigo-50 border-indigo-500 text-indigo-800', iconClass: 'text-indigo-600' },
}

interface BannerProps {
  tone?: BannerTone
  title?: string
  children: ReactNode
  onDismiss?: () => void
  className?: string
}

// Left-accent alert banner with a real icon — replaces the emoji + flat
// colored-box pattern (⏳, ✅, ⚠️) used ad hoc across the app.
export default function Banner({ tone = 'info', title, children, onDismiss, className = '' }: BannerProps) {
  const { icon: Icon, classes, iconClass } = toneConfig[tone]
  return (
    <div className={`border-l-4 rounded-xl p-4 md:p-5 shadow-sm ${classes} ${className}`}>
      <div className="flex items-start gap-3">
        <Icon size={20} className={`shrink-0 mt-0.5 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          {title && <h3 className="font-bold text-sm mb-1">{title}</h3>}
          <div className="text-sm leading-relaxed">{children}</div>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer" aria-label="Dismiss">
            <XCircle size={18} />
          </button>
        )}
      </div>
    </div>
  )
}
