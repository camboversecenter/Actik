// Reissue: moving a person's credentials to their new wallet key.
//
// A wallet key is replaced when the PIN is forgotten and the wallet reset
// (the key is lost), when someone else has the wallet (compromised), or on
// purpose (replaced). Credentials bound to the old key can then no longer be
// presented by their holder, so the holder asks each issuer to reissue them to
// the new key. The issuer must be sure the request comes from the same person.
// Two ways to show it:
//
//   old_key   The old credential, presented with a proof from the old key,
//             naming this issuer and the new key. Only someone who could open
//             the old key could make it. Refused for a key retired as
//             compromised (the database refuses it too): whoever compromised
//             it could make the same proof.
//
//   identity  A fresh identity attestation from an identity verifier, bound to
//             the new key and presented with that key's proof, naming this
//             issuer and the new key. The name on it must match the name on
//             the credential. The old credential is attached when the holder
//             still has it; when the wallet was lost with it, the issuer finds
//             the credential in its own records instead.
//
// The issuer then reissues the same claims to the new key with its usual
// issuing code and withdraws the old credential as 'corrected', so a copy in
// the wrong hands stops verifying.
//
// Pure: no network, no storage. reissueApi.ts does the fetching.

import type { JWK } from 'jose'
import { ALWAYS_REVEALED } from './disclosure'
import { present, peekJwt, addKeyBinding, readDisclosures } from './sdjwt'
import { keyId, publicOnly } from './trustList'
import {
  checkCredential,
  CredentialRefused,
  type CheckedCredential,
  type RevocationState,
  type TrustState,
} from './credentialCheck'
import { IDENTITY_TYPE, sameName } from './identity'

export type ReissueProof = 'old_key' | 'identity'

/** What a continuity proof names as its audience: this issuer, and the key to reissue to. */
export function reissueAudience(issuerDid: string, newKid: string): string {
  return `actik:reissue:${issuerDid}:${newKid}`
}

export interface ReissueRequestDraft {
  issuer_did: string
  proof: ReissueProof
  credential: string | null
  identity: string | null
}

/**
 * The request a holder sends. `credential` is the old credential as held (all
 * its disclosures, so the issuer can reissue it as it was); `identity` an
 * identity attestation bound to the new key.
 */
export async function buildReissueRequest(options: {
  issuerDid: string
  newKid: string
  proof: ReissueProof
  /** The old credential, full, if the holder still has it. Required for old_key. */
  credential?: string | null
  /** The old key, opened. Required for old_key. */
  oldKey?: CryptoKey | null
  /** An identity attestation bound to the new key. Required for identity. */
  identity?: string | null
  /** The new key, opened. Required for identity. */
  newKey?: CryptoKey | null
}): Promise<ReissueRequestDraft> {
  const audience = reissueAudience(options.issuerDid, options.newKid)
  const nonce = crypto.randomUUID()
  if (options.credential && peekJwt(options.credential).iss !== options.issuerDid) {
    throw new Error('This credential was not issued by that issuer.')
  }
  // A full credential ends with '~'; strip any proof it might already carry.
  const full = options.credential ? options.credential.replace(/~[^~]*$/, '~') : null
  if (options.proof === 'old_key') {
    if (!full || !options.oldKey) throw new Error('Proving with the old key needs the credential and the old key.')
    return {
      issuer_did: options.issuerDid, proof: 'old_key', identity: null,
      credential: await addKeyBinding(full, options.oldKey, { audience, nonce }),
    }
  }
  if (!options.identity || !options.newKey) throw new Error('Proving with an identity check needs the check and your wallet key.')
  const shown = present(options.identity.replace(/~[^~]*$/, '~'), ALWAYS_REVEALED)
  return {
    issuer_did: options.issuerDid, proof: 'identity', credential: full,
    identity: await addKeyBinding(shown, options.newKey, { audience, nonce }),
  }
}

export interface ReissueRequestRow {
  id: string
  issuer_did: string
  recipient_email: string
  new_holder_jwk: JWK
  proof: ReissueProof
  credential: string | null
  identity: string | null
  created_at: string
}

export type ReissueCheck =
  | {
      kind: 'ready'
      proof: ReissueProof
      newHolderJwk: JWK
      newKid: string
      /** The credential to replace, checked as this issuer's own. */
      old: CheckedCredential
      /** What to sign again: every claim the old credential carried. */
      claims: Record<string, unknown>
      /** For proof = identity: who checked the person, and when. */
      identity: { name: string; verifier: string; verifiedOn: string } | null
    }
  | {
      /** Identity proven, but the holder no longer has the credential: find it in your records. */
      kind: 'needs_records'
      proof: 'identity'
      newHolderJwk: JWK
      newKid: string
      identity: { name: string; verifier: string; verifiedOn: string }
    }
  | { kind: 'refused'; reason: string; unavailable: boolean }

