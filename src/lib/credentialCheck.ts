// Is this credential genuinely from the issuer it names? Pure: it takes the
// registry record as an argument and performs no I/O, so it is testable
// without a database (see test-claim.ts). The lookup lives in
// claimVerification.ts.
//
// Why it exists: the wallet renders a credential from plain columns
// (`institution_name`, `degree_type`, `student_name`), and nothing used to
// check the signed token behind them. A row saying "RUPP — BSc in IT"
// therefore looked identical whether an accredited institution signed it or
// not, and a holder who claimed it carried it as genuine until some
// third-party verifier finally refused it.

import { verify, VerificationRejected, type CredentialAssertion } from './sdjwt'
import type { JWK } from 'jose'

/**
 * A claim that must not proceed. `reason` is the stable part — match on it,
 * log it; `message` is what a person reads and may be reworded or translated.
 */
export class ClaimRefused extends Error {
  readonly reason: string
  constructor(reason: string, message: string) {
    super(message)
    this.name = 'ClaimRefused'
    this.reason = reason
  }
}

/** What the registry lookup came back with. `failed` means we could not read it. */
export interface RegistryResult {
  row: Record<string, unknown> | null
  failed: boolean
}

/** The registry stores the key as jsonb in one code path and a JSON string in another. */
export function readPublicJwk(row: Record<string, unknown>): JWK | null {
  for (const candidate of [row.public_jwk, row.public_key]) {
    if (!candidate) continue
    let jwk: unknown = candidate
    if (typeof candidate === 'string') {
      try {
        jwk = JSON.parse(candidate)
      } catch {
        continue
      }
    }
    if (jwk && typeof jwk === 'object') {
      const typed = jwk as JWK
      return typed.alg ? typed : { ...typed, alg: 'ES256' }
    }
  }
  return null
}

export function messageForRefusal(reason: string): string {
  switch (reason) {
    case 'SIGNATURE_INVALID':
      // The common innocent cause is a key rotation: InstitutionSettings lets
      // an issuer replace its keypair, and the registry then holds a key that
      // never signed this credential. Either way the holder's move is the
      // same, and it is not to store this.
      return 'This credential was not signed by the key the institution has registered. ' +
        'If the institution has changed its signing key, ask it to issue the credential again.'
    case 'DISCLOSURE_NOT_SIGNED':
      return 'A field in this credential was not covered by the signature, so it cannot be trusted.'
    case 'CREDENTIAL_EXPIRED':
      return 'This credential has expired. Ask the institution for a current one.'
    case 'CREDENTIAL_NOT_YET_VALID':
      return 'This credential is dated in the future. Check the date on this device, then try again.'
    case 'ISSUER_KEY_MALFORMED':
      return "The registry's key for this institution is unusable, so this credential could not be checked."
    case 'NO_CREDENTIAL':
      return 'This entry carries no credential to claim.'
    case 'NO_ISSUER':
      return 'This entry names no issuer, so there is nothing to check it against.'
    case 'REGISTRY_UNAVAILABLE':
      return 'The trust registry could not be reached, so this credential was not checked. Please try again shortly.'
    case 'ISSUER_UNKNOWN':
      return 'The institution that issued this credential is not listed in the trust registry.'
    case 'ISSUER_MISMATCH':
      return 'This credential names a different issuer from the one it was sent under, so it cannot be trusted.'
    default:
      return 'This credential could not be read, so it cannot be trusted.'
  }
}

function refuse(reason: string): never {
  throw new ClaimRefused(reason, messageForRefusal(reason))
}

/**
 * Returns the assertion for a credential that genuinely came from the issuer
 * it names, or throws `ClaimRefused`.
 *
 * Accreditation standing is deliberately NOT checked. A credential signed
 * while an institution was accredited was legitimately issued, and refusing to
 * let the holder keep it because the institution's standing changed later
 * would strand real credentials. Standing is a question for whoever verifies a
 * share, and the verifier page asks it.
 */
export async function checkIssuedCredential(
  sdjwt: string | null | undefined,
  issuerDid: string | null | undefined,
  registry: RegistryResult
): Promise<CredentialAssertion> {
  if (!sdjwt) refuse('NO_CREDENTIAL')
  if (!issuerDid) refuse('NO_ISSUER')

  // A registry we cannot read is our problem, not the credential's: say so and
  // let the holder try again rather than refusing something never checked.
  if (registry.failed) refuse('REGISTRY_UNAVAILABLE')
  if (!registry.row) refuse('ISSUER_UNKNOWN')

  const publicJwk = readPublicJwk(registry.row)
  if (!publicJwk) refuse('ISSUER_KEY_MALFORMED')

  let assertion: CredentialAssertion
  try {
    assertion = await verify(sdjwt, publicJwk)
  } catch (e) {
    if (e instanceof VerificationRejected) {
      // The reason, never the payload.
      console.error('[claim] refused:', e.reason)
      refuse(e.reason)
    }
    throw e
  }

  // The signature verified against the key the registry holds for this DID. If
  // the token names a different issuer, the row and the credential disagree
  // about who made it, and the row is the half nobody signed.
  if (assertion.issuer !== issuerDid) refuse('ISSUER_MISMATCH')

  return assertion
}

/** A signed value if the credential carries one, else what the row claimed. */
export function signedOr(
  assertion: CredentialAssertion,
  claim: string,
  fallback: unknown
): unknown {
  const value = assertion.claims[claim]
  if (value === null || value === undefined || value === '') return fallback ?? null
  return value
}
