// Minimal SD-JWT (Selective Disclosure JWT) implementation.
//
// This is an EDUCATIONAL implementation that follows the structure of the IETF
// SD-JWT spec closely enough to be correct and to round-trip, but it is NOT a
// full implementation. For production use the `@sd-jwt/sd-jwt-vc` library and
// add Key Binding (KB-JWT) for holder proof. See README.
//
// The core trick: the issuer signs HASHES of each claim (the `_sd` array), not
// the values. The values live in separate "disclosure" strings appended after
// the JWT with `~` separators. Revealing a claim = including its disclosure;
// hiding it = leaving the disclosure out. The signature stays valid either way.

import { SignJWT, jwtVerify, importJWK, type JWK } from 'jose'

const enc = new TextEncoder()
const dec = new TextDecoder()

function bytesToB64u(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function b64uJSON(obj: unknown): string {
  return bytesToB64u(enc.encode(JSON.stringify(obj)))
}

function fromB64uJSON<T = unknown>(s: string): T {
  return JSON.parse(dec.decode(b64uToBytes(s))) as T
}

// Hash of the base64url-encoded disclosure string (UTF-8 / Khmer safe).
async function sha256b64u(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return bytesToB64u(new Uint8Array(digest))
}

function randomSalt(): string {
  return bytesToB64u(crypto.getRandomValues(new Uint8Array(16)))
}

export type Claims = Record<string, unknown>

export interface IssueParams {
  issuerDid: string
  /**
   * The issuer's signing key. In the app this is always `signingKey`: a
   * non-extractable CryptoKey held in memory (see issuerKeyStore.ts), which
   * can sign but can never be read back out, so script on the page cannot
   * walk off with it. `issuerPrivateJwk` remains for tests and scripts.
   */
  signingKey?: CryptoKey
  issuerPrivateJwk?: JWK
  /**
   * RFC 7638 thumbprint of the signing key, written to the JWT header. The
   * trust list may hold several keys for one issuer — an old one retired, a
   * new one active — and this is how a verifier picks the right one.
   */
  kid?: string
  /** The credential's id. Defaults to a fresh UUID; pass one to keep a record of it. */
  jti?: string
  /** Claims that should each become selectively-disclosable. */
  subject: Claims
  /** Credential type, e.g. "https://actik.kh/credentials/degree". */
  vct: string
  /** Optional credential lifetime in seconds (sets `exp`). */
  expiresInSec?: number
  /**
   * The holder's public key, when the recipient has one. Written into the
   * signed payload as `cnf`, it binds the credential to that holder: every
   * presentation must then carry a key-binding JWT signed with the matching
   * private key, which only the holder's wallet can unlock.
   */
  holderPublicJwk?: JWK
}

async function makeDisclosure(name: string, value: unknown) {
  // A disclosure is base64url( JSON.stringify([salt, name, value]) ).
  const disclosure = b64uJSON([randomSalt(), name, value])
  const digest = await sha256b64u(disclosure)
  return { disclosure, digest }
}

/** Issue a full SD-JWT: `<signed-jwt>~<disclosure>~<disclosure>~...~` */
export async function issueSdJwt(p: IssueParams): Promise<string> {
  const disclosures: string[] = []
  const sd: string[] = []
  for (const [k, v] of Object.entries(p.subject)) {
    const { disclosure, digest } = await makeDisclosure(k, v)
    disclosures.push(disclosure)
    sd.push(digest)
  }

  const key = p.signingKey ?? (p.issuerPrivateJwk ? await importJWK(p.issuerPrivateJwk, 'ES256') : null)
  if (!key) throw new Error('issueSdJwt: no signing key')
  const now = Math.floor(Date.now() / 1000)

  // `jti` names this one credential, so that the issuer can later withdraw
  // exactly it (revocation.ts) and nothing else. It sits in the signed
  // payload, not in a disclosure, so it travels with every presentation.
  const cnf = p.holderPublicJwk
    ? { jwk: { kty: p.holderPublicJwk.kty, crv: p.holderPublicJwk.crv, x: p.holderPublicJwk.x, y: p.holderPublicJwk.y } }
    : undefined
  let builder = new SignJWT({ _sd: sd, _sd_alg: 'sha-256', vct: p.vct, ...(cnf ? { cnf } : {}) })
    .setProtectedHeader(p.kid ? { alg: 'ES256', typ: 'dc+sd-jwt', kid: p.kid } : { alg: 'ES256', typ: 'dc+sd-jwt' })
    .setIssuer(p.issuerDid)
    .setIssuedAt(now)
    .setJti(p.jti ?? crypto.randomUUID())
  if (p.expiresInSec) builder = builder.setExpirationTime(now + p.expiresInSec)

  const jwt = await builder.sign(key)
  return [jwt, ...disclosures].join('~') + '~'
}

interface ParsedSdJwt {
  jwt: string
  disclosures: string[]
  /** The key-binding JWT, when the presentation ends with one instead of `~`. */
  keyBinding: string | null
  /** The presentation without its key-binding JWT: what `sd_hash` covers. */
  withoutKeyBinding: string
}

function parseSdJwt(sdjwt: string): ParsedSdJwt {
  const parts = sdjwt.split('~')
  const jwt = parts[0]
  // A presentation is `<jwt>~<d>~...~` and, when key-bound, `<jwt>~<d>~...~<kb-jwt>`:
  // a non-empty last element (with more than one element) is the KB-JWT.
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  const keyBinding = last.length > 0 ? last : null
  const middle = keyBinding ? parts.slice(1, -1) : parts.slice(1)
  const disclosures = middle.filter((x) => x.length > 0)
  const withoutKeyBinding = keyBinding ? sdjwt.slice(0, sdjwt.length - keyBinding.length) : sdjwt
  return { jwt, disclosures, keyBinding, withoutKeyBinding }
}

/**
 * Read the header `kid` and the payload `iat`/`iss` WITHOUT verifying anything.
 * Only for choosing which trusted key to verify with: every value here is
 * re-checked against the verified payload afterwards, never acted on directly.
 */
export function peekJwt(sdjwt: string): { kid: string | null; iat: number | null; iss: string | null; jti: string | null; bound: boolean } {
  try {
    const [h, p] = sdjwt.split('~')[0].split('.')
    const header = fromB64uJSON<Record<string, unknown>>(h)
    const payload = fromB64uJSON<Record<string, unknown>>(p)
    return {
      kid: typeof header.kid === 'string' ? header.kid : null,
      iat: typeof payload.iat === 'number' ? payload.iat : null,
      iss: typeof payload.iss === 'string' ? payload.iss : null,
      jti: typeof payload.jti === 'string' ? payload.jti : null,
      bound: !!payload.cnf,
    }
  } catch {
    return { kid: null, iat: null, iss: null, jti: null, bound: false }
  }
}

export interface DecodedDisclosure {
  name: string
  value: unknown
  disclosure: string
}

/** Decode the human-readable claims held in an SD-JWT's disclosures. */
export function readDisclosures(sdjwt: string): DecodedDisclosure[] {
  const { disclosures } = parseSdJwt(sdjwt)
  return disclosures.map((d) => {
    const [, name, value] = fromB64uJSON<[string, string, unknown]>(d)
    return { name, value, disclosure: d }
  })
}

/**
 * Build a presentation that reveals only `revealNames`, omitting every other
 * disclosure. The issuer signature is untouched and still verifies.
 */
export function present(fullSdJwt: string, revealNames: string[]): string {
  // Any key binding on the input is dropped: it covered a different set of disclosures.
  const { jwt, disclosures } = parseSdJwt(fullSdJwt)
  const keep = disclosures.filter((d) => {
    const [, name] = fromB64uJSON<[string, string, unknown]>(d)
    return revealNames.includes(name)
  })
  return [jwt, ...keep].join('~') + '~'
}

/**
 * Why a presentation was refused. These strings are the contract: localise the
 * message shown to a person, never the reason itself, and never renumber or
 * rename one once it has shipped — a caller (or a log, or another
 * implementation) is matching on it.
 */
export type RejectionReason =
  | 'MALFORMED_PRESENTATION'
  | 'ISSUER_KEY_MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'DISCLOSURE_NOT_SIGNED'
  | 'CREDENTIAL_EXPIRED'
  | 'CREDENTIAL_NOT_YET_VALID'

export class VerificationRejected extends Error {
  readonly reason: RejectionReason
  constructor(reason: RejectionReason, detail?: string) {
    super(detail ?? reason)
    this.name = 'VerificationRejected'
    this.reason = reason
  }
}

/**
 * The four fields a reader must compare against the document in their hand.
 * A field is null when the holder chose not to disclose it.
 *
 * A valid signature says the issuer signed *a* credential carrying these
 * values. It says nothing about the paper, the PDF or the photo the code was
 * printed on: a genuine code lifted from a real certificate and placed on a
 * forged one verifies perfectly. The comparison is the only thing that closes
 * that gap, which is why it is a field on the result and not a footnote.
 */
export interface PrintedDocumentFields {
  subjectName: string | null
  documentId: string | null
  issuingOrganisation: string | null
  issueDate: string | null
}

const VCT_PREFIX = 'https://actik.kh/credentials/'

/** "https://actik.kh/credentials/academic_degree" → "academic_degree". The legacy "degree" reads as academic_degree. */
export function credentialTypeFromVct(vct: unknown): string | null {
  if (typeof vct !== 'string' || !vct.startsWith(VCT_PREFIX)) return null
  const type = vct.slice(VCT_PREFIX.length)
  if (type === 'degree') return 'academic_degree'
  return /^[a-z_]{1,64}$/.test(type) ? type : null
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

/**
 * What verification produces when it does not throw.
 *
 * There is deliberately no `valid`, `isValid` or equivalent accessor. A caller
 * that reaches this object already knows the signature verified against the
 * key it supplied; what it does not yet know — and what this type forces it to
 * handle — is whether the signed fields describe the document in front of the
 * reader.
 */
export class CredentialAssertion {
  readonly issuer: string
  /** The credential's own identifier; null on credentials issued before jtis existed. */
  readonly jti: string | null
  readonly issuedAt: number | null
  readonly expiresAt: number | null
  readonly claims: Claims
  readonly mustMatchPrintedDocument: PrintedDocumentFields
  /** The credential's type, from its signed `vct` (e.g. "academic_degree"); null if it has none. */
  readonly credentialType: string | null
  /** The holder key the issuer bound this credential to (`cnf.jwk`); null when unbound. */
  readonly holderKey: JWK | null

  constructor(issuer: string, payload: Record<string, unknown>, claims: Claims) {
    this.issuer = issuer
    this.credentialType = credentialTypeFromVct(payload.vct)
    const cnf = payload.cnf as { jwk?: JWK } | undefined
    this.holderKey = cnf && cnf.jwk && typeof cnf.jwk === 'object' ? cnf.jwk : null
    this.jti = typeof payload.jti === 'string' ? payload.jti : null
    this.issuedAt = typeof payload.iat === 'number' ? payload.iat : null
    this.expiresAt = typeof payload.exp === 'number' ? payload.exp : null
    this.claims = claims
    // One credential shape per type, one comparison. The first claim present
    // wins, so a degree compares its certificate number and graduation date
    // while a professional certification compares its licence number and the
    // date it was certified — rather than showing the reader nothing.
    this.mustMatchPrintedDocument = {
      subjectName: asText(claims.name ?? claims.student_name),
      documentId: asText(
        claims.certificate_id ?? claims.license_number ?? claims.student_id
      ),
      issuingOrganisation: asText(
        claims.institution ?? claims.institution_name ?? claims.university ?? claims.issuing_body
      ),
      issueDate: asText(
        claims.graduation_date ??
          claims.date_certified ??
          claims.completion_date ??
          claims.date_awarded ??
          claims.event_date ??
          claims.date ??
          claims.issue_date ??
          claims.year
      ),
    }
  }
}

function reasonFor(e: unknown): RejectionReason {
  const code = (e as { code?: string })?.code
  switch (code) {
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'SIGNATURE_INVALID'
    case 'ERR_JWT_EXPIRED':
      return 'CREDENTIAL_EXPIRED'
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      return (e as { claim?: string }).claim === 'nbf'
        ? 'CREDENTIAL_NOT_YET_VALID'
        : 'MALFORMED_PRESENTATION'
    default:
      return 'MALFORMED_PRESENTATION'
  }
}

/**
 * Verify a presentation against the issuer's public key:
 *  1. the issuer signature is valid (and `exp` not passed),
 *  2. every revealed disclosure hashes to a digest the issuer signed.
 *
 * Returns a `CredentialAssertion`, or throws `VerificationRejected` carrying a
 * stable `reason`. It never returns a verdict: refusal is an exception and
 * acceptance is a set of fields somebody still has to read.
 */
export async function verify(
  presentation: string,
  issuerPublicJwk: JWK
): Promise<CredentialAssertion> {
  let key: Awaited<ReturnType<typeof importJWK>>
  try {
    const jwk = issuerPublicJwk.alg ? issuerPublicJwk : { ...issuerPublicJwk, alg: 'ES256' }
    key = await importJWK(jwk, 'ES256')
  } catch {
    throw new VerificationRejected('ISSUER_KEY_MALFORMED')
  }

  const { jwt, disclosures } = parseSdJwt(presentation)

  let payload: Record<string, unknown>
  try {
    // jwtVerify checks the signature AND throws if `exp` is in the past.
    // `algorithms` pins ES256: without it a caller could be steered by the
    // token's own header.
    ;({ payload } = await jwtVerify(jwt, key, { algorithms: ['ES256'] }) as unknown as {
      payload: Record<string, unknown>
    })
  } catch (e) {
    // The reason, never the payload: a jose error carries the decoded claims
    // on `cause`, and those are the credential's contents.
    throw new VerificationRejected(reasonFor(e))
  }

  const signedDigests = (payload._sd as string[] | undefined) ?? []
  const claims: Claims = {}
  for (const d of disclosures) {
    const digest = await sha256b64u(d)
    // Never log `d` or the claims it decodes to.
    if (!signedDigests.includes(digest)) {
      throw new VerificationRejected('DISCLOSURE_NOT_SIGNED')
    }
    let name: string
    let value: unknown
    try {
      ;[, name, value] = fromB64uJSON<[string, string, unknown]>(d)
    } catch {
      throw new VerificationRejected('MALFORMED_PRESENTATION')
    }
    claims[name] = value
  }

  return new CredentialAssertion(String(payload.iss ?? ''), payload, claims)
}

// ---------------------------------------------------------------------------
// Key binding (SD-JWT KB-JWT)
// ---------------------------------------------------------------------------
// A bound credential is presented with a short JWT signed by the holder's key:
// it names where the presentation is going (`aud`), carries a nonce, and
// hashes the exact presentation it accompanies (`sd_hash`). So a presentation
// copied from one proof request or share link cannot be replayed to another,
// and nobody without the holder's wallet can present the credential at all.

export type KeyBindingProblem = 'HOLDER_PROOF_MISSING' | 'HOLDER_PROOF_INVALID' | 'HOLDER_PROOF_WRONG_AUDIENCE'

/** Append a key-binding JWT to a presentation (which must end with `~`). */
export async function addKeyBinding(
  presentation: string,
  holderKey: CryptoKey,
  options: { audience: string; nonce: string; issuedAt?: number }
): Promise<string> {
  if (!presentation.endsWith('~')) throw new Error('addKeyBinding: presentation already bound or malformed')
  const kb = await new SignJWT({
    aud: options.audience,
    nonce: options.nonce,
    iat: options.issuedAt ?? Math.floor(Date.now() / 1000),
    sd_hash: await sha256b64u(presentation),
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'kb+jwt' })
    .sign(holderKey)
  return presentation + kb
}

/**
 * Check a presentation's key binding against the holder key its issuer signed
 * in. Returns null when it holds, or why it does not.
 */
export async function checkKeyBinding(
  presentation: string,
  holderKey: JWK,
  audience: string,
  now: number
): Promise<KeyBindingProblem | null> {
  const { keyBinding, withoutKeyBinding } = parseSdJwt(presentation)
  if (!keyBinding) return 'HOLDER_PROOF_MISSING'
  let payload: Record<string, unknown>
  try {
    const key = await importJWK({ ...holderKey, alg: 'ES256' }, 'ES256')
    ;({ payload } = (await jwtVerify(keyBinding, key, { algorithms: ['ES256'], typ: 'kb+jwt' })) as unknown as {
      payload: Record<string, unknown>
    })
  } catch {
    return 'HOLDER_PROOF_INVALID'
  }
  if (typeof payload.nonce !== 'string' || typeof payload.iat !== 'number' || payload.iat > now + 300) {
    return 'HOLDER_PROOF_INVALID'
  }
  if (payload.sd_hash !== (await sha256b64u(withoutKeyBinding))) return 'HOLDER_PROOF_INVALID'
  if (payload.aud !== audience) return 'HOLDER_PROOF_WRONG_AUDIENCE'
  return null
}

/** What a share link's key-binding proof names as its audience. */
export function shareAudience(shareId: string): string {
  return `actik:share:${shareId}`
}