export function messageForReissueRefusal(reason: string): string {
  switch (reason) {
    case 'REISSUE_NOT_YOUR_CREDENTIAL':
      return 'This credential was not issued by you, so you cannot reissue it.'
    case 'REISSUE_NOT_BOUND':
      return 'This credential was never bound to a wallet key, so there is no old key to prove continuity with. Ask for an identity check instead.'
    case 'REISSUE_SAME_KEY':
      return 'The credential is already bound to this wallet key. There is nothing to reissue.'
    case 'REISSUE_OLD_KEY_PROOF':
      return 'The proof from the old wallet key does not check out for this request. Do not reissue.'
    case 'REISSUE_NO_IDENTITY':
      return 'The request carries no identity check.'
    case 'REISSUE_NOT_IDENTITY':
      return 'What was sent as an identity check is not one.'
    case 'REISSUE_IDENTITY_OTHER_KEY':
      return 'The identity check is bound to a different wallet key from the one to reissue to. Do not reissue.'
    case 'REISSUE_NAME_MISMATCH':
      return 'The name on the identity check does not match the name on the credential. Do not reissue unless you have resolved this with the person directly.'
    case 'CREDENTIAL_REVOKED':
      return 'You have already withdrawn this credential — perhaps it was reissued already.'
    default:
      return reason
  }
}

function refused(reason: string, unavailable = false): ReissueCheck {
  return { kind: 'refused', reason, unavailable }
}

/**
 * Check a reissue request as the issuer it is addressed to. Trust and
 * revocation state arrive already opened. Never reissues anything itself.
 */
export async function checkReissueRequest(
  row: ReissueRequestRow,
  ctx: {
    issuerDid: string
    trust: TrustState
    revocationsFor: (issuerDid: string) => RevocationState
    now: number
  }
): Promise<ReissueCheck> {
  const newHolderJwk = publicOnly(row.new_holder_jwk)
  const newKid = await keyId(newHolderJwk)
  const audience = reissueAudience(ctx.issuerDid, newKid)

  const check = async (sdjwt: string, iss: string | null, holderProof?: { audience: string }) => {
    try {
      return await checkCredential(sdjwt, iss, ctx.trust, iss ? ctx.revocationsFor(iss) : { list: null, failure: null }, ctx.now,
        holderProof ? { holderProof } : {})
    } catch (e) {
      if (e instanceof CredentialRefused) return e
      throw e
    }
  }

  // The old credential, when sent: it must be this issuer's own, and bound to
  // some other key than the one to reissue to.
  let old: CheckedCredential | null = null
  if (row.credential) {
    if (peekJwt(row.credential).iss !== ctx.issuerDid) return refused('REISSUE_NOT_YOUR_CREDENTIAL')
    const proving = row.proof === 'old_key'
    const r = await check(row.credential, ctx.issuerDid, proving ? { audience } : undefined)
    if (r instanceof CredentialRefused) {
      if (proving && r.reason.startsWith('HOLDER_PROOF_')) return refused('REISSUE_OLD_KEY_PROOF')
      return refused(r.reason, r.unavailable)
    }
    if (!r.assertion.holderKey) {
      if (proving) return refused('REISSUE_NOT_BOUND')
    } else if ((await keyId(publicOnly(r.assertion.holderKey))) === newKid) {
      return refused('REISSUE_SAME_KEY')
    }
    if (proving && r.holder.binding !== 'bound') return refused('REISSUE_OLD_KEY_PROOF')
    old = r
  }

  if (row.proof === 'old_key') {
    if (!old) return refused('REISSUE_OLD_KEY_PROOF')
    return { kind: 'ready', proof: 'old_key', newHolderJwk, newKid, old, claims: reissuableClaims(row.credential!), identity: null }
  }

  // proof = identity: an attestation from an identity verifier, bound to the
  // new key, proven by the new key for this issuer.
  if (!row.identity) return refused('REISSUE_NO_IDENTITY')
  const idIss = peekJwt(row.identity).iss
  const id = await check(row.identity, idIss, { audience })
  if (id instanceof CredentialRefused) return refused(id.reason, id.unavailable)
  if (id.assertion.credentialType !== IDENTITY_TYPE || id.holder.binding !== 'bound') return refused('REISSUE_NOT_IDENTITY')
  if ((await keyId(publicOnly(id.assertion.holderKey!))) !== newKid) return refused('REISSUE_IDENTITY_OTHER_KEY')
  const identity = {
    name: String(id.assertion.claims.name ?? ''),
    verifier: id.issuer.name,
    verifiedOn: String(id.assertion.claims.verified_on ?? ''),
  }
  if (!old) return { kind: 'needs_records', proof: 'identity', newHolderJwk, newKid, identity }
  if (!sameName(identity.name, old.assertion.claims.name)) return refused('REISSUE_NAME_MISMATCH')
  return { kind: 'ready', proof: 'identity', newHolderJwk, newKid, old, claims: reissuableClaims(row.credential!), identity }
}

/**
 * The claims to sign again: everything the old credential disclosed, except
 * the registered claims the new signature sets afresh.
 */
export function reissuableClaims(credential: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const d of readDisclosures(credential)) {
    if (['iss', 'iat', 'exp'].includes(d.name)) continue
    out[d.name] = d.value
  }
  return out
}
