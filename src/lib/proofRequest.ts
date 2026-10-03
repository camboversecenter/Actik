// Proof requests: recruitment where the candidate stays in control.
//
// An employer publishes a request — "a bachelor's degree, and a professional
// certification" — as a link. A candidate opens it, picks matching credentials
// from their own wallet, and answers with exactly the fields the request may
// see. The employer's app checks each answer against the Root-signed trust list
// and the institution's withdrawal list, and shows who issued it first.
//
// What this format refuses to express, on purpose:
//
//   - Fields that invite discrimination or are not needed to judge a
//     qualification: age or date of birth, sex, marital status, photograph,
//     national ID, student number, email, place of birth, religion. There is no
//     way to ask for them, because the request names fields from a per-type
//     allowlist and nothing else. The candidate's app discloses only allowlisted
//     fields whatever a request says, and the database refuses a response that
//     carries anything else (supabase: proof_responses_guard).
//   - Self-added items. Only credentials an institution issued can answer a
//     requirement, so "issued" and "added by me" cannot be confused.
//   - A search over people. A request is answered by candidates who choose to;
//     employers never browse wallets (they are end-to-end encrypted anyway).
//
// Who is answering: a bound credential (issued with the holder's wallet key,
// see holderKey.ts) must come with that wallet's proof, made for this request,
// so a copy cannot be sent by someone else or replayed to another request. An
// unbound one proves only who it was issued to — the candidate's name is
// always disclosed so the employer can check their ID at interview.
//
// Pure: no network, no storage.

import { ALWAYS_REVEALED } from './disclosure'
import { present, peekJwt, credentialTypeFromVct, addKeyBinding } from './sdjwt'
import {
  checkCredential,
  CredentialRefused,
  type CheckedCredential,
  type RevocationState,
  type TrustState,
} from './credentialCheck'

export const MAX_REQUIREMENTS = 5
export const MAX_REQUEST_DAYS = 90
export const MAX_PRESENTATION_LENGTH = 100_000

/**
 * The credential types a request may ask for, and the extra fields — beyond
 * what every answer discloses (ALWAYS_REVEALED: the holder's name, the
 * institution, the document number and date, the substance of the credential)
 * — that it may ask to see. Anything not listed here cannot be requested.
 */
export const REQUESTABLE: Record<string, { label: string; extras: string[] }> = {
  academic_degree: { label: 'Academic degree', extras: ['major', 'gpa'] },
  professional_certification: { label: 'Professional certification', extras: [] },
  completion: { label: 'Certificate of completion', extras: ['duration', 'department_or_role'] },
  attendance_participation: { label: 'Attendance or participation', extras: ['role_description'] },
  merit_excellence: { label: 'Merit or excellence award', extras: ['basis_description'] },
  appreciation_service: { label: 'Appreciation or service', extras: ['capacity'] },
  employment_record: { label: 'Employment record', extras: ['department', 'role_description'] },
}

/** Fields a request can never name, listed so the interface can say so plainly. */
export const NEVER_REQUESTABLE = [
  'date of birth or age', 'sex or gender', 'marital status', 'photograph', 'national ID',
  'student number', 'place of birth', 'religion or ethnicity', 'email or phone',
]

export interface Requirement {
  type: string
  extras: string[]
  /** The employer's own words about this requirement, e.g. "in accounting or finance". */
  note: string
}

export interface ProofRequestDraft {
  requesterName: string
  title: string
  description: string
  requirements: Requirement[]
  expiresInDays: number
}

export interface ProofRequest {
  id: string
  requesterName: string
  title: string
  description: string
  requirements: Requirement[]
  expiresAt: string
  status: 'open' | 'closed' | 'expired'
}

export type ProofRequestProblem =
  | 'REQUESTER_NAME'
  | 'TITLE'
  | 'DESCRIPTION'
  | 'NO_REQUIREMENTS'
  | 'TOO_MANY_REQUIREMENTS'
  | 'UNKNOWN_TYPE'
  | 'FIELD_NOT_REQUESTABLE'
  | 'NOTE'
  | 'EXPIRY'

