// Build and sign the trust list. Run by the Root holder, offline:
//
//   1. In the Supabase SQL editor, run supabase/queries/export_trustlist_input.sql
//      and save the single JSON cell it returns as trustlist-input.json.
//   2. npx tsx scripts/build-trustlist.ts \
//        --root /media/usb/actik-root.private.jwk.json \
//        --input trustlist-input.json \
//        --previous trustlist-current.json \   (omit for the very first list)
//        --out trustlist-next.json
//   3. Review the summary it prints. It is the list of who verifiers will
//      trust for the next 30 days — read it as such.
//   4. Paste the SQL it prints into the SQL editor to publish.
//
// The admin dashboard's "approve" is a request; this is where it takes effect.
// An institution approved in the dashboard but absent from the summary is not
// trusted by anyone.
//
// Re-run at least every 30 days even if nothing changed: a list expires, and
// verifiers stop verifying rather than trust a stale one.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { JWK } from 'jose'
import {
  importSigningKey, keyId, publicOnly, verifySignedDocument, type SignedDocument,
} from '../src/lib/trustList.ts'
import { buildTrustList, type IssuerSnapshot } from '../src/lib/trustListBuild.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const rootPath = arg('root')
const inputPath = arg('input')
const outPath = arg('out')
const previousPath = arg('previous')
const days = Number(arg('days') ?? 30)

if (!rootPath || !inputPath || !outPath) {
  console.error('usage: tsx scripts/build-trustlist.ts --root <private.jwk.json> --input <export.json> --out <next.json> [--previous <current.json>] [--days 30]')
  process.exit(2)
}
if (!(days > 0 && days <= 31)) {
  console.error('--days must be between 1 and 31: verifiers refuse a list valid for longer.')
  process.exit(2)
}
if (existsSync(outPath)) {
  console.error(`refusing to overwrite ${outPath}`)
  process.exit(1)
}

const rootJwk = JSON.parse(readFileSync(rootPath, 'utf8')) as JWK
const rootPublic = publicOnly(rootJwk)
const rootKid = await keyId(rootPublic)
const rootKey = await importSigningKey(rootJwk)

// The SQL editor returns the JSON cell as-is; accept it wrapped or bare.
let raw = JSON.parse(readFileSync(inputPath, 'utf8'))
if (raw && !Array.isArray(raw) && Array.isArray(raw.trustlist_input)) raw = raw.trustlist_input
if (Array.isArray(raw) && raw.length === 1 && raw[0]?.trustlist_input) raw = raw[0].trustlist_input
const snapshot = raw as IssuerSnapshot[]
if (!Array.isArray(snapshot)) {
  console.error('input is not the array export_trustlist_input.sql produces')
  process.exit(1)
}

// The new version must supersede the published one, and the published one
// must really be ours — otherwise we would be continuing someone else's chain.
let previousVersion = 0
if (previousPath) {
  const prev = JSON.parse(readFileSync(previousPath, 'utf8')) as SignedDocument
  if (!(await verifySignedDocument(prev, rootPublic))) {
    console.error('--previous is not signed by this Root. Refusing to continue its version chain.')
    process.exit(1)
  }
  previousVersion = JSON.parse(prev.statement).version
} else {
  console.warn('No --previous given: this list will be version 1. Verifiers that already hold a')
  console.warn('later version will refuse it as a rollback.\n')
}

const now = Math.floor(Date.now() / 1000)
const { document, statement } = await buildTrustList({
  snapshot, previousVersion, rootKey, rootKid, now, validitySeconds: days * 24 * 60 * 60,
})

writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' })

const fmt = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z')
console.log(`Trust list v${statement.version}, signed by Root ${rootKid}`)
console.log(`valid ${fmt(statement.issuedAt)} → ${fmt(statement.expires)}\n`)
console.log(`${statement.issuers.length} issuer(s) will be trusted:`)
for (const i of statement.issuers) {
  // The tier is part of what the Root signs: check it as carefully as the name.
  const tier = i.kind === 'employer' ? 'registered employer — employment records only' : 'accredited institution — every credential type'
  console.log(`  ${i.name}  ${i.did}\n    ${tier}`)
  for (const k of i.keys) {
    console.log(`    ${k.status.padEnd(7)} ${k.kid}  signs credentials dated ${fmt(k.notBefore)} → ${fmt(k.notAfter)}`)
  }
}
const left = snapshot.filter((s) => !statement.issuers.some((i) => i.did === s.did))
if (left.length) {
  console.log(`\n${left.length} registered institution(s) NOT on the list (not accredited, or accreditation revoked):`)
  for (const s of left) console.log(`  ${s.name}  ${s.did}`)
}

const sqlJson = JSON.stringify(document).replace(/'/g, "''")
console.log(`\nWritten to ${outPath}. To publish, run in the Supabase SQL editor:\n`)
console.log(`insert into public.trust_documents (kind, document, version)`)
console.log(`values ('trustlist', '${sqlJson}'::jsonb, 0)`)
console.log(`on conflict (kind) do update set document = excluded.document;`)
