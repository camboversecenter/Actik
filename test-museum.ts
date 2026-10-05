// Run with: npm run test:museum
//
// The museum exhibit file a holder exports for CamboVerse (src/lib/museumExport.ts).
// What it must carry, and — as much — what it must not.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { holdIssuerKey } from './src/lib/issuerKeyStore.ts'
import { issuePrintedCredential, printedDocumentHash } from './src/lib/printedCredential.ts'
import { buildRevocationList, openRevocationList, credentialStatus } from './src/lib/revocation.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { importSigningKey, keyId, openTrustList } from './src/lib/trustList.ts'
import {
  buildExhibitPackage, dataUrlBytes, sha256HexBytes, sensitiveFieldsOnDocument, ExportRefused, EXHIBIT_TYPE,
} from './src/lib/museumExport.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}
async function refused(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false } catch (e) { return e instanceof ExportRefused }
}

console.log('museum exhibit export')
const now = Math.floor(Date.now() / 1000)
const DAY = 86400
const numDid = didWeb('num.edu.kh')
const num = await generateIssuerKeys()
const held = await holdIssuerKey(num.privateJwk, numDid)

// The original issued file, as the credential carries it (claims.photo).
const scanBytes = new TextEncoder().encode('pretend these are the JPEG bytes of the certificate scan')
const original = 'data:image/jpeg;base64,' + Buffer.from(scanBytes).toString('base64')
const jti = crypto.randomUUID()
const claims: Record<string, unknown> = {
  name: 'Chan Sopheak',
  institution: 'National University of Management',
  degree_type: 'Bachelor of Business Administration',
  certificate_id: 'NUM-2026-BBA-0417',
  student_id: 'NUM-S-20220417',
  graduation_date: '2026-07-15',
  photo: original,
}
const printed = await issuePrintedCredential({
  signingKey: held.key, publicJwk: held.publicJwk,
  claims: {
    issuer: numDid, issuedAt: now, documentType: 'academic_degree', documentId: 'NUM-2026-BBA-0417',
    subjectName: 'Chan Sopheak', issuingOrganisation: 'National University of Management', issueDate: '2026-07-15',
    documentHash: await printedDocumentHash(scanBytes),
  },
})
const prepared = 'data:image/jpeg;base64,/9j/AAAA'
const base = {
  credentialId: '6f1c2e9a-0000-4000-8000-000000000001', issuerDid: numDid, claims, jti,
  title: 'Bachelor of Business Administration', originalFile: original, publicImage: prepared,
  visibility: 'private' as const, printed, includePrinted: true, now,
}

const pkg = await buildExhibitPackage(base)
assert(pkg.type === EXHIBIT_TYPE && pkg.verification === 'self-asserted', 'the exhibit is self-asserted, whatever ACTIK knows')
assert(!/verified|isValid/i.test(JSON.stringify({ ...pkg, credential: null })), 'no field says "verified"')
assert(pkg.source.fileSha256 === await sha256HexBytes(scanBytes), "the file's SHA-256 is of the original bytes")
assert(pkg.source.fileSha256!.slice(0, 32) === (await printedDocumentHash(scanBytes)).toLowerCase(),
  "…and its first 32 characters are the printed code's dh (MUSEUM.md rule 7)")
assert(!JSON.stringify(pkg).includes(original.slice(23, 60)), 'the original file is not in the package')
assert(pkg.source.actikVisibility === 'private' && pkg.exhibit.khmerTitle === null, 'private by default; Khmer title never guessed')
assert(pkg.exhibit.issuerName === 'National University of Management' && pkg.exhibit.date === '2026-07-15',
  'issuer and date are taken from the signed claims')
assert(pkg.credential === printed, 'the printed code goes in when the holder chooses')

// Withdrawal: CamboVerse can take the exhibit down from the public list alone.
const root = await generateIssuerKeys()
const { document } = await buildTrustList({
  snapshot: [{ did: numDid, name: 'National University of Management', accredited: true,
    keys: [{ public_jwk: num.publicJwk, created_at: new Date((now - DAY) * 1000).toISOString() }] }],
  previousVersion: 0, rootKey: await importSigningKey(root.privateJwk), rootKid: await keyId(root.publicJwk), now,
})
const list = await openTrustList(document, { roots: [root.publicJwk], now })
for (const how of [{ jti }, { documentId: 'NUM-2026-BBA-0417' }]) {
  const rev = await openRevocationList(await buildRevocationList({
    issuerDid: numDid, previous: null, signingKey: held.key, kid: held.kid, now,
    add: [{ ...how, reason: 'withdrawn', revokedAt: now }],
  }), { list, issuerDid: numDid })
  assert(rev.entries.some((e) => pkg.withdrawal!.ids.includes(e.id)),
    `a withdrawal by ${Object.keys(how)[0]} matches one of the exhibit's withdrawal ids`)
  assert((await credentialStatus({ jti, claims }, rev, now)).status === 'revoked', '…the same match the wallet makes')
}
const privatePkg = await buildExhibitPackage({ ...base, includePrinted: false })
const text = JSON.stringify(privatePkg)
assert(privatePkg.credential === null && !text.includes('NUM-2026-BBA-0417') && !text.includes(jti) &&
  !text.includes('NUM-S-20220417') && !text.includes('Chan Sopheak'),
  'without the printed code the package names no document number, jti, student number or name')

// Things that must not be exported.
assert(await refused(() => buildExhibitPackage({ ...base, publicImage: original.replace('jpeg', 'png') })),
  'a public image that is not the re-encoded copy is refused')
const otherFile = await issuePrintedCredential({
  signingKey: held.key, publicJwk: held.publicJwk,
  claims: { issuer: numDid, issuedAt: now, documentType: 'academic_degree', documentId: 'NUM-2026-BBA-0417',
    subjectName: 'Chan Sopheak', issuingOrganisation: 'National University of Management', issueDate: '2026-07-15',
    documentHash: await printedDocumentHash(new TextEncoder().encode('a different file')) },
})
assert(await refused(() => buildExhibitPackage({ ...base, printed: otherFile })),
  'a printed code signed for a different file is refused — it would hang beside the wrong image')
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7').toString('base64')
const pdfPkg = await buildExhibitPackage({ ...base, originalFile: pdf, publicImage: null, includePrinted: false })
assert(pdfPkg.source.fileType === 'application/pdf' && pdfPkg.source.publicImage === null,
  'a PDF exports its hash and no picture')

// Prompts for what to cover.
assert(JSON.stringify(sensitiveFieldsOnDocument(claims)) === JSON.stringify(['Student number']),
  'the holder is told the student number is probably printed on it')
assert(sensitiveFieldsOnDocument({ national_id: '0123', date_of_birth: '2000-01-01', birth_date: '2000-01-01' }).length === 2,
  'national ID and date of birth are flagged, once each')
assert(dataUrlBytes('not a data url') === null, 'a non-data URL is not read as a file')

console.log('\nALL TESTS PASSED')
