// Run with: npm run test:identity
//
// Identity verifiers, the third tier of the trust list, and the identity
// attestation they issue: a name as on the document, checked in person, bound
// to the person's wallet — and nothing else.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { importSigningKey, keyId, openTrustList, issuerMayIssue } from './src/lib/trustList.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { checkCredential, CredentialRefused } from './src/lib/credentialCheck.ts'
import { issueSdJwt, present } from './src/lib/sdjwt.ts'
import { issuePrintedCredential, PrintRefused } from './src/lib/printedCredential.ts'
import { holdIssuerKey } from './src/lib/issuerKeyStore.ts'
import { ALWAYS_REVEALED } from './src/lib/disclosure.ts'
import { buildBoundAnswer, checkAnswer, validateRequest, REQUESTABLE, disclosedNames } from './src/lib/proofRequest.ts'
import { buildExhibitPackage, ExportRefused } from './src/lib/museumExport.ts'
import {
  IDENTITY_VCT, identityClaims, IdentityInvalid, sameName, boundToOneWallet, claimsOutsideIdentity,
} from './src/lib/identity.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}
async function reason(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'ACCEPTED' } catch (e) { return (e as { reason?: string }).reason ?? 'THREW' }
}
function throws(fn: () => unknown, cls: new (...a: never[]) => Error): boolean {
  try { fn(); return false } catch (e) { return e instanceof cls }
}

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const iso = (t: number) => new Date(t * 1000).toISOString()
const root = await generateIssuerKeys(), office = await generateIssuerKeys(), uni = await generateIssuerKeys()
const officeDid = didWeb('id-desk.phnompenh.example'), uniDid = didWeb('num.edu.kh')
const rootKey = await importSigningKey(root.privateJwk)
const rootKid = await keyId(root.publicJwk)
const { document } = await buildTrustList({
  snapshot: [
    { did: officeDid, name: 'Phnom Penh ID Desk', accredited: true, kind: 'identity_verifier',
      keys: [{ public_jwk: office.publicJwk, created_at: iso(now - DAY) }] },
    { did: uniDid, name: 'National University of Management', accredited: true,
      keys: [{ public_jwk: uni.publicJwk, created_at: iso(now - DAY) }] },
  ],
  previousVersion: 0, rootKey, rootKid, now,
})
const list = await openTrustList(document, { roots: [root.publicJwk], now })
const trust = { list, failure: null }
const none = { list: null, failure: null }
const officeKey = await importSigningKey(office.privateJwk), officeKid = await keyId(office.publicJwk)
const uniKey = await importSigningKey(uni.privateJwk), uniKid = await keyId(uni.publicJwk)
const holder = await generateIssuerKeys(), stranger = await generateIssuerKeys()
const holderKey = await importSigningKey(holder.privateJwk), strangerKey = await importSigningKey(stranger.privateJwk)

console.log('the identity verifier tier')
assert(list.issuers.get(officeDid)?.kind === 'identity_verifier', 'the Root signs an identity verifier in as one')
assert(issuerMayIssue('identity_verifier', 'identity_attestation') && !issuerMayIssue('identity_verifier', 'academic_degree'),
  'an identity verifier may issue identity attestations, and nothing else')
assert(!issuerMayIssue('institution', 'identity_attestation') && issuerMayIssue('institution', 'academic_degree'),
  'an institution may issue everything except identity attestations — identity needs its own admission')
assert(!issuerMayIssue('employer', 'identity_attestation') && issuerMayIssue('employer', 'employment_record'),
  'an employer still only employment records')
assert(!issuerMayIssue(undefined, 'identity_attestation'), 'a list from before kinds existed admits no identity verifier')
let unknownKind: unknown = null
try {
  await buildTrustList({ snapshot: [{ did: officeDid, name: 'X', accredited: true, kind: 'identity',
    keys: [{ public_jwk: office.publicJwk, created_at: iso(now - DAY) }] }], previousVersion: 0, rootKey, rootKid, now })
} catch (e) { unknownKind = e }
assert(unknownKind instanceof Error, 'an unknown kind still stops the build')

