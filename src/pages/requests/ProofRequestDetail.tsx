// The employer's view of one request: its link, and every answer, each
// checked on this device against the signed trust list and the institution's
// withdrawal list. Who issued it comes first; there is no tick.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowLeft, Copy, Loader2 } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import { longDate } from '../../lib/dates'
import { messageForRefusal } from '../../lib/credentialCheck'
import { displayClaim } from '../../lib/claimDisplay'
import type { CheckedAnswer, ProofRequest } from '../../lib/proofRequest'
import {
  checkResponses,
  closeProofRequest,
  getProofRequest,
  listResponses,
  type CheckedResponse,
} from '../../lib/proofRequestApi'
import { StatusPill } from './ProofRequests'

export function requestLink(id: string) {
  return `${window.location.origin}/request/${id}`
}

export function RequirementLabel({ request, index }: { request: Pick<ProofRequest, 'requirements'>; index: number }) {
  const { t } = useLanguage()
  const r = request.requirements[index]
  if (!r) return null
  return (
    <span>
      {t(`proof.type_${r.type}`)}
      {r.extras.length > 0 && <span className="text-stone-500"> + {r.extras.map((f) => t(`proof.field_${f}`)).join(', ')}</span>}
      {r.note && <span className="text-stone-500"> — {r.note}</span>}
    </span>
  )
}