export class ProofRequestInvalid extends Error {
  readonly problem: ProofRequestProblem
  constructor(problem: ProofRequestProblem, detail?: string) {
    super(detail ? `${problem}: ${detail}` : problem)
    this.name = 'ProofRequestInvalid'
    this.problem = problem
  }
}

const textLength = (s: unknown, min: number, max: number) =>
  typeof s === 'string' && s.trim().length >= min && s.trim().length <= max

/** Check a draft and return it normalised. Throws ProofRequestInvalid. */
export function validateRequest(d: ProofRequestDraft): ProofRequestDraft {
  if (!textLength(d.requesterName, 2, 120)) throw new ProofRequestInvalid('REQUESTER_NAME')
  if (!textLength(d.title, 2, 120)) throw new ProofRequestInvalid('TITLE')
  if (typeof d.description !== 'string' || d.description.length > 2000) throw new ProofRequestInvalid('DESCRIPTION')
  if (!Array.isArray(d.requirements) || d.requirements.length === 0) throw new ProofRequestInvalid('NO_REQUIREMENTS')
  if (d.requirements.length > MAX_REQUIREMENTS) throw new ProofRequestInvalid('TOO_MANY_REQUIREMENTS')
  const requirements = d.requirements.map((r) => {
    const spec = REQUESTABLE[r.type]
    if (!spec) throw new ProofRequestInvalid('UNKNOWN_TYPE', String(r.type))
    const extras = [...new Set(r.extras ?? [])]
    for (const f of extras) {
      if (!spec.extras.includes(f)) throw new ProofRequestInvalid('FIELD_NOT_REQUESTABLE', f)
    }
    if (typeof r.note !== 'string' || r.note.length > 300) throw new ProofRequestInvalid('NOTE')
    return { type: r.type, extras, note: r.note.trim() }
  })
  if (!Number.isInteger(d.expiresInDays) || d.expiresInDays < 1 || d.expiresInDays > MAX_REQUEST_DAYS) {
    throw new ProofRequestInvalid('EXPIRY')
  }
  return {
    requesterName: d.requesterName.trim(),
    title: d.title.trim(),
    description: d.description.trim(),
    requirements,
    expiresInDays: d.expiresInDays,
  }
}

/** Every claim an answer to this requirement may disclose. */
export function allowedClaims(r: Requirement): string[] {
  const spec = REQUESTABLE[r.type]
  if (!spec) return []
  return [...ALWAYS_REVEALED, ...r.extras.filter((f) => spec.extras.includes(f))]
}

function b64uText(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Disclosure names in a presentation, without verifying it. */
export function disclosedNames(presentation: string): string[] {
  const names: string[] = []
  const parts = presentation.split('~')
  // A key-bound presentation ends with its KB-JWT instead of `~`: not a disclosure.
  const middle = parts.length > 1 && parts[parts.length - 1] !== '' ? parts.slice(1, -1) : parts.slice(1)
  for (const d of middle) {
    if (!d) continue
    try {
      const decoded = JSON.parse(b64uText(d))
      names.push(Array.isArray(decoded) && typeof decoded[1] === 'string' ? decoded[1] : '\u0000invalid')
    } catch {
      names.push('\u0000invalid')
    }
  }
  return names
}

/** The credential type a token claims (unverified — only for offering matches). */
export function claimedType(sdjwt: string): string | null {
  try {
    const payload = JSON.parse(b64uText(sdjwt.split('~')[0].split('.')[1]))
    return credentialTypeFromVct(payload.vct)
  } catch {
    return null
  }
}

export class AnswerRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnswerRefused'
  }
}

/**
 * The presentation a candidate sends for one requirement: their credential
 * with only the allowlisted fields disclosed. Refuses a credential of the
 * wrong type rather than send it.
 */