console.log('\nwhat an identity attestation may say')
const input = {
  sub: 'user-1', name: '  Chan   Sopheak ', verifierName: 'Phnom Penh ID Desk', evidenceType: 'national_id_card',
  verifiedOn: new Date().toISOString().slice(0, 10), sawOriginalInPerson: true, holderPublicJwk: holder.publicJwk,
}
const claims = identityClaims(input)
assert(claims.name === 'Chan Sopheak' && claims.verification_level === 'in_person_document' && claims.evidence_type === 'national_id_card',
  'a name as on the document, the level and the evidence type')
assert(claimsOutsideIdentity(Object.keys(claims)).length === 0 && Object.keys(claims).length === 6,
  'and nothing else: no ID number, birth date, photo or note')
assert(throws(() => identityClaims({ ...input, holderPublicJwk: null }), IdentityInvalid), 'refused without a wallet key: nothing to bind to')
assert(throws(() => identityClaims({ ...input, sawOriginalInPerson: false }), IdentityInvalid), 'refused without the in-person confirmation')
assert(throws(() => identityClaims({ ...input, evidenceType: 'student_card' }), IdentityInvalid), 'refused for any other evidence')
assert(throws(() => identityClaims({ ...input, verifiedOn: '2999-01-01' }), IdentityInvalid), 'refused when dated in the future')

const attest = (opts: { bound?: boolean; extra?: Record<string, unknown>; signer?: 'office' | 'uni' } = {}) => {
  const signer = opts.signer ?? 'office'
  return issueSdJwt({
    issuerDid: signer === 'office' ? officeDid : uniDid, signingKey: signer === 'office' ? officeKey : uniKey,
    kid: signer === 'office' ? officeKid : uniKid, subject: { ...claims, ...(opts.extra ?? {}) },
    holderPublicJwk: opts.bound === false ? undefined : holder.publicJwk, vct: IDENTITY_VCT, expiresInSec: 5 * 365 * DAY,
  })
}
const identity = await attest()
const checked = await checkCredential(identity, officeDid, trust, none, now)
assert(checked.assertion.credentialType === 'identity_attestation' && checked.issuer.kind === 'identity_verifier',
  'a bound attestation from an identity verifier verifies, and says who checked')
assert((await reason(async () => checkCredential(await attest({ bound: false }), officeDid, trust, none, now))) === 'IDENTITY_NOT_BOUND',
  'an unbound attestation is refused')
let notBound: unknown = null
try { await checkCredential(await attest({ bound: false }), officeDid, trust, none, now) } catch (e) { notBound = e }
assert(notBound instanceof CredentialRefused && !notBound.unavailable, '…as a refusal, not a "could not check"')
assert((await reason(async () => checkCredential(await attest({ extra: { id_number: '010203040' } }), officeDid, trust, none, now)))
  === 'IDENTITY_CLAIM_NOT_ALLOWED', 'an attestation carrying an ID number is refused')
assert((await reason(async () => checkCredential(await attest({ extra: { birth_date: '2000-01-01' } }), officeDid, trust, none, now)))
  === 'IDENTITY_CLAIM_NOT_ALLOWED', '…and one carrying a birth date')
assert((await reason(async () => checkCredential(await attest({ signer: 'uni' }), uniDid, trust, none, now))) === 'TYPE_NOT_ALLOWED_FOR_ISSUER',
  'a university cannot issue an identity attestation')
const officeDegree = await issueSdJwt({ issuerDid: officeDid, signingKey: officeKey, kid: officeKid,
  subject: { name: 'Chan Sopheak', degree_type: 'MBA' }, vct: 'https://actik.kh/credentials/academic_degree' })
assert((await reason(() => checkCredential(officeDegree, officeDid, trust, none, now))) === 'TYPE_NOT_ALLOWED_FOR_ISSUER',
  'nor can an identity verifier issue a degree')

console.log('\nnever on paper, never in a museum')
const held = await holdIssuerKey(office.privateJwk, officeDid)
let printRefused: unknown = null
try {
  await issuePrintedCredential({ signingKey: held.key, publicJwk: held.publicJwk, claims: {
    issuer: officeDid, issuedAt: now, documentType: 'identity_attestation', documentId: 'X', subjectName: 'Chan Sopheak',
    issuingOrganisation: 'Phnom Penh ID Desk', issueDate: '2026-10-01' } })
} catch (e) { printRefused = e }
assert(printRefused instanceof PrintRefused, 'an identity check is never printed')
let museumRefused: unknown = null
try {
  await buildExhibitPackage({ issuerDid: officeDid, claims, credentialType: 'identity_attestation', jti: null,
    title: 'Identity', now, includePrinted: false } as Parameters<typeof buildExhibitPackage>[0])
} catch (e) { museumRefused = e }
assert(museumRefused instanceof ExportRefused, 'nor exported as a museum exhibit')

