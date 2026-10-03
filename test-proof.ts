// Run with: npm run test:proof
//
// Proof requests (src/lib/proofRequest.ts): what an employer can ask for, what a
// candidate's answer discloses, and how an answer is checked.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { importSigningKey, keyId, openTrustList } from './src/lib/trustList.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { buildRevocationList, openRevocationList } from './src/lib/revocation.ts'
import { issueSdJwt, present } from './src/lib/sdjwt.ts'
import {
  REQUESTABLE, validateRequest, allowedClaims, buildAnswer, checkAnswer, disclosedNames, claimedType,
  ProofRequestInvalid, AnswerRefused, type Requirement, type ProofRequestDraft,
} from './src/lib/proofRequest.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}
function problem(fn: () => unknown): string | null {
  try { fn(); return null } catch (e) { return e instanceof ProofRequestInvalid ? e.problem : 'THREW' }
}

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const numDid = didWeb('num.edu.kh')
const root = await generateIssuerKeys()
const num = await generateIssuerKeys()
const { document } = await buildTrustList({
  snapshot: [{ did: numDid, name: 'National University of Management', accredited: true,
    keys: [{ public_jwk: num.publicJwk, created_at: new Date((now - DAY) * 1000).toISOString() }] }],
  previousVersion: 0, rootKey: await importSigningKey(root.privateJwk), rootKid: await keyId(root.publicJwk), now,
})
const list = await openTrustList(document, { roots: [root.publicJwk], now })
const trust = { list, failure: null }
const numKey = await importSigningKey(num.privateJwk)
const kid = await keyId(num.publicJwk)
const issue = (type: string, subject: Record<string, unknown>) => issueSdJwt({
  issuerDid: numDid, signingKey: numKey, kid, subject, vct: `https://actik.kh/credentials/${type}`, expiresInSec: 5 * 365 * DAY,
})
const degree = await issue('academic_degree', {
  name: 'Chan Sopheak', institution: 'National University of Management', degree_type: 'Bachelor of Business Administration',
  major: 'Accounting', gpa: '3.6', graduation_date: '2026-07-15', certificate_id: 'NUM-2026-BBA-0417',
  student_id: 'NUM-S-20220417', national_id: '010203040', date_of_birth: '2004-01-01', email: 'sopheak@example.com',
  photo: 'data:image/png;base64,AAAA',
})
const licence = await issue('professional_certification', {
  name: 'Chan Sopheak', institution: 'National University of Management', cert_name: 'Certified Accounting Technician',
  issuing_body: 'National University of Management', date_certified: '2026-08-01', license_number: 'CAT-0042',
})
const withdrawnDegree = await issue('academic_degree', {
  name: 'Keo Dara', institution: 'National University of Management', degree_type: 'Bachelor of Arts',
  graduation_date: '2025-07-15', certificate_id: 'NUM-2025-BA-0999',
})
const revocations = { list: await openRevocationList(await buildRevocationList({
  issuerDid: numDid, previous: null, signingKey: numKey, kid, now,
  add: [{ documentId: 'NUM-2025-BA-0999', reason: 'withdrawn', revokedAt: now }],
}), { list, issuerDid: numDid }), failure: null }
const revFor = () => revocations

console.log('what a request can ask for')
const banned = ['national_id', 'student_id', 'date_of_birth', 'birth_date', 'photo', 'email', 'gender', 'sex',
  'marital_status', 'place_of_birth', 'religion', 'age', 'phone', 'sub']
for (const type of Object.keys(REQUESTABLE)) {
  const all = allowedClaims({ type, extras: REQUESTABLE[type].extras, note: '' })
  assert(!banned.some((b) => all.includes(b)), `${type}: no requestable field is personal or discriminatory`)
}
const draft: ProofRequestDraft = {
  requesterName: 'Angkor Accounting Co.', title: 'Junior accountant', description: 'Phnom Penh office.',
  requirements: [{ type: 'academic_degree', extras: ['major'], note: 'in accounting or finance' },
    { type: 'professional_certification', extras: [], note: '' }],
  expiresInDays: 30,
}
assert(validateRequest(draft).requirements.length === 2, 'a sensible request is accepted')
for (const f of ['national_id', 'student_id', 'photo', 'date_of_birth', 'email']) {
  assert(problem(() => validateRequest({ ...draft, requirements: [{ type: 'academic_degree', extras: [f], note: '' }] }))
    === 'FIELD_NOT_REQUESTABLE', `asking for ${f} is refused`)
}
assert(problem(() => validateRequest({ ...draft, requirements: [{ type: 'passport', extras: [], note: '' }] })) === 'UNKNOWN_TYPE',
  'an unknown credential type is refused')
