// One answer to a request, on its own page: who sent it, and each credential
// in full, checked on this device the same way as the list it came from.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import type { ProofRequest } from '../../lib/proofRequest'
import { checkResponses, getProofRequest, listResponses, type CheckedResponse } from '../../lib/proofRequestApi'
import { Answer, RequirementLabel, nameOf } from './ProofRequestDetail'

export default function ResponseDetail() {
  const { id = '', answerId = '' } = useParams<{ id: string; answerId: string }>()
  const { t } = useLanguage()
  const [request, setRequest] = useState<ProofRequest | null | undefined>(undefined)
  const [resp, setResp] = useState<CheckedResponse | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await getProofRequest(id)
        if (!live) return
        setRequest(r)
        if (!r) return
        // Check only this answer: the others are not on screen.
        const rows = (await listResponses(id)).filter((row) => row.id === answerId)
        const [checked] = await checkResponses(r, rows)
        if (live) setResp(checked ?? null)
      } catch (e) {
        if (!live) return
        setError(e instanceof Error ? e.message : String(e))
        setRequest((r) => r ?? null)
        setResp(null)
      }
    })()
    return () => { live = false }
  }, [id, answerId])

  if (request === undefined || (request && resp === undefined)) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>
  }
  if (!request) return <div className="max-w-2xl mx-auto px-1 py-10 text-center text-stone-500">{error ?? t('proof.not_found')}</div>

  const back = (
    <Link to={`/app/requests/${request.id}`} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 max-w-full">
      <ArrowLeft size={14} className="shrink-0" /> <span className="truncate">{request.title}</span>
    </Link>
  )
  if (!resp) {
    return (
      <div className="w-full md:max-w-3xl mx-auto space-y-6">
        {back}
        <p className="py-10 text-center text-stone-500">{error ?? t('proof.answer_not_found')}</p>
      </div>
    )
  }

  const name = nameOf(resp)
  return (
    <div className="w-full md:max-w-3xl mx-auto space-y-6">
      {back}

      <header>
        <h1 className="text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight break-words">{name ?? resp.contact}</h1>
        <p className="text-sm text-stone-500 mt-1 break-all">
          {name && <>{resp.contact} · </>}{new Date(resp.createdAt).toLocaleDateString()}
        </p>
      </header>

      {resp.oneWalletWithIdentity && (
        <p className="text-xs rounded-lg border border-sky-200 bg-sky-50 text-sky-900 p-3" data-testid="one-wallet">
          {t('proof.one_wallet_with_identity')}
        </p>
      )}

      {request.requirements.map((_, i) => (
        <section key={i} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3" data-testid="answer-item">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide"><RequirementLabel request={request} index={i} /></h2>
          <Answer answer={resp.answers.find((a) => a.requirement === i)} />
        </section>
      ))}
    </div>
  )
}
