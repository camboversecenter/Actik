// Run with: npm run test:printed
//
// Part 1 proves the vendored QRSeal core (src/khsqr/) is QRSeal: every Profile
// B case in QRSeal's own conformance suite, run against this copy, must give
// the same verdict and the same reason string.
import { readFileSync } from 'node:fs'
import { TrustAnchor } from './src/khsqr/trustlist.ts'
import { verifyProfileB } from './src/khsqr/profileB.ts'
import { KhSqrError } from './src/khsqr/errors.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}

console.log('QRSeal conformance vectors (Profile B) against the vendored core')
const suite = JSON.parse(readFileSync('test/fixtures/khsqr-vectors.json', 'utf8'))
let ran = 0
for (const v of suite.cases) {
  if (v.profile !== 'B' || v.type !== 'verify') continue
  const st = v.state
  let outcome: { accepted: boolean; reason: string | null }
  try {
    const trustAnchor = await TrustAnchor.open({
      trustList: suite.trustLists[st.trustList],
      ...(st.timestamp === null ? {} : { timestamp: suite.timestamps[st.timestamp] }),
      rootKeys: suite.pinned.rootKeys,
      timestampKeys: suite.pinned.timestampKeys,
      now: st.now,
      ...(st.heldVersion === undefined ? {} : { heldVersion: st.heldVersion }),
      ...(st.fetchedAt === undefined ? {} : { fetchedAt: st.fetchedAt }),
      ...(st.revocations === undefined ? {} : { revocations: suite.revocations?.[st.revocations] ?? [] }),
    })
    await verifyProfileB({ payload: v.input.payload, trustAnchor, now: st.now })
    outcome = { accepted: true, reason: null }
  } catch (e) {
    if (!(e instanceof KhSqrError)) throw e
    outcome = { accepted: false, reason: e.reason }
  }
  const wanted = v.expect === 'accept'
  assert(outcome.accepted === wanted && (v.reason === null || v.reason === outcome.reason),
    `${v.id} → ${outcome.accepted ? 'accept' : outcome.reason}`)
  ran++
}
// QRSeal's suite has 14 Profile B cases: 13 verify, 1 roundtrip. The roundtrip
// needs QRSeal's private key, so its own runner skips it too; Actik's
// sign-then-verify round trip is exercised in part 2 below.
assert(ran === 13, 'all 13 Profile B verify vectors give QRSeal\'s verdict and reason')

// Part 2: Actik's printed lane — QRSeal's format, Actik's trust layer.
console.log('\nActik printed certificates')
const { generateIssuerKeys, didWeb } = await import('./src/lib/did.ts')
const { importSigningKey, keyId, openTrustList } = await import('./src/lib/trustList.ts')
const { buildTrustList } = await import('./src/lib/trustListBuild.ts')
const { buildRevocationList, openRevocationList } = await import('./src/lib/revocation.ts')
const { CredentialRefused, CredentialWithdrawn } = await import('./src/lib/credentialCheck.ts')
const {
  issuePrintedCredential, verifyPrintedCredential, printedKeyId, printedDocumentHash, classifyScanned, PrintRefused,
} = await import('./src/lib/printedCredential.ts')
const { holdIssuerKey } = await import('./src/lib/issuerKeyStore.ts')

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const iso = (t: number) => new Date(t * 1000).toISOString()
const root = await generateIssuerKeys()
const numDid = didWeb('num.edu.kh')
const ruppDid = didWeb('rupp.edu.kh')
const numOld = await generateIssuerKeys()
const numNew = await generateIssuerKeys()
const rupp = await generateIssuerKeys()
const rotatedAt = now - 10 * DAY
const { document } = await buildTrustList({
  snapshot: [
    { did: numDid, name: 'National University of Management', accredited: true, keys: [
      { public_jwk: numOld.publicJwk, created_at: iso(now - 400 * DAY), retired_at: iso(rotatedAt) },
      { public_jwk: numNew.publicJwk, created_at: iso(rotatedAt) },
    ] },
    { did: ruppDid, name: 'Royal University of Phnom Penh', accredited: true,
      keys: [{ public_jwk: rupp.publicJwk, created_at: iso(now - 400 * DAY) }] },
  ],
  previousVersion: 0, rootKey: await importSigningKey(root.privateJwk), rootKid: await keyId(root.publicJwk), now,
})
const list = await openTrustList(document, { roots: [root.publicJwk], now })
const trust = { list, failure: null }
const none = { list: null, failure: null }

// The NUM degree, issued with the key held the way the app holds it.
const held = await holdIssuerKey(numNew.privateJwk, numDid)
const scan = new TextEncoder().encode('pretend this is the certificate scan')
const claims = {
  issuer: numDid,
  issuedAt: now,
  documentType: 'academic_degree',
  documentId: 'NUM-2026-BBA-0417',
  subjectName: 'ចាន់ សុភ័ក្រ',            // Khmer, exactly as printed
  issuingOrganisation: 'National University of Management',
  issueDate: '2026-07-15',
  documentHash: await printedDocumentHash(scan),
}
const printed = await issuePrintedCredential({ signingKey: held.key, publicJwk: held.publicJwk, claims })
assert(printed.startsWith('KH1:'), 'a printed code is a KH1: payload, not a URL')
assert(/^[0-9A-Z $%*+\-./:]+$/.test(printed),
  `it uses only the QR alphanumeric set, so it encodes compactly (${printed.length} characters)`)

