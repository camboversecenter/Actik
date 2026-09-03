import { CheckCircle2, ShieldCheck, Share2, Landmark } from 'lucide-react'
import { useLanguage } from '../lib/i18n'

interface CredentialCardProps {
  degreeTitle: string
  institutionName?: string | null
  issuerDid?: string | null
  graduationDate?: string | null
  createdAt: string
  onClick?: () => void
  className?: string
  // Omitted when not yet known/loaded — renders nothing rather than "0" so a
  // loading list never flashes a false-zero share count.
  shareCount?: number
}

function truncateDid(did: string) {
  if (!did) return ''
  if (did.length <= 28) return did
  return did.slice(0, 28) + '…'
}

// Shared visual for a single claimed credential — used on the Wallet home
// screen and the per-category Wallet list. Keeping this in one place avoids
// the card design drifting between the two screens.
//
// "Banded" treatment: a colored institution header (an icon stands in for a
// real crest — Actik has no institution-logo column yet, so there's nothing
// honest to abbreviate into initials), the degree title as the primary line,
// and a dashed circular "verified in vault" seal. Institution name and
// degree title render exactly as stored (whatever script the issuer used) —
// no fabricated second-language line; only static labels get Khmer-primary
// styling elsewhere in the app.
export default function CredentialCard({
  degreeTitle,
  institutionName,
  issuerDid,
  graduationDate,
  createdAt,
  onClick,
  className = '',
  shareCount,
}: CredentialCardProps) {
  const { t } = useLanguage()
  const year = graduationDate ? new Date(graduationDate).getFullYear().toString() : null

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden ${className}`}
    >
      {/* Institution band */}
      <div className="bg-indigo-600 px-4 py-2.5 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center shrink-0">
          <Landmark size={13} className="text-white" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0 font-khmer text-[13px] font-semibold text-white truncate">
          {institutionName || t('wallet.institution_unknown')}
        </div>
        <CheckCircle2 size={15} className="text-white shrink-0" strokeWidth={2.4} />
      </div>

      {/* Body */}
      <div className="flex items-start gap-3.5 p-4">
        <div className="min-w-0 flex-1">
          <h4 className="font-khmer font-bold text-stone-900 text-[17px] leading-snug">{degreeTitle}</h4>
          <div className="flex items-center gap-4 mt-3">
            <div>
              <div className="font-mono text-[9px] text-stone-400 uppercase tracking-wide">{t('wallet.issued_on_label')}</div>
              <div className="font-mono text-xs font-medium text-stone-700">{new Date(createdAt).toLocaleDateString()}</div>
            </div>
            {year && (
              <div>
                <div className="font-mono text-[9px] text-stone-400 uppercase tracking-wide">{t('wallet.year_label')}</div>
                <div className="font-mono text-xs font-medium text-stone-700">{year}</div>
              </div>
            )}
            {typeof shareCount === 'number' && shareCount > 0 && (
              <div>
                <div className="font-mono text-[9px] text-stone-400 uppercase tracking-wide flex items-center gap-1">
                  <Share2 size={9} />
                  {t('wallet.share_label')}
                </div>
                <div className="font-mono text-xs font-medium text-stone-700">{shareCount}×</div>
              </div>
            )}
          </div>
        </div>
        <div className="w-14 h-14 rounded-full border-[1.5px] border-dashed border-teal-200 bg-teal-50 flex flex-col items-center justify-center shrink-0">
          <ShieldCheck size={17} className="text-teal-500" strokeWidth={1.75} />
          <span className="font-mono text-[6.5px] text-teal-500 mt-0.5 tracking-wider">{t('wallet.seal_label')}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-stone-100 px-4 py-2.5 bg-stone-50/70 flex items-center justify-between gap-3">
        {issuerDid ? (
          <span className="font-mono text-[10px] text-stone-400 truncate" title={issuerDid}>
            {truncateDid(issuerDid)}
          </span>
        ) : <span />}
        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
          <CheckCircle2 size={11} />
          {t('wallet.verified_label')}
        </span>
      </div>
    </div>
  )
}
