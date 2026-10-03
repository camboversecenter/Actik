// The holder's claim gate: nothing enters the vault unless the issuer's key —
// as the Root-signed trust list has it — actually signed it, and the issuer
// has not withdrawn it.
//
// The database half of the same rule is the `issue pending` policy: only an
// accredited issuer may write a row under its own DID. This is the holder's
// half — their own app checks rather than taking the row's word for it.

import { checkCredential, type CheckedCredential } from './credentialCheck'
import { loadRevocationState, loadTrustState } from './trustAnchor'

export { ClaimRefused, CredentialRefused, signedOr } from './credentialCheck'

export async function verifyIssuedCredential(
  sdjwt: string | null | undefined,
  issuerDid: string | null | undefined
): Promise<CheckedCredential> {
  const trust = await loadTrustState()
  const revocations =
    trust.list && issuerDid
      ? await loadRevocationState(issuerDid, trust.list)
      : { list: null, failure: null }
  return checkCredential(sdjwt, issuerDid, trust, revocations, Math.floor(Date.now() / 1000))
}
