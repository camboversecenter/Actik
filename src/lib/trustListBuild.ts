// Build and sign a trust list from a snapshot of the registry. Used by the
// Root holder's offline script (scripts/build-trustlist.ts) and by the tests,
// so the tests exercise the same builder the ceremony uses.

import type { JWK } from 'jose'
import {
  isIssuerKind,
  keyId,
  publicOnly,
  signStatement,
  MAX_LIST_VALIDITY_SECONDS,
  TRUSTLIST_TYPE,
  type SignedDocument,
  type TrustListIssuer,
  type TrustListKey,
  type TrustListStatement,
} from './trustList'

/** One issuer as exported from the database (see supabase/queries/export_trustlist_input.sql). */
export interface IssuerSnapshot {
  did: string
  name: string
  domain?: string | null
  accredited: boolean
  /** 'employer' or 'identity_verifier' admits that tier; null or absent an institution. */
  kind?: string | null
  revoked_at?: string | null
  keys: Array<{
    public_jwk: JWK | string
    created_at: string
    retired_at?: string | null
    revoked_at?: string | null
  }>
}

const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

function asJwk(value: JWK | string): JWK {
  return typeof value === 'string' ? (JSON.parse(value) as JWK) : value
}

export async function buildTrustList(options: {
  snapshot: IssuerSnapshot[]
  previousVersion: number
  rootKey: CryptoKey
  rootKid: string
  now: number
  validitySeconds?: number
}): Promise<{ document: SignedDocument; statement: TrustListStatement }> {
  const validity = Math.min(options.validitySeconds ?? 30 * 24 * 60 * 60, MAX_LIST_VALIDITY_SECONDS)
  const expires = options.now + validity

  const issuers: TrustListIssuer[] = []
  for (const s of options.snapshot) {
    // Accreditation is decided here, by what goes on the list. An issuer the
    // admin dashboard approved but the Root has not yet listed is not trusted.
    if (!s.accredited || s.revoked_at) continue

    const keys: TrustListKey[] = []
    for (const k of s.keys) {
      const jwk = publicOnly(asJwk(k.public_jwk))
      const status = k.revoked_at ? 'revoked' : k.retired_at ? 'retired' : 'active'
      keys.push({
        kid: await keyId(jwk),
        jwk,
        status,
        notBefore: epoch(k.created_at),
        // An active key vouches up to the end of this list; the next list
        // extends it. A retired key vouches only up to its retirement.
        notAfter: k.retired_at ? epoch(k.retired_at) : k.revoked_at ? epoch(k.revoked_at) : expires,
      })
    }
    if (keys.length === 0) continue
    // The kind is decided here too, by what the Root signs — not by what an
    // issuer said about itself when it registered. A kind this build does not
    // recognise stops it, rather than admit anyone at the wider tier.
    const kind = s.kind ?? 'institution'
    if (!isIssuerKind(kind)) {
      throw new Error(`Issuer ${s.did} has unknown kind "${s.kind}"; nothing was signed.`)
    }
    issuers.push({ did: s.did, name: s.name, domain: s.domain ?? null, kind, keys })
  }

  const statement: TrustListStatement = {
    type: TRUSTLIST_TYPE,
    version: options.previousVersion + 1,
    issuedAt: options.now,
    expires,
    issuers,
  }
  const document = await signStatement(statement, options.rootKey, options.rootKid)
  return { document, statement }
}
