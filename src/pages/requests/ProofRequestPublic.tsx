// A proof request as anyone with its link sees it, signed in or not: who is
// asking (in their own words), what they ask for, and exactly what an answer
// shows them. Answering happens in the candidate's wallet.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, SearchX } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import { longDate } from '../../lib/dates'
import type { ProofRequest } from '../../lib/proofRequest'
import { getProofRequest, rememberReturnTo } from '../../lib/proofRequestApi'
import { RequirementLabel } from './ProofRequestDetail'

export function RequestSummary({ request }: { request: ProofRequest }) {
  const { t } = useLanguage()
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('proof.request_from')}</p>
        <h1 className="text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{request.title}</h1>
        <p className="text-sm text-stone-700 mt-1">{request.requesterName}</p>
        <p className="text-xs text-amber-800 mt-1">{t('proof.requester_unverified')}</p>
      </div>
      {request.description && <p className="text-sm text-stone-700 whitespace-pre-line">{request.description}</p>}
      <div className="bg-white rounded-2xl border border-stone-200/80 p-5 space-y-2.5">
        <h2 className="text-sm font-bold text-stone-900">{t('proof.they_ask')}</h2>
        <ol className="list-decimal pl-5 text-sm text-stone-800 space-y-1">
          {request.requirements.map((_, i) => <li key={i}><RequirementLabel request={request} index={i} /></li>)}
        </ol>
        <p className="text-xs text-stone-500 leading-relaxed">{t('proof.answer_shows')}</p>
        <p className="text-xs text-stone-500 leading-relaxed">{t('proof.never_asked')}</p>
      </div>
      <p className="text-xs text-stone-500">
        {request.status === 'open'
          ? t('proof.until', { date: longDate(Math.floor(new Date(request.expiresAt).getTime() / 1000)) })
          : t(`proof.status_${request.status}_long`)}
      </p>
    </div>
  )
}

export default function ProofRequestPublic() {
  const { id = '' } = useParams<{ id: string }>()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [request, setRequest] = useState<ProofRequest | null | undefined>(undefined)

  useEffect(() => {
    getProofRequest(id).then(setRequest).catch(() => setRequest(null))
  }, [id])

  return (
    <div className="min-h-[100dvh] bg-stone-100">
      <header className="sticky top-0 z-30 material-bar border-b border-stone-900/[0.06] pt-[env(safe-area-inset-top)]">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center">
          <img src="/logo.png" alt="Actik" className="h-8 w-auto" />
        </div>
      </header>

      <main className={`max-w-xl mx-auto px-4 pt-6 space-y-6 ${request?.status === 'open' ? 'pb-[calc(96px+env(safe-area-inset-bottom))]' : 'pb-10'}`}>
        {request === undefined && (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-indigo-600" size={26} />
          </div>
        )}
        {request === null && (
          <div className="bg-white rounded-3xl border border-stone-200/80 px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
              <SearchX size={22} className="text-stone-400" />
            </div>
            <p className="text-[15px] font-semibold text-stone-800">{t('proof.not_found')}</p>
          </div>
        )}
        {request && (
          <>
            <RequestSummary request={request} />
            <p className="text-xs text-stone-500 leading-relaxed">{t('proof.answer_privacy')}</p>
          </>
        )}
      </main>

      {request && request.status === 'open' && (
        <div className="fixed bottom-0 inset-x-0 z-30 material-bar border-t border-stone-900/[0.06] pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-xl mx-auto px-4 py-3">
            <button
              type="button"
              onClick={() => {
                const path = `/app/answer/${request.id}`
                rememberReturnTo(path)
                navigate(path)
              }}
              className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[15px] shadow-sm cursor-pointer"
            >
              {t('proof.answer_from_wallet')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
