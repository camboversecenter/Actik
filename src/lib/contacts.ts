// Verified contacts: is the person on this call really who they say, right now?
//
// A video call or a voice message can be faked. What cannot be faked without
// the other person's unlocked wallet is a signature from their wallet key. So:
//
//   1. First link. A and B meet in person and scan each other's QR code, which
//      carries each one's holder public key; each names the other. Or B sends
//      a contact card carrying an identity attestation bound to B's key, which
//      A's app verifies — then the name comes from the attestation. Either way
//      the contact is stored end-to-end encrypted in A's own wallet.
//   2. Check. A taps "Check B". The database relays a short-lived challenge
//      addressed to B's key. B's app shows "A is asking you to confirm it's
//      you, right now" (A's name from B's own contacts, and a warning if A is
//      not one). B approves with their PIN; the app signs {nonce, aud = A's
//      key, iat} with B's holder key. A's app verifies the signature against
//      B's key from A's contacts, the nonce, the audience and the time, and
//      shows "B confirmed at hh:mm".
//
// Never a spoken code: a code read aloud over a faked call is relayed by the
// faker. The answer is bound to A's key and the nonce, so it cannot be
// replayed to someone else or later.
//
// What it does not do (shown in the app): it cannot tell B from someone
// holding B's unlocked phone and PIN; and if both sides of the first link
// were impostors, every later check confirms the impostor.
//
// Pure: no network, no storage. contactsApi.ts does the relaying.

import { SignJWT, jwtVerify, importJWK, type JWK } from 'jose'
import { keyId, publicOnly, bytesToB64u, b64uToBytes } from './trustList'
import { present, addKeyBinding } from './sdjwt'
import { ALWAYS_REVEALED } from './disclosure'
import {
  checkCredential,
  CredentialRefused,
  type RevocationState,
  type TrustState,
} from './credentialCheck'
import { IDENTITY_TYPE } from './identity'

export const CONTACT_CARD_PREFIX = 'ACTIK-CONTACT:1:'
export const PRESENCE_TYP = 'actik-presence+jwt'
/** How long an answer is good for, from when it was signed. */
export const PRESENCE_MAX_AGE_SECONDS = 120
const SKEW = 30

export interface Contact {
  /** Thumbprint of their holder key. */
  kid: string
  publicJwk: JWK
  /** What the owner calls them, or the name on their identity attestation. */
  name: string
  how: 'in_person' | 'identity_card'
  /** Present when the card carried a verified identity attestation. */
  identity: { name: string; verifier: string; verifiedOn: string } | null
  /** Unix seconds. */
  addedAt: number
}

export class ContactRefused extends Error {
  readonly reason: string
  constructor(reason: string, message?: string) {
    super(message ?? reason)
    this.name = 'ContactRefused'
    this.reason = reason
  }
}

/** What a contact card's identity proof names as its audience. */
export function contactCardAudience(kid: string): string {
  return `actik:contact-card:${kid}`
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/**
 * A contact card: the holder's public key and, optionally, an identity
 * attestation bound to it, with that key's proof. Shown as a QR code in
 * person, or sent as text.
 */
export async function makeContactCard(options: {
  publicJwk: JWK
  key: CryptoKey
  identity?: string | null
}): Promise<string> {
  const jwk = publicOnly(options.publicJwk)
  const card: { jwk: JWK; identity?: string } = { jwk }
  if (options.identity) {
    const shown = present(options.identity.replace(/~[^~]*$/, '~'), ALWAYS_REVEALED)
    card.identity = await addKeyBinding(shown, options.key, { audience: contactCardAudience(await keyId(jwk)), nonce: crypto.randomUUID() })
  }
  return CONTACT_CARD_PREFIX + bytesToB64u(enc.encode(JSON.stringify(card)))
}

export interface OpenedCard {
  kid: string
  publicJwk: JWK
  identity: Contact['identity']
}

/**
 * Read a contact card. With an identity attestation, it must verify like any
 * credential (Root-signed identity verifier, not withdrawn), be bound to the
 * card's key, and carry that key's proof. Throws ContactRefused.
 */
export async function openContactCard(
  text: string,
  ctx: { trust: TrustState; revocationsFor: (issuerDid: string) => RevocationState; now: number }
): Promise<OpenedCard> {
  const trimmed = text.trim()
  if (!trimmed.startsWith(CONTACT_CARD_PREFIX)) throw new ContactRefused('CARD_NOT_A_CARD', 'This is not an Actik contact card.')
  let card: { jwk?: JWK; identity?: unknown }
  try {
    card = JSON.parse(dec.decode(b64uToBytes(trimmed.slice(CONTACT_CARD_PREFIX.length))))
  } catch {
    throw new ContactRefused('CARD_MALFORMED', 'This contact card could not be read.')
  }
  const jwk = card.jwk
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || 'd' in jwk) {
    throw new ContactRefused('CARD_MALFORMED', 'This contact card carries no usable wallet key.')
  }
  const publicJwk = publicOnly(jwk)
  const kid = await keyId(publicJwk)
  if (card.identity === undefined) return { kid, publicJwk, identity: null }
  if (typeof card.identity !== 'string') throw new ContactRefused('CARD_MALFORMED', 'This contact card could not be read.')

  let checked
  try {
    const iss = JSON.parse(dec.decode(b64uToBytes(card.identity.split('.')[1]))).iss
    checked = await checkCredential(card.identity, typeof iss === 'string' ? iss : null, ctx.trust,
      typeof iss === 'string' ? ctx.revocationsFor(iss) : { list: null, failure: null }, ctx.now,
      { holderProof: { audience: contactCardAudience(kid) } })
  } catch (e) {
    if (e instanceof CredentialRefused) throw new ContactRefused(e.reason, e.message)
    throw new ContactRefused('CARD_MALFORMED', 'The identity check on this card could not be read.')
  }
  if (checked.assertion.credentialType !== IDENTITY_TYPE) {
    throw new ContactRefused('CARD_NOT_IDENTITY', 'What this card carries is not an identity check.')
  }
  if ((await keyId(publicOnly(checked.assertion.holderKey!))) !== kid) {
    throw new ContactRefused('CARD_IDENTITY_OTHER_KEY', 'The identity check on this card belongs to a different wallet from the card’s key. Do not add it.')
  }
  return {
    kid, publicJwk,
    identity: {
      name: String(checked.assertion.claims.name ?? ''),
      verifier: checked.issuer.name,
      verifiedOn: String(checked.assertion.claims.verified_on ?? ''),
    },
  }
}