const ok = await verifyPrintedCredential(printed, trust, none, now)
assert(ok.issuer.name === 'National University of Management', 'it verifies against the signed trust list')
assert(ok.assertion.mustMatchPrintedDocument.subjectName === 'ចាន់ សុភ័ក្រ', 'a Khmer name round-trips exactly')
assert(ok.assertion.mustMatchPrintedDocument.documentId === 'NUM-2026-BBA-0417', 'the document number round-trips')
assert(ok.assertion.kid === await printedKeyId(numNew.publicJwk), "the code names NUM's key by QRSeal's 8-byte id")
assert(ok.standing.status === 'unchecked', 'with no withdrawal list published, standing is unchecked, not clear')
assert(!('valid' in (ok as object)) && !('valid' in (ok.assertion as object)), 'there is no boolean verdict to read')

// The transplant check, with QRSeal's own comparison.
const forgedPaper = ok.assertion.compareWithPrintedDocument({
  subjectName: 'Someone Else', documentId: 'NUM-2026-BBA-0417',
  issuingOrganisation: 'National University of Management', issueDate: '2026-07-15',
})
assert(forgedPaper.mismatches.length === 1 && forgedPaper.mismatches[0].field === 'subjectName',
  'a genuine code on a forged paper is caught by comparing the printed name')

async function reason(fn: () => Promise<unknown>) {
  try { await fn() } catch (e) { return (e as { reason?: string }).reason ?? 'THREW' }
  return 'ACCEPTED'
}

// Tampering anywhere in the payload.
const flipped = printed.slice(0, 40) + (printed[40] === 'A' ? 'B' : 'A') + printed.slice(41)
assert((await reason(() => verifyPrintedCredential(flipped, trust, none, now))) !== 'ACCEPTED',
  'one changed character and it does not verify')

// A stranger's key, NUM's name.
const stranger = await generateIssuerKeys()
const strangerCode = await issuePrintedCredential({
  signingKey: await importSigningKey(stranger.privateJwk), publicJwk: stranger.publicJwk, claims,
})
assert((await reason(() => verifyPrintedCredential(strangerCode, trust, none, now))) === 'UNKNOWN_KID',
  "a certificate signed by a key the Root never listed is refused, whatever name it carries")

// RUPP's genuine key signing a certificate in NUM's name.
const crossCode = await issuePrintedCredential({
  signingKey: await importSigningKey(rupp.privateJwk), publicJwk: rupp.publicJwk, claims,
})
assert((await reason(() => verifyPrintedCredential(crossCode, trust, none, now))) === 'ISSUER_KEY_MISMATCH',
  "one accredited institution cannot print another's certificates")

// Key rotation: printed before retirement still verifies; after, not.
const oldKey = await importSigningKey(numOld.privateJwk)
const beforeRotation = await issuePrintedCredential({ signingKey: oldKey, publicJwk: numOld.publicJwk,
  claims: { ...claims, issuedAt: now - 30 * DAY } })
assert((await verifyPrintedCredential(beforeRotation, trust, none, now)).key.status === 'retired',
  'a certificate printed before a key rotation keeps verifying')
const afterRotation = await issuePrintedCredential({ signingKey: oldKey, publicJwk: numOld.publicJwk,
  claims: { ...claims, issuedAt: now - DAY } })
assert((await reason(() => verifyPrintedCredential(afterRotation, trust, none, now))) === 'KEY_NOT_VALID_AT_ISSUANCE',
  'the retired key cannot print anything dated after its retirement')

// No trust list: could not check — not "fake".
let unavailable = false
try { await verifyPrintedCredential(printed, { list: null, failure: 'TRUSTLIST_EXPIRED' }, none, now) }
catch (e) { unavailable = (e as InstanceType<typeof CredentialRefused>).unavailable }
assert(unavailable, 'with no usable trust list the answer is "could not check", never a verdict on the paper')

// Withdrawal: the in-app withdrawal (jti + document number) reaches the paper.
const revDoc = await buildRevocationList({
  issuerDid: numDid, previous: null, signingKey: held.key, kid: held.kid, now,
  add: [{ jti: crypto.randomUUID(), documentId: 'NUM-2026-BBA-0417', reason: 'withdrawn', revokedAt: now }],
})
const revs = { list: await openRevocationList(revDoc, { list, issuerDid: numDid }), failure: null }
let withdrawn: InstanceType<typeof CredentialWithdrawn> | null = null
try { await verifyPrintedCredential(printed, trust, revs, now) } catch (e) { withdrawn = e as InstanceType<typeof CredentialWithdrawn> }
assert(withdrawn?.reason === 'CREDENTIAL_REVOKED' && withdrawn.withdrawalReason === 'withdrawn',
  'withdrawing a credential in the app withdraws its printed copy')
