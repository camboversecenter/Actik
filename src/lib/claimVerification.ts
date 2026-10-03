// The holder's claim gate: nothing enters the vault unless the issuer's key —
// as the Root-signed trust list has it — actually signed it, and the issuer
// has not withdrawn it.
//
// The database half of the same rule is the `issue pending` policy: only an
// accredited issuer may write a row under its own DID. This is the holder's
// half — their own app checks rather than taking the row's word for it.

import { checkCredential, type CheckedCredential } from './credentialCheck'
import { loadRevocationState, loadTrustState } from './trustAnchor'
import { checkPrintedCopy, type PrintedCopyResult } from './printedCredential'

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

/**
 * The printed copy that came with a credential, checked before the holder
 * keeps it: it must verify on its own (QRSeal Profile B against the same trust
 * list), come from the same issuer, and name the same document and holder as
 * the credential it arrived with. Returns the code, or null with the reason it
 * was dropped — a bad printed copy never blocks the credential itself.
 */
export async function verifyPrintedCopy(
  printed: string | null | undefined,
  credential: CheckedCredential
): Promise<PrintedCopyResult> {
  if (!printed) return { payload: null, reason: null }
  const trust = await loadTrustState()
  const issuerDid = credential.assertion.issuer
  const revocations = trust.list ? await loadRevocationState(issuerDid, trust.list) : { list: null, failure: null }
  return checkPrintedCopy(printed, credential, trust, revocations, Math.floor(Date.now() / 1000))
}
