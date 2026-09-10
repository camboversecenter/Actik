// Supabase storage adapter for zk-vault-react, scoped to an issuer's signing
// key instead of the holder wallet.
//
// zk-vault is zero-knowledge: these columns only ever hold ciphertext / random
// strings. The encryption keys are derived in the browser from the issuer's
// PIN and never reach Supabase.
//
// The envelopes used to live on `issuers`, which is world-readable (it is the
// public registry), so an anonymous caller could fetch the envelope and its
// salt and crack the passcode offline. They now live in `issuer_secrets`,
// keyed by the owning user and readable by nobody else — no anon, no admin.
// See supabase/migrations/20260910_rls_hardening.sql.

import { supabase } from '../lib/supabaseClient'
import type { IVaultStorageAdapter } from './zk-vault-contract'

export const issuerVaultAdapter: IVaultStorageAdapter = {
  loadEnvelopes: async (userId: string) => {
    const { data, error } = await supabase
      .from('issuer_secrets')
      .select('vault_envelope_pin, vault_pin_salt, vault_envelope_passkey, passkey_id')
      .eq('owner', userId)
      .maybeSingle()

    if (error) throw error
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
    const updates: Record<string, unknown> = { owner: userId, updated_at: new Date().toISOString() }
    if (envelopes.pinEnvelope !== undefined) updates.vault_envelope_pin = envelopes.pinEnvelope
    if (envelopes.pinSalt !== undefined) updates.vault_pin_salt = envelopes.pinSalt
    if (envelopes.passkeyEnvelope !== undefined) updates.vault_envelope_passkey = envelopes.passkeyEnvelope
    if (envelopes.passkeyId !== undefined) updates.passkey_id = envelopes.passkeyId

    // Upsert: unlike the old `issuers` row, this row does not exist until the
    // issuer first sets up its signing vault.
    const { error } = await supabase.from('issuer_secrets').upsert(updates, { onConflict: 'owner' })
    if (error) throw error
  },
}
