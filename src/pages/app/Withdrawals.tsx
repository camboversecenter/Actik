// Withdraw a credential, and keep the withdrawal list current.
//
// Each withdrawal re-signs the institution's list with its own key and
// publishes it; verifiers then refuse that credential, saying the institution
// withdrew it (or replaced it with a corrected one). The list is public, so it
// carries only hashes and one of two fixed reasons — never a document number,
// a name, or the institution's own explanation. The list also has to be re-signed at least every 30
// days even when nothing changes — a lapsed list makes every verifier report
// "standing unchecked" for all of this institution's credentials — so the page
// shows when it lapses and offers to renew.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, ArrowLeft } from 'lucide-react'
import { longDate } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import IssuerKeyUnlock from '../../components/IssuerKeyUnlock'
import { getIssuerKey, subscribeIssuerKey } from '../../lib/issuerKeyStore'
import {
  loadIssuedRecords,
  publishWithdrawals,
  WithdrawalBlocked,
  type IssuedRecord,
  type IssuerContext,
} from '../../lib/withdrawal'
import type { OpenedRevocations, WithdrawalReason, WithdrawalRequest } from '../../lib/revocation'

const REASONS: Array<{ value: WithdrawalReason; label: string; hint: string }> = [
  { value: 'withdrawn', label: 'Withdrawn', hint: 'Taken back: rescinded, or issued in error.' },
  { value: 'corrected', label: 'Replaced by a corrected credential', hint: 'A corrected one has been issued in its place.' },
]

const REASON_LABEL: Record<WithdrawalReason, string> = { withdrawn: 'Withdrawn', corrected: 'Replaced by a corrected credential' }

