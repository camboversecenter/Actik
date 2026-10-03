// Per-credential withdrawal: an issuer-signed list of credentials it has taken
// back. QRSeal SPEC §4.5, adapted.
//
// Before this, the only way to take back a rescinded degree or a credential
// issued with the wrong date was to have the institution's whole key revoked —
// withdrawing everything it had ever signed. Now the issuer signs a list of
// the specific credentials it withdraws, and a verifier checks against it.
//
// What a verifier may then say, and must not overstate:
//   clear     — checked against the issuer's list, version V, dated D, and
//               this credential is not on it. That is the limit of what was
//               checked: a withdrawal the issuer made after D is not known.
//   unchecked — the issuer publishes no list, or let its list lapse. The
//               signature may be fine; the standing is unknown, and an
//               interface must not present the credential as current.
//   revoked   — the issuer withdrew it. A refusal, and a specific one: the
//               holder is entitled to know it was the institution, not the
//               code, that ended it.
//
// The list is signed by one of the issuer's own keys, and that key must be one
// the Root-signed trust list accepts for that issuer — so a list can be
// trusted exactly as far as the issuer's credentials can.
//
// Pure: no network, no storage.

import {
  b64uToBytes,
  keyAcceptedAt,
  sha256Hex,
  signStatement,
  TrustRejected,
  verifySignedDocument,
  MAX_LIST_VALIDITY_SECONDS,
  CLOCK_SKEW_SECONDS,
  type OpenedTrustList,
  type SignedDocument,
  type HeldVersion,
} from './trustList'
import type { CredentialAssertion } from './sdjwt'

export const REVOCATIONS_TYPE = 'actik/revocations/1'

export interface RevocationEntry {
  /** The credential's `jti` — present on everything issued since kids/jtis were added. */
  jti?: string
  /**
   * The document number the institution printed — certificate_id or
   * license_number. Lets an institution withdraw a credential issued before
   * jtis existed, and lets a registrar work from the number on the paper.
   * Deliberately NOT student_id: one student number can sit on several
   * credentials, and withdrawing one must not withdraw them all.
   */
  documentId?: string
  reason: string
  revokedAt: number
}

export interface RevocationStatement {
  type: typeof REVOCATIONS_TYPE
  issuer: string
  version: number
  issuedAt: number
  expires: number
  revoked: RevocationEntry[]
}

export type RevocationRejectionReason =
  | 'REVOCATIONS_MALFORMED'
  | 'REVOCATIONS_WRONG_ISSUER'
  | 'REVOCATIONS_KEY_NOT_ACCEPTED'
  | 'REVOCATIONS_SIGNATURE_INVALID'
  | 'REVOCATIONS_VALIDITY_TOO_LONG'
  | 'REVOCATIONS_ROLLBACK'
  | 'REVOCATIONS_VERSION_CONFLICT'

export class RevocationRejected extends Error {
  readonly reason: RevocationRejectionReason
  constructor(reason: RevocationRejectionReason) {
    super(reason)
    this.name = 'RevocationRejected'
    this.reason = reason
  }
}

export type CredentialStatus =
  | { status: 'clear'; listVersion: number; listIssuedAt: number }
  | { status: 'unchecked'; why: 'none_published' | 'expired'; listExpiredAt?: number }
  | { status: 'revoked'; reason: string; revokedAt: number; listVersion: number }

