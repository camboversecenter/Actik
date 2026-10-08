// Proof requests: the ones you made (as an employer) and the ones you answered
// (as a candidate). Either side is open to any signed-in account.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Loader2 } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import { longDate } from '../../lib/dates'
import {
  listMyAnswers,
  listOwnRequests,
  withdrawAnswer,
  type MyAnswerSummary,
  type OwnRequestSummary,
} from '../../lib/proofRequestApi'

export function StatusPill({ status }: { status: 'open' | 'closed' | 'expired' }) {
  const { t } = useLanguage()
  const tone = status === 'open' ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-stone-100 text-stone-600 border-stone-200'
  return <span className={`shrink-0 text-xs font-semibold border rounded-full px-2.5 py-0.5 ${tone}`}>{t(`proof.status_${status}`)}</span>
}

export default function ProofRequests() {
  const { t } = useLanguage()
  const [own, setOwn] = useState<OwnRequestSummary[] | null>(null)
  const [answers, setAnswers] = useState<MyAnswerSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    try {
      const [o, a] = await Promise.all([listOwnRequests(), listMyAnswers()])
      setOwn(o)
      setAnswers(a)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setOwn([])
      setAnswers([])
    }
  }
  useEffect(() => { load() }, [])

  const withdraw = async (id: string) => {
    if (!window.confirm(t('proof.withdraw_confirm'))) return
    setBusy(id)
    try {
      await withdrawAnswer(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!own || !answers) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>
  }

  return (
    <div className="w-full md:max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{t('proof.page_title')}</h1>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">{t('proof.page_intro')}</p>
      </div>

      {error && <div className="rounded-lg p-3 bg-rose-50 text-rose-800 border border-rose-200 text-sm">{error}</div>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-stone-900">{t('proof.your_requests')}</h2>
          <Link to="/app/requests/new" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold">
            <Plus size={14} /> {t('proof.new_request')}
          </Link>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
          {own.length === 0 && <p className="p-4 text-sm text-stone-500">{t('proof.no_requests')}</p>}
          {own.map((r) => (
            <Link key={r.id} to={`/app/requests/${r.id}`} className="flex items-start justify-between gap-3 p-4 hover:bg-stone-50">
              <div className="min-w-0">
                <div className="font-semibold text-stone-900 truncate">{r.title}</div>
                <div className="text-xs text-stone-500 truncate">
                  {r.requesterName} · {t('proof.answers_count', { count: r.responses })} · {t('proof.until', { date: longDate(Math.floor(new Date(r.expiresAt).getTime() / 1000)) })}
                </div>
              </div>
              <StatusPill status={r.status} />
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-stone-900">{t('proof.your_answers')}</h2>
        <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
          {answers.length === 0 && <p className="p-4 text-sm text-stone-500">{t('proof.no_answers')}</p>}
          {answers.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="font-semibold text-stone-900 truncate">{a.title}</div>
                <div className="text-xs text-stone-500 truncate">
                  {a.requesterName} · {t('proof.sent_items', { count: a.items })} · {new Date(a.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusPill status={a.requestStatus} />
                <button
                  type="button" disabled={busy === a.id} onClick={() => withdraw(a.id)}
                  className="text-xs font-semibold text-rose-700 border border-rose-200 rounded-lg px-2.5 py-1 disabled:opacity-40"
                >
                  {t('proof.withdraw_answer')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
