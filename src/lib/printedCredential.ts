// The printed lane: a credential that lives entirely inside the QR code on a
// printed certificate, verified in the Actik app with no server call and no
// website. QRSeal's Profile B (SPEC §3), on Actik's trust layer.
//
// Why a second lane at all. The in-app share is a link: its QR is a URL, and a
// URL hands the trust decision to a browser and asks a person to judge a
// domain — the judgement phishing exploits. A printed certificate's QR carries
// the credential itself, `KH1:…`, and the Actik scanner refuses every URL but
// its own. Nothing on the paper sends anyone anywhere.
//
// What is QRSeal and what is Actik:
//   - the wire format, claim rules, signature check, issuer binding and stable
//     reason strings are QRSeal's, run unmodified from src/khsqr/ (checked
//     against QRSeal's own conformance vectors in test-printed.ts);
//   - which keys and issuers are trusted, and which credentials are withdrawn,
//     come from Actik's Root-signed trust list and issuer-signed withdrawal
//     lists — the same ones the in-app lane uses — presented to QRSeal's
//     verifier through ActikProfileBSource below.
//
// One deliberate difference from QRSeal: QRSeal accepts a key only while it is
// valid *now* (SPEC §3.1a's horizon gate). Actik accepts a retired key for
// anything it signed *before* retirement, as the in-app lane does, so that
// rotating a key does not void every certificate it ever printed. The cost is
// QRSeal's open question: a retired key stolen before retirement could sign
// backdated certificates. A suspected compromise must therefore be a key
// *revocation*, which voids everything it signed — not a rotation.

import {
  assertNotUrlCarrier,
  inflate,
  PREFIX,
  signProfileB,
  verifyProfileB,
  type CredentialAssertion as PrintedAssertion,
  type CredentialClaims,
  type ProfileBTrustSource,
} from '../khsqr/profileB'
import { deriveKid, importVerificationKey } from '../khsqr/kid'
import { revocationEntryId, type RevocationStatus, type TrustedKeyRecord } from '../khsqr/trustlist'
import { KhSqrError, KeyRevokedError, UnknownKidError } from '../khsqr/errors'
import { decodeBase45 } from '../khsqr/base45'
import { decodeCbor } from '../khsqr/cbor'
import { decodeCoseSign1 } from '../khsqr/cose'
import { bytesToHex } from '../khsqr/hex'
import type { JWK } from 'jose'
import {
  b64uToBytes,
  CLOCK_SKEW_SECONDS,
  type OpenedTrustList,
  type TrustListIssuer,
  type TrustListKey,
} from './trustList'
import type { OpenedRevocations, RevocationEntry } from './revocation'
import {
  CredentialRefused,
  CredentialWithdrawn,
  messageForRefusal,
  type CheckedCredential,
  type RevocationState,
  type TrustState,
} from './credentialCheck'

export { PREFIX as PRINTED_PREFIX }
export type { PrintedAssertion, CredentialClaims as PrintedClaims }

function refuse(reason: string): never {
  throw new CredentialRefused(reason, messageForRefusal(reason))
}

/** The 65-byte uncompressed P-256 point a JWK describes. */
function uncompressedPoint(jwk: JWK): Uint8Array {
  const x = b64uToBytes(jwk.x ?? '')
  const y = b64uToBytes(jwk.y ?? '')
  const point = new Uint8Array(65)
  point[0] = 0x04
  point.set(x, 1)
  point.set(y, 33)
  return point
}

/**
 * QRSeal's key id for a key: the first 8 bytes of SHA-256 over its
 * uncompressed point, as 16 uppercase hex. Printed codes carry this (8 bytes
 * is what fits a QR); the in-app lane uses the longer RFC 7638 thumbprint. Both
 * are derived from the same public key, so the trust list needs no new field.
 */
export async function printedKeyId(jwk: JWK): Promise<string> {
  return deriveKid(uncompressedPoint(jwk))
}

/**
 * `dh`: the first 16 bytes of SHA-256 over the issued file, as 32 lowercase
 * hex — the shape QRSeal's reference vectors use, kept short because every
 * byte here costs QR modules. It ties the printed code to the certificate scan
 * the holder also has in their wallet.
 */
export async function printedDocumentHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return bytesToHex(digest.subarray(0, 16)).toLowerCase()
}

export class PrintRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrintRefused'
  }
}

