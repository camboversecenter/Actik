// Proof requests: reading and writing them, and checking answers as an
// employer. The rules live in proofRequest.ts and in the database
// (supabase/migrations/20261006_proof_requests.sql); this file only moves data.

import { boundToOneWallet } from './identity'
import { supabase } from './supabase'
import { loadRevocationState, loadTrustState } from './trustAnchor'
import type { RevocationState } from './credentialCheck'
import {
  checkAnswer,
  validateRequest,
  type AnswerItem,
  type CheckedAnswer,
  type ProofRequest,
  type ProofRequestDraft,
  type Requirement,
} from './proofRequest'

export interface OwnRequestSummary {
  id: string
  title: string
  requesterName: string
  createdAt: string
  expiresAt: string
  status: ProofRequest['status']
  responses: number
}

export interface MyAnswerSummary {
  id: string
  requestId: string
  title: string
  requesterName: string
  requestStatus: ProofRequest['status']
  items: number
  createdAt: string
}

export interface ResponseRow {
  id: string
  contact: string
  items: AnswerItem[]
  createdAt: string
}

export interface CheckedResponse {
  id: string
  contact: string
  createdAt: string
  answers: CheckedAnswer[]
  /**
   * Every checked credential in this answer was presented, with its holder's
   * proof, from one wallet key — and one of them is an identity attestation.
   */
  oneWalletWithIdentity: boolean
}

const statusOf = (closedAt: string | null, expiresAt: string): ProofRequest['status'] =>
  closedAt ? 'closed' : new Date(expiresAt).getTime() <= Date.now() ? 'expired' : 'open'

export async function createProofRequest(draft: ProofRequestDraft): Promise<string> {
  const d = validateRequest(draft)
  const { data, error } = await supabase
    .from('proof_requests')
    .insert({
      requester_name: d.requesterName,
      title: d.title,
      description: d.description,
      requirements: d.requirements,
      expires_at: new Date(Date.now() + d.expiresInDays * 86400 * 1000).toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'The request could not be saved.')
  return data.id as string
}

export async function listOwnRequests(): Promise<OwnRequestSummary[]> {
  const { data, error } = await supabase
    .from('proof_requests')
    .select('id, title, requester_name, created_at, expires_at, closed_at, proof_responses(count)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    requesterName: r.requester_name,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: statusOf(r.closed_at, r.expires_at),
    responses: r.proof_responses?.[0]?.count ?? 0,
  }))
}

/** Anyone with the link may read a request. null when there is no such request. */
export async function getProofRequest(id: string): Promise<ProofRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data, error } = await supabase.rpc('get_proof_request', { p_id: id })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  if (!r) return null
  return {
    id: r.id,
    requesterName: r.requester_name,
    title: r.title,
    description: r.description ?? '',
    requirements: (r.requirements ?? []) as Requirement[],
    expiresAt: r.expires_at,
    status: r.status,
  }
}

export async function closeProofRequest(id: string): Promise<void> {
  const { error } = await supabase.from('proof_requests').update({ closed_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listResponses(requestId: string): Promise<ResponseRow[]> {
  const { data, error } = await supabase
    .from('proof_responses')
    .select('id, contact, items, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({ id: r.id, contact: r.contact, items: r.items ?? [], createdAt: r.created_at }))
}

/**
 * Check every answer to a request the way a verifier would: against the signed
 * trust list and each institution's withdrawal list, on this device.
 */
export async function checkResponses(request: ProofRequest, rows: ResponseRow[]): Promise<CheckedResponse[]> {
  const trust = await loadTrustState()
  const revocations = new Map<string, RevocationState>()
  if (trust.list) {
    const issuers = new Set<string>()
    for (const row of rows) for (const item of row.items) {
      const iss = issuerOf(item.presentation)
      if (iss) issuers.add(iss)
    }
    await Promise.all([...issuers].map(async (did) => revocations.set(did, await loadRevocationState(did, trust.list!))))
  }
  const now = Math.floor(Date.now() / 1000)
  const revocationsFor = (did: string) => revocations.get(did) ?? { list: null, failure: null }
  return Promise.all(
    rows.map(async (row) => {
      const answers = await Promise.all(row.items.map((item) => checkAnswer(request, item, trust, revocationsFor, now)))
      const checked = answers.flatMap((a) => (a.kind === 'checked' ? [a.checked] : []))
      return {
        id: row.id,
        contact: row.contact,
        createdAt: row.createdAt,
        answers,
        oneWalletWithIdentity: (await boundToOneWallet(checked)).withIdentity,
      }
    })
  )
}

function issuerOf(presentation: string): string | null {
  try {
    const p = presentation.split('~')[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const iss = JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).iss
    return typeof iss === 'string' ? iss : null
  } catch {
    return null
  }
}

export async function submitAnswer(requestId: string, contact: string, items: AnswerItem[]): Promise<void> {
  const { error } = await supabase.from('proof_responses').insert({ request_id: requestId, contact: contact.trim(), items })
  if (error) {
    if (error.code === '23505') throw new Error('ALREADY_ANSWERED')
    throw new Error(error.message)
  }
}

export async function listMyAnswers(): Promise<MyAnswerSummary[]> {
  const { data, error } = await supabase.rpc('my_proof_responses')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    requestId: r.request_id,
    title: r.title,
    requesterName: r.requester_name,
    requestStatus: r.request_status,
    items: r.items_count,
    createdAt: r.created_at,
  }))
}

export async function withdrawAnswer(id: string): Promise<void> {
  const { error } = await supabase.from('proof_responses').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// After signing in, a candidate who opened a request link returns to it.
const RETURN_KEY = 'actik_return_to'

export function rememberReturnTo(path: string) {
  try {
    if (/^\/app\/answer\/[0-9a-f-]{36}$/i.test(path)) sessionStorage.setItem(RETURN_KEY, path)
  } catch {
    // storage unavailable: the candidate opens the link again after signing in
  }
}

export function takeReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return path && /^\/app\/answer\/[0-9a-f-]{36}$/i.test(path) ? path : null
  } catch {
    return null
  }
}