assert(problem(() => validateRequest({ ...draft, requirements: [] })) === 'NO_REQUIREMENTS', 'a request must ask for something')
assert(problem(() => validateRequest({ ...draft, requirements: Array(6).fill(draft.requirements[1]) })) === 'TOO_MANY_REQUIREMENTS',
  'at most five requirements')
assert(problem(() => validateRequest({ ...draft, expiresInDays: 91 })) === 'EXPIRY', 'a request lasts at most 90 days')
assert(problem(() => validateRequest({ ...draft, title: ' ' })) === 'TITLE', 'a request needs a title')

console.log('\nwhat a candidate discloses')
const wantDegree: Requirement = { type: 'academic_degree', extras: ['major'], note: '' }
const answer = buildAnswer(wantDegree, degree)
const names = disclosedNames(answer)
assert(['name', 'institution', 'degree_type', 'graduation_date', 'certificate_id', 'major'].every((n) => names.includes(n)),
  'the answer carries the name, institution, degree, date, document number and the requested major')
assert(!['photo', 'student_id', 'national_id', 'date_of_birth', 'email', 'gpa'].some((n) => names.includes(n)),
  'and nothing else: no photo, student number, national ID, birth date, email or unrequested GPA')
assert(disclosedNames(buildAnswer({ ...wantDegree, extras: ['major', 'gpa'] }, degree)).includes('gpa'), 'GPA only when asked')
let wrong: unknown = null
try { buildAnswer(wantDegree, licence) } catch (e) { wrong = e }
assert(wrong instanceof AnswerRefused, 'a credential of the wrong kind is not sent')
assert(claimedType(degree) === 'academic_degree', 'the type is read from the credential')

console.log('\nchecking an answer')
const request = { requirements: [wantDegree, { type: 'professional_certification', extras: [], note: '' }] }
const ok = await checkAnswer(request, { requirement: 0, presentation: answer }, trust, revFor, now)
assert(ok.kind === 'checked' && ok.checked.issuer.name === 'National University of Management',
  'a genuine answer is checked, and names the institution from the signed trust list')
assert(ok.kind === 'checked' && ok.checked.standing.status === 'clear', "…with its standing against the institution's withdrawal list")
assert(ok.kind === 'checked' && ok.fields.some(([k, v]) => k === 'major' && v === 'Accounting') &&
  !ok.fields.some(([k]) => ['iss', 'iat', 'exp'].includes(k)), 'the employer sees the allowed fields only')
assert(!JSON.stringify(Object.keys(ok)).match(/valid|verified|ok"/i), 'the result is fields, not a yes/no')
const lic = await checkAnswer(request, { requirement: 1, presentation: buildAnswer(request.requirements[1], licence) }, trust, revFor, now)
assert(lic.kind === 'checked', 'a professional certification answers its requirement')

const overShared = present(degree, ['name', 'institution', 'degree_type', 'national_id'])
const over = await checkAnswer(request, { requirement: 0, presentation: overShared }, trust, revFor, now)
assert(over.kind === 'not_asked' && over.reason === 'OVER_DISCLOSED', 'an answer that discloses more than allowed is not shown at all')
const licAsDegree = present(licence, allowedClaims(wantDegree))
const wrongType = await checkAnswer(request, { requirement: 0, presentation: licAsDegree }, trust, revFor, now)
assert(wrongType.kind === 'not_asked' && wrongType.reason === 'WRONG_TYPE', 'a certification offered as a degree does not count')
const gone = await checkAnswer(request, { requirement: 0, presentation: buildAnswer(wantDegree, withdrawnDegree) }, trust, revFor, now)
assert(gone.kind === 'refused' && gone.withdrawn && !gone.unavailable, 'a withdrawn degree is refused as withdrawn')
const parts = answer.split('~')
const tampered = [parts[0], ...parts.slice(1, -1).map((d, i) => (i === 0 ? d.slice(0, -2) + 'AA' : d)), ''].join('~')
const bad = await checkAnswer(request, { requirement: 0, presentation: tampered }, trust, revFor, now)
assert(bad.kind === 'refused' || bad.kind === 'not_asked', 'a tampered answer is refused')
const noTrust = await checkAnswer(request, { requirement: 0, presentation: answer }, { list: null, failure: 'TRUSTLIST_EXPIRED' }, revFor, now)
assert(noTrust.kind === 'refused' && noTrust.unavailable, 'with no usable trust list the answer is "could not check", not a refusal of the candidate')
const missing = await checkAnswer(request, { requirement: 7, presentation: answer }, trust, revFor, now)
assert(missing.kind === 'not_asked' && missing.reason === 'NO_SUCH_REQUIREMENT', 'an answer to a requirement that does not exist is ignored')

console.log('\nALL TESTS PASSED')
