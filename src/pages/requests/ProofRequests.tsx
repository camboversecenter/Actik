// Proof requests: the ones you made (as an employer) and the ones you answered
// (as a candidate). Either side is open to any signed-in account.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Loader2, MoreHorizontal } from 'lucide-react'
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

type Tab = 'answered' | 'made'

const toSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

export default function ProofRequests() {
  const { t } = useLanguage()
  const [own, setOwn] = useState<OwnRequestSummary[] | null>(null)
  const [answers, setAnswers] = useState<MyAnswerSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('answered')
  const [menu, setMenu] = useState<string | null>(null)
  const picked = useRef(false)

  const load = async () => {
    try {
      const [o, a] = await Promise.all([listOwnRequests(), listMyAnswers()])
      setOwn(o)
      setAnswers(a)
      // Open on the side that has something, unless the person already chose.
      if (!picked.current) setTab(a.length === 0 && o.length > 0 ? 'made' : 'answered')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setOwn([])
      setAnswers([])
    }
  }
  useEffect(() => { load() }, [])

  const choose = (next: Tab) => { picked.current = true; setTab(next) }

  const withdraw = async (id: string) => {
    setMenu(null)
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

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'answered', label: t('proof.tab_answered'), count: answers.length },
    { id: 'made', label: t('proof.tab_made'), count: own.length },
  ]

  return (
    <div className="w-full md:max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{t('proof.page_title')}</h1>
          <p className="text-sm text-stone-500 mt-1">{t('proof.page_intro')}</p>
        </div>
        <Link to="/app/requests/new" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold">
          <Plus size={14} /> {t('proof.new_request')}
        </Link>
      </div>

      {error && <div className="rounded-lg p-3 bg-rose-50 text-rose-800 border border-rose-200 text-sm">{error}</div>}

      <div role="tablist" className="flex rounded-xl bg-stone-200/70 p-1 text-sm font-semibold">
        {tabs.map((x) => (
          <button
            key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => choose(x.id)}
            className={`flex-1 py-1.5 rounded-lg transition-colors ${tab === x.id ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500'}`}
          >
            {x.label} · {x.count}
          </button>
        ))}
      </div>

      {tab === 'answered' ? (
        <div className="space-y-3">
          {answers.length === 0 && <p className="p-4 text-sm text-stone-500 bg-white rounded-2xl border border-stone-200 shadow-sm">{t('proof.no_answers')}</p>}
          {answers.map((a) => {
            const visible = !a.expiresAt || new Date(a.expiresAt).getTime() > Date.now()
            return (
              <div key={a.id} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900">{a.title}</p>
                    <p className="text-xs text-stone-500 mt-0.5">{a.requesterName}</p>
                  </div>
                  <StatusPill status={a.requestStatus} />
                </div>
                <p className="mt-3 text-xs text-stone-600">
                  {t('proof.sent_items', { count: a.items })} · {longDate(toSeconds(a.createdAt))}
                  {a.expiresAt && <span className={visible ? '' : 'text-amber-800'}> · {visible ? t('proof.visible_until', { date: longDate(toSeconds(a.expiresAt)) }) : t('proof.visible_ended')}</span>}
                </p>
                <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between">
                  <Link to={`/app/requests/sent/${a.id}`} className="text-xs font-semibold text-indigo-700">{t('proof.view_sent')} ›</Link>
                  <div className="relative">
                    <button
                      type="button" aria-label={t('proof.more_actions')} disabled={busy === a.id}
                      onClick={() => setMenu(menu === a.id ? null : a.id)}
                      className="p-1 -m-1 text-stone-400 hover:text-stone-700 disabled:opacity-40"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {menu === a.id && (
                      <>
                        <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(null)} />
                        <div className="absolute right-0 bottom-full mb-1 z-20 min-w-[9rem] rounded-lg border border-stone-200 bg-white shadow-lg py-1">
                          <button type="button" onClick={() => withdraw(a.id)} className="w-full text-left px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">
                            {t('proof.withdraw_answer')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {own.length === 0 && <p className="p-4 text-sm text-stone-500 bg-white rounded-2xl border border-stone-200 shadow-sm">{t('proof.no_requests')}</p>}
          {own.map((r) => (
            <Link key={r.id} to={`/app/requests/${r.id}`} className="block bg-white rounded-2xl border border-stone-200 shadow-sm p-4 hover:bg-stone-50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-stone-900">{r.title}</p>
                  <p className="text-xs text-stone-500 mt-0.5">{r.requesterName}</p>
                </div>
                <StatusPill status={r.status} />
              </div>
              <p className="mt-3 text-xs text-stone-600">
                {t('proof.answers_count', { count: r.responses })} · {t('proof.until', { date: longDate(toSeconds(r.expiresAt)) })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