/**
 * Sign a printed credential. Every text claim must be present and non-empty:
 * the four the verifier compares against the paper are only a defence if they
 * are on it.
 */
export async function issuePrintedCredential(options: {
  signingKey: CryptoKey
  publicJwk: JWK
  claims: CredentialClaims
}): Promise<string> {
  const c = options.claims
  const required: Array<[string, string]> = [
    ['issuer', c.issuer],
    ['document type', c.documentType],
    ['document number', c.documentId],
    ['holder name', c.subjectName],
    ['issuing institution', c.issuingOrganisation],
    ['issue date', c.issueDate],
  ]
  for (const [label, value] of required) {
    if (!value || !value.trim()) {
      throw new PrintRefused(
        label === 'document number'
          ? 'A printed certificate needs a document number (certificate or licence number). The verifier compares it with the paper; without one there is nothing tying the code to this document.'
          : `A printed certificate needs a ${label}.`
      )
    }
  }
  return signProfileB({
    privateKey: options.signingKey,
    kid: await printedKeyId(options.publicJwk),
    claims: c,
  })
}

/**
 * The issuer a printed code names, read WITHOUT verifying it — only so the
 * caller knows whose withdrawal list to load before verifying. Nothing here is
 * trusted; verifyPrintedCredential re-derives everything from the signature.
 */
export async function peekPrintedIssuer(payload: string): Promise<string | null> {
  try {
    if (!payload.startsWith(PREFIX)) return null
    const cose = decodeCoseSign1(await inflate(decodeBase45(payload.slice(PREFIX.length))))
    const claims = decodeCbor(cose.payload)
    const issuer = claims instanceof Map ? claims.get(1) : undefined
    return typeof issuer === 'string' ? issuer : null
  } catch {
    return null
  }
}

/**
 * Actik's signed trust list and withdrawal lists, in the shape QRSeal's
 * verifier asks for. Built once per verification.
 */
class ActikProfileBSource implements ProfileBTrustSource {
  private constructor(
    private readonly byKid: Map<string, Array<{ issuer: TrustListIssuer; key: TrustListKey }>>,
    private readonly revocations: RevocationState,
    private readonly withdrawnByEntryId: Map<string, RevocationEntry>,
    private readonly preferIssuer: string | null,
    private readonly now: number
  ) {}

  static async create(
    list: OpenedTrustList,
    revocations: RevocationState,
    issuerHint: string | null,
    now: number
  ): Promise<ActikProfileBSource> {
    const byKid = new Map<string, Array<{ issuer: TrustListIssuer; key: TrustListKey }>>()
    for (const issuer of list.issuers.values()) {
      for (const key of issuer.keys) {
        const kid = await printedKeyId(key.jwk)
        byKid.set(kid, [...(byKid.get(kid) ?? []), { issuer, key }])
      }
    }
    // Actik's list entries are QRSeal's own entry hashes (issuer and document
    // number), so a printed code's entry is looked up as-is.
    const withdrawn = new Map<string, RevocationEntry>()
    const opened: OpenedRevocations | null = revocations.list
    if (opened) {
      for (const e of opened.entries) withdrawn.set(e.id, e)
    }
    return new ActikProfileBSource(byKid, revocations, withdrawn, issuerHint, now)
  }

  async resolveRecords(kid: string, _profile: 'B', _now: number) {
    const matches = this.byKid.get(kid) ?? []
    if (matches.length === 0) throw new UnknownKidError()
    const live = matches.filter((m) => m.key.status !== 'revoked')
    if (live.length === 0) throw new KeyRevokedError()
    // The key window is checked against the credential's own issue time once
    // it has verified (see verifyPrintedCredential), not against `now`.
    live.sort((a, b) => Number(b.issuer.did === this.preferIssuer) - Number(a.issuer.did === this.preferIssuer))
    return Promise.all(
      live.map(async ({ issuer, key }) => {
        const point = uncompressedPoint(key.jwk)
        const record: TrustedKeyRecord = {
          kid,
          x: bytesToHex(point.subarray(1, 33)),
          y: bytesToHex(point.subarray(33, 65)),
          profiles: ['B'],
          status: 'active',
          notBefore: key.notBefore,
          notAfter: key.notAfter,
          // The issuer claim a printed code carries is the issuer's DID, and
          // it must equal this — QRSeal's issuer binding, unchanged.
          subject: { name: issuer.name, organisationId: issuer.did },
        }
        return { key: await importVerificationKey(point), record }
      })
    )
  }