export interface OpenedRevocations {
  issuer: string
  version: number
  issuedAt: number
  expires: number
  digest: string
  entries: RevocationEntry[]
  document: SignedDocument
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Open an issuer's revocation list. Throws RevocationRejected when the list is
 * not one the issuer could have signed, or would roll this verifier back —
 * that is a trust-state failure ("we could not check"), not a verdict on any
 * credential. An expired but genuine list opens; credentialStatus() reports it
 * as unchecked.
 */
export async function openRevocationList(
  doc: SignedDocument,
  options: { list: OpenedTrustList; issuerDid: string; held?: HeldVersion | null }
): Promise<OpenedRevocations> {
  if (
    !doc || typeof doc.statement !== 'string' || !doc.signature ||
    doc.signature.alg !== 'ES256' || typeof doc.signature.kid !== 'string' ||
    typeof doc.signature.value !== 'string'
  ) {
    throw new RevocationRejected('REVOCATIONS_MALFORMED')
  }

  // Which key signed it is not taken on trust either: parse just enough to know
  // when it claims to have been signed, then require the trust list to accept
  // that kid for this issuer at that time.
  let s: RevocationStatement
  try {
    s = JSON.parse(doc.statement)
  } catch {
    throw new RevocationRejected('REVOCATIONS_MALFORMED')
  }
  if (
    !s || s.type !== REVOCATIONS_TYPE || typeof s.issuer !== 'string' ||
    !isNumber(s.version) || !isNumber(s.issuedAt) || !isNumber(s.expires) ||
    !Array.isArray(s.revoked)
  ) {
    throw new RevocationRejected('REVOCATIONS_MALFORMED')
  }
  if (s.issuer !== options.issuerDid) throw new RevocationRejected('REVOCATIONS_WRONG_ISSUER')

  let signer
  try {
    signer = keyAcceptedAt(options.list, options.issuerDid, doc.signature.kid, s.issuedAt)
  } catch (e) {
    if (e instanceof TrustRejected) throw new RevocationRejected('REVOCATIONS_KEY_NOT_ACCEPTED')
    throw e
  }
  if (!(await verifySignedDocument(doc, signer.jwk))) {
    throw new RevocationRejected('REVOCATIONS_SIGNATURE_INVALID')
  }
  if (s.expires - s.issuedAt > MAX_LIST_VALIDITY_SECONDS) {
    throw new RevocationRejected('REVOCATIONS_VALIDITY_TOO_LONG')
  }

  const digest = await sha256Hex(doc.statement)
  const held = options.held
  if (held) {
    if (s.version < held.version) throw new RevocationRejected('REVOCATIONS_ROLLBACK')
    if (s.version === held.version && digest !== held.digest) {
      throw new RevocationRejected('REVOCATIONS_VERSION_CONFLICT')
    }
  }

  for (const e of s.revoked) {
    if (!e || (typeof e.jti !== 'string' && typeof e.documentId !== 'string') || !isNumber(e.revokedAt)) {
      throw new RevocationRejected('REVOCATIONS_MALFORMED')
    }
  }

  return {
    issuer: s.issuer,
    version: s.version,
    issuedAt: s.issuedAt,
    expires: s.expires,
    digest,
    entries: s.revoked,
    document: doc,
  }
}

/** The document numbers a revocation entry may name for this credential. */
function documentNumbers(assertion: CredentialAssertion): string[] {
  const out: string[] = []
  for (const key of ['certificate_id', 'license_number']) {
    const v = assertion.claims[key]
    if (typeof v === 'string' && v !== '') out.push(v)
  }
  return out
}

/**
 * Standing of one credential against its issuer's list (or the absence of one).
 * A credential on the list is revoked even if the list has since expired: an
 * expired list is stale about what it does NOT say, not about what it does.
 */
export function credentialStatus(
  assertion: CredentialAssertion,
  revocations: OpenedRevocations | null,
  now: number
): CredentialStatus {
  if (!revocations) return { status: 'unchecked', why: 'none_published' }

  const numbers = documentNumbers(assertion)
  const hit = revocations.entries.find(
    (e) =>
      (e.jti !== undefined && assertion.jti !== null && e.jti === assertion.jti) ||
      (e.documentId !== undefined && numbers.includes(e.documentId))
  )
  if (hit) {
    return { status: 'revoked', reason: hit.reason, revokedAt: hit.revokedAt, listVersion: revocations.version }
  }

  if (now > revocations.expires + CLOCK_SKEW_SECONDS) {
    return { status: 'unchecked', why: 'expired', listExpiredAt: revocations.expires }
  }
  return { status: 'clear', listVersion: revocations.version, listIssuedAt: revocations.issuedAt }
}

/**
 * Build and sign the next version of an issuer's list. The issuer's key never
 * leaves the CryptoKey it is held in.
 */
export async function buildRevocationList(options: {
  issuerDid: string
  previous: OpenedRevocations | null
  add: RevocationEntry[]
  signingKey: CryptoKey
  kid: string
  now: number
  validitySeconds?: number
}): Promise<SignedDocument> {
  const validity = Math.min(options.validitySeconds ?? 30 * 24 * 60 * 60, MAX_LIST_VALIDITY_SECONDS)
  const statement: RevocationStatement = {
    type: REVOCATIONS_TYPE,
    issuer: options.issuerDid,
    version: (options.previous?.version ?? 0) + 1,
    issuedAt: options.now,
    expires: options.now + validity,
    revoked: [...(options.previous?.entries ?? []), ...options.add],
  }
  return signStatement(statement, options.signingKey, options.kid)
}

// Re-exported so callers that only deal with revocations need one import.
export { b64uToBytes }