function Answer({ answer }: { answer: CheckedAnswer | undefined }) {
  const { t } = useLanguage()
  if (!answer) return <p className="text-sm text-stone-500">{t('proof.not_answered')}</p>
  if (answer.kind === 'not_asked') {
    return <p className="text-sm text-rose-800">{t(`proof.not_asked_${answer.reason}`)}</p>
  }
  if (answer.kind === 'refused') {
    const tone = answer.unavailable ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-900'
    const head = answer.unavailable ? t('proof.could_not_check') : answer.withdrawn ? t('verify.withdrawn_title') : t('proof.did_not_verify')
    return (
      <div className={`rounded-lg border p-3 text-sm ${tone}`}>
        <p className="font-semibold">{head}</p>
        <p className="text-xs mt-0.5">{messageForRefusal(answer.reason)}</p>
      </div>
    )
  }
  const c = answer.checked
  const standing = c.standing
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="text-stone-500">{t('proof.issued_by')}</span>{' '}
        <span className="font-bold text-stone-900">{c.issuer.name}</span>{' '}
        <span className="text-xs text-stone-500">· {t(`proof.kind_${c.issuer.kind ?? 'institution'}`)}</span>
      </p>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-sm">
        {answer.fields.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-stone-500">{t(`proof.field_${k}`)}</dt>
            <dd className="font-medium text-stone-900 break-words">{displayClaim(t, k, v, c.assertion.issuedAt)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-stone-600">
        {standing.status === 'clear'
          ? `${t('verify.standing_clear_title')} ${t('verify.standing_clear_desc', { issuer: c.issuer.name, version: standing.listVersion, date: longDate(standing.listIssuedAt) })}`
          : standing.why === 'expired'
            ? `${t('verify.standing_unchecked_title')} ${t('verify.standing_lapsed_desc', { issuer: c.issuer.name, date: longDate(standing.listExpiredAt ?? 0) })}`
            : `${t('verify.standing_unchecked_title')} ${t('verify.standing_none_desc', { issuer: c.issuer.name })}`}
      </p>
      <p className="text-xs text-stone-600">{c.holder.binding === 'bound' ? t('proof.holder_bound') : t('proof.holder_unbound')}</p>
      {c.assertion.mustMatchPrintedDocument.subjectName && (
        <p className="text-xs text-stone-600">{t('proof.check_id', { name: c.assertion.mustMatchPrintedDocument.subjectName })}</p>
      )}
    </div>
  )
}

export default function ProofRequestDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const { t } = useLanguage()
  const [request, setRequest] = useState<ProofRequest | null | undefined>(undefined)
  const [responses, setResponses] = useState<CheckedResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    try {
      const r = await getProofRequest(id)
      setRequest(r)
      if (r) setResponses(await checkResponses(r, await listResponses(id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRequest((r) => r ?? null)
    }
  }
  useEffect(() => { load() }, [id])

  if (request === undefined) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>
  }
  if (!request) return <div className="max-w-2xl mx-auto p-6 text-stone-600">{error ?? t('proof.not_found')}</div>

  const link = requestLink(request.id)

  return (
    <div className="w-full md:max-w-3xl mx-auto pb-24 px-4 md:px-0 pt-4 space-y-6">
      <Link to="/app/requests" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> {t('proof.page_title')}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-stone-900">{request.title}</h1>
          <p className="text-sm text-stone-500 mt-1">
            {request.requesterName} · {t('proof.until', { date: longDate(Math.floor(new Date(request.expiresAt).getTime() / 1000)) })}
          </p>
        </div>
        <StatusPill status={request.status} />
      </div>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-stone-900">{t('proof.what_you_ask')}</h2>
        <ol className="list-decimal pl-5 text-sm text-stone-800 space-y-1">
          {request.requirements.map((_, i) => <li key={i}><RequirementLabel request={request} index={i} /></li>)}
        </ol>
      </section>

      {request.status === 'open' && (
        <section className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col sm:flex-row gap-4 items-start">
          <div className="bg-white p-2 border border-stone-200 rounded-lg shrink-0">
            <QRCodeSVG value={link} size={132} level="M" />
          </div>
          <div className="space-y-2 min-w-0">
            <h2 className="text-sm font-bold text-stone-900">{t('proof.share_heading')}</h2>
            <p className="text-xs text-stone-500 leading-relaxed">{t('proof.share_hint')}</p>
            <code className="block text-xs font-mono break-all bg-stone-50 border border-stone-200 rounded p-2" data-testid="request-link">{link}</code>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold">
                <Copy size={13} /> {copied ? t('museum.copied') : t('museum.copy')}
              </button>
              <button type="button" onClick={async () => { if (window.confirm(t('proof.close_confirm'))) { await closeProofRequest(request.id); load() } }}
                className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700">
                {t('proof.close_request')}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-bold text-stone-900">{t('proof.answers_heading', { count: responses?.length ?? 0 })}</h2>
        <p className="text-xs text-stone-500 leading-relaxed">{t('proof.answers_hint')}</p>
        {error && <div className="rounded-lg p-3 bg-rose-50 text-rose-800 border border-rose-200 text-sm">{error}</div>}
        {!responses && <Loader2 className="animate-spin text-indigo-600" size={24} />}
        {responses?.length === 0 && <p className="text-sm text-stone-500">{t('proof.no_answers_yet')}</p>}
        {responses?.map((resp) => (
          <article key={resp.id} className="bg-white rounded-xl border border-stone-200 p-4 space-y-4" data-testid="answer">
            <div className="flex items-start justify-between gap-3 text-sm">
              <div>
                <span className="text-stone-500">{t('proof.contact')}</span>{' '}
                <span className="font-semibold text-stone-900 break-all">{resp.contact}</span>
              </div>
              <span className="text-xs text-stone-500 shrink-0">{new Date(resp.createdAt).toLocaleDateString()}</span>
            </div>
            {resp.oneWalletWithIdentity && (
              <p className="text-xs rounded-lg border border-sky-200 bg-sky-50 text-sky-900 p-2.5" data-testid="one-wallet">
                {t('proof.one_wallet_with_identity')}
              </p>
            )}
            {request.requirements.map((_, i) => (
              <div key={i} className="border-t border-stone-100 pt-3 space-y-2">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide"><RequirementLabel request={request} index={i} /></p>
                <Answer answer={resp.answers.find((a) => a.requirement === i)} />
              </div>
            ))}
          </article>
        ))}
      </section>
    </div>
  )
}
