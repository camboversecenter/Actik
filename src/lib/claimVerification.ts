// The registry lookup behind credentialCheck.ts. Kept apart from the decision
// logic so that logic can be tested without a database.

import { supabase } from './supabase'
import { checkIssuedCredential, type RegistryResult } from './credentialCheck'
import type { CredentialAssertion } from './sdjwt'

export { ClaimRefused, signedOr } from './credentialCheck'

/**
 * Verify a credential against the issuer's registry record before anything
 * trusts it or stores it. Returns the assertion, or throws `ClaimRefused`.
 *
 * The database half of the same rule is the `issue pending` policy: only an
 * accredited issuer may write a row under its own DID
 * (supabase/migrations/20261003_pending_credentials_issuer_only.sql). This is
 * the holder's half — their own app checks the signature rather than taking
 * the row's word for it.
 */
export async function verifyIssuedCredential(
  sdjwt: string | null | undefined,
  issuerDid: string | null | undefined
): Promise<CredentialAssertion> {
  let registry: RegistryResult = { row: null, failed: false }

  if (sdjwt && issuerDid) {
    // select('*') rather than named columns: this project's `issuers` table
    // carries the key as `public_jwk` on one code path and `public_key` on the
    // other, and naming a column absent from either shape 400s the query.
    const { data, error } = await supabase
      .from('issuers')
      .select('*')
      .eq('did', issuerDid)
      .maybeSingle()

    registry = {
      row: (data as Record<string, unknown> | null) ?? null,
      failed: !!error,
    }
  }

  return checkIssuedCredential(sdjwt, issuerDid, registry)
}
