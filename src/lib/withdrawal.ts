// The issuer's side of withdrawal: reading what it has issued, reading its own
// published withdrawal list, and signing and publishing the next one.
//
// The previous list is never taken on trust, even though it is the issuer's
// own: it is opened against the Root-signed trust list exactly as a verifier
// would open it. Otherwise anyone able to edit the `revocation_lists` row
// could plant a list with a withdrawal missing, and the issuer's next
// signature would quietly make that removal real.

import { supabase } from './supabase'
import { loadTrustState } from './trustAnchor'
import {
  buildRevocationList,
  credentialStatus,
  openRevocationList,
  RevocationRejected,
  type OpenedRevocations,
  type RevocationEntry,
} from './revocation'
import { keyAcceptedAt, TrustRejected, type SignedDocument } from './trustList'
import { getIssuerKey } from './issuerKeyStore'

export class WithdrawalBlocked extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WithdrawalBlocked'
  }
}

export interface IssuerContext {
  did: string
  name: string
  accredited: boolean
}

export async function loadIssuerContext(userId: string): Promise<IssuerContext | null> {
  const { data } = await supabase
    .from('issuers')
    .select('*')
    .or(`owner.eq.${userId},user_id.eq.${userId}`)
    .limit(1)
    .maybeSingle()
  if (!data?.did) return null
  return { did: data.did, name: data.name, accredited: !!data.accredited }
}

/**
 * This issuer's published list, opened and checked like a verifier would.
 * null when it has never published one. Throws WithdrawalBlocked when it
 * cannot be checked — never returns an unchecked list to build on.
 */
export async function loadOwnRevocations(did: string): Promise<OpenedRevocations | null> {
  const trust = await loadTrustState()
  if (!trust.list) {
    throw new WithdrawalBlocked(
      'The signed trust registry is not available right now, so your withdrawal list cannot be checked. Try again shortly.'
    )
  }
  const { data, error } = await supabase
    .from('revocation_lists')
    .select('document')
    .eq('issuer_did', did)
    .maybeSingle()
  if (error) throw new WithdrawalBlocked('Your withdrawal list could not be read. Try again shortly.')
  if (!data?.document) return null
  try {
    return await openRevocationList(data.document as SignedDocument, { list: trust.list, issuerDid: did })
  } catch (e) {
    if (e instanceof RevocationRejected) {
      throw new WithdrawalBlocked(
        `The withdrawal list published under your name does not check out (${e.reason}). ` +
          'Do not publish over it — contact the registry operator, because someone other than you may have written it.'
      )
    }
    throw e
  }
}

/**
 * Sign and publish the next version of this issuer's list, with `add`
 * appended. With nothing to add it simply renews the list — which must happen
 * at least every 30 days, or verifiers report standing as unchecked.
 */
export async function publishWithdrawals(did: string, add: RevocationEntry[]): Promise<OpenedRevocations> {
  const held = getIssuerKey()
  if (!held || held.did !== did) {
    throw new WithdrawalBlocked('Unlock your signing key first: the list is signed with it.')
  }

  const trust = await loadTrustState({ force: true })
  if (!trust.list) {
    throw new WithdrawalBlocked('The signed trust registry is not available right now. Try again shortly.')
  }
  const now = Math.floor(Date.now() / 1000)
  // A list signed with a key the registry does not (yet) list for you would be
  // refused by every verifier. Say so now rather than publish something inert.
  try {
    keyAcceptedAt(trust.list, did, held.kid, now)
  } catch (e) {
    if (e instanceof TrustRejected) {
      throw new WithdrawalBlocked(
        'Your current signing key is not on the published trust registry yet (it changes when the registry is next ' +
          'published after a key change). A list signed with it would not be accepted, so nothing was published.'
      )
    }
    throw e
  }

  const previous = await loadOwnRevocations(did)
  const document = await buildRevocationList({
    issuerDid: did,
    previous,
    add,
    signingKey: held.key,
    kid: held.kid,
    now,
  })

  const { error } = await supabase
    .from('revocation_lists')
    .upsert({ issuer_did: did, document, version: 0 }, { onConflict: 'issuer_did' })
  if (error) throw new WithdrawalBlocked(`Publishing failed: ${error.message}`)

  return openRevocationList(document, { list: trust.list, issuerDid: did })
}

export interface IssuedRecord {
  id: string
  jti: string | null
  documentId: string | null
  title: string
  date: string
  credential_type: string
  email: string | null
  withdrawn: { reason: string; revokedAt: number } | null
}

/**
 * What this issuer has issued, from the log the database writes as each
 * credential goes out (issued_credentials), with withdrawals marked from its
 * own published list. If the list cannot be checked, nothing is marked —
 * rather than marked from a list that may not be genuine.
 */
export async function loadIssuedRecords(userId: string): Promise<{
  issuer: IssuerContext | null
  records: IssuedRecord[]
  revocations: OpenedRevocations | null
  revocationsError: string | null
}> {
  const issuer = await loadIssuerContext(userId)
  if (!issuer) return { issuer: null, records: [], revocations: null, revocationsError: null }

  const { data } = await supabase
    .from('issued_credentials')
    .select('*')
    .eq('issuer_did', issuer.did)
    .order('issued_at', { ascending: false })

  let revocations: OpenedRevocations | null = null
  let revocationsError: string | null = null
  try {
    revocations = await loadOwnRevocations(issuer.did)
  } catch (e) {
    revocationsError = e instanceof Error ? e.message : String(e)
  }

  const now = Math.floor(Date.now() / 1000)
  const records: IssuedRecord[] = (data ?? []).map((r: any) => {
    // credentialStatus wants an assertion; the log carries the two things a
    // withdrawal entry can name.
    const pseudo = {
      jti: r.jti ?? null,
      claims: r.document_id ? { certificate_id: r.document_id, license_number: r.document_id } : {},
    } as unknown as Parameters<typeof credentialStatus>[0]
    const st = revocations ? credentialStatus(pseudo, revocations, now) : null
    return {
      id: r.id,
      jti: r.jti ?? null,
      documentId: r.document_id ?? null,
      title: r.label || 'Issued credential',
      date: r.issued_at,
      credential_type: r.credential_type || 'academic_degree',
      email: r.recipient_email ?? null,
      withdrawn: st && st.status === 'revoked' ? { reason: st.reason, revokedAt: st.revokedAt } : null,
    }
  })

  return { issuer, records, revocations, revocationsError }
}
