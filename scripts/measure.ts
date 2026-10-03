// Run with: npm run measure
//
// The sizes and timings reported in paper/main.tex (section 4.10). Everything
// is generated here with fresh keys and fictional names; nothing is read from
// a database. Timings are of this machine's JavaScript engine, not of a phone:
// report the machine with the numbers.
import { generateIssuerKeys, didWeb } from '../src/lib/did.ts'
import { importSigningKey, keyId, openTrustList } from '../src/lib/trustList.ts'
import { buildTrustList } from '../src/lib/trustListBuild.ts'
import { buildRevocationList, openRevocationList } from '../src/lib/revocation.ts'
import { checkCredential } from '../src/lib/credentialCheck.ts'
import { issueSdJwt, present, addKeyBinding, shareAudience } from '../src/lib/sdjwt.ts'
import { ALWAYS_REVEALED } from '../src/lib/disclosure.ts'
import { issuePrintedCredential, verifyPrintedCredential, printedDocumentHash } from '../src/lib/printedCredential.ts'
import { holdIssuerKey } from '../src/lib/issuerKeyStore.ts'
const now = Math.floor(Date.now() / 1000), DAY = 86400
const did = didWeb('university.example')
const root = await generateIssuerKeys(), iss = await generateIssuerKeys(), holder = await generateIssuerKeys()
const issuers = [{ did, name: 'Example University', accredited: true, keys: [{ public_jwk: iss.publicJwk, created_at: new Date((now - DAY) * 1000).toISOString() }] }]
for (let i = 0; i < 99; i++) { const k = await generateIssuerKeys(); issuers.push({ did: didWeb(`issuer${i}.example`), name: `Issuer ${i}`, accredited: true, keys: [{ public_jwk: k.publicJwk, created_at: new Date((now - DAY) * 1000).toISOString() }] }) }
const { document } = await buildTrustList({ snapshot: issuers, previousVersion: 0, rootKey: await importSigningKey(root.privateJwk), rootKid: await keyId(root.publicJwk), now })
const list = await openTrustList(document, { roots: [root.publicJwk], now })
const key = await importSigningKey(iss.privateJwk), kid = await keyId(iss.publicJwk)
const subject = { sub: 'holder@example.com', name: 'Chan Sopheak', institution: 'Example University', iss: did, degree_type: 'Bachelor of Business Administration',
  major: 'Accounting', graduation_date: '2026-07-15', certificate_id: 'EU-2026-BBA-0417', student_id: 'S-20220417' }
const full = await issueSdJwt({ issuerDid: did, signingKey: key, kid, subject, holderPublicJwk: holder.publicJwk, vct: 'https://actik.kh/credentials/academic_degree', expiresInSec: 5 * 365 * DAY })
const shared = present(full, ALWAYS_REVEALED)
const bound = await addKeyBinding(shared, await importSigningKey(holder.privateJwk), { audience: shareAudience('5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11'), nonce: crypto.randomUUID() })
const entries = []
for (let i = 0; i < 1000; i++) entries.push({ documentId: `X-${i}`, reason: 'withdrawn' as const, revokedAt: now })
const rdoc = await buildRevocationList({ issuerDid: did, previous: null, signingKey: key, kid, now, add: entries })
const revs = { list: await openRevocationList(rdoc, { list, issuerDid: did }), failure: null }
const trust = { list, failure: null }
const time = async (n: number, f: () => Promise<unknown>) => { const t: number[] = []; for (let i = 0; i < n; i++) { const a = performance.now(); await f(); t.push(performance.now() - a) } t.sort((x, y) => x - y); return { median: t[Math.floor(n / 2)].toFixed(2), p95: t[Math.floor(n * 0.95)].toFixed(2) } }
const opts = { holderProof: { audience: shareAudience('5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11') } }
await time(20, () => checkCredential(bound, did, trust, revs, now, opts))
console.log('sizes (bytes): full credential', full.length, '| default share', shared.length, '| with key binding', bound.length, '| KB-JWT overhead', bound.length - shared.length)
console.log('trust list (100 issuers) statement bytes', document.statement.length, '| withdrawal list (1000 entries) bytes', rdoc.statement.length)
console.log('verify share w/ binding + 1000-entry list:', await time(300, () => checkCredential(bound, did, trust, revs, now, opts)))
console.log('open trust list (100 issuers):', await time(100, () => openTrustList(document, { roots: [root.publicJwk], now })))
const held = await holdIssuerKey(iss.privateJwk, did)
const printed = await issuePrintedCredential({ signingKey: held.key, publicJwk: held.publicJwk, claims: { issuer: did, issuedAt: now, documentType: 'academic_degree',
  documentId: 'EU-2026-BBA-0417', subjectName: 'ចាន់ សុភ័ក្រ', issuingOrganisation: 'Example University', issueDate: '2026-07-15', documentHash: await printedDocumentHash(new TextEncoder().encode('scan')) } })
console.log('printed KH1 code chars', printed.length)
console.log('verify printed:', await time(300, () => verifyPrintedCredential(printed, trust, revs, now)))
console.log('runtime', process.version, process.platform, process.arch)
