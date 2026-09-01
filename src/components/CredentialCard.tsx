import { GraduationCap, ShieldCheck } from 'lucide-react'
import { useLanguage } from '../lib/i18n'

interface CredentialCardProps {
  degreeTitle: string
  institutionName?: string | null
  issuerDid?: string | null
  graduationDate?: string | null
  createdAt: string
  onClick?: () => void
  className?: string
}

function truncateDid(did: string) {
  if (!did) return ''
  if (did.length <= 28) return did
  return did.slice(0, 28) + '…'
}

// Shared visual for a single claimed credential — used on the Wallet home
// screen and the per-category Wallet list. Keeping this in one place avoids
// the card design drifting between the two screens.
export default function CredentialCard({
  degreeTitle,
  institutionName,
  issuerDid,
  graduationDate,
  createdAt,
  onClick,
  className = '',
}: CredentialCardProps) {
  const { t } = useLanguage()
  const year = graduationDate ? new Date(graduationDate).getFullYear().toString() : null

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer overflow-hidden ${className}`}
    >
      <div className="flex items-start gap-3 p-5">
        <div className="shrink-0 w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
          <GraduationCap size={22} className="text-indigo-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-bold text-stone-900 leading-snug truncate">{degreeTitle}</h4>
              <p className="text-sm text-stone-500 truncate mt-0.5">
                {institutionName || t('wallet.encrypted_certificate_fallback')}
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              <ShieldCheck size={12} />
              {t('wallet.verified_label')}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 px-5 py-3 border-t border-stone-100 bg-stone-50/70 text-xs text-stone-500">
        <span>
          {t('wallet.issued_on')}<strong className="text-stone-700 font-semibold">{new Date(createdAt).toLocaleDateString()}</strong>
        </span>
        {year && (
          <span>
            {t('wallet.year')}<strong className="text-stone-700 font-semibold">{year}</strong>
          </span>
        )}
        {issuerDid && (
          <span className="ml-auto font-mono text-[10px] text-stone-400 truncate" title={issuerDid}>
            {truncateDid(issuerDid)}
          </span>
        )}
      </div>
    </div>
  )
}
