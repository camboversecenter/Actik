// Reissue requests: people whose wallet key changed, asking this issuer to
// reissue their credentials to the new key (docs/KEY_RECOVERY.md).
//
// Each request is checked before it is shown: the old key's proof, or a fresh
// identity check bound to the new key whose name matches the credential.
// Reissuing signs the same claims to the new key, sends them to the person's
// inbox, and withdraws the old credential as "replaced by a corrected one".

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import IssuerKeyUnlock from '../../components/IssuerKeyUnlock'
import { getIssuerKey, subscribeIssuerKey } from '../../lib/issuerKeyStore'
import { loadIssuerContext, type IssuerContext } from '../../lib/withdrawal'
import { messageForRefusal } from '../../lib/credentialCheck'
import { messageForReissueRefusal } from '../../lib/reissue'
import {
  loadReissueRequests, reissueFromRequest, declineReissueRequest, type CheckedReissueRequest,
} from '../../lib/reissueApi'

interface LogEntry { jti: string | null; label: string | null; credential_type: string | null; issued_at: string }

const PROOF_LABEL = {
  old_key: 'Proven with the old wallet key',
  identity: 'Proven with a fresh identity check, bound to the new key',
}

export default function ReissueRequests() {
  const navigate = useNavigate()
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [issuer, setIssuer] = useState<IssuerContext | null>(null)
  const [items, setItems] = useState<CheckedReissueRequest[] | null>(null)
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({})
  const [hasKey, setHasKey] = useState(!!getIssuerKey())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => subscribeIssuerKey(() => setHasKey(!!getIssuerKey())), [])

  const load = useCallback(async (userId: string) => {
    const ctx = await loadIssuerContext(userId)
    setIssuer(ctx)
    if (!ctx) return setItems([])
    try {
      const checked = await loadReissueRequests(ctx.did)
      setItems(checked)
      // For a request with no credential attached: this issuer's own record of
      // what it issued to that email, to issue again from.
      const emails = [...new Set(checked.filter((c) => c.check.kind === 'needs_records').map((c) => c.row.recipient_email))]
      const found: Record<string, LogEntry[]> = {}
      for (const email of emails) {
        const { data } = await supabase.from('issued_credentials')
          .select('jti, label, credential_type, issued_at').eq('issuer_did', ctx.did).eq('recipient_email', email)
          .order('issued_at', { ascending: false })
        found[email] = (data ?? []) as LogEntry[]
      }
      setLogs(found)
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
      setItems([])
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      if (!u) return navigate('/auth/login')
      setUser({ id: u.id, email: u.email ?? '' })
      load(u.id)
    })
  }, [load, navigate])

  const act = async (id: string, fn: () => Promise<void>, done: string) => {
    if (!user) return
    setBusy(id)
    setMessage(null)
    try {
      await fn()
      setMessage({ tone: 'ok', text: done })
      await load(user.id)
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!items || !user) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 size={36} className="animate-spin text-indigo-600" /></div>
  }
  if (!issuer) return <div className="max-w-2xl mx-auto p-6 text-stone-600">No issuer is registered to this account.</div>

  return (
    <div className="w-full md:max-w-3xl mx-auto pb-24 px-4 md:px-0 pt-4 space-y-6">
      <Link to="/app/issued" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> Issued credentials
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold text-stone-900">Reissue requests</h1>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">
          People whose wallet key changed — a forgotten PIN, a lost or compromised phone — ask you to reissue their
          credentials to their new key. Each request has been checked below. Reissuing signs the same details again,
          bound to the new key, and withdraws the old credential as “replaced by a corrected credential”, so a copy
          in the wrong hands stops verifying.
        </p>
      </div>

      {message && (
        <div className={`rounded-lg p-3 text-sm border ${message.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
          {message.text}
        </div>
      )}

      {!hasKey && items.some((i) => i.check.kind !== 'refused') && (
        <IssuerKeyUnlock userId={user.id} userEmail={user.email} did={issuer.did} onUnlocked={() => setHasKey(true)} />
      )}

      {items.length === 0 && <p className="text-sm text-stone-500">No open requests.</p>}

      {items.map((item) => {
        const { row, check } = item
        return (
          <article key={row.id} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3" data-testid="reissue-request">
            <div className="flex justify-between gap-3 text-sm">
              <span className="font-semibold text-stone-900 break-all">{row.recipient_email}</span>
              <span className="text-xs text-stone-500 shrink-0">{new Date(row.created_at).toLocaleDateString()}</span>
            </div>
            <p className="text-xs text-stone-600">{PROOF_LABEL[row.proof]}</p>

            {check.kind === 'refused' && (
              <div className={`rounded-lg border p-3 text-sm ${check.unavailable ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                <p className="font-semibold">{check.unavailable ? 'Could not be checked right now' : 'Do not reissue'}</p>
                <p className="text-xs mt-0.5">{check.reason.startsWith('REISSUE_') || check.reason === 'CREDENTIAL_REVOKED'
                  ? messageForReissueRefusal(check.reason) : messageForRefusal(check.reason)}</p>
              </div>
            )}

            {check.kind !== 'refused' && check.identity && (
              <p className="text-sm text-stone-700">
                Identity checked in person by <strong>{check.identity.verifier}</strong> on {check.identity.verifiedOn}:
                {' '}<strong>{check.identity.name}</strong>
              </p>
            )}

            {check.kind === 'ready' && (
              <div className="text-sm text-stone-700 space-y-1">
                <p>Credential to reissue: <strong>{String(check.claims.degree_type ?? check.claims.job_title ?? check.claims.cert_name ?? check.old.assertion.credentialType)}</strong> for <strong>{String(check.claims.name ?? '')}</strong></p>
                <p className="text-xs text-stone-500">The same details, as you signed them, will be signed again to the new key. Check them against your records.</p>
              </div>
            )}

            {check.kind === 'needs_records' && (
              <div className="text-sm text-stone-700 space-y-2">
                <p className="text-xs text-stone-500">The person no longer has the credential (their wallet was lost with it). Issue it again from your own records — the form opens with their email and the name from the identity check.</p>
                <ul className="divide-y divide-stone-100">
                  {(logs[row.recipient_email] ?? []).map((l) => (
                    <li key={l.jti ?? l.issued_at} className="py-1.5 flex justify-between gap-3">
                      <span>{l.label ?? l.credential_type} <span className="text-xs text-stone-500">· {new Date(l.issued_at).toLocaleDateString()}</span></span>
                      <Link className="text-xs font-semibold text-indigo-700"
                        to={`/app/issue?reissue=${row.id}&replaces=${l.jti ?? ''}&email=${encodeURIComponent(row.recipient_email)}&name=${encodeURIComponent(check.identity.name)}&type=${l.credential_type ?? ''}`}>
                        Issue again →
                      </Link>
                    </li>
                  ))}
                  {(logs[row.recipient_email] ?? []).length === 0 && <li className="py-1.5 text-xs text-stone-500">You have no record of issuing anything to this email.</li>}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {check.kind === 'ready' && (
                <button type="button" disabled={!hasKey || !!busy}
                  onClick={() => act(row.id, () => reissueFromRequest({ did: issuer.did, name: issuer.name }, item),
                    'Reissued to the new key and the old one withdrawn. It reaches the person’s wallet when they accept it.')}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50">
                  {busy === row.id ? <Loader2 size={12} className="animate-spin" /> : 'Reissue to the new key'}
                </button>
              )}
              <button type="button" disabled={!!busy}
                onClick={() => window.confirm('Decline this request? The person can ask again.') && act(row.id, () => declineReissueRequest(row.id), 'Declined.')}
                className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 disabled:opacity-50">
                Decline
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
