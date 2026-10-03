// Generate the trust Root keypair. Run once, offline, by whoever holds the
// Root role:
//
//   npx tsx scripts/trust-root-keygen.ts --out /media/usb/actik-root.private.jwk.json
//
// The private key is the most sensitive thing in the whole system — anyone
// holding it can declare any institution accredited — so this script:
//   - refuses to write anywhere inside this repository, where `git add .`
//     could commit it;
//   - refuses to overwrite an existing file;
//   - writes it readable by your user only (0600).
// Keep it on removable media or in an HSM, not on a server, and keep a second
// copy somewhere physically separate. Lose it and you cannot publish a new
// list; you would have to ship a build pinning a new Root.
//
// The public half is printed for VITE_TRUST_ROOT_KEYS. Pinning more than one
// Root (a JSON array) is how you rotate: ship a build that trusts old and new,
// start signing with the new one, then drop the old one in a later build.

import { writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPair, exportJWK } from 'jose'
import { keyId, publicOnly } from '../src/lib/trustList.ts'

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
if (outIdx === -1 || !args[outIdx + 1]) {
  console.error('usage: tsx scripts/trust-root-keygen.ts --out <path outside this repository>')
  process.exit(2)
}

const out = resolve(args[outIdx + 1])
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (out === repo || out.startsWith(repo + sep)) {
  console.error(`refusing to write the Root private key inside the repository (${repo}).`)
  console.error('Put it on removable media or in a directory git will never see.')
  process.exit(1)
}
if (existsSync(out)) {
  console.error(`refusing to overwrite ${out}. If you mean to replace the Root, move the old key first.`)
  process.exit(1)
}

const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
const privateJwk = { ...(await exportJWK(privateKey)), alg: 'ES256' }
const publicJwk = publicOnly(await exportJWK(publicKey))
const kid = await keyId(publicJwk)

writeFileSync(out, JSON.stringify(privateJwk, null, 2) + '\n', { mode: 0o600, flag: 'wx' })

console.log(`Root private key written to ${out} (mode 0600).`)
console.log(`Root kid: ${kid}\n`)
console.log('Pin the public half in the app build — .env or your host\'s build settings:\n')
console.log(`VITE_TRUST_ROOT_KEYS='${JSON.stringify([publicJwk])}'`)
