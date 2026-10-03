// The signed trust list: who is accredited, and with which keys.
//
// Until this existed, a verifier believed whatever the `issuers` table said at
// the moment it asked. Anyone able to write that table — a service-role key, a
// compromised admin account, a privilege bug like the profiles.role one —
// could mark an institution accredited or swap its public key, and every
// verifier would agree. The table was the trust root.
//
// Now the trust root is a key pinned into the app at build time
// (VITE_TRUST_ROOT_KEYS) whose private half lives offline. It signs a list of
// accredited issuers and their keys; verifiers accept a key only if that list,
// under that signature, says so. The database still holds the working state —
// applications, approvals, key history — but it holds *proposals*: nothing
// becomes trusted until the Root holder builds and signs a new list
// (scripts/build-trustlist.ts) and publishes it.
//
// The shape follows QRSeal's SPEC §4.2, adapted to DIDs and JWKs:
//   - the signature covers the UTF-8 bytes of `statement` exactly as stored, and
//     the verifier parses that same string — no canonicalisation step to
//     disagree about;
//   - ES256, raw r||s, base64url;
//   - `version` only ever goes up, and a verifier that has seen version N
//     refuses N-1;
//   - the list expires, and may not be issued for longer than 31 days, so an
//     abandoned Root cannot leave a list valid forever.
//
// Pure: no network, no storage. trustAnchor.ts does the fetching.

import { calculateJwkThumbprint, type JWK } from 'jose'

export const TRUSTLIST_TYPE = 'actik/trustlist/1'
export const MAX_LIST_VALIDITY_SECONDS = 31 * 24 * 60 * 60
/** Tolerated clock difference between issuer, Root and verifier. */
export const CLOCK_SKEW_SECONDS = 300

export type TrustRejectionReason =
  | 'TRUSTLIST_NO_ROOT_CONFIGURED'
  | 'TRUSTLIST_MISSING'
  | 'TRUSTLIST_MALFORMED'
  | 'TRUSTLIST_UNKNOWN_ROOT'
  | 'TRUSTLIST_SIGNATURE_INVALID'
  | 'TRUSTLIST_EXPIRED'
  | 'TRUSTLIST_NOT_YET_VALID'
  | 'TRUSTLIST_VALIDITY_TOO_LONG'
  | 'TRUSTLIST_ROLLBACK'
  | 'TRUSTLIST_VERSION_CONFLICT'
  | 'ISSUER_NOT_LISTED'
  | 'KEY_UNKNOWN'
  | 'KEY_REVOKED'
  | 'KEY_NOT_VALID_AT_ISSUANCE'

/** Reasons that mean "our own trust state is the problem", not the credential. */
export const TRUST_STATE_REASONS: ReadonlySet<string> = new Set([
  'TRUSTLIST_NO_ROOT_CONFIGURED',
  'TRUSTLIST_MISSING',
  'TRUSTLIST_MALFORMED',
  'TRUSTLIST_UNKNOWN_ROOT',
  'TRUSTLIST_SIGNATURE_INVALID',
  'TRUSTLIST_EXPIRED',
  'TRUSTLIST_NOT_YET_VALID',
  'TRUSTLIST_VALIDITY_TOO_LONG',
  'TRUSTLIST_ROLLBACK',
  'TRUSTLIST_VERSION_CONFLICT',
])

export class TrustRejected extends Error {
  readonly reason: TrustRejectionReason
  constructor(reason: TrustRejectionReason, detail?: string) {
    super(detail ?? reason)
    this.name = 'TrustRejected'
    this.reason = reason
  }
}

// --- the signed envelope, shared with revocation lists ----------------------

export interface SignedDocument {
  /** The exact JSON text that was signed. Parse this string; never re-encode. */
  statement: string
  signature: { alg: 'ES256'; kid: string; value: string }
}

const enc = new TextEncoder()

export function bytesToB64u(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Only the public members, in the shape every key in a list is stored in. */
export function publicOnly(jwk: JWK): JWK {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
}

/** RFC 7638 thumbprint: the key identifier used everywhere in this scheme. */
export async function keyId(jwk: JWK): Promise<string> {
  return calculateJwkThumbprint(publicOnly(jwk), 'sha256')
}

async function importVerifyKey(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { ...publicOnly(jwk), ext: true } as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
}

export async function verifySignedDocument(doc: SignedDocument, jwk: JWK): Promise<boolean> {
  try {
    const key = await importVerifyKey(jwk)
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64uToBytes(doc.signature.value),
      enc.encode(doc.statement)
    )
  } catch {
    return false
  }
}