  revocationStatus(issuer: string, entryId: string): RevocationStatus {
    if (this.revocations.failure) return { state: 'withheld', declaredVersion: 0 }
    const opened = this.revocations.list
    if (!opened || opened.issuer !== issuer) return { state: 'unchecked' }
    const hit = this.withdrawnByEntryId.get(entryId)
    if (hit) return { state: 'revoked', revokedAt: hit.revokedAt, reason: hit.reason, listVersion: opened.version }
    if (this.now > opened.expires + CLOCK_SKEW_SECONDS) return { state: 'unchecked' }
    return { state: 'clear', listVersion: opened.version, listIssuedAt: opened.issuedAt }
  }

  withdrawalFor(entryId: string): RevocationEntry | undefined {
    return this.withdrawnByEntryId.get(entryId)
  }
}

export interface CheckedPrinted {
  assertion: PrintedAssertion
  issuer: TrustListIssuer
  key: TrustListKey
  standing:
    | { status: 'clear'; listVersion: number; listIssuedAt: number }
    | { status: 'unchecked'; why: 'none_published' | 'expired'; listExpiredAt?: number }
  trustListVersion: number
}

/**
 * Verify a scanned printed code. Returns what was checked, or throws
 * CredentialRefused (CredentialWithdrawn when the institution withdrew it).
 * No network: the trust list and withdrawal list arrive already opened.
 */
export async function verifyPrintedCredential(
  payload: string,
  trust: TrustState,
  revocations: RevocationState,
  now: number
): Promise<CheckedPrinted> {
  const scanned = payload.trim()

  // A URL is refused before anything else, whatever our trust state.
  try {
    assertNotUrlCarrier(scanned)
  } catch (e) {
    if (e instanceof KhSqrError) refuse(e.reason)
    throw e
  }
  if (!scanned.startsWith(PREFIX)) refuse('PREFIX_INVALID')

  if (!trust.list) refuse(trust.failure ?? 'TRUSTLIST_MISSING')
  const list = trust.list

  const hint = await peekPrintedIssuer(scanned)
  const source = await ActikProfileBSource.create(list, revocations, hint, now)

  let assertion: PrintedAssertion
  try {
    assertion = await verifyProfileB({ payload: scanned, trustAnchor: source, now })
  } catch (e) {
    if (!(e instanceof KhSqrError)) throw e
    if (e.reason === 'CREDENTIAL_REVOKED' && hint) {
      // QRSeal's error carries only a reason class; the institution's own
      // words are in Actik's list. Find them by the same hash.
      const decoded = await peekDocumentId(scanned)
      const entry = decoded ? source.withdrawalFor(await revocationEntryId(hint, decoded)) : undefined
      throw new CredentialWithdrawn(entry?.reason ?? 'withdrawn', entry?.revokedAt ?? 0)
    }
    refuse(e.reason)
  }

  // Which listed key signed it, and was that key valid when it did?
  const issuer = list.issuers.get(assertion.issuer)
  if (!issuer) refuse('ISSUER_NOT_LISTED')
  let key: TrustListKey | undefined
  for (const k of issuer.keys) {
    if (k.status !== 'revoked' && (await printedKeyId(k.jwk)) === assertion.kid) key = k
  }
  if (!key) refuse('KEY_UNKNOWN')
  if (
    assertion.issuedAt < key.notBefore - CLOCK_SKEW_SECONDS ||
    assertion.issuedAt > key.notAfter + CLOCK_SKEW_SECONDS
  ) {
    refuse('KEY_NOT_VALID_AT_ISSUANCE')
  }
  if (assertion.issuedAt > now + CLOCK_SKEW_SECONDS) refuse('CREDENTIAL_NOT_YET_VALID')

  const standing: CheckedPrinted['standing'] =
    assertion.credentialStatus === 'clear' && assertion.revocationList
      ? { status: 'clear', listVersion: assertion.revocationList.version, listIssuedAt: assertion.revocationList.issuedAt }
      : revocations.list
        ? { status: 'unchecked', why: 'expired', listExpiredAt: revocations.list.expires }
        : { status: 'unchecked', why: 'none_published' }

  return { assertion, issuer, key, standing, trustListVersion: list.version }
}

