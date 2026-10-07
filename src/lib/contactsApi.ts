// Verified contacts over Supabase: contacts sealed in the owner's wallet, and
// short-lived checks relayed by the database. The checking itself is pure and
// lives in contacts.ts.

import { supabase } from './supabase'
import type { Contact } from './contacts'

type Encrypt = (data: unknown) => Promise<{ cipher: string; iv: string }>
type Decrypt = (payload: { cipher: string; iv: string }) => Promise<unknown>

export interface StoredContact extends Contact {
  id: string
}

/** The owner's contacts, opened with their wallet key. Rows it cannot open are skipped. */
export async function loadContacts(decrypt: Decrypt): Promise<StoredContact[]> {
  const { data, error } = await supabase.from('wallet_contacts').select('id, cipher, iv').order('created_at')
  if (error) throw new Error('Your contacts could not be read.')
  const out: StoredContact[] = []
  for (const row of data ?? []) {
    try {
      out.push({ ...(await decrypt({ cipher: row.cipher, iv: row.iv }) as Contact), id: row.id })
    } catch {
      // Sealed by a wallet that has since been reset.
    }
  }
  return out
}

export async function saveContact(contact: Contact, encrypt: Encrypt): Promise<void> {
  const sealed = await encrypt(contact)
  const { error } = await supabase.from('wallet_contacts').insert({ cipher: sealed.cipher, iv: sealed.iv })
  if (error) throw new Error('The contact could not be saved.')
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from('wallet_contacts').delete().eq('id', id)
  if (error) throw new Error('The contact could not be removed.')
}

export interface CheckRow {
  id: string
  from_kid: string
  to_kid: string
  nonce: string
  created_at: string
  expires_at: string
  response: string | null
  declined: boolean
  responded_at: string | null
}

/** Ask the holder of `toKid` to confirm, right now. The database adds the nonce. */
export async function startCheck(toKid: string): Promise<CheckRow> {
  const { data, error } = await supabase.from('contact_checks').insert({ to_kid: toKid }).select('*').single()
  if (error) throw new Error(error.message || 'The check could not be sent.')
  return data as CheckRow
}

export async function readCheck(id: string): Promise<CheckRow | null> {
  const { data } = await supabase.from('contact_checks').select('*').eq('id', id).maybeSingle()
  return (data as CheckRow | null) ?? null
}

/**
 * Checks addressed to this wallet key, still open. Filtered by key, not just
 * by visibility: the asker can read their own outgoing checks too, and must
 * never be prompted by them.
 */
export async function incomingChecks(myKid: string): Promise<CheckRow[]> {
  const { data } = await supabase.from('contact_checks').select('*').eq('to_kid', myKid).is('response', null).eq('declined', false)
    .gt('expires_at', new Date().toISOString())
  return (data ?? []) as CheckRow[]
}

/** Answer with a signed presence proof, or decline (null). */
export async function answerCheck(id: string, response: string | null): Promise<void> {
  const { error } = await supabase.rpc('answer_contact_check', { p_id: id, p_response: response })
  if (error) throw new Error(error.message || 'The answer could not be sent.')
}

export async function forgetCheck(id: string): Promise<void> {
  await supabase.from('contact_checks').delete().eq('id', id)
}
