// Answer a proof request from your own wallet.
//
// Everything happens on the candidate's device: the vault is decrypted here,
// each matching credential is checked here (a withdrawn one is not offered),
// and the presentation is cut down here to the fields the request may see.
// The candidate sees exactly what the employer will see before sending.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import VaultUnlockModal from '../../components/VaultUnlockModal'
import { verifyIssuedCredential } from '../../lib/claimVerification'
import { CredentialRefused, messageForRefusal } from '../../lib/credentialCheck'
import { peekJwt, readDisclosures } from '../../lib/sdjwt'
import {
  allowedClaims,
  buildAnswer,
  claimedType,
  type AnswerItem,
  type ProofRequest,
} from '../../lib/proofRequest'
import { getProofRequest, submitAnswer } from '../../lib/proofRequestApi'
import { RequestSummary } from './ProofRequestPublic'
import { displayClaim } from '../../lib/claimDisplay'

type UnlockMethod = 'pin' | 'passkey' | 'biometric' | 'both' | null

interface Candidate {
  id: string
  label: string
  type: string | null
  sdjwt: string
  claims: Record<string, unknown>
  /** null while checking; a refusal message when it cannot be offered. */
  check: { usable: true; issuer: string } | { usable: false; message: string } | null
}


export default function AnswerProofRequest() {
  const { id = '' } = useParams<{ id: string }>()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { isUnlocked, unlockWithPin, unlockWithPasskey, checkVaultStatus, decryptPayload } = useZkVault()

  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [request, setRequest] = useState<ProofRequest | null | undefined>(undefined)
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [unlockMethod, setUnlockMethod] = useState<UnlockMethod>(null)
  const [pin, setPin] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [choice, setChoice] = useState<Record<number, string | null>>({})
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user
      if (!u) return navigate('/auth/login')
      setUser({ id: u.id, email: u.email ?? '' })
      setContact(u.email ?? '')
      const status = await checkVaultStatus(u.id)
      setVaultExists(status.status === 'ok' ? status.exists : false)
      const { data: v } = await supabase.from('vaults').select('unlock_method').eq('user_id', u.id).maybeSingle()
      if (v?.unlock_method) setUnlockMethod(v.unlock_method as UnlockMethod)
      else {
        const { data: p } = await supabase.from('profiles').select('vault_envelope_pin, vault_envelope_passkey').eq('id', u.id).maybeSingle()
        const pinSet = !!p?.vault_envelope_pin
        const passkeySet = !!p?.vault_envelope_passkey
        setUnlockMethod(pinSet && passkeySet ? 'both' : pinSet ? 'pin' : passkeySet ? 'passkey' : null)
      }
    })
    getProofRequest(id).then(setRequest).catch(() => setRequest(null))
  }, [id, checkVaultStatus, navigate])

  // Decrypt the wallet and check every credential of a requested type.
  useEffect(() => {
    if (!isUnlocked || !user || !request || candidates) return
    const wanted = new Set(request.requirements.map((r) => r.type))
    ;(async () => {
      const { data } = await supabase.from('credentials').select('*').eq('owner', user.id)
      const out: Candidate[] = []
      for (const row of data ?? []) {
        try {
          const decrypted = (row.cipher && row.iv
            ? await decryptPayload({ cipher: row.cipher, iv: row.iv })
            : await decryptPayload(JSON.parse(row.sd_jwt))) as { sdjwt: string }
          const type = claimedType(decrypted.sdjwt)
          if (!type || !wanted.has(type)) continue
          const claims = Object.fromEntries(readDisclosures(decrypted.sdjwt).map((d) => [d.name, d.value]))
          out.push({ id: row.id, label: row.label || row.degree_title || t(`proof.type_${type}`), type, sdjwt: decrypted.sdjwt, claims, check: null })
        } catch {
          // a credential that will not decrypt is simply not offered
        }
      }
      setCandidates(out)
      const checked = await Promise.all(out.map(async (c) => {
        try {
          const r = await verifyIssuedCredential(c.sdjwt, peekJwt(c.sdjwt).iss)
          return { ...c, check: { usable: true as const, issuer: `${r.issuer.name} · ${t(`proof.kind_${r.issuer.kind ?? 'institution'}`)}` } }
        } catch (e) {
          const message = e instanceof CredentialRefused ? messageForRefusal(e.reason) : String(e)
          return { ...c, check: { usable: false as const, message } }
        }
      }))
      setCandidates(checked)
      const first: Record<number, string | null> = {}
      request.requirements.forEach((r, i) => {
        first[i] = checked.find((c) => c.type === r.type && c.check?.usable)?.id ?? null
      })
      setChoice(first)
    })()
  }, [isUnlocked, user, request, candidates, decryptPayload, t])

  const items: AnswerItem[] = useMemo(() => {
    if (!request || !candidates) return []
    const out: AnswerItem[] = []
    request.requirements.forEach((r, i) => {
      const c = candidates.find((x) => x.id === choice[i])
      if (!c?.check?.usable) return
      try {
        out.push({ requirement: i, presentation: buildAnswer(r, c.sdjwt) })
      } catch {
        // buildAnswer refuses a credential it cannot send; it is then simply not sent
      }
    })
    return out
  }, [request, candidates, choice])

  const send = async () => {
    if (!request) return
    setSending(true)
    setError(null)
    try {
      await submitAnswer(request.id, contact, items)
      setSent(true)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m === 'ALREADY_ANSWERED' ? t('proof.already_answered') : m)
    } finally {
      setSending(false)
    }
  }

  if (request === undefined || vaultExists === null) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>
  }
  if (!request) return <div className="max-w-2xl mx-auto p-6 text-stone-600">{t('proof.not_found')}</div>

  return (
    <div className="w-full md:max-w-2xl mx-auto pb-24 px-4 md:px-0 pt-4 space-y-6">
      <Link to="/app/requests" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> {t('proof.page_title')}
      </Link>
      <RequestSummary request={request} />

      {sent ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-800 space-y-2" data-testid="answer-sent">
          <p className="font-semibold">{t('proof.sent_title')}</p>
          <p>{t('proof.sent_desc', { requester: request.requesterName })}</p>
          <Link to="/app/requests" className="text-indigo-700 font-semibold">{t('proof.your_answers')}</Link>
        </div>
      ) : request.status !== 'open' ? null : !vaultExists ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t('proof.no_wallet')} <Link to="/app/vault-setup" className="font-semibold underline">{t('proof.set_up_wallet')}</Link>
        </div>
      ) : !isUnlocked ? (
        <VaultUnlockModal
          unlockMethod={unlockMethod}
          pinInput={pin}
          onPinChange={setPin}
          onSubmitPin={async (e) => {
            e.preventDefault()
            if (!user) return
            setUnlocking(true)
            setUnlockError(null)
            try { if (!(await unlockWithPin(pin, user.id))) setUnlockError(t('proof.unlock_failed')) }
            catch { setUnlockError(t('proof.unlock_failed')) }
            finally { setUnlocking(false) }
          }}
          onPasskeyClick={async () => {
            if (!user) return
            setUnlocking(true)
            setUnlockError(null)
            try { if (!(await unlockWithPasskey(user.id))) setUnlockError(t('proof.unlock_failed')) }
            catch { setUnlockError(t('proof.unlock_failed')) }
            finally { setUnlocking(false) }
          }}
          isUnlocking={unlocking}
          unlockError={unlockError}
          onCancel={() => navigate('/app/requests')}
        />
      ) : !candidates ? (
        <Loader2 className="animate-spin text-indigo-600" size={24} />
      ) : (
        <>
          {request.requirements.map((r, i) => {
            const matches = candidates.filter((c) => c.type === r.type)
            const chosen = candidates.find((c) => c.id === choice[i])
            const shown = chosen ? allowedClaims(r).filter((k) => !['iss', 'iat', 'exp'].includes(k) && chosen.claims[k] !== undefined && chosen.claims[k] !== '') : []
            return (
              <section key={i} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3" data-testid={`answer-requirement-${i}`}>
                <h2 className="text-sm font-bold text-stone-900">{i + 1}. {t(`proof.type_${r.type}`)}{r.note && <span className="font-normal text-stone-500"> — {r.note}</span>}</h2>
                {matches.length === 0 && <p className="text-sm text-stone-500">{t('proof.no_match')}</p>}
                {matches.map((c) => (
                  <label key={c.id} className={`flex items-start gap-2 text-sm ${c.check?.usable === false ? 'text-stone-400' : 'text-stone-800'}`}>
                    <input
                      type="radio" name={`req-${i}`} className="mt-1" checked={choice[i] === c.id}
                      disabled={!c.check?.usable} onChange={() => setChoice((ch) => ({ ...ch, [i]: c.id }))}
                    />
                    <span>
                      <span className="font-medium">{c.label}</span>
                      {c.check === null && <span className="block text-xs text-stone-500">{t('proof.checking')}</span>}
                      {c.check?.usable && <span className="block text-xs text-stone-500">{t('proof.issued_by')} {c.check.issuer}</span>}
                      {c.check?.usable === false && <span className="block text-xs text-rose-700">{c.check.message}</span>}
                    </span>
                  </label>
                ))}
                {matches.length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-stone-600">
                    <input type="radio" name={`req-${i}`} checked={choice[i] === null} onChange={() => setChoice((ch) => ({ ...ch, [i]: null }))} />
                    {t('proof.skip_requirement')}
                  </label>
                )}
                {chosen && (
                  <div className="rounded-lg bg-stone-50 border border-stone-200 p-3" data-testid={`preview-${i}`}>
                    <p className="text-xs font-semibold text-stone-600 mb-1">{t('proof.they_will_see', { requester: request.requesterName })}</p>
                    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-0.5 text-xs">
                      {shown.map((k) => (
                        <div key={k} className="contents">
                          <dt className="text-stone-500">{t(`proof.field_${k}`)}</dt>
                          <dd className="text-stone-900 break-words">{displayClaim(t, k, chosen.claims[k], peekJwt(chosen.sdjwt).iat)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </section>
            )
          })}

          <label className="block text-sm font-medium text-stone-800">
            {t('proof.contact_label')}
            <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm mt-1" name="contact" />
            <span className="block text-xs text-stone-500 font-normal mt-1">{t('proof.contact_hint')}</span>
          </label>

          {error && <div className="rounded-lg p-3 bg-rose-50 text-rose-800 border border-rose-200 text-sm">{error}</div>}

          <button
            type="button" onClick={send} disabled={sending || items.length === 0 || contact.trim().length < 3}
            className="w-full h-12 rounded-xl bg-indigo-600 text-white font-semibold text-sm disabled:opacity-50"
          >
            {sending ? t('proof.sending') : t('proof.send_answer', { count: items.length })}
          </button>
          <p className="text-xs text-stone-500 leading-relaxed">{t('proof.answer_privacy')}</p>
        </>
      )}
    </div>
  )
}