export function buildAnswer(r: Requirement, sdjwt: string): string {
  if (claimedType(sdjwt) !== r.type) throw new AnswerRefused('This credential is not the kind the request asks for.')
  const presentation = present(sdjwt, allowedClaims(r))
  if (presentation.length > MAX_PRESENTATION_LENGTH) throw new AnswerRefused('This credential is too large to send.')
  return presentation
}

/** What a key-binding proof names as its audience when answering this request. */
export function proofAudience(requestId: string): string {
  return `actik:proof-request:${requestId}`
}

/**
 * buildAnswer, plus the holder's proof when the credential is bound to a
 * holder key: signed for this request only, so the answer cannot be replayed
 * to another. An unbound credential is sent as it is.
 */
export async function buildBoundAnswer(
  r: Requirement,
  sdjwt: string,
  requestId: string,
  holderKey: CryptoKey | null
): Promise<string> {
  const presentation = buildAnswer(r, sdjwt)
  const bound = !!(JSON.parse(b64uText(sdjwt.split('~')[0].split('.')[1])) as { cnf?: unknown }).cnf
  if (!bound) return presentation
  if (!holderKey) throw new AnswerRefused('This credential is bound to your wallet key, which is not unlocked.')
  return addKeyBinding(presentation, holderKey, { audience: proofAudience(requestId), nonce: crypto.randomUUID() })
}

export interface AnswerItem {
  requirement: number
  presentation: string
}

/** What an employer may be shown about one answer. Never a yes/no. */
export type CheckedAnswer =
  | {
      kind: 'checked'
      requirement: number
      checked: CheckedCredential
      /** Only the fields this requirement may see, in a stable order. */
      fields: Array<[string, unknown]>
    }
  | { kind: 'refused'; requirement: number; reason: string; unavailable: boolean; withdrawn: boolean }
  | { kind: 'not_asked'; requirement: number; reason: 'WRONG_TYPE' | 'OVER_DISCLOSED' | 'NO_SUCH_REQUIREMENT' }

/**
 * Check one answer against the request it answers. Trust and revocation state
 * arrive already opened; nothing here touches the network.
 */
export async function checkAnswer(
  request: Pick<ProofRequest, 'id' | 'requirements'>,
  item: AnswerItem,
  trust: TrustState,
  revocationsFor: (issuerDid: string) => RevocationState,
  now: number
): Promise<CheckedAnswer> {
  const r = request.requirements[item.requirement]
  if (!r) return { kind: 'not_asked', requirement: item.requirement, reason: 'NO_SUCH_REQUIREMENT' }

  // An answer carrying anything the request could not ask for is not shown at
  // all — not even the allowed part. The database refuses such a response, so
  // this only triggers if that check was bypassed.
  const allowed = allowedClaims(r)
  if (disclosedNames(item.presentation).some((n) => !allowed.includes(n))) {
    return { kind: 'not_asked', requirement: item.requirement, reason: 'OVER_DISCLOSED' }
  }

  const issuerDid = peekJwt(item.presentation).iss
  let checked: CheckedCredential
  try {
    checked = await checkCredential(
      item.presentation, issuerDid, trust, issuerDid ? revocationsFor(issuerDid) : { list: null, failure: null }, now,
      // A bound credential must be presented by its holder, to this request.
      { holderProof: { audience: proofAudience(request.id) } }
    )
  } catch (e) {
    if (e instanceof CredentialRefused) {
      return {
        kind: 'refused', requirement: item.requirement, reason: e.reason, unavailable: e.unavailable,
        withdrawn: e.reason === 'CREDENTIAL_REVOKED',
      }
    }
    throw e
  }
  // The type is the signed one, checked after the signature.
  if (checked.assertion.credentialType !== r.type) {
    return { kind: 'not_asked', requirement: item.requirement, reason: 'WRONG_TYPE' }
  }
  const fields = allowed
    .filter((k) => !['iss', 'iat', 'exp'].includes(k))
    .filter((k) => checked.assertion.claims[k] !== undefined && checked.assertion.claims[k] !== '')
    .map((k) => [k, checked.assertion.claims[k]] as [string, unknown])
  return { kind: 'checked', requirement: item.requirement, checked, fields }
}
