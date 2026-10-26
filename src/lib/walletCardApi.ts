// Opening and saving wallet cards (see walletCard.ts for what a card is).

import { supabase } from './supabase'
import { cardFromSdJwt, sealCard, type WalletCard, type Encrypt, type Decrypt } from './walletCard'

/**
 * Open the cards of the rows given (unlocked wallet only). Rows without a card
 * are opened in full once, and a card is sealed and saved for them. A row this
 * wallet cannot open (sealed by a wallet since reset) is left out.
 */
export async function openCards(
  rows: { id: string; card_cipher?: string | null; card_iv?: string | null }[],
  encrypt: Encrypt,
  decrypt: Decrypt,
): Promise<Record<string, WalletCard>> {
  const out: Record<string, WalletCard> = {}
  const missing: string[] = []
  for (const r of rows) {
    if (!r.card_cipher || !r.card_iv) { missing.push(r.id); continue }
    try {
      out[r.id] = await decrypt({ cipher: r.card_cipher, iv: r.card_iv }) as WalletCard
    } catch {
      // not openable with this wallet's key
    }
  }
  if (missing.length === 0) return out

  const { data: full } = await supabase.from('credentials').select('id, cipher, iv').in('id', missing)
  for (const r of full ?? []) {
    try {
      const opened = await decrypt({ cipher: r.cipher, iv: r.iv }) as { sdjwt?: string }
      if (!opened.sdjwt) continue
      const card = cardFromSdJwt(opened.sdjwt)
      out[r.id] = card
      // Best-effort: if it fails, the card is built again next time.
      await supabase.from('credentials').update(await sealCard(encrypt, card)).eq('id', r.id)
    } catch {
      // not openable with this wallet's key
    }
  }
  return out
}
