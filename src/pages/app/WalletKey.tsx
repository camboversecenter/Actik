// The holder's wallet key: what it is, replacing it, and moving credentials to
// a new one (docs/KEY_RECOVERY.md).
//
// A key is never changed, only retired. After that, credentials bound to the
// old key are asked for again, issuer by issuer: proven with the old key if it
// is still available and was not compromised, otherwise with a fresh identity
// check bound to the new key.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, KeyRound, Loader2, ShieldAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import { longDate } from '../../lib/dates'
import { peekJwt, readDisclosures } from '../../lib/sdjwt'
import { claimedType } from '../../lib/proofRequest'
import { keyId, publicOnly } from '../../lib/trustList'
import { loadTrustState } from '../../lib/trustAnchor'
import {
  ensureHolderKey, retireHolderKey, listHolderKeys, openRetiredKey, HolderKeyUnreadable,
  type HeldHolderKey, type HolderKeyRecord, type RetirementReason,
} from '../../lib/holderKey'
import { buildReissueRequest } from '../../lib/reissue'
import { sendReissueRequest, listOwnReissueRequests, type OwnReissueRequest } from '../../lib/reissueApi'
import { IDENTITY_TYPE } from '../../lib/identity'

interface HeldCredential {
  id: string
  sdjwt: string
  type: string | null
  issuerDid: string
  issuerName: string
  title: string
  /** Thumbprint of the key it is bound to; null when unbound. */
  boundTo: string | null
}