console.log('\nasked for in a proof request')
assert(REQUESTABLE.identity_attestation?.extras.length === 0, 'requestable, with no extras to ask for')
for (const f of ['verification_level', 'evidence_type', 'verified_on']) {
  assert(ALWAYS_REVEALED.includes(f), `every share of an attestation shows ${f}`)
}
const shown = present(identity, ALWAYS_REVEALED)
assert(!disclosedNames(shown).includes('sub') && disclosedNames(shown).includes('name'), 'a share shows the name, not the account id')
const req = validateRequest({ requesterName: 'Angkor Accounting Co.', title: 'Accountant', description: '', expiresInDays: 30,
  requirements: [{ type: 'academic_degree', extras: [], note: '' }, { type: 'identity_attestation', extras: [], note: '' }] })
const request = { id: '7d3f1c2a-1111-4222-8333-944455556666', requirements: req.requirements }
const degree = await issueSdJwt({ issuerDid: uniDid, signingKey: uniKey, kid: uniKid, holderPublicJwk: holder.publicJwk,
  subject: { name: 'Chan Sopheak', institution: 'National University of Management', degree_type: 'BBA',
    graduation_date: '2026-07-15', certificate_id: 'NUM-2026-BBA-0417' }, vct: 'https://actik.kh/credentials/academic_degree' })
const a0 = await checkAnswer(request, { requirement: 0, presentation: await buildBoundAnswer(request.requirements[0], degree, request.id, holderKey) }, trust, () => none, now)
const a1 = await checkAnswer(request, { requirement: 1, presentation: await buildBoundAnswer(request.requirements[1], identity, request.id, holderKey) }, trust, () => none, now)
assert(a0.kind === 'checked' && a1.kind === 'checked', 'a degree and an identity check, both answered from one wallet')
if (a0.kind !== 'checked' || a1.kind !== 'checked') throw new Error('unreachable')
const one = await boundToOneWallet([a0.checked, a1.checked])
assert(one.sameWallet && one.withIdentity, 'the reviewer is told the degree and the identity check are bound to the same wallet')
const otherDegree = await issueSdJwt({ issuerDid: uniDid, signingKey: uniKey, kid: uniKid, holderPublicJwk: stranger.publicJwk,
  subject: { name: 'Chan Sopheak', institution: 'National University of Management', degree_type: 'BBA' },
  vct: 'https://actik.kh/credentials/academic_degree' })
const a2 = await checkAnswer(request, { requirement: 0, presentation: await buildBoundAnswer(request.requirements[0], otherDegree, request.id, strangerKey) }, trust, () => none, now)
if (a2.kind !== 'checked') throw new Error('unreachable')
assert(!(await boundToOneWallet([a2.checked, a1.checked])).sameWallet, 'a degree from another wallet with the same name is not')
const unboundDegree = await issueSdJwt({ issuerDid: uniDid, signingKey: uniKey, kid: uniKid,
  subject: { name: 'Chan Sopheak', institution: 'National University of Management', degree_type: 'BBA' },
  vct: 'https://actik.kh/credentials/academic_degree' })
const a3 = await checkAnswer(request, { requirement: 0, presentation: await buildBoundAnswer(request.requirements[0], unboundDegree, request.id, null) }, trust, () => none, now)
if (a3.kind !== 'checked') throw new Error('unreachable')
assert(!(await boundToOneWallet([a3.checked, a1.checked])).sameWallet, 'nor is an unbound degree, whatever its name')
const copied = await checkAnswer({ ...request, id: '9e8d7c6b-1111-4222-8333-944455556666' },
  { requirement: 1, presentation: await buildBoundAnswer(request.requirements[1], identity, request.id, holderKey) }, trust, () => none, now)
assert(copied.kind === 'refused' && copied.reason === 'HOLDER_PROOF_WRONG_AUDIENCE', 'an identity check copied to another request is refused')

console.log('\nnames compared, never guessed')
assert(sameName('Chan  Sopheak', 'chan sopheak') && !sameName('Chan Sopheak', 'Chan Sophea') && !sameName('', ''),
  'case and spacing ignored; nothing fuzzy')

console.log('\nALL TESTS PASSED')
