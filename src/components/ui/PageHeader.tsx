import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'

interface PageHeaderProps {
  icon?: LucideIcon
  title: string
  subtitle?: string
  actions?: ReactNode
  className?: string
}

// Consistent page-level heading — icon badge (optional) + title + subtitle,
// with a slot for right-aligned actions. Used in place of every page
// hand-rolling its own <h1>+<p> block with slightly different spacing.
export default function PageHeader({ icon: Icon, title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-stone-200 ${className}`}>
      <div className="flex items-start gap-3.5">
        {Icon && (
          <div className="shrink-0 w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Icon size={22} className="text-indigo-600" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-extrabold text-stone-900 tracking-tight leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-stone-500 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
