// Run with: npm run test:employment
//
// Employment records, and the employer tier of the trust list: an employer is
// admitted by the Root as an employer, may sign employment records only, and
// every verifier shows it as one.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { importSigningKey, keyId, openTrustList, signStatement } from './src/lib/trustList.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { buildRevocationList, openRevocationList } from './src/lib/revocation.ts'
import { checkCredential, CredentialRefused, CredentialWithdrawn } from './src/lib/credentialCheck.ts'
import { issueSdJwt } from './src/lib/sdjwt.ts'
import { issuePrintedCredential, verifyPrintedCredential } from './src/lib/printedCredential.ts'
import { holdIssuerKey } from './src/lib/issuerKeyStore.ts'
import { buildAnswer, checkAnswer, disclosedNames } from './src/lib/proofRequest.ts'
import { displayClaim } from './src/lib/claimDisplay.ts'
import { ALWAYS_REVEALED } from './src/lib/disclosure.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}
async function reason(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'ACCEPTED' } catch (e) { return (e as { reason?: string }).reason ?? 'THREW' }
}

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const iso = (t: number) => new Date(t * 1000).toISOString()
const root = await generateIssuerKeys()
const firm = await generateIssuerKeys()
const uni = await generateIssuerKeys()
const firmDid = didWeb('angkor-accounting.example')
const uniDid = didWeb('num.edu.kh')
const rootKey = await importSigningKey(root.privateJwk)
const rootKid = await keyId(root.publicJwk)
const { document, statement } = await buildTrustList({
  snapshot: [
    { did: firmDid, name: 'Angkor Accounting Co.', accredited: true, kind: 'employer',
      keys: [{ public_jwk: firm.publicJwk, created_at: iso(now - DAY) }] },
    { did: uniDid, name: 'National University of Management', accredited: true,
      keys: [{ public_jwk: uni.publicJwk, created_at: iso(now - DAY) }] },
  ],
  previousVersion: 0, rootKey, rootKid, now,
})
const list = await openTrustList(document, { roots: [root.publicJwk], now })
const trust = { list, failure: null }
const none = { list: null, failure: null }

console.log('the employer tier')
assert(list.issuers.get(firmDid)?.kind === 'employer', 'the Root signs an employer in as an employer')
assert(list.issuers.get(uniDid)?.kind === 'institution', 'an issuer exported without a kind is an institution, as before kinds existed')
let unknownKind: unknown = null
try {
  await buildTrustList({ snapshot: [{ did: uniDid, name: 'X', accredited: true, kind: 'university+',
    keys: [{ public_jwk: uni.publicJwk, created_at: iso(now - DAY) }] }], previousVersion: 0, rootKey, rootKid, now })
} catch (e) { unknownKind = e }
assert(unknownKind instanceof Error, 'an unknown kind stops the build instead of admitting anyone at the wider tier')
const promoted = JSON.parse(document.statement)
promoted.issuers[0].kind = 'institution'
assert((await reason(() => openTrustList({ ...document, statement: JSON.stringify(promoted) }, { roots: [root.publicJwk], now })))
  === 'TRUSTLIST_SIGNATURE_INVALID', 'an employer cannot be promoted to an institution without the Root')
const legacy = await signStatement({ ...statement, issuers: statement.issuers.map(({ kind: _k, ...i }) => i) }, rootKey, rootKid)
const legacyList = await openTrustList(legacy, { roots: [root.publicJwk], now })
assert(legacyList.issuers.get(firmDid)?.kind === 'institution', 'a list signed before kinds existed reads as all institutions, as it was')

console.log('\nwhat an employer may sign')
const firmKey = await importSigningKey(firm.privateJwk)
const firmKid = await keyId(firm.publicJwk)
const job = {
  name: 'Chan Sopheak', institution: 'Angkor Accounting Co.', job_title: 'Accountant', employment_type: 'full_time',
  employment_start: '2023-03-01', employment_status: 'current', department: 'Finance', role_description: 'Month-end close',
}
const record = await issueSdJwt({ issuerDid: firmDid, signingKey: firmKey, kid: firmKid, jti: crypto.randomUUID(), subject: job,
  vct: 'https://actik.kh/credentials/employment_record', expiresInSec: 10 * 365 * DAY })
const checked = await checkCredential(record, firmDid, trust, none, now)
assert(checked.issuer.kind === 'employer' && checked.assertion.credentialType === 'employment_record',
  "an employer's employment record verifies, and says it came from a registered employer")