/** The document number of an unverified code, to look up a withdrawal reason. */
async function peekDocumentId(payload: string): Promise<string | null> {
  try {
    const cose = decodeCoseSign1(await inflate(decodeBase45(payload.slice(PREFIX.length))))
    const claims = decodeCbor(cose.payload)
    const di = claims instanceof Map ? claims.get('di') : undefined
    return typeof di === 'string' ? di : null
  } catch {
    return null
  }
}

/**
 * What a scanned string is, before any verifying.
 *   own-link — a link to this app's own /verify/<id> page: the in-app share
 *              lane, which the scanner may follow because it never leaves
 *              this app.
 *   url      — any other link. Refused: Actik's codes never send you to a
 *              website, so a code that does is not one of ours, and opening
 *              it is exactly the judgement phishing relies on.
 *   printed  — a KH1: printed credential.
 *   other    — anything else: not an Actik code, and not a forgery either.
 */
export type ScannedKind =
  | { kind: 'own-link'; shareId: string }
  | { kind: 'url' }
  | { kind: 'printed'; payload: string }
  | { kind: 'other' }

export function classifyScanned(text: string, ownOrigin: string): ScannedKind {
  const scanned = text.trim()
  if (/^https?:\/\//i.test(scanned)) {
    try {
      const url = new URL(scanned)
      const match = /^\/verify\/([0-9a-f-]{36})\/?$/i.exec(url.pathname)
      // Exact origin, no credentials, no query tricks: a lookalike domain or a
      // userinfo-prefixed URL is just another URL.
      if (url.origin === ownOrigin && !url.username && !url.password && match) {
        return { kind: 'own-link', shareId: match[1] }
      }
    } catch {
      /* unparsable: still a URL by its scheme */
    }
    return { kind: 'url' }
  }
  if (scanned.startsWith(PREFIX)) return { kind: 'printed', payload: scanned }
  return { kind: 'other' }
}

/**
 * The four printed fields (and file hash) a code carries, read without
 * verifying it. For the holder's own reprint, from their vault, of a code that
 * was verified when it was claimed: the paper must show exactly what the code
 * signs, so the fields are taken from the code, never from the wallet's
 * display columns. Anyone scanning the reprint verifies it in full.
 */
export async function readPrintedFields(payload: string): Promise<{
  subjectName: string
  documentId: string
  issuingOrganisation: string
  issueDate: string
  documentHash: string | null
} | null> {
  try {
    if (!payload.startsWith(PREFIX)) return null
    const cose = decodeCoseSign1(await inflate(decodeBase45(payload.slice(PREFIX.length))))
    const claims = decodeCbor(cose.payload)
    if (!(claims instanceof Map)) return null
    const text = (k: string) => (typeof claims.get(k) === 'string' ? (claims.get(k) as string) : null)
    const subjectName = text('sn'), documentId = text('di'), issuingOrganisation = text('io'), issueDate = text('idt')
    if (subjectName === null || documentId === null || issuingOrganisation === null || issueDate === null) return null
    return { subjectName, documentId, issuingOrganisation, issueDate, documentHash: text('dh') }
  } catch {
    return null
  }
}

/**
 * Whether a printed copy delivered with a credential belongs with it: it
 * verifies on its own, comes from the same issuer, and names the same document
 * and holder. Used at claim time (claimVerification.verifyPrintedCopy).
 */
export type PrintedCopyResult = { payload: string } | { payload: null; reason: string | null }

export async function checkPrintedCopy(
  printed: string,
  credential: CheckedCredential,
  trust: TrustState,
  revocations: RevocationState,
  now: number
): Promise<PrintedCopyResult> {
  const issuerDid = credential.assertion.issuer
  try {
    const checked = await verifyPrintedCredential(printed, trust, revocations, now)
    const signed = credential.assertion.mustMatchPrintedDocument
    const paper = checked.assertion.mustMatchPrintedDocument
    const same = (a: string | null, b: string) => a !== null && a.normalize('NFC').trim() === b.normalize('NFC').trim()
    if (checked.assertion.issuer !== issuerDid) return { payload: null, reason: 'ISSUER_MISMATCH' }
    if (!same(signed.documentId, paper.documentId)) return { payload: null, reason: 'DOCUMENT_MISMATCH' }
    if (signed.subjectName !== null && !same(signed.subjectName, paper.subjectName)) {
      return { payload: null, reason: 'SUBJECT_MISMATCH' }
    }
    return { payload: printed.trim() }
  } catch (e) {
    if (e instanceof CredentialRefused) return { payload: null, reason: e.reason }
    throw e
  }
}
