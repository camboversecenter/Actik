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
// The list is public, so it names no one. Version 1 carried document numbers,
// jtis and a free-text reason in the clear: anyone could read which numbered
// degree an institution had taken back, and why. Version 2 carries only
// QRSeal's entry hash — SHA-256 over a domain tag, the issuer and the document
// number (or the jti) — and one of two fixed reasons. Only someone already
// holding the credential can compute the entry to look for. A guessable
// numbering scheme can still be enumerated by someone hashing candidates; what
// they learn is that a number was withdrawn, never whose it was or why.
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
import { revocationEntryId } from '../khsqr/trustlist'

export const REVOCATIONS_TYPE = 'actik/revocations/2'
/** The format that named credentials in the clear. Opened only to be replaced. */
export const LEGACY_REVOCATIONS_TYPE = 'actik/revocations/1'

/**
 * Why a credential was withdrawn — two fixed categories, as in QRSeal. A
 * free-text reason on a public list ("plagiarism") is exactly what must not be
 * published; the institution keeps its reasons in its own records.
 *   withdrawn — taken back: rescinded, issued in error, no longer stands.
 *   corrected — superseded: the institution has issued a corrected one.
 */
export type WithdrawalReason = 'withdrawn' | 'corrected'

export interface RevocationEntry {
  /** revocationEntryId(issuer, documentNumber) or revocationEntryId(issuer, 'jti:' + jti). */
  id: string
  reason: WithdrawalReason
  revokedAt: number
}

/**
 * What an issuer withdraws, before it is hashed for publication: the
 * credential's `jti`, the document number printed on it, or both.
 * The document number is certificate_id or license_number — deliberately NOT
 * student_id: one student number can sit on several credentials, and
 * withdrawing one must not withdraw them all.
 */
export interface WithdrawalRequest {
  jti?: string | null
  documentId?: string | null
  reason: WithdrawalReason
  revokedAt: number
}

/** The entry id for a jti. Prefixed so it can never equal a document number's. */
export function jtiEntryId(issuer: string, jti: string): Promise<string> {
  return revocationEntryId(issuer, `jti:${jti}`)
}

/** The entry id for a printed document number — QRSeal's, unchanged, so printed codes match it. */
export function documentEntryId(issuer: string, documentId: string): Promise<string> {
  return revocationEntryId(issuer, documentId)
}

/** Hash a withdrawal into the entries that go on the public list. */
export async function entriesFor(issuer: string, w: WithdrawalRequest): Promise<RevocationEntry[]> {
  const out: RevocationEntry[] = []
  if (w.jti) out.push({ id: await jtiEntryId(issuer, w.jti), reason: w.reason, revokedAt: w.revokedAt })
  if (w.documentId) {
    out.push({ id: await documentEntryId(issuer, w.documentId), reason: w.reason, revokedAt: w.revokedAt })
  }
  return out
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
  | { status: 'revoked'; reason: WithdrawalReason; revokedAt: number; listVersion: number }

export interface OpenedRevocations {
  issuer: string
  version: number
  issuedAt: number
  expires: number
  digest: string
  entries: RevocationEntry[]
  /** True for a version-1 list: genuine, but it names credentials in the clear and must be republished. */
  legacy: boolean
  document: SignedDocument
}

const ENTRY_ID = /^[0-9A-F]{64}$/

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
  const legacy = !!s && (s as { type?: unknown }).type === LEGACY_REVOCATIONS_TYPE
  if (
    !s || (s.type !== REVOCATIONS_TYPE && !legacy) || typeof s.issuer !== 'string' ||
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

  let entries: RevocationEntry[]
  if (legacy) {
    // A version-1 list still withdraws what it withdrew: hash its entries so
    // they match, and flag it so the issuer's next publication replaces it.
    entries = []
    for (const e of s.revoked as unknown as Array<Record<string, unknown>>) {
      const jti = typeof e?.jti === 'string' ? e.jti : null
      const documentId = typeof e?.documentId === 'string' ? e.documentId : null
      if (!e || (!jti && !documentId) || !isNumber(e.revokedAt)) {
        throw new RevocationRejected('REVOCATIONS_MALFORMED')
      }
      entries.push(...(await entriesFor(s.issuer, { jti, documentId, reason: 'withdrawn', revokedAt: e.revokedAt })))
    }
  } else {
    for (const e of s.revoked) {
      if (
        !e || typeof e.id !== 'string' || !ENTRY_ID.test(e.id) || !isNumber(e.revokedAt) ||
        (e.reason !== 'withdrawn' && e.reason !== 'corrected') ||
        Object.keys(e).some((k) => k !== 'id' && k !== 'reason' && k !== 'revokedAt')
      ) {
        throw new RevocationRejected('REVOCATIONS_MALFORMED')
      }
    }
    entries = s.revoked
  }

  return {
    issuer: s.issuer,
    version: s.version,
    issuedAt: s.issuedAt,
    expires: s.expires,
    digest,
    entries,
    legacy,
    document: doc,
  }
}

/** The document numbers a revocation entry may name for this credential. */
function documentNumbers(assertion: Pick<CredentialAssertion, 'claims'>): string[] {
  const out: string[] = []
  for (const key of ['certificate_id', 'license_number']) {
    const v = assertion.claims[key]
    if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v)
  }
  return out
}

/** Every entry id under which this credential could have been withdrawn. */
export async function entryIdsForCredential(
  issuer: string,
  assertion: Pick<CredentialAssertion, 'jti' | 'claims'>
): Promise<string[]> {
  const ids: string[] = []
  if (assertion.jti) ids.push(await jtiEntryId(issuer, assertion.jti))
  for (const n of documentNumbers(assertion)) ids.push(await documentEntryId(issuer, n))
  return ids
}

/**
 * Standing of one credential against its issuer's list (or the absence of one).
 * A credential on the list is revoked even if the list has since expired: an
 * expired list is stale about what it does NOT say, not about what it does.
 */
export async function credentialStatus(
  assertion: Pick<CredentialAssertion, 'jti' | 'claims'>,
  revocations: OpenedRevocations | null,
  now: number
): Promise<CredentialStatus> {
  if (!revocations) return { status: 'unchecked', why: 'none_published' }

  const ids = await entryIdsForCredential(revocations.issuer, assertion)
  const hit = revocations.entries.find((e) => ids.includes(e.id))
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
  add: WithdrawalRequest[]
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
    revoked: [...(options.previous?.entries ?? [])],
  }
  for (const w of options.add) {
    for (const e of await entriesFor(options.issuerDid, w)) {
      if (!statement.revoked.some((have) => have.id === e.id)) statement.revoked.push(e)
    }
  }
  return signStatement(statement, options.signingKey, options.kid)
}

// Re-exported so callers that only deal with revocations need one import.
export { b64uToBytes }