function ReasonPicker(props: { value: WithdrawalReason; onChange: (v: WithdrawalReason) => void; name: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs text-stone-500 mb-1">
        Verifiers see only this category. Keep your own explanation in your records — the list is public.
      </legend>
      {REASONS.map((r) => (
        <label key={r.value} className="flex items-start gap-2 text-sm text-stone-700">
          <input
            type="radio"
            name={props.name}
            value={r.value}
            checked={props.value === r.value}
            onChange={() => props.onChange(r.value)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{r.label}</span> <span className="text-xs text-stone-500">{r.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

const fmt = (t: number) => longDate(t)

export default function Withdrawals() {
  const navigate = useNavigate()
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [issuer, setIssuer] = useState<IssuerContext | null>(null)
  const [records, setRecords] = useState<IssuedRecord[]>([])
  const [revocations, setRevocations] = useState<OpenedRevocations | null>(null)
  const [revocationsError, setRevocationsError] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(!!getIssuerKey())

  const [pendingId, setPendingId] = useState<string | null>(null)
  const [reason, setReason] = useState<WithdrawalReason>('withdrawn')
  const [byNumber, setByNumber] = useState('')
  const [byNumberReason, setByNumberReason] = useState<WithdrawalReason>('withdrawn')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => subscribeIssuerKey(() => setHasKey(!!getIssuerKey())), [])

  const load = useCallback(async (userId: string) => {
    setLoading(true)
    const result = await loadIssuedRecords(userId)
    setIssuer(result.issuer)
    setRecords(result.records)
    setRevocations(result.revocations)
    setRevocationsError(result.revocationsError)
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      if (!u) return navigate('/auth/login')
      setUser({ id: u.id, email: u.email ?? '' })
      load(u.id)
    })
  }, [load, navigate])

  const publish = async (add: WithdrawalRequest[], done: string) => {
    if (!issuer || !user) return
    setBusy(true)
    setMessage(null)
    try {
      await publishWithdrawals(issuer.did, add)
      setMessage({ tone: 'ok', text: done })
      setPendingId(null)
      setReason('withdrawn')
      setByNumber('')
      setByNumberReason('withdrawn')
      await load(user.id)
    } catch (e) {
      setMessage({
        tone: 'error',
        text: e instanceof WithdrawalBlocked ? e.message : `Nothing was published: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const withdraw = (r: IssuedRecord) => {
    const now = Math.floor(Date.now() / 1000)
    // Name it both ways when we can: the jti withdraws the in-app credential,
    // the document number withdraws its printed copy, which carries no jti.
    const entry: WithdrawalRequest = { jti: r.jti, documentId: r.documentId, reason, revokedAt: now }
    publish([entry], `Withdrawn. Verifiers will refuse “${r.title}” as soon as they next check your list.`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={36} className="animate-spin text-indigo-600" />
      </div>
    )
  }

  if (!issuer) {
    return <div className="max-w-2xl mx-auto p-6 text-stone-600">No institution is registered to this account.</div>
  }

  if (!hasKey && user) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <p className="text-sm text-stone-600 mb-4">
          Withdrawals are signed with your institution's key. Unlock it to continue.
        </p>
        <IssuerKeyUnlock userId={user.id} userEmail={user.email} did={issuer.did} onUnlocked={() => setHasKey(true)} />
      </div>
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const lapsesInDays = revocations ? Math.floor((revocations.expires - now) / 86400) : null

  return (
    <div className="w-full md:max-w-3xl mx-auto pb-24 px-4 md:px-0 pt-4 space-y-6">
      <Link to="/app/issued" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> Issued credentials
      </Link>

      <div>
        <h1 className="text-2xl font-extrabold text-stone-900">Withdrawals</h1>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">
          Withdrawing a credential adds it to {issuer.name}'s signed withdrawal list. Verifiers then refuse it and say
          your institution withdrew it. They can be up to a day behind, and a verifier offline for longer can be further
          behind than that — a withdrawal is not instant.
        </p>
      </div>

      {/* The list's own standing: what verifiers will say about every credential. */}
      <div
        className={`rounded-xl border p-4 text-sm ${
          revocationsError
            ? 'border-rose-200 bg-rose-50 text-rose-800'
            : !revocations || (lapsesInDays !== null && lapsesInDays < 7)
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-stone-200 bg-white text-stone-700'
        }`}
      >
        {revocationsError ? (
          <p>{revocationsError}</p>
        ) : !revocations ? (
          <p>
            You have not published a withdrawal list. Until you do, verifiers report the standing of every credential
            you issue as <strong>unchecked</strong>.
          </p>
        ) : lapsesInDays !== null && lapsesInDays < 0 ? (
          <p>
            Your withdrawal list (version {revocations.version}) <strong>lapsed on {fmt(revocations.expires)}</strong>.
            Verifiers now report your credentials' standing as unchecked. Renew it.
          </p>
        ) : (
          <p>
            Your withdrawal list is version {revocations.version}, signed {fmt(revocations.issuedAt)}, with{' '}
            {revocations.entries.length} withdrawal{revocations.entries.length === 1 ? '' : 's'}. It lapses on{' '}
            <strong>{fmt(revocations.expires)}</strong>
            {lapsesInDays !== null && lapsesInDays < 7 ? ' — renew it before then.' : '.'}
          </p>
        )}
        {revocations?.legacy && (
          <p className="mt-2 font-semibold text-rose-800">
            This list was published in the old format, which shows document numbers and your reasons to anyone who
            reads it. Renew it now: the new version keeps every withdrawal but publishes only hashes of them.
          </p>
        )}
        {!revocationsError && (
          <button
            type="button"
            disabled={busy}
            onClick={() => publish([], 'Withdrawal list renewed for another 30 days.')}
            className="mt-3 px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-800 text-xs font-semibold disabled:opacity-50"
          >
            {revocations ? 'Renew list now' : 'Publish an empty list now'}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Everything this institution has issued, from the database's own log. */}
      <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
        {records.length === 0 && <p className="p-4 text-sm text-stone-500">Nothing issued yet.</p>}
        {records.map((r) => (
          <div key={r.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-stone-900 truncate">{r.title}</div>
                <div className="text-xs text-stone-500 font-mono truncate">
                  {r.documentId ?? 'no document number'} · {r.email ?? ''} · {new Date(r.date).toLocaleDateString()}
                </div>
              </div>
              {r.withdrawn ? (
                <span className="shrink-0 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-1">
                  Withdrawn {fmt(r.withdrawn.revokedAt)}
                </span>
              ) : (
                pendingId !== r.id && (
                  <button
                    type="button"
                    disabled={busy || !!revocationsError || (!r.jti && !r.documentId)}
                    onClick={() => {
                      setPendingId(r.id)
                      setReason('withdrawn')
                    }}
                    className="shrink-0 text-xs font-semibold text-rose-700 border border-rose-200 rounded-lg px-2.5 py-1 disabled:opacity-40"
                  >
                    Withdraw
                  </button>
                )
              )}
            </div>
            {r.withdrawn && <p className="text-xs text-stone-500">{REASON_LABEL[r.withdrawn.reason]}</p>}
            {pendingId === r.id && (
              <div className="space-y-2">
                <ReasonPicker name={`reason-${r.id}`} value={reason} onChange={setReason} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => withdraw(r)}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? 'Signing…' : 'Withdraw — this cannot be undone'}
                  </button>
                  <button type="button" onClick={() => setPendingId(null)} className="px-3 py-1.5 text-xs text-stone-600">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Credentials issued before each one carried its own id are withdrawn
          by the number printed on them. */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
        <h2 className="text-sm font-bold text-stone-900">Withdraw by document number</h2>
        <p className="text-xs text-stone-500">
          For credentials issued before this list existed. Uses the certificate or licence number printed on the
          document — never a student number, which may appear on several documents.
        </p>
        <input
          value={byNumber}
          onChange={(e) => setByNumber(e.target.value)}
          placeholder="e.g. NUM-2026-BBA-0417"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
        <ReasonPicker name="reason-by-number" value={byNumberReason} onChange={setByNumberReason} />
        <button
          type="button"
          disabled={busy || !!revocationsError || byNumber.trim().length < 3}
          onClick={() =>
            publish(
              [{ documentId: byNumber.trim(), reason: byNumberReason, revokedAt: Math.floor(Date.now() / 1000) }],
              `Document ${byNumber.trim()} withdrawn.`
            )
          }
          className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"
        >
          Withdraw this number — cannot be undone
        </button>
      </div>
    </div>
  )
}
