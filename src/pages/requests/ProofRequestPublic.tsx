// A proof request as anyone with its link sees it, signed in or not: who is
// asking (in their own words), what they ask for, and exactly what an answer
// shows them. Answering happens in the candidate's wallet.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
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
        <h1 className="text-2xl font-extrabold text-stone-900">{request.title}</h1>
        <p className="text-sm text-stone-700 mt-1">{request.requesterName}</p>
        <p className="text-xs text-amber-800 mt-1">{t('proof.requester_unverified')}</p>
      </div>
      {request.description && <p className="text-sm text-stone-700 whitespace-pre-line">{request.description}</p>}
      <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
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
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <p className="text-sm font-bold text-indigo-700">Actik</p>
        {request === undefined && <Loader2 className="animate-spin text-indigo-600" size={28} />}
        {request === null && <p className="text-stone-600">{t('proof.not_found')}</p>}
        {request && (
          <>
            <RequestSummary request={request} />
            {request.status === 'open' && (
              <button
                type="button"
                onClick={() => {
                  const path = `/app/answer/${request.id}`
                  rememberReturnTo(path)
                  navigate(path)
                }}
                className="w-full h-12 rounded-xl bg-indigo-600 text-white font-semibold text-sm"
              >
                {t('proof.answer_from_wallet')}
              </button>
            )}
            <p className="text-xs text-stone-500 leading-relaxed">{t('proof.answer_privacy')}</p>
          </>
        )}
      </div>
    </div>
  )
}
