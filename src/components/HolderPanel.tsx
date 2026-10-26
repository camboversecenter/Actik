import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { present, readDisclosures } from '../lib/sdjwt'
import type { CredentialRow } from '../lib/types'

// These come from the zk-vault-react library AFTER you copy it into src/vault/
// (see README). They are not bundled here.
import { useZkVault, encryptData, decryptData } from '../vault/zk-vault'
import VaultSetup from '../vault/components/VaultSetup'
import VaultUnlock from '../vault/components/VaultUnlock'

interface DecodedCred extends CredentialRow {
  sdjwt: string
  claims: { name: string; value: unknown }[]
}

export default function HolderPanel({ user }: { user: User }) {
  const { isUnlocked, sessionKey } = useZkVault()
  const [hasVault, setHasVault] = useState<boolean | null>(null)
  const [creds, setCreds] = useState<DecodedCred[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // share builder state
  const [shareFor, setShareFor] = useState<DecodedCred | null>(null)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [ttlMin, setTtlMin] = useState(60)
  const [shareLink, setShareLink] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('profiles').select('vault_envelope_pin').eq('id', user.id).maybeSingle()
      .then(({ data }) => setHasVault(!!data?.vault_envelope_pin))
  }, [user.id])

  const loadCreds = useCallback(async () => {
    if (!sessionKey) return
    const { data } = await supabase.from('credentials').select('*').eq('owner', user.id).order('created_at')
    const rows = (data ?? []) as CredentialRow[]
    const decoded: DecodedCred[] = []
    for (const r of rows) {
      try {
        const payload = await decryptData({ cipher: r.cipher, iv: r.iv }, sessionKey)
        const sdjwt = (payload as { sdjwt: string }).sdjwt
        decoded.push({ ...r, sdjwt, claims: readDisclosures(sdjwt) })
      } catch {
        /* skip undecryptable */
      }
    }
    setCreds(decoded)
  }, [sessionKey, user.id])

  useEffect(() => { if (isUnlocked) loadCreds() }, [isUnlocked, loadCreds])

  // Pull any credentials issued to this user's email and encrypt them into the vault.
  async function claimPending() {
    if (!sessionKey || !user.email) return
    setBusy(true); setMsg(null)
    const { data } = await supabase
      .from('pending_credentials')
      .select('*')
      .eq('recipient_email', user.email.toLowerCase())
    let n = 0
    for (const p of data ?? []) {
      const enc = await encryptData({ sdjwt: p.sdjwt }, sessionKey)
      const { error } = await supabase.from('credentials').insert({
        owner: user.id, cipher: enc.cipher, iv: enc.iv,
      })
      if (!error) { await supabase.from('pending_credentials').delete().eq('id', p.id); n++ }
    }
    setMsg(n ? `Claimed ${n} credential(s) into your encrypted vault.` : 'No new credentials.')
    await loadCreds()
    setBusy(false)
  }

  function openShare(c: DecodedCred) {
    setShareFor(c)
    setShareLink(null)
    const init: Record<string, boolean> = {}
    c.claims.forEach((cl) => (init[cl.name] = cl.name !== 'gpa' && cl.name !== 'national_id'))
    setReveal(init)
  }

  async function createShare() {
    if (!shareFor) return
    setBusy(true); setMsg(null)
    const names = Object.entries(reveal).filter(([, v]) => v).map(([k]) => k)
    const presentation = present(shareFor.sdjwt, names)
    const expires = new Date(Date.now() + ttlMin * 60_000).toISOString()
    const { data, error } = await supabase.from('shares').insert({
      owner: user.id,
      presentation,
      issuer_did: deriveIssuer(shareFor.sdjwt),
      revealed: names,
      expires_at: expires,
    }).select().single()
    if (error) setMsg(error.message)
    else setShareLink(`${location.origin}/?share=${data.id}`)
    setBusy(false)
  }

  if (hasVault === null) return <div className="card">Loading…</div>
  if (!hasVault) return <div className="card"><VaultSetup userId={user.id} userEmail={user.email ?? ''} onSuccess={() => setHasVault(true)} /></div>
  if (!isUnlocked) return <div className="card"><VaultUnlock userId={user.id} /></div>

  return (
    <div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>My credentials</h2>
          <button className="ghost" onClick={claimPending} disabled={busy}>Check for new</button>
        </div>
        {creds.length === 0 && <p className="muted">No credentials yet. Ask an issuer to send one to {user.email}, then tap “Check for new”.</p>}
        {creds.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
            <h3>{c.label ?? 'Credential'}</h3>
            {c.claims.map((cl) => (
              <div key={cl.name} className="claim"><span className="k">{cl.name}</span><span className="v">{String(cl.value)}</span></div>
            ))}
            <button className="primary" style={{ marginTop: 10 }} onClick={() => openShare(c)}>Share with an employer</button>
          </div>
        ))}
      </div>

      {shareFor && (
        <div className="card">
          <h2>Create a time-limited share</h2>
          <p className="muted">Choose what to reveal. Unchecked fields stay hidden — the employer never sees them.</p>
          {shareFor.claims.map((cl) => (
            <label key={cl.name} className="check">
              <input type="checkbox" checked={!!reveal[cl.name]} onChange={(e) => setReveal({ ...reveal, [cl.name]: e.target.checked })} />
              {cl.name}: <strong>{String(cl.value)}</strong>
            </label>
          ))}
          <label>Link expires in</label>
          <select value={ttlMin} onChange={(e) => setTtlMin(Number(e.target.value))}>
            <option value={15}>15 minutes</option>
            <option value={60}>1 hour</option>
            <option value={1440}>1 day</option>
            <option value={10080}>1 week</option>
          </select>
          <button className="primary" onClick={createShare} disabled={busy}>Generate share link</button>
          {shareLink && (
            <div className="notice info">
              <strong>Send this link to the employer</strong>
              <div className="mono" style={{ marginTop: 6 }}>{shareLink}</div>
            </div>
          )}
        </div>
      )}

      {msg && <div className="notice info">{msg}</div>}
    </div>
  )
}

// Read the `iss` claim out of the JWT header part without verifying (just for display/lookup).
function deriveIssuer(sdjwt: string): string {
  try {
    const payload = JSON.parse(atob(sdjwt.split('~')[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.iss ?? ''
  } catch {
    return ''
  }
}
