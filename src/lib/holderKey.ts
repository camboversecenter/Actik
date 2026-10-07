// The holder's own key: what binds a credential to the wallet it was issued to.
//
// Made once, the first time a wallet is unlocked. The private half is
// encrypted with the wallet's own key (the same end-to-end encryption as the
// credentials) and stored in `holder_keys`; only the holder's PIN or passkey
// can open it, on any of their devices. In memory it is held as a
// non-extractable CryptoKey: it can sign key-binding proofs, and cannot be
// read back out.
//
// The public half is what an issuer writes into a credential as `cnf`, so the
// credential can afterwards only be presented with a proof signed by this key.
//
// A key is never changed, only retired (docs/KEY_RECOVERY.md): when the PIN is
// forgotten and the wallet reset ('lost'), when someone else has the wallet
// ('compromised'), or on purpose ('replaced'). The next unlock then makes a new
// key, and the holder asks each issuer to reissue to it (reissue.ts).

import { exportJWK, generateKeyPair, type JWK } from 'jose'
import { supabase } from './supabase'
import { keyId } from './trustList'

export interface HeldHolderKey {
  key: CryptoKey
  publicJwk: JWK
  /** RFC 7638 thumbprint of the public key. */
  kid: string
}

type Encrypt = (data: unknown) => Promise<{ cipher: string; iv: string }>
type Decrypt = (payload: { cipher: string; iv: string }) => Promise<unknown>

let held: { userId: string; promise: Promise<HeldHolderKey> } | null = null

export type RetirementReason = 'lost' | 'compromised' | 'replaced'

/** The active key exists, but this wallet cannot open it: the wallet was reset, or is another wallet. */
export class HolderKeyUnreadable extends Error {
  constructor() {
    super('This wallet cannot open your wallet key. If you reset your wallet or forgot your PIN, retire the old key and recover your credentials (Wallet key → Recover).')
    this.name = 'HolderKeyUnreadable'
  }
}

const publicPart = (jwk: JWK): JWK => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y })

async function importPrivate(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

async function loadOrCreate(userId: string, encrypt: Encrypt, decrypt: Decrypt): Promise<HeldHolderKey> {
  const { data, error } = await supabase
    .from('holder_keys')
    .select('public_jwk, private_cipher, private_iv')
    .eq('user_id', userId)
    .is('retired_at', null)
    .maybeSingle()
  if (error) throw new Error('Your wallet key could not be read. Try again shortly.')

  if (data) {
    // Never replace an existing key silently: credentials are bound to it.
    // Replacing it is a decision the holder makes (retireHolderKey).
    let privateJwk: JWK
    try {
      privateJwk = (await decrypt({ cipher: data.private_cipher, iv: data.private_iv })) as JWK
    } catch {
      throw new HolderKeyUnreadable()
    }
    const publicJwk = publicPart(data.public_jwk as JWK)
    if (privateJwk.x !== publicJwk.x || privateJwk.y !== publicJwk.y) {
      throw new Error('Your wallet key does not match its public half. Contact support; do not reset your wallet.')
    }
    return { key: await importPrivate(privateJwk), publicJwk, kid: await keyId(publicJwk) }
  }

  const pair = await generateKeyPair('ES256', { extractable: true })
  const privateJwk = await exportJWK(pair.privateKey)
  const publicJwk = publicPart(await exportJWK(pair.publicKey))
  const sealed = await encrypt(privateJwk)
  const { error: insertError } = await supabase.from('holder_keys').insert({
    user_id: userId,
    public_jwk: publicJwk,
    private_cipher: sealed.cipher,
    private_iv: sealed.iv,
  })
  if (insertError) {
    // Another tab may have made one first: use that one.
    if (insertError.code === '23505') return loadOrCreate(userId, encrypt, decrypt)
    throw new Error('Your wallet key could not be saved. Try again shortly.')
  }
  return { key: await importPrivate(privateJwk), publicJwk, kid: await keyId(publicJwk) }
}

/** The holder's key, made on first use. The wallet must be unlocked. */
export function ensureHolderKey(userId: string, encrypt: Encrypt, decrypt: Decrypt): Promise<HeldHolderKey> {
  if (held && held.userId === userId) return held.promise
  const promise = loadOrCreate(userId, encrypt, decrypt)
  held = { userId, promise }
  // A failure is not remembered: the next call tries again.
  promise.catch(() => {
    if (held?.promise === promise) held = null
  })
  return promise
}

export function forgetHolderKey() {
  held = null
}

/**
 * Retire the active key. Irreversible: credentials bound to it can then only
 * be presented by whoever still holds it, and issuers are asked to reissue them
 * to the next key. Returns the retired key's thumbprint, or null if there was none.
 */
export async function retireHolderKey(reason: RetirementReason, kid?: string): Promise<string | null> {
  // With a kid: mark that key (active or already retired) compromised.
  const { data, error } = await supabase.rpc('retire_holder_key', kid ? { p_reason: 'compromised', p_kid: kid } : { p_reason: reason })
  if (error) throw new Error('Your wallet key could not be retired. Try again shortly.')
  held = null
  return (data as string | null) ?? null
}

export interface HolderKeyRecord {
  kid: string
  publicJwk: JWK
  createdAt: string
  retiredAt: string | null
  retiredReason: RetirementReason | null
}

/** Every key this holder has had, newest first. Public halves only. */
export async function listHolderKeys(userId: string): Promise<HolderKeyRecord[]> {
  const { data, error } = await supabase
    .from('holder_keys')
    .select('kid, public_jwk, created_at, retired_at, retired_reason')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error('Your wallet keys could not be read. Try again shortly.')
  return (data ?? []).map((r: any) => ({
    kid: r.kid, publicJwk: publicPart(r.public_jwk), createdAt: r.created_at,
    retiredAt: r.retired_at ?? null, retiredReason: r.retired_reason ?? null,
  }))
}

/**
 * The private half of a retired key, if this wallet can still open it — only
 * for proving continuity to an issuer ('replaced' keys). null otherwise.
 */
export async function openRetiredKey(
  userId: string, kid: string, decrypt: Decrypt
): Promise<CryptoKey | null> {
  const { data } = await supabase
    .from('holder_keys')
    .select('public_jwk, private_cipher, private_iv, retired_reason')
    .eq('user_id', userId)
    .eq('kid', kid)
    .maybeSingle()
  if (!data || data.retired_reason === 'compromised') return null
  try {
    const privateJwk = (await decrypt({ cipher: data.private_cipher, iv: data.private_iv })) as JWK
    const pub = publicPart(data.public_jwk as JWK)
    if (privateJwk.x !== pub.x || privateJwk.y !== pub.y) return null
    return await importPrivate(privateJwk)
  } catch {
    return null
  }
}

/** Whether a credential's `cnf` key is this holder's key. */
export async function isOwnHolderKey(holder: HeldHolderKey, cnf: JWK): Promise<boolean> {
  return (await keyId(publicPart(cnf))) === holder.kid
}
