// Is this credential genuinely from the issuer it names, and does that issuer
// still stand behind it? Shared by the holder's claim gate and the verifier
// page, so the two can never disagree about what counts.
//
// Pure: the trust list and the issuer's revocation list arrive as arguments,
// already fetched and opened (trustAnchor.ts does that). Testable without a
// network or a database — see test-claim.ts.
//
// The order matters and follows QRSeal SPEC §2.8 in spirit:
//   1. our own trust state      — no signed list, no verdict
//   2. the issuer and its key   — listed, not revoked, valid when it signed
//   3. the signature            — against that key, and only that key
//   4. the issuer binding       — the token names the issuer it was sent under
//   5. the issuer's withdrawals — clear, unchecked, or revoked

import { verify, peekJwt, checkKeyBinding, VerificationRejected, type CredentialAssertion } from './sdjwt'
import {
  candidateKeys,
  TrustRejected,
  TRUST_STATE_REASONS,
  type OpenedTrustList,
  type TrustListIssuer,
  type TrustListKey,
  issuerMayIssue,
} from './trustList'
import { credentialStatus, type CredentialStatus, type OpenedRevocations, type WithdrawalReason } from './revocation'

/**
 * A credential that must not be accepted. `reason` is the stable part — match
 * on it, log it. `message` is what a person reads. `unavailable` is true when
 * the reason is our own trust state rather than anything about the credential:
 * an interface must then say "could not check", never "this is not genuine".
 */
export class CredentialRefused extends Error {
  readonly reason: string
  readonly unavailable: boolean
  constructor(reason: string, message: string) {
    super(message)
    this.name = 'CredentialRefused'
    this.reason = reason
    this.unavailable = isTrustStateReason(reason)
  }
}

/** Kept so existing callers read naturally; it is the same class. */
export const ClaimRefused = CredentialRefused

export function isTrustStateReason(reason: string): boolean {
  return TRUST_STATE_REASONS.has(reason) || reason.startsWith('REVOCATIONS_')
}

export interface TrustState {
  list: OpenedTrustList | null
  /** Why `list` is null, when it is. */
  failure: string | null
}

export interface RevocationState {
  /** null with no failure means the issuer publishes no list. */
  list: OpenedRevocations | null
  failure: string | null
}

export interface CheckedCredential {
  assertion: CredentialAssertion
  issuer: TrustListIssuer
  key: TrustListKey
  /** clear or unchecked. A revoked credential never gets this far — it is refused. */
  standing: Exclude<CredentialStatus, { status: 'revoked' }>
  trustListVersion: number
  /**
   * Whether the presenter proved they hold the wallet this was issued to.
   *   bound      — the issuer bound it to a holder key, and this presentation
   *                carries a key-binding proof for this audience
   *   unbound    — issued without a holder key (before binding existed, or to
   *                someone with no wallet yet): only an ID check ties it to a person
   *   not_asked  — bound, but this check was not about presenting it (claiming,
   *                exporting from one's own wallet)
   */
  holder: { binding: 'bound'; audience: string } | { binding: 'unbound' } | { binding: 'not_asked' }
}

export function messageForRefusal(reason: string): string {
  if (isTrustStateReason(reason)) {
    return 'The signed trust registry could not be checked right now, so this credential was not checked. ' +
      'Nothing is known to be wrong with it. Please try again shortly.'
  }
  switch (reason) {
    case 'ISSUER_NOT_LISTED':
      return 'The institution that issued this is not on the signed trust registry. ' +
        'If it was approved only recently, it appears once the registry is next published.'
    case 'KEY_UNKNOWN':
      return 'This was signed with a key the trust registry does not list for this institution. ' +
        'If the institution changed its signing key recently, this resolves once the registry is next published.'
    case 'KEY_REVOKED':
      return "The institution's signing key has been revoked, so nothing it signed can be trusted. " +
        'Ask the institution to issue this again.'
    case 'KEY_NOT_VALID_AT_ISSUANCE':
      return 'This is dated outside the period the institution’s key was valid for, so it cannot be trusted.'
    case 'SIGNATURE_INVALID':
      return 'This was not signed by any key the institution has registered. It did not verify.'
    case 'DISCLOSURE_NOT_SIGNED':
      return 'A field in this was not covered by the signature, so it cannot be trusted.'
    case 'CREDENTIAL_EXPIRED':
      return 'This credential has expired. Ask the institution for a current one.'
    case 'CREDENTIAL_NOT_YET_VALID':
      return 'This credential is dated in the future. Check the date on this device, then try again.'
    case 'CREDENTIAL_REVOKED':
      return 'The institution has withdrawn this credential. That was its decision, not a fault in the code.'
    case 'UNKNOWN_KID':
      return 'This was signed with a key the trust registry does not list. It did not verify.'
    case 'ISSUER_KEY_MISMATCH':
      return 'The key that signed this belongs to a different institution from the one it names. It did not verify.'
    case 'URL_PAYLOAD_REJECTED':
      return 'This code opens a website. Actik certificates never do — this is not one of them. ' +
        'Do not open it, and do not enter any details on a site it leads to.'
    case 'PREFIX_INVALID':
      return 'This is not an Actik printed certificate code.'
    case 'HOLDER_PROOF_MISSING':
      return 'This credential is bound to its holder’s wallet, but it was presented without proof from that wallet. Whoever sent it may not be the person it was issued to.'
    case 'HOLDER_PROOF_INVALID':
      return 'The proof that this came from its holder’s wallet does not check out. Whoever sent it may not be the person it was issued to.'
    case 'HOLDER_PROOF_WRONG_AUDIENCE':
      return 'This was presented to someone else, and has been copied here. Ask the holder to send it to you directly.'
    case 'TYPE_NOT_ALLOWED_FOR_ISSUER':
      return 'This issuer is registered as an employer, which may issue employment records only — not this kind of credential. It did not verify.'
    case 'ISSUER_MISMATCH':
      return 'This names a different issuer from the one it was sent under, so it cannot be trusted.'
    case 'NO_CREDENTIAL':
      return 'There is no credential here to check.'
    case 'NO_ISSUER':
      return 'This names no issuer, so there is nothing to check it against.'
    default:
      return 'This could not be read as a credential. It did not verify.'
  }
}

