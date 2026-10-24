// What a candidate sent in answer to a proof request, read back from their own
// answer row: the fields the employer can see, and the contact they left.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import { longDate } from '../../lib/dates'
import { peekJwt, readDisclosures } from '../../lib/sdjwt'
import { displayClaim } from '../../lib/claimDisplay'
import { getMyAnswer, getProofRequest } from '../../lib/proofRequestApi'
import type { ProofRequest } from '../../lib/proofRequest'
import { RequestSummary } from './ProofRequestPublic'

type Answer = NonNullable<Awaited<ReturnType<typeof getMyAnswer>>>

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

  const sentTo = (i: number) => answer.items.find((it) => it.requirement === i)

  return (
    <div className="w-full md:max-w-2xl mx-auto space-y-6">
      <Link to="/app/requests" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> {t('proof.page_title')}
      </Link>
      <RequestSummary request={request} />
      <p className="text-xs text-stone-500">
        {t('proof.sent_on', { date: longDate(Math.floor(new Date(answer.createdAt).getTime() / 1000)) })}
        {answer.expiresAt && (
          <> · {new Date(answer.expiresAt).getTime() > Date.now()
            ? t('proof.visible_until', { date: longDate(Math.floor(new Date(answer.expiresAt).getTime() / 1000)) })
            : t('proof.visible_ended')}</>
        )}
      </p>

      {request.requirements.map((r, i) => {
        const item = sentTo(i)
        let fields: Array<[string, unknown]> = []
        let iat: number | null = null
        if (item) {
          try {
            fields = readDisclosures(item.presentation).map((d) => [d.name, d.value] as [string, unknown])
            iat = peekJwt(item.presentation).iat
          } catch {
            // an unreadable presentation shows as an empty card rather than breaking the page
          }
        }
        return (
          <section key={i} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <h2 className="text-sm font-bold text-stone-900">{i + 1}. {t(`proof.type_${r.type}`)}</h2>
            {!item ? (
              <p className="text-sm text-stone-500">{t('proof.sent_skipped')}</p>
            ) : (
              <div className="rounded-lg bg-stone-50 border border-stone-200 p-3">
                <p className="text-xs font-semibold text-stone-600 mb-1">{t('proof.sent_to', { requester: request.requesterName })}</p>
                <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {fields.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-stone-500">{t(`proof.field_${k}`)}</dt>
                      <dd className="text-stone-900 break-words">{displayClaim(t, k, v, iat)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
        )
      })}

      <div className="text-sm text-stone-700">
        <span className="font-medium">{t('proof.sent_contact')}: </span>{answer.contact}
      </div>
    </div>
  )
}
