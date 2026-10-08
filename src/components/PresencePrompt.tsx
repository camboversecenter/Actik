// "A is asking you to confirm it's you, right now." Watches for checks
// addressed to this wallet's key while it is unlocked, and answers one only
// when the holder approves with their PIN (docs/VERIFIED_CONTACTS.md).

import { useEffect, useState } from 'react'
import { ShieldAlert, UserCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useZkVault } from '../vault/zk-vault'
import { useLanguage } from '../lib/i18n'
import { ensureHolderKey } from '../lib/holderKey'
import { signPresence } from '../lib/contacts'
import { incomingChecks, answerCheck, loadContacts, type CheckRow, type StoredContact } from '../lib/contactsApi'

export default function PresencePrompt() {
  const { t } = useLanguage()
  const { isUnlocked, encryptPayload, decryptPayload, unlockWithPin, unlockWithPasskey } = useZkVault()
  const [check, setCheck] = useState<CheckRow | null>(null)
  const [asker, setAsker] = useState<StoredContact | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [handled, setHandled] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isUnlocked || check) return
    let active = true
    const poll = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const uid = data.session?.user?.id
        if (!uid) return
        const key = await ensureHolderKey(uid, encryptPayload, (p) => decryptPayload(p))
        const rows = (await incomingChecks(key.kid)).filter((r) => !handled.has(r.id))
        if (!active || rows.length === 0) return
        const contacts = await loadContacts((p) => decryptPayload(p))
        // A's name comes from B's own contacts, never from the request.
        setAsker(contacts.find((c) => c.kid === rows[0].from_kid) ?? null)
        setCheck(rows[0])
      } catch {
        /* try again on the next tick */
      }
    }
    poll()
    const handle = window.setInterval(poll, 4000)
    return () => { active = false; clearInterval(handle) }
  }, [isUnlocked, check, handled, encryptPayload, decryptPayload])

  if (!check) return null

  const close = () => {
    setHandled((s) => new Set(s).add(check.id))
    setCheck(null)
    setAsker(null)
    setPin('')
    setError(null)
  }

  const decline = async () => {
    try { await answerCheck(check.id, null) } catch { /* expired already */ }
    close()
  }

  const approve = async (method: 'pin' | 'passkey' = 'pin') => {
    setBusy(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const uid = data.session?.user?.id
      if (!uid) throw new Error(t('presence.signed_out'))
      // The PIN (or passkey), now: an unlocked phone in someone else's hand is not enough.
      const confirmed = method === 'passkey' ? await unlockWithPasskey(uid) : await unlockWithPin(pin, uid)
      if (!confirmed) throw new Error(t(method === 'passkey' ? 'presence.passkey_failed' : 'presence.wrong_pin'))
      const key = await ensureHolderKey(uid, encryptPayload, (p) => decryptPayload(p))
      if (key.kid !== check.to_kid) throw new Error(t('presence.not_this_key'))
      const jws = await signPresence({ key: key.key, signerKid: key.kid, nonce: check.nonce, audienceKid: check.from_kid })
      await answerCheck(check.id, jws)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-stone-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="presence-prompt">
      <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-3">
        {asker ? (
          <h2 className="text-lg font-bold text-stone-900 flex items-start gap-2"><UserCheck className="shrink-0 mt-0.5 text-indigo-600" size={20} />{t('presence.asking', { name: asker.name })}</h2>
        ) : (
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-stone-900 flex items-start gap-2"><ShieldAlert className="shrink-0 mt-0.5 text-amber-600" size={20} />{t('presence.unknown_asking')}</h2>
            <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 p-2" data-testid="presence-unknown">{t('presence.unknown_warning')}</p>
          </div>
        )}
        <p className="text-sm text-stone-600 leading-relaxed">{t('presence.explain')}</p>
        <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} name="presencePin"
          placeholder={t('presence.pin')} className="w-full rounded-xl border border-stone-300 h-11 px-3 text-base tracking-widest bg-white" />
        {error && <p className="text-xs text-rose-700">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={decline} disabled={busy} className="h-11 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700">{t('presence.decline')}</button>
          <button type="button" onClick={() => approve('pin')} disabled={busy || pin.length < 4} className="h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">{t('presence.approve')}</button>
        </div>
        <button type="button" onClick={() => approve('passkey')} disabled={busy} className="w-full text-xs font-semibold text-indigo-700 disabled:opacity-50">
          {t('presence.use_passkey')}
        </button>
      </div>
    </div>
  )
}