function refuse(reason: string): never {
  throw new CredentialRefused(reason, messageForRefusal(reason))
}

/** Revocation details travel on the refusal so an interface can show them. */
export class CredentialWithdrawn extends CredentialRefused {
  readonly withdrawalReason: WithdrawalReason
  readonly revokedAt: number
  constructor(withdrawalReason: WithdrawalReason, revokedAt: number) {
    super('CREDENTIAL_REVOKED', messageForRefusal('CREDENTIAL_REVOKED'))
    this.name = 'CredentialWithdrawn'
    this.withdrawalReason = withdrawalReason
    this.revokedAt = revokedAt
  }
}

export async function checkCredential(
  sdjwt: string | null | undefined,
  issuerDid: string | null | undefined,
  trust: TrustState,
  revocations: RevocationState,
  now: number,
  options: { holderProof?: { audience: string } } = {}
): Promise<CheckedCredential> {
  if (!sdjwt) refuse('NO_CREDENTIAL')
  if (!issuerDid) refuse('NO_ISSUER')

  // 1. No signed list, no verdict — and no falling back on the database.
  if (!trust.list) refuse(trust.failure ?? 'TRUSTLIST_MISSING')
  const list = trust.list

  // 2. Which listed keys could have signed this? The header kid and iat are
  //    read unverified here, only to choose; step 3 verifies, and the window
  //    is re-checked below against the verified iat.
  const peek = peekJwt(sdjwt)
  let candidates: TrustListKey[]
  try {
    candidates = candidateKeys(list, issuerDid, { kid: peek.kid, iat: peek.iat })
  } catch (e) {
    if (e instanceof TrustRejected) refuse(e.reason)
    throw e
  }

  // 3. The signature, against a trusted key.
  let assertion: CredentialAssertion | null = null
  let key: TrustListKey | null = null
  for (const candidate of candidates) {
    try {
      assertion = await verify(sdjwt, candidate.jwk)
      key = candidate
      break
    } catch (e) {
      if (!(e instanceof VerificationRejected)) throw e
      // A wrong key reads as a bad signature: try the next candidate. Any
      // other reason (expired, malformed) is about the credential itself.
      if (e.reason !== 'SIGNATURE_INVALID') refuse(e.reason)
    }
  }
  if (!assertion || !key) refuse('SIGNATURE_INVALID')

  // 4. The token names the issuer it arrived under.
  if (assertion.issuer !== issuerDid) refuse('ISSUER_MISMATCH')

  //    And the issuer is the kind that may issue this. A registered employer
  //    signs employment records, never degrees: its key on the trust list
  //    does not make it a university.
  if (!issuerMayIssue(list.issuers.get(issuerDid)?.kind, assertion.credentialType)) refuse('TYPE_NOT_ALLOWED_FOR_ISSUER')

  //    The key was valid when this was signed — on the *verified* iat. A
  //    retired key only vouches for what it signed before it was retired.
  if (assertion.issuedAt === null && key.status === 'retired') refuse('KEY_NOT_VALID_AT_ISSUANCE')
  if (assertion.issuedAt !== null) {
    try {
      candidateKeys(list, issuerDid, { kid: key.kid, iat: assertion.issuedAt })
    } catch (e) {
      if (e instanceof TrustRejected) refuse(e.reason)
      throw e
    }
  }

  // 5. Has the issuer withdrawn it?
  if (revocations.failure) refuse(revocations.failure)
  const standing = await credentialStatus(assertion, revocations.list, now)
  if (standing.status === 'revoked') throw new CredentialWithdrawn(standing.reason, standing.revokedAt)

  // 6. Is it being presented by the holder it was issued to?
  let holder: CheckedCredential['holder'] = { binding: 'unbound' }
  if (assertion.holderKey) {
    if (!options.holderProof) {
      holder = { binding: 'not_asked' }
    } else {
      const problem = await checkKeyBinding(sdjwt, assertion.holderKey, options.holderProof.audience, now)
      if (problem) refuse(problem)
      holder = { binding: 'bound', audience: options.holderProof.audience }
    }
  }

  return {
    assertion,
    issuer: list.issuers.get(issuerDid)!,
    key,
    standing,
    trustListVersion: list.version,
    holder,
  }
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
