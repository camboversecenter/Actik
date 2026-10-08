// Create a proof request. The form can only offer what the format allows:
// credential types from REQUESTABLE and, for each, its listed extra fields.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import {
  MAX_REQUIREMENTS,
  ProofRequestInvalid,
  REQUESTABLE,
  type Requirement,
} from '../../lib/proofRequest'
import { createProofRequest } from '../../lib/proofRequestApi'

const TYPES = Object.keys(REQUESTABLE)

export default function NewProofRequest() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [requesterName, setRequesterName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState<Requirement[]>([{ type: 'academic_degree', extras: [], note: '' }])
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, r: Partial<Requirement>) =>
    setRequirements((rs) => rs.map((x, j) => (j === i ? { ...x, ...r } : x)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const id = await createProofRequest({ requesterName, title, description, requirements, expiresInDays: days })
      navigate(`/app/requests/${id}`, { replace: true })
    } catch (err) {
      setError(err instanceof ProofRequestInvalid ? t(`proof.invalid_${err.problem}`) : err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const input = 'w-full border border-stone-300 rounded-lg px-3 py-2 text-sm'

  return (
    <form onSubmit={submit} className="w-full md:max-w-2xl mx-auto space-y-6">
      <Link to="/app/requests" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> {t('proof.page_title')}
      </Link>
      <div>
        <h1 className="text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{t('proof.new_request')}</h1>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">{t('proof.new_intro')}</p>
      </div>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <label className="block text-sm font-medium text-stone-800">
          {t('proof.requester_name')}
          <input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} className={`${input} mt-1`} maxLength={120} name="requesterName" />
          <span className="block text-xs text-stone-500 font-normal mt-1">{t('proof.requester_name_hint')}</span>
        </label>
        <label className="block text-sm font-medium text-stone-800">
          {t('proof.request_title')}
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mt-1`} maxLength={120} name="title" placeholder={t('proof.request_title_placeholder')} />
        </label>
        <label className="block text-sm font-medium text-stone-800">
          {t('proof.description')}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} mt-1`} rows={3} maxLength={2000} name="description" />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-stone-900">{t('proof.what_you_ask')}</h2>
        {requirements.map((r, i) => (
          <div key={i} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3" data-testid={`requirement-${i}`}>
            <div className="flex items-center gap-2">
              <select
                value={r.type} onChange={(e) => update(i, { type: e.target.value, extras: [] })}
                className={input} aria-label={t('proof.credential_type')}
              >
                {TYPES.map((type) => <option key={type} value={type}>{t(`proof.type_${type}`)}</option>)}
              </select>
              {requirements.length > 1 && (
                <button type="button" onClick={() => setRequirements((rs) => rs.filter((_, j) => j !== i))}
                  className="p-2 text-stone-400 hover:text-rose-700" aria-label={t('proof.remove')}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            {REQUESTABLE[r.type].extras.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-stone-500">{t('proof.also_ask')}</p>
                {REQUESTABLE[r.type].extras.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox" checked={r.extras.includes(f)}
                      onChange={(e) => update(i, { extras: e.target.checked ? [...r.extras, f] : r.extras.filter((x) => x !== f) })}
                    />
                    {t(`proof.field_${f}`)}
                  </label>
                ))}
              </div>
            )}
            <input
              value={r.note} onChange={(e) => update(i, { note: e.target.value })} maxLength={300}
              className={input} placeholder={t('proof.note_placeholder')} aria-label={t('proof.note')}
            />
          </div>
        ))}
        {requirements.length < MAX_REQUIREMENTS && (
          <button type="button" onClick={() => setRequirements((rs) => [...rs, { type: 'professional_certification', extras: [], note: '' }])}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700">
            <Plus size={14} /> {t('proof.add_requirement')}
          </button>
        )}
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600 leading-relaxed space-y-1">
          <p>{t('proof.always_shown')}</p>
          <p>{t('proof.never_asked')}</p>
        </div>
      </section>

      <label className="block text-sm font-medium text-stone-800">
        {t('proof.open_for')}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${input} mt-1`}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{t('proof.days', { count: d })}</option>)}
        </select>
      </label>

      {error && <div className="rounded-lg p-3 bg-rose-50 text-rose-800 border border-rose-200 text-sm">{error}</div>}

      <button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-indigo-600 text-white font-semibold text-sm disabled:opacity-50">
        {busy ? t('proof.saving') : t('proof.create')}
      </button>
    </form>
  )
}
