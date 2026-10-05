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
    .maybeSingle()
  if (error) throw new Error('Your wallet key could not be read. Try again shortly.')

  if (data) {
    // Never replace an existing key: credentials are bound to it.
    const privateJwk = (await decrypt({ cipher: data.private_cipher, iv: data.private_iv })) as JWK
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

/** Whether a credential's `cnf` key is this holder's key. */
export async function isOwnHolderKey(holder: HeldHolderKey, cnf: JWK): Promise<boolean> {
  return (await keyId(publicPart(cnf))) === holder.kid
}
