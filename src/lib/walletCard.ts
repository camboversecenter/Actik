// What a wallet card shows — title, institution, major, dates — kept as a
// small encrypted blob beside the credential, not in plain columns.
//
// The database holds ciphertext (paper, "Roles": the holder's wallet is end-to-
// end encrypted). A card's details used to sit in plain columns so the list
// could draw without unlocking; now they are sealed with the same vault key as
// the credential, in `card_cipher`/`card_iv`. The blob is a few hundred bytes,
// so the list opens it instead of the whole credential (which carries the
// photo, ~0.7 MB). Only `credential_type` stays readable, so a locked wallet
// can still sort cards into categories.
//
// A row from before this change has no card. The first time the unlocked
// wallet lists it, the whole credential is opened once, a card is sealed from
// it and saved, and the row is not opened in full again for its card.

import { readDisclosures, peekJwt } from './sdjwt'

export interface WalletCard {
  title?: string
  institution_name?: string
  issuer_did?: string
  major?: string
  graduation_date?: string
  jti?: string
}

export type Sealed = { cipher: string; iv: string }
export type Encrypt = (data: unknown) => Promise<Sealed>
export type Decrypt = (payload: Sealed) => Promise<unknown>

/** The columns a wallet list selects to draw its cards. */
export const CARD_LIST_COLUMNS = 'id, owner, iv, created_at, credential_type, card_cipher, card_iv'

/** A card read from the signed credential itself — never from what a row says. */
export function cardFromSdJwt(sdjwt: string): WalletCard {
  const claims: Record<string, any> = {}
  readDisclosures(sdjwt).forEach((d) => { claims[d.name] = d.value })
  const { iss, jti } = peekJwt(sdjwt)
  const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v))
  return {
    title: str(claims.degree_type ?? claims.degree ?? claims.job_title ?? claims.cert_name ?? claims.program_name
      ?? claims.event_name ?? claims.achievement_title ?? claims.sub_type),
    institution_name: str(claims.institution),
    issuer_did: str(iss),
    major: str(claims.major),
    // The card's one date, whatever the type calls it.
    graduation_date: str(claims.graduation_date ?? claims.completion_date ?? claims.date_certified ?? claims.event_date
      ?? claims.date_awarded ?? claims.date ?? claims.employment_start ?? claims.verified_on ?? claims.issue_date),
    jti: str(jti),
  }
}

export async function sealCard(encrypt: Encrypt, card: WalletCard): Promise<{ card_cipher: string; card_iv: string }> {
  const sealed = await encrypt(card)
  return { card_cipher: sealed.cipher, card_iv: sealed.iv }
}
