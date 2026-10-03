// Recording an issuer's keys in `issuer_keys`, the history the Root reads when
// it builds the signed trust list.
//
// A new key is a proposal until the next list is published: credentials it
// signs do not verify, and cannot be claimed, until the Root has listed it.
// The key it replaces is retired, not deleted — what it signed before today
// keeps verifying, which is the whole point of keeping the history.

import type { JWK } from 'jose'
import { supabase } from './supabase'
import { publicOnly } from './trustList'

async function issuerIdFor(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('issuers')
    .select('id')
    .or(`owner.eq.${userId},user_id.eq.${userId}`)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No institution is registered to this account.')
  return data.id as string
}

/**
 * Add `publicJwk` as this issuer's active key and retire every other active
 * one. The new key goes in first, so there is never a moment with no active
 * key on record.
 */
export async function recordNewIssuerKey(userId: string, publicJwk: JWK): Promise<void> {
  const issuerId = await issuerIdFor(userId)

  const { data: inserted, error: insertError } = await supabase
    .from('issuer_keys')
    .insert({ issuer_id: issuerId, public_jwk: publicOnly(publicJwk) })
    .select('id')
    .single()
  if (insertError) throw insertError

  // The server stamps retired_at itself (issuer_keys_guard); the value sent
  // only marks the column as being set.
  const { error: retireError } = await supabase
    .from('issuer_keys')
    .update({ retired_at: new Date().toISOString() })
    .eq('issuer_id', issuerId)
    .neq('id', inserted.id)
    .is('retired_at', null)
    .is('revoked_at', null)
  if (retireError) throw retireError
}
