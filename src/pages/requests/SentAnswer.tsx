// What a candidate sent in answer to a proof request, read back from their own
// answer row: who got it, until when they can see it, and the fields shown.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Loader2, Mail } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import { longDate } from '../../lib/dates'
import { peekJwt, readDisclosures } from '../../lib/sdjwt'
import { displayClaim } from '../../lib/claimDisplay'
import { getMyAnswer, getProofRequest } from '../../lib/proofRequestApi'
import { allowedClaims, type ProofRequest } from '../../lib/proofRequest'
import { StatusPill } from './ProofRequests'

type Answer = NonNullable<Awaited<ReturnType<typeof getMyAnswer>>>

const HIDDEN = ['iss', 'iat', 'exp']
const day = (iso: string) => longDate(Math.floor(new Date(iso).getTime() / 1000))

export default function SentAnswer() {
  const { id = '' } = useParams<{ id: string }>()
  const { t } = useLanguage()
  const [answer, setAnswer] = useState<Answer | null | undefined>(undefined)
  const [request, setRequest] = useState<ProofRequest | null>(null)

  useEffect(() => {
    getMyAnswer(id)
      .then(async (a) => {
        setAnswer(a)
        if (a) setRequest(await getProofRequest(a.requestId))
      })
      .catch(() => setAnswer(null))
  }, [id])

  if (answer === undefined) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>
  }
  if (!answer || !request) return <div className="max-w-2xl mx-auto px-1 py-10 text-center text-stone-500">{t('proof.not_found')}</div>

  const visible = !answer.expiresAt || new Date(answer.expiresAt).getTime() > Date.now()

  return (
    <div className="w-full md:max-w-2xl mx-auto space-y-5">
      <Link to="/app/requests" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> {t('proof.page_title')}
      </Link>

      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[24px] md:text-[28px] font-bold text-stone-900 leading-tight">{request.title}</h1>
          <StatusPill status={request.status} />
        </div>
        <p className="text-sm text-stone-600">{request.requesterName}</p>
      </header>

      <div className="rounded-xl bg-white border border-stone-200 divide-y divide-stone-100 text-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Clock size={16} className="text-stone-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-stone-900 font-medium">{t('proof.sent_on', { date: day(answer.createdAt) })}</p>
            {answer.expiresAt && (
              <p className={`text-xs ${visible ? 'text-stone-500' : 'text-amber-800'}`}>
                {visible ? t('proof.visible_until', { date: day(answer.expiresAt) }) : t('proof.visible_ended')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Mail size={16} className="text-stone-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-stone-500">{t('proof.sent_contact')}</p>
            <p className="text-stone-900 font-medium break-all">{answer.contact}</p>
          </div>
        </div>
      </div>

      {request.requirements.map((r, i) => {
        const item = answer.items.find((it) => it.requirement === i)
        let fields: Array<[string, unknown]> = []
        let iat: number | null = null
        if (item) {
          try {
            const claims = Object.fromEntries(readDisclosures(item.presentation).map((d) => [d.name, d.value]))
            fields = allowedClaims(r)
              .filter((k) => !HIDDEN.includes(k) && claims[k] !== undefined && claims[k] !== '')
              .map((k) => [k, claims[k]])
            iat = peekJwt(item.presentation).iat
          } catch {
            // an unreadable presentation shows as an empty card rather than breaking the page
          }
        }
        return (
          <section key={i} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <h2 className="px-4 py-2.5 text-sm font-bold text-stone-900 bg-stone-50 border-b border-stone-100">
              {t(`proof.type_${r.type}`)}
            </h2>
            {!item ? (
              <p className="px-4 py-3 text-sm text-stone-500">{t('proof.sent_skipped')}</p>
            ) : (
              <dl className="px-4 py-3 grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-1.5 text-sm">
                {fields.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-stone-500">{t(`proof.field_${k}`)}</dt>
                    <dd className="text-stone-900 break-words">{displayClaim(t, k, v, iat)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )
      })}
    </div>
  )
}
