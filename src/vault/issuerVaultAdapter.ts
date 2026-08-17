// Supabase storage adapter for zk-vault-react, scoped to an issuer's signing
// key instead of the holder wallet.
//
// zk-vault is zero-knowledge: these columns only ever hold ciphertext / random
// strings. The encryption keys are derived in the browser from the issuer's
// PIN and never reach Supabase.
//
// The `issuers` table has two divergent column-naming layouts live in
// practice (see IssuerDashboard.tsx's handleRegenerateKeys) — `owner` is the
// one confirmed working, but we keep the same owner-then-user_id fallback
// used throughout the issuer pages for parity.

import { supabase } from '../lib/supabaseClient'
import type { IVaultStorageAdapter } from './zk-vault-contract'

function isMissingColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return !!(error.message?.includes('owner') || error.code === 'PGRST204' || error.code === '42703')
}

export const issuerVaultAdapter: IVaultStorageAdapter = {
  loadEnvelopes: async (userId: string) => {
    let { data, error } = await supabase
      .from('issuers')
      .select('vault_envelope_pin, vault_pin_salt, vault_envelope_passkey, passkey_id')
      .eq('owner', userId)
      .maybeSingle()

    if (isMissingColumnError(error)) {
      const fallback = await supabase
        .from('issuers')
        .select('vault_envelope_pin, vault_pin_salt, vault_envelope_passkey, passkey_id')
        .eq('user_id', userId)
        .maybeSingle()
      data = fallback.data
      error = fallback.error
    }

    if (!data) {
      return { pinEnvelope: null, pinSalt: null, passkeyEnvelope: null, passkeyId: null }
    }
    return {
      pinEnvelope: data.vault_envelope_pin,
      pinSalt: data.vault_pin_salt,
      passkeyEnvelope: data.vault_envelope_passkey,
      passkeyId: data.passkey_id,
    }
  },

  saveEnvelopes: async (userId: string, envelopes) => {
    const updates: Record<string, unknown> = {}
    if (envelopes.pinEnvelope !== undefined) updates.vault_envelope_pin = envelopes.pinEnvelope
    if (envelopes.pinSalt !== undefined) updates.vault_pin_salt = envelopes.pinSalt
    if (envelopes.passkeyEnvelope !== undefined) updates.vault_envelope_passkey = envelopes.passkeyEnvelope
    if (envelopes.passkeyId !== undefined) updates.passkey_id = envelopes.passkeyId

    // The issuer row must already exist (created at registration), so this is
    // always an update, never an upsert.
    let { error } = await supabase.from('issuers').update(updates).eq('owner', userId)

    if (isMissingColumnError(error)) {
      ;({ error } = await supabase.from('issuers').update(updates).eq('user_id', userId))
    }

    if (error) throw error
  },
}
