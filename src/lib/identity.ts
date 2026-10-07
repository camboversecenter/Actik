// Identity attestations: a person, seen in person, by a Root-admitted
// identity verifier.
//
// An identity verifier is the third tier of the trust list, beside accredited
// institutions and registered employers. It checks an original national ID
// card or passport in front of the person it belongs to, compares the photo
// with the face, and signs one thing: the name exactly as the document gives
// it, bound to that person's wallet key.
//
// What an attestation never carries, by construction: the document number, a
// date of birth, a photo, a face template, a fingerprint, an address, notes or
// a scan. The issuing form has no place for them, IDENTITY_CLAIMS is the whole
// list, the database outbox guard decodes the signed token and refuses
// anything else, and every verifier refuses an attestation that discloses
// anything else. ACTIK holds no register of people; the attestation lives in
// the person's own wallet.
//
// It must be holder-bound (`cnf`). An attestation anyone could present would
// say "someone called Chan Sopheak exists", which is worthless; one that only
// the person's wallet can present says "the person sending this is the one who
// was checked". checkCredential refuses an unbound one (IDENTITY_NOT_BOUND).
//
// Pure: no network, no storage.

import { keyId, publicOnly } from './trustList'
import type { CheckedCredential } from './credentialCheck'

export const IDENTITY_TYPE = 'identity_attestation'
export const IDENTITY_VCT = `https://actik.kh/credentials/${IDENTITY_TYPE}`

/** Every claim an identity attestation may carry. Nothing else, ever. */
export const IDENTITY_CLAIMS = [
  'sub', 'iss', 'iat', 'exp',
  'name', 'institution', 'verification_level', 'evidence_type', 'verified_on',
] as const

export const VERIFICATION_LEVELS = ['in_person_document'] as const
export const EVIDENCE_TYPES = ['national_id_card', 'passport'] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

export class IdentityInvalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityInvalid'
  }
}

export interface IdentityInput {
  /** The person's account id (or email when they have none yet — but see holder binding). */
  sub: string
  /** Exactly as printed on the document. */
  name: string
  /** The identity verifier's own name. */
  verifierName: string
  evidenceType: string
  /** YYYY-MM-DD, the day the document was seen. */
  verifiedOn: string
  /** The verifier confirmed it saw the original, in person, and compared the photo. */
  sawOriginalInPerson: boolean
  /** The person's wallet key. Without it there is nothing to bind to, and nothing is issued. */
  holderPublicJwk: unknown
}

/**
 * The claims of an identity attestation, checked. Throws IdentityInvalid.
 * Takes no free text beyond the name: there is nowhere for an ID number, a
 * birth date or a note to go.
 */
export function identityClaims(input: IdentityInput, now: Date = new Date()): Record<string, string> {
  if (!input.holderPublicJwk || typeof input.holderPublicJwk !== 'object') {
    throw new IdentityInvalid('This person has no wallet key yet. Ask them to open their Actik wallet once, then try again.')
  }
  if (!input.sawOriginalInPerson) {
    throw new IdentityInvalid('Confirm that you have seen the original document in person and compared its photo.')
  }
  const name = input.name.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 200) throw new IdentityInvalid('Enter the name exactly as it is on the document.')
  if (!(EVIDENCE_TYPES as readonly string[]).includes(input.evidenceType)) {
    throw new IdentityInvalid('Choose the document you saw: a national ID card or a passport.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.verifiedOn) || Number.isNaN(Date.parse(input.verifiedOn))) {
    throw new IdentityInvalid('Enter the day you saw the document.')
  }
  if (input.verifiedOn > now.toISOString().slice(0, 10)) throw new IdentityInvalid('The check cannot be dated in the future.')
  if (!input.verifierName.trim()) throw new IdentityInvalid('The verifier has no name.')
  return {
    sub: input.sub,
    name,
    institution: input.verifierName.trim(),
    verification_level: 'in_person_document',
    evidence_type: input.evidenceType,
    verified_on: input.verifiedOn,
  }
}

/** Claims in an identity attestation that it may not carry (empty when clean). */
export function claimsOutsideIdentity(claimNames: Iterable<string>): string[] {
  const allowed = new Set<string>(IDENTITY_CLAIMS)
  return [...claimNames].filter((n) => !allowed.has(n))
}

/** How names are compared: Unicode-normalised, spaces collapsed, case ignored. Never fuzzy. */
export function sameName(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  return norm(a) !== '' && norm(a) === norm(b)
}

/**
 * For a reviewer looking at several credentials from one answer: are they all
 * bound to the same wallet key, and is one of them an identity attestation?
 * Then the degree and the identity check were presented by one wallet — the
 * one the identity verifier saw the person for.
 *
 * Only credentials that were presented with a valid holder proof count.
 */
export async function boundToOneWallet(checked: CheckedCredential[]): Promise<{
  sameWallet: boolean
  withIdentity: boolean
}> {
  if (checked.length < 2) return { sameWallet: false, withIdentity: false }
  const kids = new Set<string>()
  for (const c of checked) {
    if (c.holder.binding !== 'bound' || !c.assertion.holderKey) return { sameWallet: false, withIdentity: false }
    kids.add(await keyId(publicOnly(c.assertion.holderKey)))
  }
  const sameWallet = kids.size === 1
  return { sameWallet, withIdentity: sameWallet && checked.some((c) => c.assertion.credentialType === IDENTITY_TYPE) }
}
