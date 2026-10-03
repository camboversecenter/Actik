// Fetching, persisting and opening the trust state: the Root-signed trust
// list and the issuers' revocation lists. The decisions live in trustList.ts,
// revocation.ts and credentialCheck.ts; this file only moves documents around.
//
// Three rules, from QRSeal's verifier guidance:
//   - the Root key is pinned in the build (VITE_TRUST_ROOT_KEYS) and is never
//     fetched, so the server can serve lists but cannot vouch for them;
//   - a list that fails to open means "cannot verify right now" — we never
//     fall back on the database, or on an older list;
//   - remember the highest version seen, so a server (or anyone between us
//     and it) cannot quietly hand this browser an older list.
//
// A verifier visiting for the first time has nothing remembered, and will
// accept any genuine, unexpired list — up to 31 days old. Closing that gap
// needs QRSeal's separate timestamp role (§4.3); it is not built here.

import type { JWK } from 'jose'
import { supabase } from './supabase'
import { openTrustList, TrustRejected, type HeldVersion, type SignedDocument } from './trustList'
import { openRevocationList, RevocationRejected } from './revocation'
import type { OpenedTrustList } from './trustList'
import type { RevocationState, TrustState } from './credentialCheck'

/** A held list newer than this is used without re-fetching. */
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode, quota, or blocked storage: we simply remember less */
  }
}

/** The Root public keys this build trusts. Empty means no Root was configured. */
export function pinnedRoots(): JWK[] {
  const raw = import.meta.env.VITE_TRUST_ROOT_KEYS as string | undefined
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as JWK[]) : [parsed as JWK]
  } catch {
    return []
  }
}

const now = () => Math.floor(Date.now() / 1000)

const TRUST_HELD = 'actik:trustlist:held'
const TRUST_DOC = 'actik:trustlist:doc'

let trustPromise: Promise<TrustState> | null = null

export function loadTrustState(options: { force?: boolean } = {}): Promise<TrustState> {
  if (!trustPromise || options.force) {
    const attempt = openTrustState(!!options.force)
    trustPromise = attempt
    // Remember a list that opened; never remember a failure, or one network
    // blip would leave the page unable to verify until it is reloaded.
    attempt.then(
      (state) => {
        if (!state.list && trustPromise === attempt) trustPromise = null
      },
      () => {
        if (trustPromise === attempt) trustPromise = null
      }
    )
  }
  return trustPromise
}

async function openTrustState(force: boolean): Promise<TrustState> {
  const held = readJson<HeldVersion>(TRUST_HELD)
  const cached = readJson<{ document: SignedDocument; fetchedAt: number }>(TRUST_DOC)

  let doc: SignedDocument | null = null
  let fetched = false
  if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_AFTER_MS) {
    doc = cached.document
  } else {
    const { data, error } = await supabase
      .from('trust_documents')
      .select('document')
      .eq('kind', 'trustlist')
      .maybeSingle()
    if (!error && data?.document) {
      doc = data.document as SignedDocument
      fetched = true
    } else {
      // Offline or the server is unreachable: a list we already hold is still
      // signed, and openTrustList still enforces its expiry.
      doc = cached?.document ?? null
    }
  }

  try {
    const list = await openTrustList(doc, { roots: pinnedRoots(), now: now(), held })
    if (fetched) writeJson(TRUST_DOC, { document: doc, fetchedAt: Date.now() })
    if (!held || list.version >= held.version) {
      writeJson(TRUST_HELD, { version: list.version, digest: list.digest })
    }
    return { list, failure: null }
  } catch (e) {
    if (e instanceof TrustRejected) {
      console.error('[trust] list not usable:', e.reason)
      return { list: null, failure: e.reason }
    }
    throw e
  }
}

const revocationHeldKey = (did: string) => `actik:revocations:${did}:held`

export async function loadRevocationState(
  issuerDid: string,
  list: OpenedTrustList
): Promise<RevocationState> {
  const held = readJson<HeldVersion>(revocationHeldKey(issuerDid))

  const { data, error } = await supabase
    .from('revocation_lists')
    .select('document')
    .eq('issuer_did', issuerDid)
    .maybeSingle()

  if (error) return { list: null, failure: 'REVOCATIONS_UNAVAILABLE' }
  if (!data?.document) {
    // Never published is "unchecked". But a list this browser has already seen
    // disappearing is not the same thing: someone removed it.
    return held ? { list: null, failure: 'REVOCATIONS_MISSING' } : { list: null, failure: null }
  }

  try {
    const opened = await openRevocationList(data.document as SignedDocument, { list, issuerDid, held })
    if (!held || opened.version >= held.version) {
      writeJson(revocationHeldKey(issuerDid), { version: opened.version, digest: opened.digest })
    }
    return { list: opened, failure: null }
  } catch (e) {
    if (e instanceof RevocationRejected) {
      console.error('[trust] revocation list not usable:', e.reason)
      return { list: null, failure: e.reason }
    }
    throw e
  }
}