const otherCert = await issuePrintedCredential({ signingKey: held.key, publicJwk: held.publicJwk,
  claims: { ...claims, documentId: 'NUM-2026-BBA-0418' } })
const cleared = await verifyPrintedCredential(otherCert, trust, revs, now)
assert(cleared.standing.status === 'clear' && cleared.standing.listVersion === 1,
  'another certificate is clear, as of withdrawal list version 1')
const withheld = await reason(() => verifyPrintedCredential(otherCert, trust, { list: null, failure: 'REVOCATIONS_ROLLBACK' }, now))
assert(withheld === 'REVOCATIONS_MISSING', 'a withdrawal list that will not open makes the check unavailable')

// No document number: refused at print time.
let refusedPrint = false
try { await issuePrintedCredential({ signingKey: held.key, publicJwk: held.publicJwk, claims: { ...claims, documentId: ' ' } }) }
catch (e) { refusedPrint = e instanceof PrintRefused }
assert(refusedPrint, 'a certificate with no document number is not printed')

// What the scanner does with what it reads.
const origin = 'https://actik.app'
assert(classifyScanned(printed, origin).kind === 'printed', 'the scanner routes KH1: codes to printed verification')
assert(classifyScanned('https://actik.app/verify/5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11', origin).kind === 'own-link',
  "the scanner follows a link to this app's own verify page")
for (const lookalike of [
  'https://actik.app.evil.example/verify/5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11',
  'https://actlk.app/verify/5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11',
  'https://actik.app@evil.example/verify/5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11',
  'http://actik.app/verify/5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11',
  'https://actik.app/pay?to=5f0c6f8e',
]) {
  assert(classifyScanned(lookalike, origin).kind === 'url', `refused as a website: ${lookalike}`)
}
assert((await reason(() => verifyPrintedCredential('https://actik.app/x', trust, none, now))) === 'URL_PAYLOAD_REJECTED',
  'a URL handed straight to the verifier is refused before anything else')
assert(classifyScanned('00020101021129370016A000000677010111', origin).kind === 'other',
  'an ordinary code is "not an Actik code", not a forgery')

// Claim time: the printed copy is kept only if it belongs with its credential.
console.log('\nthe printed copy delivered with a credential')
const { issueSdJwt } = await import('./src/lib/sdjwt.ts')
const { checkCredential } = await import('./src/lib/credentialCheck.ts')
const { checkPrintedCopy } = await import('./src/lib/printedCredential.ts')
const sdjwt = await issueSdJwt({
  issuerDid: numDid, signingKey: held.key, kid: held.kid, jti: crypto.randomUUID(),
  subject: { name: 'ចាន់ សុភ័ក្រ', institution: 'National University of Management', certificate_id: 'NUM-2026-BBA-0417',
    graduation_date: '2026-07-15', degree_type: 'Bachelor of Business Administration' },
  vct: 'https://actik.kh/credentials/academic_degree', expiresInSec: 5 * 365 * DAY,
})
const credential = await checkCredential(sdjwt, numDid, trust, none, now)
const kept = await checkPrintedCopy(printed, credential, trust, none, now)
assert(kept.payload === printed, 'a printed copy of the same document, by the same issuer, is kept')
const wrongDoc = await checkPrintedCopy(otherCert, credential, trust, none, now)
assert(wrongDoc.payload === null && wrongDoc.reason === 'DOCUMENT_MISMATCH', "a printed copy of another document is not kept")
const ruppHeld = await holdIssuerKey(rupp.privateJwk, ruppDid)
const ruppCopy = await issuePrintedCredential({ signingKey: ruppHeld.key, publicJwk: ruppHeld.publicJwk,
  claims: { ...claims, issuer: ruppDid, issuingOrganisation: 'Royal University of Phnom Penh' } })
const wrongIssuer = await checkPrintedCopy(ruppCopy, credential, trust, none, now)
assert(wrongIssuer.payload === null && wrongIssuer.reason === 'ISSUER_MISMATCH', "another institution's printed copy is not kept")
const otherName = await issuePrintedCredential({ signingKey: held.key, publicJwk: held.publicJwk,
  claims: { ...claims, subjectName: 'Someone Else' } })
assert((await checkPrintedCopy(otherName, credential, trust, none, now)).payload === null,
  "a printed copy naming someone else is not kept")
const tampered = printed.slice(0, -3) + (printed.endsWith('A') ? 'BBB' : 'AAA')
assert((await checkPrintedCopy(tampered, credential, trust, none, now)).payload === null, 'a damaged printed copy is not kept')
const { readPrintedFields } = await import('./src/lib/printedCredential.ts')
const read = await readPrintedFields(printed)
assert(read?.subjectName === 'ចាន់ សុភ័ក្រ' && read.documentId === 'NUM-2026-BBA-0417' && read.documentHash === claims.documentHash,
  'a reprint takes its four fields from the code itself')

console.log('\nALL TESTS PASSED')
