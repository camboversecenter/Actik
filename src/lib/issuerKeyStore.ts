// Where the issuer's signing key lives while a session is signing: in memory,
// as a non-extractable CryptoKey.
//
// It used to live in sessionStorage as a plain JWK. Any script that ran on the
// page — an XSS, a compromised dependency, a browser extension — could read
// that string and leave with the institution's signing key, and keep signing
// as the institution until somebody noticed and revoked it.
//
// A non-extractable CryptoKey can be *used* by script on the page but never
// *read*: the browser will sign with it and will not hand over the bytes. An
// attacker who gets script onto the page can still sign while they are there —
// nothing in a browser prevents that — but they cannot take the key away.
// That turns a permanent compromise into one bounded by the session.
//
// The private JWK still exists briefly: when a key is generated, and when the
// vault decrypts it at unlock. It is imported here immediately and the
// caller's reference dropped. A page reload forgets the key; the issuer
// unlocks again (IssuerKeyUnlock), which is the intended cost.

import type { JWK } from 'jose'
import { importSigningKey, keyId } from './trustList'

export interface HeldIssuerKey {
  /** Signs; cannot be exported. */
  key: CryptoKey
  /** RFC 7638 thumbprint — the kid written into every credential it signs. */
  kid: string
  did: string
}

let held: HeldIssuerKey | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

export async function holdIssuerKey(privateJwk: JWK, did: string): Promise<HeldIssuerKey> {
  const next: HeldIssuerKey = {
    key: await importSigningKey(privateJwk),
    kid: await keyId(privateJwk),
    did,
  }
  held = next
  notify()
  return next
}

export function getIssuerKey(): HeldIssuerKey | null {
  return held
}

export function forgetIssuerKey(): void {
  held = null
  notify()
}

export function subscribeIssuerKey(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Earlier builds left the private key in sessionStorage. Remove it on start-up
 * so an old tab's plaintext copy does not outlive the upgrade.
 */
export function purgeLegacySessionKey(): void {
  try {
    sessionStorage.removeItem('issuer_private_key')
    sessionStorage.removeItem('issuer_did')
  } catch {
    /* storage blocked: nothing was stored there either */
  }
}