/** B's answer to A's check: signed with B's holder key, for A's key and this nonce only. */
export async function signPresence(options: {
  key: CryptoKey
  signerKid: string
  nonce: string
  audienceKid: string
  now?: number
}): Promise<string> {
  return new SignJWT({ nonce: options.nonce, aud: options.audienceKid, sub: options.signerKid,
    iat: options.now ?? Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: 'ES256', typ: PRESENCE_TYP })
    .sign(options.key)
}

export type PresenceProblem =
  | 'PRESENCE_SIGNATURE_INVALID'
  | 'PRESENCE_WRONG_NONCE'
  | 'PRESENCE_WRONG_AUDIENCE'
  | 'PRESENCE_STALE'
  | 'PRESENCE_FUTURE'

export class PresenceRefused extends Error {
  readonly reason: PresenceProblem
  constructor(reason: PresenceProblem) {
    super(reason)
    this.name = 'PresenceRefused'
    this.reason = reason
  }
}

/**
 * A's app checks B's answer against B's key as A stored it when they met.
 * Returns when B signed it; throws PresenceRefused. Never returns "verified":
 * what it returns is a time, which the app shows.
 */
export async function verifyPresence(
  jws: string,
  options: {
    contactJwk: JWK
    nonce: string
    audienceKid: string
    /** Unix seconds: when the check was asked. An answer cannot predate it. */
    askedAt: number
    now: number
  }
): Promise<{ confirmedAt: number }> {
  let payload: Record<string, unknown>
  try {
    const key = await importJWK({ ...publicOnly(options.contactJwk), alg: 'ES256' }, 'ES256')
    ;({ payload } = (await jwtVerify(jws, key, { algorithms: ['ES256'], typ: PRESENCE_TYP })) as unknown as {
      payload: Record<string, unknown>
    })
  } catch {
    throw new PresenceRefused('PRESENCE_SIGNATURE_INVALID')
  }
  if (payload.nonce !== options.nonce) throw new PresenceRefused('PRESENCE_WRONG_NONCE')
  if (payload.aud !== options.audienceKid) throw new PresenceRefused('PRESENCE_WRONG_AUDIENCE')
  const iat = payload.iat
  if (typeof iat !== 'number') throw new PresenceRefused('PRESENCE_SIGNATURE_INVALID')
  if (iat > options.now + SKEW) throw new PresenceRefused('PRESENCE_FUTURE')
  if (iat < options.askedAt - SKEW || options.now - iat > PRESENCE_MAX_AGE_SECONDS) throw new PresenceRefused('PRESENCE_STALE')
  return { confirmedAt: iat }
}

export function messageForPresence(reason: string): string {
  switch (reason) {
    case 'PRESENCE_SIGNATURE_INVALID':
      return 'The answer was not signed by the wallet key you stored for this contact. Do not trust this call.'
    case 'PRESENCE_WRONG_NONCE':
    case 'PRESENCE_WRONG_AUDIENCE':
      return 'The answer was made for a different check. Do not trust this call.'
    case 'PRESENCE_STALE':
    case 'PRESENCE_FUTURE':
      return 'The answer is not from just now. Ask again.'
    default:
      return reason
  }
}