/**
 * Sign `statement` (serialised once, here) with a P-256 private key. Used by
 * the build script for trust lists and by issuers for revocation lists.
 */
export async function signStatement(
  statement: object,
  privateKey: CryptoKey,
  kid: string
): Promise<SignedDocument> {
  const text = JSON.stringify(statement)
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(text))
  )
  return { statement: text, signature: { alg: 'ES256', kid, value: bytesToB64u(sig) } }
}

/** Import a private JWK for signing. Non-extractable: it can be used, not read back. */
export async function importSigningKey(privateJwk: JWK): Promise<CryptoKey> {
  const { kty, crv, x, y, d } = privateJwk
  return crypto.subtle.importKey(
    'jwk',
    { kty, crv, x, y, d, ext: false } as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

// --- the trust list ---------------------------------------------------------

export type KeyStatus = 'active' | 'retired' | 'revoked'

export interface TrustListKey {
  kid: string
  jwk: JWK
  /**
   * active  — in use; credentials it signs verify.
   * retired — rotated out, not compromised: credentials it signed *before*
   *           `notAfter` still verify, anything dated later does not. This is
   *           what keeps a key rotation from stranding every credential the
   *           old key ever signed.
   * revoked — compromised: nothing it signed verifies, whatever the date.
   */
  status: KeyStatus
  /** Unix seconds. A credential's `iat` must fall inside [notBefore, notAfter]. */
  notBefore: number
  notAfter: number
}

/**
 * What kind of issuer the Root admitted, and therefore what it may issue.
 * An accredited institution may issue every credential type; a registered
 * employer only employment records. Verifiers show the kind beside the name,
 * so a job record from a small business never borrows a university's weight.
 * A list signed before kinds existed carries none: every issuer on it is an
 * institution.
 */
export type IssuerKind = 'institution' | 'employer'

export interface TrustListIssuer {
  did: string
  name: string
  domain: string | null
  kind?: IssuerKind
  keys: TrustListKey[]
}

/** The credential types each kind of issuer may sign. */
export function issuerMayIssue(kind: IssuerKind | undefined, credentialType: string | null): boolean {
  if ((kind ?? 'institution') === 'institution') return true
  return credentialType === 'employment_record'
}

export interface TrustListStatement {
  type: typeof TRUSTLIST_TYPE
  version: number
  issuedAt: number
  expires: number
  issuers: TrustListIssuer[]
}

export interface OpenedTrustList {
  version: number
  issuedAt: number
  expires: number
  digest: string
  /** The document as fetched, so it can be persisted and re-opened. */
  document: SignedDocument
  issuers: Map<string, TrustListIssuer>
}

export interface HeldVersion {
  version: number
  digest: string
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseStatement(text: string): TrustListStatement {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new TrustRejected('TRUSTLIST_MALFORMED')
  }
  const s = raw as Partial<TrustListStatement>
  if (
    !s ||
    s.type !== TRUSTLIST_TYPE ||
    !isNumber(s.version) ||
    !isNumber(s.issuedAt) ||
    !isNumber(s.expires) ||
    !Array.isArray(s.issuers)
  ) {
    throw new TrustRejected('TRUSTLIST_MALFORMED')
  }
  for (const issuer of s.issuers) {
    if (
      !issuer || typeof issuer.did !== 'string' || !Array.isArray(issuer.keys) ||
      (issuer.kind !== undefined && issuer.kind !== 'institution' && issuer.kind !== 'employer')
    ) {
      throw new TrustRejected('TRUSTLIST_MALFORMED')
    }
    for (const k of issuer.keys) {
      if (
        !k || typeof k.kid !== 'string' || !k.jwk ||
        !['active', 'retired', 'revoked'].includes(k.status) ||
        !isNumber(k.notBefore) || !isNumber(k.notAfter)
      ) {
        throw new TrustRejected('TRUSTLIST_MALFORMED')
      }
    }
  }
  return s as TrustListStatement
}

/**
 * Open a signed trust list against the pinned Root keys.
 *
 * Throws TrustRejected. Every reason it throws is a trust-state reason: the
 * verifier cannot check anything right now, and must say so rather than fall
 * back on an older list or on the database.
 */
export async function openTrustList(
  doc: SignedDocument | null | undefined,
  options: { roots: JWK[]; now: number; held?: HeldVersion | null }
): Promise<OpenedTrustList> {
  if (options.roots.length === 0) throw new TrustRejected('TRUSTLIST_NO_ROOT_CONFIGURED')
  if (!doc) throw new TrustRejected('TRUSTLIST_MISSING')
  if (
    typeof doc.statement !== 'string' ||
    !doc.signature ||
    doc.signature.alg !== 'ES256' ||
    typeof doc.signature.kid !== 'string' ||
    typeof doc.signature.value !== 'string'
  ) {
    throw new TrustRejected('TRUSTLIST_MALFORMED')
  }

  // The Root that signed it must be one we pinned, chosen by kid.
  let root: JWK | null = null
  for (const candidate of options.roots) {
    if ((await keyId(candidate)) === doc.signature.kid) root = candidate
  }
  if (!root) throw new TrustRejected('TRUSTLIST_UNKNOWN_ROOT')
  if (!(await verifySignedDocument(doc, root))) throw new TrustRejected('TRUSTLIST_SIGNATURE_INVALID')

  // Only now is the statement worth parsing.
  const s = parseStatement(doc.statement)
  if (s.expires - s.issuedAt > MAX_LIST_VALIDITY_SECONDS) {
    throw new TrustRejected('TRUSTLIST_VALIDITY_TOO_LONG')
  }
  if (s.issuedAt > options.now + CLOCK_SKEW_SECONDS) throw new TrustRejected('TRUSTLIST_NOT_YET_VALID')
  if (options.now > s.expires) throw new TrustRejected('TRUSTLIST_EXPIRED')

  const digest = await sha256Hex(doc.statement)
  const held = options.held
  if (held) {
    if (s.version < held.version) throw new TrustRejected('TRUSTLIST_ROLLBACK')
    // Same version, different content: the Root (or someone with it) has
    // signed two lists and told this verifier one and someone else the other.
    if (s.version === held.version && digest !== held.digest) {
      throw new TrustRejected('TRUSTLIST_VERSION_CONFLICT')
    }
  }

  return {
    version: s.version,
    issuedAt: s.issuedAt,
    expires: s.expires,
    digest,
    document: doc,
    issuers: new Map(s.issuers.map((i) => [i.did, { ...i, kind: i.kind ?? 'institution' }])),
  }
}

/**
 * The keys of `did` that could have signed a credential carrying this header
 * kid and this `iat`. Usually one. A credential issued before kids were added
 * carries none, and every key whose window covers its `iat` is a candidate;
 * the caller tries each.
 *
 * Throws TrustRejected with a credential-side reason when nothing qualifies.
 */
export function candidateKeys(
  list: OpenedTrustList,
  did: string,
  credential: { kid?: string | null; iat?: number | null }
): TrustListKey[] {
  const issuer = list.issuers.get(did)
  if (!issuer) throw new TrustRejected('ISSUER_NOT_LISTED')

  let keys = issuer.keys
  if (credential.kid) {
    keys = keys.filter((k) => k.kid === credential.kid)
    if (keys.length === 0) throw new TrustRejected('KEY_UNKNOWN')
  }

  const live = keys.filter((k) => k.status !== 'revoked')
  if (live.length === 0) throw new TrustRejected('KEY_REVOKED')

  if (typeof credential.iat !== 'number') return live
  const iat = credential.iat
  const inWindow = live.filter(
    (k) => iat >= k.notBefore - CLOCK_SKEW_SECONDS && iat <= k.notAfter + CLOCK_SKEW_SECONDS
  )
  if (inWindow.length === 0) throw new TrustRejected('KEY_NOT_VALID_AT_ISSUANCE')
  return inWindow
}

/** Is `kid` a key this list currently accepts for `did`, at time `at`? */
export function keyAcceptedAt(
  list: OpenedTrustList,
  did: string,
  kid: string,
  at: number
): TrustListKey {
  return candidateKeys(list, did, { kid, iat: at })[0]
}
