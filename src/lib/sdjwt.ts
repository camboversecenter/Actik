// Minimal SD-JWT (Selective Disclosure JWT) implementation.
//
// This is an EDUCATIONAL implementation that follows the structure of the IETF
// SD-JWT spec closely enough to be correct and to round-trip, but it is NOT a
// full implementation. For production use the `@sd-jwt/sd-jwt-vc` library and
// add Key Binding (KB-JWT) for holder proof. See README.
//
// The core trick: the issuer signs HASHES of each claim (the `_sd` array), not
// the values. The values live in separate "disclosure" strings appended after
// the JWT with `~` separators. Revealing a claim = including its disclosure;
// hiding it = leaving the disclosure out. The signature stays valid either way.

import { SignJWT, jwtVerify, importJWK, type JWK } from 'jose'

const enc = new TextEncoder()
const dec = new TextDecoder()

function bytesToB64u(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function b64uJSON(obj: unknown): string {
  return bytesToB64u(enc.encode(JSON.stringify(obj)))
}

function fromB64uJSON<T = unknown>(s: string): T {
  return JSON.parse(dec.decode(b64uToBytes(s))) as T
}

// Hash of the base64url-encoded disclosure string (UTF-8 / Khmer safe).
async function sha256b64u(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return bytesToB64u(new Uint8Array(digest))
}

function randomSalt(): string {
  return bytesToB64u(crypto.getRandomValues(new Uint8Array(16)))
}

export type Claims = Record<string, unknown>

export interface IssueParams {
  issuerDid: string
  issuerPrivateJwk: JWK
  /** Claims that should each become selectively-disclosable. */
  subject: Claims
  /** Credential type, e.g. "https://actik.kh/credentials/degree". */
  vct: string
  /** Optional credential lifetime in seconds (sets `exp`). */
  expiresInSec?: number
}

async function makeDisclosure(name: string, value: unknown) {
  // A disclosure is base64url( JSON.stringify([salt, name, value]) ).
  const disclosure = b64uJSON([randomSalt(), name, value])
  const digest = await sha256b64u(disclosure)
  return { disclosure, digest }
}

/** Issue a full SD-JWT: `<signed-jwt>~<disclosure>~<disclosure>~...~` */
export async function issueSdJwt(p: IssueParams): Promise<string> {
  const disclosures: string[] = []
  const sd: string[] = []
  for (const [k, v] of Object.entries(p.subject)) {
    const { disclosure, digest } = await makeDisclosure(k, v)
    disclosures.push(disclosure)
    sd.push(digest)
  }

  const key = await importJWK(p.issuerPrivateJwk, 'ES256')
  const now = Math.floor(Date.now() / 1000)

  let builder = new SignJWT({ _sd: sd, _sd_alg: 'sha-256', vct: p.vct })
    .setProtectedHeader({ alg: 'ES256', typ: 'dc+sd-jwt' })
    .setIssuer(p.issuerDid)
    .setIssuedAt(now)
  if (p.expiresInSec) builder = builder.setExpirationTime(now + p.expiresInSec)

  const jwt = await builder.sign(key)
  return [jwt, ...disclosures].join('~') + '~'
}

interface ParsedSdJwt {
  jwt: string
  disclosures: string[]
}

function parseSdJwt(sdjwt: string): ParsedSdJwt {
  const parts = sdjwt.split('~')
  const jwt = parts[0]
  // Drop the (possibly empty) trailing element after the final `~`.
  const disclosures = parts.slice(1).filter((x) => x.length > 0)
  return { jwt, disclosures }
}

export interface DecodedDisclosure {
  name: string
  value: unknown
  disclosure: string
}

/** Decode the human-readable claims held in an SD-JWT's disclosures. */
export function readDisclosures(sdjwt: string): DecodedDisclosure[] {
  const { disclosures } = parseSdJwt(sdjwt)
  return disclosures.map((d) => {
    const [, name, value] = fromB64uJSON<[string, string, unknown]>(d)
    return { name, value, disclosure: d }
  })
}

/**
 * Build a presentation that reveals only `revealNames`, omitting every other
 * disclosure. The issuer signature is untouched and still verifies.
 */
export function present(fullSdJwt: string, revealNames: string[]): string {
  const { jwt, disclosures } = parseSdJwt(fullSdJwt)
  const keep = disclosures.filter((d) => {
    const [, name] = fromB64uJSON<[string, string, unknown]>(d)
    return revealNames.includes(name)
  })
  return [jwt, ...keep].join('~') + '~'
}

export interface VerifyResult {
  valid: boolean
  issuer?: string
  claims: Claims
  error?: string
}

/**
 * Verify a presentation against the issuer's public key:
 *  1. the issuer signature is valid (and `exp` not passed),
 *  2. every revealed disclosure hashes to a digest the issuer signed.
 */
export async function verify(presentation: string, issuerPublicJwk: JWK): Promise<VerifyResult> {
  try {
    const { jwt, disclosures } = parseSdJwt(presentation)
    const jwk = issuerPublicJwk.alg 
      ? issuerPublicJwk 
      : { ...issuerPublicJwk, alg: 'ES256' }
    const key = await importJWK(jwk, 'ES256')

    // jwtVerify checks the signature AND throws if `exp` is in the past.
    const { payload } = await jwtVerify(jwt, key)
    const signedDigests = (payload._sd as string[] | undefined) ?? []

    const claims: Claims = {}
    for (const d of disclosures) {
      const digest = await sha256b64u(d)
      // Never log `d` or the claims it decodes to: a disclosure is the
      // credential's payload, and console output outlives the tab.
      if (!signedDigests.includes(digest)) {
        return { valid: false, claims: {}, 
          error: 'A disclosure does not match any signed hash.' }
      }
      const [, name, value] = fromB64uJSON<[string, string, unknown]>(d)
      claims[name] = value
    }

    return { valid: true, issuer: payload.iss, claims }
  } catch (e) {
    // The message only: a jose error carries the decoded payload on `cause`,
    // and that is the credential's contents.
    const message = e instanceof Error ? e.message : String(e)
    console.error('[sdjwt verify] error:', message)
    return { valid: false, claims: {}, error: message }
  }
}
