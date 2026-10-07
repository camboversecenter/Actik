// Reissue requests over Supabase: the holder asks, the issuer checks and
// reissues. The checking itself is pure and lives in reissue.ts.

import { supabase } from './supabase'
import { issueSdJwt, peekJwt } from './sdjwt'
import { loadRevocationState, loadTrustState } from './trustAnchor'
import { publishWithdrawals } from './withdrawal'
import { getIssuerKey } from './issuerKeyStore'
import type { RevocationState } from './credentialCheck'
import {
  checkReissueRequest,
  type ReissueCheck,
  type ReissueRequestDraft,
  type ReissueRequestRow,
} from './reissue'

export interface OwnReissueRequest {
  id: string
  issuerDid: string
  proof: 'old_key' | 'identity'
  oldJti: string | null
  status: 'open' | 'reissued' | 'declined'
  createdAt: string
}

/** Send a request. The database fills in who is asking and their current key. */
export async function sendReissueRequest(draft: ReissueRequestDraft): Promise<void> {
  const { error } = await supabase.from('reissue_requests').insert(draft)
  if (error) {
    if (error.code === '23505') throw new Error('You have already asked this issuer to reissue this credential.')
    throw new Error(error.message || 'The request could not be sent.')
  }
}

export async function listOwnReissueRequests(): Promise<OwnReissueRequest[]> {
  const { data, error } = await supabase
    .from('reissue_requests')
    .select('id, issuer_did, proof, old_jti, status, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error('Your requests could not be read.')
  return (data ?? []).map((r: any) => ({
    id: r.id, issuerDid: r.issuer_did, proof: r.proof, oldJti: r.old_jti ?? null, status: r.status, createdAt: r.created_at,
  }))
}

export interface CheckedReissueRequest {
  row: ReissueRequestRow & { old_jti: string | null; status: string }
  check: ReissueCheck
}

/** The open requests addressed to this issuer, each checked. */
export async function loadReissueRequests(issuerDid: string): Promise<CheckedReissueRequest[]> {
  const { data, error } = await supabase
    .from('reissue_requests')
    .select('id, issuer_did, recipient_email, new_holder_jwk, proof, credential, identity, old_jti, status, created_at')
    .eq('issuer_did', issuerDid)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  if (error) throw new Error('Reissue requests could not be read.')
  const rows = (data ?? []) as Array<ReissueRequestRow & { old_jti: string | null; status: string }>
  const trust = await loadTrustState()
  const revocations = new Map<string, RevocationState>()
  const revocationsFor = (did: string) => revocations.get(did) ?? { list: null, failure: null }
  if (trust.list) {
    const dids = new Set<string>([issuerDid])
    for (const r of rows) {
      const iss = r.identity ? peekJwt(r.identity).iss : null
      if (iss) dids.add(iss)
    }
    await Promise.all([...dids].map(async (d) => revocations.set(d, await loadRevocationState(d, trust.list!))))
  }
  const now = Math.floor(Date.now() / 1000)
  return Promise.all(rows.map(async (row) => ({
    row,
    check: await checkReissueRequest(row, { issuerDid, trust, revocationsFor, now }),
  })))
}

export async function declineReissueRequest(id: string): Promise<void> {
  const { error } = await supabase.from('reissue_requests').update({ status: 'declined' }).eq('id', id)
  if (error) throw new Error('The request could not be updated.')
}

/**
 * Withdraw the replaced credential as 'corrected' and close the request. Used
 * after a reissue from a checked request, and after one issued again from the
 * issuer's own records (IssueCredential, `?reissue=`).
 */
export async function completeReissue(issuerDid: string, requestId: string, oldJti: string | null): Promise<void> {
  if (oldJti) {
    await publishWithdrawals(issuerDid, [{ jti: oldJti, reason: 'corrected', revokedAt: Math.floor(Date.now() / 1000) }])
  }
  const { error } = await supabase.from('reissue_requests').update({ status: 'reissued' }).eq('id', requestId)
  if (error) throw new Error('The credential was reissued, but the request could not be closed.')
}

const DISPLAY_COLUMNS = new Set(['sub', 'name', 'institution', 'photo', 'student_id', 'degree_type', 'major', 'graduation_date', 'certificate_id'])

/**
 * Reissue a checked request: the same claims, signed again, bound to the new
 * key, into the holder's inbox; then the old one withdrawn as 'corrected'.
 */
export async function reissueFromRequest(
  issuer: { did: string; name: string },
  req: CheckedReissueRequest
): Promise<void> {
  if (req.check.kind !== 'ready') throw new Error('This request is not ready to reissue.')
  const held = getIssuerKey()
  if (!held || held.did !== issuer.did) throw new Error('Unlock your signing key first.')
  const { check, row } = req
  const type = check.old.assertion.credentialType ?? 'academic_degree'
  const jti = crypto.randomUUID()
  const sdjwt = await issueSdJwt({
    issuerDid: issuer.did, signingKey: held.key, kid: held.kid, jti,
    holderPublicJwk: check.newHolderJwk, subject: check.claims,
    vct: `https://actik.kh/credentials/${type}`, expiresInSec: 365 * 24 * 60 * 60 * 5,
  })
  const c = check.claims as Record<string, any>
  const row_: Record<string, unknown> = {
    recipient_email: row.recipient_email,
    sdjwt,
    issuer_did: issuer.did,
    institution_name: issuer.name,
    credential_type: type,
    credential_jti: jti,
    replaces_jti: check.old.assertion.jti,
    label: c.degree_type || c.job_title || c.cert_name || c.sub_type || (type === 'identity_attestation' ? 'Identity check' : 'Certificate'),
  }
  if (type === 'academic_degree') {
    Object.assign(row_, {
      degree_type: c.degree_type ?? null, student_id: c.student_id ?? null, major: c.major ?? null,
      graduation_date: c.graduation_date ?? null, certificate_id: c.certificate_id ?? null,
    })
  } else {
    row_.type_metadata = Object.fromEntries(Object.entries(c).filter(([k]) => !DISPLAY_COLUMNS.has(k)))
  }
  const { error } = await supabase.from('pending_credentials').insert(row_)
  if (error) throw new Error(error.message || 'The credential could not be reissued.')
  await completeReissue(issuer.did, row.id, check.old.assertion.jti)
}
