// Verified contacts (docs/VERIFIED_CONTACTS.md): people whose wallet key you
// have, and "is it really you, right now?" answered by their wallet.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, UserCheck, Copy, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import { ensureHolderKey, type HeldHolderKey } from '../../lib/holderKey'
import { loadRevocationState, loadTrustState } from '../../lib/trustAnchor'
import { claimedType } from '../../lib/proofRequest'
import { keyId, publicOnly } from '../../lib/trustList'
import { IDENTITY_TYPE } from '../../lib/identity'
import {
  makeContactCard, openContactCard, verifyPresence, messageForPresence, ContactRefused, PresenceRefused,
  type OpenedCard,
} from '../../lib/contacts'
import {
  loadContacts, saveContact, deleteContact, startCheck, readCheck, forgetCheck, type StoredContact,
} from '../../lib/contactsApi'
import QrScanner from '../../components/QrScanner'
import { peekJwt } from '../../lib/sdjwt'

type CheckState =
  | { kind: 'waiting'; id: string; expiresAt: number }
  | { kind: 'confirmed'; at: number }
  | { kind: 'declined' }
  | { kind: 'expired' }
  | { kind: 'refused'; message: string }

const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function Contacts() {
  const { t } = useLanguage()
  const { isUnlocked, encryptPayload, decryptPayload } = useZkVault()
  const [me, setMe] = useState<HeldHolderKey | null>(null)
  const [myCard, setMyCard] = useState<string | null>(null)
  const [myIdCard, setMyIdCard] = useState<string | null>(null)
  const [contacts, setContacts] = useState<StoredContact[]>([])
  const [cardText, setCardText] = useState('')
  const [pending, setPending] = useState<OpenedCard | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const [copied, setCopied] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => () => timers.current.forEach((h) => clearInterval(h)), [])

  const load = useCallback(async () => {
    if (!isUnlocked) return
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user?.id
    if (!uid) return
    try {
      const key = await ensureHolderKey(uid, encryptPayload, (p) => decryptPayload(p))
      setMe(key)
      setMyCard(await makeContactCard({ publicJwk: key.publicJwk, key: key.key }))
      // A card with an identity check, if the wallet holds one bound to this key.
      const { data: rows } = await supabase.from('credentials').select('cipher, iv, credential_type').eq('owner', uid)
        .or(`credential_type.is.null,credential_type.eq.${IDENTITY_TYPE}`)
      let identity: string | null = null
      for (const r of rows ?? []) {
        if (r.credential_type && r.credential_type !== IDENTITY_TYPE) continue
        try {
          const opened = await decryptPayload({ cipher: r.cipher, iv: r.iv }) as { sdjwt?: string }
          const sdjwt = opened.sdjwt
          if (!sdjwt || claimedType(sdjwt) !== IDENTITY_TYPE) continue
          const payload = JSON.parse(atob(sdjwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
          if (payload.cnf?.jwk && (await keyId(publicOnly(payload.cnf.jwk))) === key.kid) identity = sdjwt
        } catch { /* not readable here */ }
      }
      setMyIdCard(identity ? await makeContactCard({ publicJwk: key.publicJwk, key: key.key, identity }) : null)
      setContacts(await loadContacts((p) => decryptPayload(p)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [isUnlocked, encryptPayload, decryptPayload])

  useEffect(() => { load() }, [load])

  const readCard = async (text: string) => {
    setError(null)
    setPending(null)
    try {
      const trust = await loadTrustState()
      const iss = (() => {
        try {
          const card = JSON.parse(atob(text.trim().split(':').pop()!.replace(/-/g, '+').replace(/_/g, '/')))
          return typeof card.identity === 'string' ? peekJwt(card.identity).iss : null
        } catch { return null }
      })()
      const rev = trust.list && iss ? await loadRevocationState(iss, trust.list) : { list: null, failure: null }
      const opened = await openContactCard(text, { trust, revocationsFor: () => rev, now: Math.floor(Date.now() / 1000) })
      if (me && opened.kid === me.kid) throw new ContactRefused('CARD_OWN', t('contacts.own_card'))
      if (contacts.some((c) => c.kid === opened.kid)) throw new ContactRefused('CARD_KNOWN', t('contacts.already_known'))
      setPending(opened)
      setPendingName(opened.identity?.name ?? '')
    } catch (e) {
      setError(e instanceof ContactRefused ? e.message : e instanceof Error ? e.message : String(e))
    }
  }

  const add = async () => {
    if (!pending || !pendingName.trim()) return
    try {
      await saveContact({
        kid: pending.kid, publicJwk: pending.publicJwk, name: pending.identity ? pending.identity.name : pendingName.trim(),
        how: pending.identity ? 'identity_card' : 'in_person', identity: pending.identity, addedAt: Math.floor(Date.now() / 1000),
      }, encryptPayload)
      setPending(null)
      setPendingName('')
      setCardText('')
      setContacts(await loadContacts((p) => decryptPayload(p)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const check = async (c: StoredContact) => {
    if (!me) return
    setError(null)
    try {
      const row = await startCheck(c.kid)
      const askedAt = Math.floor(new Date(row.created_at).getTime() / 1000)
      const expiresAt = Math.floor(new Date(row.expires_at).getTime() / 1000)
      setChecks((s) => ({ ...s, [c.id]: { kind: 'waiting', id: row.id, expiresAt } }))
      const handle = window.setInterval(async () => {
        const now = Math.floor(Date.now() / 1000)
        const r = await readCheck(row.id)
        const done = (state: CheckState) => {
          clearInterval(handle)
          setChecks((s) => ({ ...s, [c.id]: state }))
          forgetCheck(row.id)
        }
        if (!r) return done({ kind: 'expired' })
        if (r.declined) return done({ kind: 'declined' })
        if (r.response) {
          try {
            // Against the key stored when we met — never one the database supplies.
            const { confirmedAt } = await verifyPresence(r.response, { contactJwk: c.publicJwk, nonce: row.nonce, audienceKid: me.kid, askedAt, now })
            return done({ kind: 'confirmed', at: confirmedAt })
          } catch (e) {
            return done({ kind: 'refused', message: e instanceof PresenceRefused ? messageForPresence(e.reason) : String(e) })
          }
        }
        if (now > expiresAt) return done({ kind: 'expired' })
      }, 2000)
      timers.current.push(handle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!isUnlocked) {
    return (
      <div className="max-w-2xl mx-auto px-1 space-y-3">
        <h1 className="text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{t('contacts.title')}</h1>
        <p className="text-sm text-stone-600">{t('walletkey.unlock_first')}</p>
        <Link to="/app/wallet" className="inline-block text-sm font-semibold text-indigo-700">{t('nav.wallet')} →</Link>
      </div>
    )
  }

  return (
    <div className="w-full md:max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight"><UserCheck size={22} /> {t('contacts.title')}</h1>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">{t('contacts.intro')}</p>
      </div>

      {error && <div className="rounded-lg p-3 text-sm border bg-rose-50 border-rose-200 text-rose-900" data-testid="contacts-error">{error}</div>}

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-stone-900">{t('contacts.list', { count: contacts.length })}</h2>
        {contacts.length === 0 && <p className="text-sm text-stone-500">{t('contacts.none')}</p>}
        <ul className="divide-y divide-stone-100">
          {contacts.map((c) => {
            const st = checks[c.id]
            return (
              <li key={c.id} className="py-3 space-y-1.5" data-testid="contact">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900 truncate">{c.name}</p>
                    <p className="text-xs text-stone-500">
                      {c.identity ? t('contacts.via_identity', { verifier: c.identity.verifier, date: c.identity.verifiedOn }) : t('contacts.via_in_person')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" disabled={!me || st?.kind === 'waiting'} onClick={() => check(c)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50" data-testid="check-contact">
                      {st?.kind === 'waiting' ? <Loader2 size={12} className="animate-spin" /> : t('contacts.check', { name: c.name })}
                    </button>
                    <button type="button" aria-label={t('contacts.remove')} onClick={async () => {
                      if (window.confirm(t('contacts.remove_confirm', { name: c.name }))) { await deleteContact(c.id); setContacts(await loadContacts((p) => decryptPayload(p))) }
                    }} className="p-1.5 text-stone-400 hover:text-rose-700"><Trash2 size={14} /></button>
                  </div>
                </div>
                {st && (
                  <p className={`text-xs rounded-md px-2 py-1.5 ${
                    st.kind === 'confirmed' ? 'bg-emerald-50 text-emerald-900' : st.kind === 'waiting' ? 'bg-stone-50 text-stone-700' : 'bg-amber-50 text-amber-900'
                  }`} data-testid="check-result">
                    {st.kind === 'waiting' && t('contacts.waiting', { name: c.name })}
                    {st.kind === 'confirmed' && t('contacts.confirmed', { name: c.name, time: hhmm(st.at) })}
                    {st.kind === 'declined' && t('contacts.declined', { name: c.name })}
                    {st.kind === 'expired' && t('contacts.expired', { name: c.name })}
                    {st.kind === 'refused' && st.message}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-stone-900">{t('contacts.add')}</h2>
        <p className="text-xs text-stone-500 leading-relaxed">{t('contacts.add_desc')}</p>
        <QrScanner onText={(text) => { setCardText(text); readCard(text) }} onError={setError} />
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={cardText} onChange={(e) => setCardText(e.target.value)} name="card" placeholder="ACTIK-CONTACT:1:…"
            className="flex-1 rounded-lg border border-stone-300 h-9 px-2 text-xs font-mono bg-white" />
          <button type="button" disabled={!cardText.trim()} onClick={() => readCard(cardText)}
            className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold disabled:opacity-50">{t('contacts.read_card')}</button>
        </div>
        {pending && (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2" data-testid="pending-contact">
            {pending.identity ? (
              <p className="text-sm text-stone-800">{t('contacts.card_identity', { name: pending.identity.name, verifier: pending.identity.verifier, date: pending.identity.verifiedOn })}</p>
            ) : (
              <>
                <p className="text-sm text-stone-800">{t('contacts.card_plain')}</p>
                <input value={pendingName} onChange={(e) => setPendingName(e.target.value)} name="contactName" placeholder={t('contacts.name_placeholder')}
                  className="w-full rounded-lg border border-stone-300 h-9 px-2 text-sm bg-white" />
              </>
            )}
            <button type="button" disabled={!pendingName.trim()} onClick={add}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50">{t('contacts.save')}</button>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-stone-900">{t('contacts.my_card')}</h2>
        <p className="text-xs text-stone-500 leading-relaxed">{t('contacts.my_card_desc')}</p>
        {myCard ? (
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="bg-white p-2 border border-stone-200 rounded-lg shrink-0"><QRCodeSVG value={myCard} size={156} level="M" /></div>
            <div className="space-y-2 min-w-0">
              <p className="text-xs text-stone-600">{myIdCard ? t('contacts.id_card_ready') : t('contacts.no_id_card')}</p>
              {myIdCard && (
                <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(myIdCard); setCopied(true) } catch { setCopied(false) } }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold">
                  <Copy size={13} /> {copied ? t('museum.copied') : t('contacts.copy_id_card')}
                </button>
              )}
              <code className="block text-[10px] font-mono break-all bg-stone-50 border border-stone-200 rounded p-2 max-h-20 overflow-auto" data-testid="my-card">{myCard}</code>
            </div>
          </div>
        ) : <Loader2 className="animate-spin text-indigo-600" size={20} />}
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1.5">
        <p className="font-semibold">{t('contacts.limits_title')}</p>
        <p>{t('contacts.limit_never_code')}</p>
        <p>{t('contacts.limit_phone')}</p>
        <p>{t('contacts.limit_double')}</p>
      </section>
    </div>
  )
}