function jwtPayload(sdjwt: string): any {
  const p = sdjwt.split('~')[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
}

const short = (kid: string) => `${kid.slice(0, 8)}…${kid.slice(-4)}`

export default function WalletKey() {
  const { t } = useLanguage()
  const { isUnlocked, encryptPayload, decryptPayload } = useZkVault()
  const [userId, setUserId] = useState<string | null>(null)
  const [current, setCurrent] = useState<HeldHolderKey | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [keys, setKeys] = useState<HolderKeyRecord[]>([])
  const [held, setHeld] = useState<HeldCredential[]>([])
  const [requests, setRequests] = useState<OwnReissueRequest[]>([])
  const [issuers, setIssuers] = useState<Array<{ did: string; name: string }>>([])
  const [lostIssuer, setLostIssuer] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user?.id ?? null
    setUserId(uid)
    if (!uid || !isUnlocked) return
    try {
      setCurrent(await ensureHolderKey(uid, encryptPayload, (p) => decryptPayload(p)))
      setUnreadable(false)
    } catch (e) {
      setCurrent(null)
      setUnreadable(e instanceof HolderKeyUnreadable)
    }
    setKeys(await listHolderKeys(uid).catch(() => []))
    setRequests(await listOwnReissueRequests().catch(() => []))
    const { data: rows } = await supabase.from('credentials').select('id, cipher, iv, institution_name').eq('owner', uid)
    const out: HeldCredential[] = []
    for (const r of rows ?? []) {
      try {
        const opened = await decryptPayload({ cipher: r.cipher, iv: r.iv }) as { sdjwt?: string }
        if (!opened.sdjwt) continue
        const payload = jwtPayload(opened.sdjwt)
        const claims = Object.fromEntries(readDisclosures(opened.sdjwt).map((d) => [d.name, d.value]))
        out.push({
          id: r.id, sdjwt: opened.sdjwt, type: claimedType(opened.sdjwt), issuerDid: String(payload.iss ?? ''),
          issuerName: String(claims.institution ?? r.institution_name ?? payload.iss ?? ''),
          title: String(claims.degree_type ?? claims.job_title ?? claims.cert_name ?? claims.program_name ?? claims.event_name ?? claims.achievement_title ?? ''),
          boundTo: payload.cnf?.jwk ? await keyId(publicOnly(payload.cnf.jwk)) : null,
        })
      } catch {
        // Sealed by a wallet that has since been reset: nothing to read.
      }
    }
    setHeld(out)
    const trust = await loadTrustState()
    setIssuers(trust.list ? [...trust.list.issuers.values()]
      .filter((i) => i.kind !== 'identity_verifier').map((i) => ({ did: i.did, name: i.name })) : [])
  }, [isUnlocked, encryptPayload, decryptPayload])

  useEffect(() => { load() }, [load])

  const retire = async (reason: RetirementReason, kid?: string) => {
    if (!window.confirm(t(`walletkey.confirm_${kid ? 'mark_compromised' : reason}`))) return
    setBusy(kid ?? reason)
    setMessage(null)
    try {
      await retireHolderKey(reason, kid)
      await load()
      setMessage({ tone: 'ok', text: t('walletkey.retired_ok') })
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  // An identity check bound to the current key, if the wallet holds one.
  const identity = current ? held.find((c) => c.type === IDENTITY_TYPE && c.boundTo === current.kid) ?? null : null
  const toMove = current ? held.filter((c) => c.boundTo && c.boundTo !== current.kid && c.type !== IDENTITY_TYPE) : []
  const requested = (c: HeldCredential) => requests.some((r) => r.status === 'open' && r.oldJti === peekJwt(c.sdjwt).jti)

  const ask = async (issuerDid: string, credential: HeldCredential | null) => {
    if (!current || !userId) return
    setBusy(credential?.id ?? issuerDid)
    setMessage(null)
    try {
      const oldRecord = credential ? keys.find((k) => k.kid === credential.boundTo) : undefined
      const oldKey = credential && oldRecord && oldRecord.retiredReason !== 'compromised'
        ? await openRetiredKey(userId, oldRecord.kid, (p) => decryptPayload(p)) : null
      let draft
      if (credential && oldKey) {
        draft = await buildReissueRequest({ issuerDid, newKid: current.kid, proof: 'old_key', credential: credential.sdjwt, oldKey })
      } else if (identity) {
        draft = await buildReissueRequest({ issuerDid, newKid: current.kid, proof: 'identity', identity: identity.sdjwt,
          newKey: current.key, credential: credential?.sdjwt ?? null })
      } else {
        throw new Error(t('walletkey.need_identity'))
      }
      await sendReissueRequest(draft)
      setRequests(await listOwnReissueRequests().catch(() => []))
      setMessage({ tone: 'ok', text: t('walletkey.request_sent') })
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!isUnlocked) {
    return (
      <div className="max-w-2xl mx-auto px-1 space-y-3">
        <h1 className="text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{t('walletkey.title')}</h1>
        <p className="text-sm text-stone-600">{t('walletkey.unlock_first')}</p>
        <Link to="/app/wallet" className="inline-block text-sm font-semibold text-indigo-700">{t('nav.wallet')} →</Link>
      </div>
    )
  }

  return (
    <div className="w-full md:max-w-3xl mx-auto space-y-6">
      <Link to="/app/vault-setup" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft size={14} /> {t('nav.account')}
      </Link>
      <div>
        <h1 className="flex items-center gap-2 text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight"><KeyRound size={22} /> {t('walletkey.title')}</h1>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">{t('walletkey.intro')}</p>
      </div>

      {message && (
        <div className={`rounded-lg p-3 text-sm border ${message.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`} data-testid="walletkey-message">
          {message.text}
        </div>
      )}

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-stone-900">{t('walletkey.current')}</h2>
        {unreadable ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2" data-testid="key-unreadable">
            <p className="font-semibold flex items-center gap-1.5"><ShieldAlert size={15} /> {t('walletkey.unreadable_title')}</p>
            <p className="text-xs">{t('walletkey.unreadable_desc')}</p>
            <button type="button" disabled={!!busy} onClick={() => retire('lost')}
              className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-semibold disabled:opacity-50">
              {t('walletkey.retire_lost')}
            </button>
          </div>
        ) : current ? (
          <>
            <p className="text-sm text-stone-700">{t('walletkey.current_desc')} <code className="font-mono text-xs bg-stone-100 px-1.5 py-0.5 rounded" data-testid="current-kid">{short(current.kid)}</code></p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => retire('replaced')}
                className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-800 disabled:opacity-50">
                {t('walletkey.replace')}
              </button>
              <button type="button" disabled={!!busy} onClick={() => retire('compromised')}
                className="px-3 py-1.5 rounded-lg border border-rose-300 text-xs font-semibold text-rose-800 disabled:opacity-50" data-testid="compromised">
                {t('walletkey.compromised')}
              </button>
            </div>
            <p className="text-xs text-stone-500 leading-relaxed">{t('walletkey.compromised_hint')}</p>
          </>
        ) : (
          <Loader2 className="animate-spin text-indigo-600" size={20} />
        )}
      </section>

      {keys.some((k) => k.retiredAt) && (
        <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
          <h2 className="text-sm font-bold text-stone-900">{t('walletkey.history')}</h2>
          <ul className="text-sm divide-y divide-stone-100">
            {keys.filter((k) => k.retiredAt).map((k) => (
              <li key={k.kid} className="py-2 flex items-center justify-between gap-3">
                <span>
                  <code className="font-mono text-xs">{short(k.kid)}</code>{' '}
                  <span className="text-stone-600">{t(`walletkey.reason_${k.retiredReason}`)} · {longDate(Math.floor(new Date(k.retiredAt!).getTime() / 1000))}</span>
                </span>
                {k.retiredReason !== 'compromised' && (
                  <button type="button" disabled={!!busy} onClick={() => retire('compromised', k.kid)}
                    className="text-xs font-semibold text-rose-700 disabled:opacity-50">{t('walletkey.mark_compromised')}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {current && (
        <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3" data-testid="to-move">
          <h2 className="text-sm font-bold text-stone-900">{t('walletkey.to_move', { count: toMove.length })}</h2>
          <p className="text-xs text-stone-500 leading-relaxed">{identity ? t('walletkey.have_identity') : t('walletkey.no_identity')}</p>
          {toMove.length === 0 && <p className="text-sm text-stone-500">{t('walletkey.nothing_to_move')}</p>}
          <ul className="divide-y divide-stone-100">
            {toMove.map((c) => (
              <li key={c.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span><span className="font-semibold text-stone-900">{c.title || t(`proof.type_${c.type}`)}</span> <span className="text-stone-500">· {c.issuerName}</span></span>
                {requested(c) ? (
                  <span className="text-xs text-stone-500">{t('walletkey.asked')}</span>
                ) : (
                  <button type="button" disabled={!!busy} onClick={() => ask(c.issuerDid, c)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50">
                    {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : t('walletkey.ask_reissue')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {current && (
        <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
          <h2 className="text-sm font-bold text-stone-900">{t('walletkey.lost_heading')}</h2>
          <p className="text-xs text-stone-500 leading-relaxed">{t('walletkey.lost_desc')}</p>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={lostIssuer} onChange={(e) => setLostIssuer(e.target.value)} name="lostIssuer"
              className="rounded-lg border border-stone-300 h-9 px-2 text-sm bg-white">
              <option value="">{t('walletkey.choose_issuer')}</option>
              {issuers.map((i) => <option key={i.did} value={i.did}>{i.name}</option>)}
            </select>
            <button type="button" disabled={!lostIssuer || !identity || !!busy} onClick={() => ask(lostIssuer, null)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50">
              {t('walletkey.ask_issuer')}
            </button>
          </div>
        </section>
      )}

      {requests.length > 0 && (
        <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
          <h2 className="text-sm font-bold text-stone-900">{t('walletkey.requests')}</h2>
          <ul className="text-sm divide-y divide-stone-100">
            {requests.map((r) => (
              <li key={r.id} className="py-2 flex justify-between gap-3">
                <span className="break-all">{issuers.find((i) => i.did === r.issuerDid)?.name ?? r.issuerDid}</span>
                <span className="text-xs text-stone-600 shrink-0">{t(`walletkey.status_${r.status}`)} · {t(`walletkey.proof_${r.proof}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-stone-500 leading-relaxed">{t('walletkey.limits')}</p>
    </div>
  )
}