const fakeDegree = await issueSdJwt({ issuerDid: firmDid, signingKey: firmKey, kid: firmKid, subject: { name: 'Chan Sopheak', degree_type: 'MBA' },
  vct: 'https://actik.kh/credentials/academic_degree' })
assert((await reason(() => checkCredential(fakeDegree, firmDid, trust, none, now))) === 'TYPE_NOT_ALLOWED_FOR_ISSUER',
  'a degree signed by an employer is refused — its key does not make it a university')
let refused: unknown = null
try { await checkCredential(fakeDegree, firmDid, trust, none, now) } catch (e) { refused = e }
assert(refused instanceof CredentialRefused && !refused.unavailable, '…as a refusal, not a "could not check"')
const held = await holdIssuerKey(firm.privateJwk, firmDid)
const printedDegree = await issuePrintedCredential({ signingKey: held.key, publicJwk: held.publicJwk, claims: {
  issuer: firmDid, issuedAt: now, documentType: 'academic_degree', documentId: 'X-1', subjectName: 'Chan Sopheak',
  issuingOrganisation: 'Angkor Accounting Co.', issueDate: '2026-07-15' } })
assert((await reason(() => verifyPrintedCredential(printedDegree, trust, none, now))) === 'TYPE_NOT_ALLOWED_FOR_ISSUER',
  'nor can an employer print one')
const uniKey = await importSigningKey(uni.privateJwk)
const staffRecord = await issueSdJwt({ issuerDid: uniDid, signingKey: uniKey, kid: await keyId(uni.publicJwk), subject: { ...job, institution: 'National University of Management' },
  vct: 'https://actik.kh/credentials/employment_record' })
assert((await checkCredential(staffRecord, uniDid, trust, none, now)).issuer.kind === 'institution',
  'an institution is an employer too, of its own staff')

console.log('\nan employment record, shown and asked for')
for (const f of ['job_title', 'employment_type', 'employment_start', 'employment_end', 'employment_status']) {
  assert(ALWAYS_REVEALED.includes(f), `every share of a record shows ${f}`)
}
const t = (k: string, v?: Record<string, string | number>) =>
  k === 'proof.employment_current_as_of' ? `Current, as of ${v?.date}` : k === 'proof.employment_type_full_time' ? 'Full-time' : k
const shown = displayClaim(t, 'employment_status', 'current', checked.assertion.issuedAt)
assert(shown.startsWith('Current, as of ') && shown.length > 'Current, as of '.length,
  '"current" is always shown with the date the employer signed it')
assert(displayClaim(t, 'employment_type', 'full_time', null) === 'Full-time', 'the employment type reads as words')
const req = { requirements: [{ type: 'employment_record', extras: ['department'], note: 'two years in accounting' }] }
const answer = buildAnswer(req.requirements[0], record)
const names = disclosedNames(answer)
assert(names.includes('job_title') && names.includes('department') && !names.includes('role_description'),
  'a proof request sees the job, the dates and the requested department — not the unrequested role line')
const a = await checkAnswer(req, { requirement: 0, presentation: answer }, trust, () => none, now)
assert(a.kind === 'checked' && a.checked.issuer.kind === 'employer', 'the employer reviewing it sees it came from a registered employer')

console.log('\nwhen the job ends')
const ended = await issueSdJwt({ issuerDid: firmDid, signingKey: firmKey, kid: firmKid, jti: crypto.randomUUID(),
  subject: { ...job, employment_status: 'ended', employment_end: '2026-06-30' }, vct: 'https://actik.kh/credentials/employment_record' })
const rev = { list: await openRevocationList(await buildRevocationList({
  issuerDid: firmDid, previous: null, signingKey: firmKey, kid: firmKid, now,
  add: [{ jti: checked.assertion.jti, reason: 'corrected', revokedAt: now }],
}), { list, issuerDid: firmDid }), failure: null }
let w: unknown = null
try { await checkCredential(record, firmDid, trust, rev, now) } catch (e) { w = e }
assert(w instanceof CredentialWithdrawn && w.withdrawalReason === 'corrected',
  'the "current" record is withdrawn as replaced by a corrected one')
assert((await checkCredential(ended, firmDid, trust, rev, now)).standing.status === 'clear', 'and the corrected record stands')

console.log('\nALL TESTS PASSED')
