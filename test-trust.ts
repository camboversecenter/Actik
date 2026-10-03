// Run with: npm run test:trust
//
// The trust layer: a Root-signed list of accredited issuers and their keys,
// and issuer-signed lists of withdrawn credentials. Each case below is a way
// the database-as-trust-root used to fail open.
import type { JWK } from 'jose'
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { issueSdJwt, present } from './src/lib/sdjwt.ts'
import {
  openTrustList, importSigningKey, keyId, signStatement, TrustRejected,
  type OpenedTrustList, type SignedDocument,
} from './src/lib/trustList.ts'
import { buildTrustList, type IssuerSnapshot } from './src/lib/trustListBuild.ts'
import {
  openRevocationList, buildRevocationList, RevocationRejected, type OpenedRevocations,
} from './src/lib/revocation.ts'
import {
  checkCredential, CredentialRefused, CredentialWithdrawn,
  type RevocationState, type TrustState,
} from './src/lib/credentialCheck.ts'
import { ALWAYS_REVEALED } from './src/lib/disclosure.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}

async function reason(fn: () => Promise<unknown>): Promise<string> {
  try { await fn() } catch (e) {
    const r = (e as { reason?: string }).reason
    return r ?? 'THREW:' + (e as Error).message
  }
  return 'NO_REJECTION'
}

const DAY = 24 * 60 * 60
const now = Math.floor(Date.now() / 1000)
const iso = (t: number) => new Date(t * 1000).toISOString()

// --- the Root, offline ------------------------------------------------------
const root = await generateIssuerKeys()
const rootKey = await importSigningKey(root.privateJwk)
const rootKid = await keyId(root.publicJwk)
const roots: JWK[] = [root.publicJwk]

// --- NUM, with a key rotated 10 days ago ------------------------------------
const numDid = didWeb('num.edu.kh')
const numOld = await generateIssuerKeys()
const numNew = await generateIssuerKeys()
const rotatedAt = now - 10 * DAY

const snapshot: IssuerSnapshot[] = [
  {
    did: numDid, name: 'National University of Management', domain: 'num.edu.kh', accredited: true,
    keys: [
      { public_jwk: numOld.publicJwk, created_at: iso(now - 400 * DAY), retired_at: iso(rotatedAt) },
      { public_jwk: numNew.publicJwk, created_at: iso(rotatedAt) },
    ],
  },
  // approved in the dashboard, never accredited: must not appear
  { did: didWeb('pending.edu.kh'), name: 'Pending', accredited: false,
    keys: [{ public_jwk: (await generateIssuerKeys()).publicJwk, created_at: iso(now - DAY) }] },
]

const { document: listDoc } = await buildTrustList({ snapshot, previousVersion: 6, rootKey, rootKid, now })

console.log('trust list')
const list = await openTrustList(listDoc, { roots, now })
assert(list.version === 7, 'a genuine list opens, version bumped from the previous one')
assert(list.issuers.has(numDid) && list.issuers.size === 1, 'only accredited issuers are listed')

assert((await reason(() => openTrustList(listDoc, { roots: [], now }))) === 'TRUSTLIST_NO_ROOT_CONFIGURED',
  'a build with no pinned Root verifies nothing')

const impostorRoot = await generateIssuerKeys()
const { document: impostorList } = await buildTrustList({
  snapshot, previousVersion: 99, rootKey: await importSigningKey(impostorRoot.privateJwk),
  rootKid: await keyId(impostorRoot.publicJwk), now,
})
assert((await reason(() => openTrustList(impostorList, { roots, now }))) === 'TRUSTLIST_UNKNOWN_ROOT',
  'a list signed by any other key is refused — the database cannot mint its own Root')

// The attack the old design could not stop: someone with database access adds
// their own institution. Now they can only edit the statement, which breaks
// the signature.
const tampered = JSON.parse(listDoc.statement)
tampered.issuers.push({ did: didWeb('fake-uni.example'), name: 'Fake University', domain: null,
  keys: [{ kid: 'x', jwk: (await generateIssuerKeys()).publicJwk, status: 'active', notBefore: 0, notAfter: now + DAY }] })
assert((await reason(() => openTrustList({ ...listDoc, statement: JSON.stringify(tampered) }, { roots, now })))
  === 'TRUSTLIST_SIGNATURE_INVALID', 'adding an issuer to a signed list breaks its signature')

assert((await reason(() => openTrustList(listDoc, { roots, now: now + 31 * DAY }))) === 'TRUSTLIST_EXPIRED',
  'an expired list is refused')
const longList = await signStatement(
  { ...JSON.parse(listDoc.statement), expires: now + 400 * DAY }, rootKey, rootKid)
assert((await reason(() => openTrustList(longList, { roots, now }))) === 'TRUSTLIST_VALIDITY_TOO_LONG',
  'a list valid for more than 31 days is refused, even from the real Root')
assert((await reason(() => openTrustList(listDoc, { roots, now, held: { version: 8, digest: 'x' } })))
  === 'TRUSTLIST_ROLLBACK', 'an older list than this verifier has seen is refused')
assert((await reason(() => openTrustList(listDoc, { roots, now, held: { version: 7, digest: 'other' } })))
  === 'TRUSTLIST_VERSION_CONFLICT', 'two different lists with the same version are refused')

// --- credentials ------------------------------------------------------------
const trust: TrustState = { list, failure: null }
const noRevocations: RevocationState = { list: null, failure: null }
const subject = {
  name: 'Chan Sopheak', institution: 'National University of Management',
  degree_type: 'Bachelor of Business Administration', graduation_date: '2026-07-15',
  certificate_id: 'NUM-2026-BBA-0417', student_id: 'NUM-21-0417',
}
async function issue(key: { privateJwk: JWK; publicJwk: JWK }, opts: { kid?: boolean; iatShift?: number; extra?: object } = {}) {
  const realNow = Date.now
  if (opts.iatShift) Date.now = () => realNow() + opts.iatShift! * 1000
  try {
    return await issueSdJwt({
      issuerDid: numDid, signingKey: await importSigningKey(key.privateJwk),
      kid: opts.kid === false ? undefined : await keyId(key.publicJwk),
      subject: { ...subject, ...(opts.extra ?? {}) }, vct: 'https://actik.kh/credentials/academic_degree',
      expiresInSec: 5 * 365 * DAY,
    })
  } finally { Date.now = realNow }
}

console.log('\ncredentials')
const fresh = await issue(numNew)
const ok = await checkCredential(fresh, numDid, trust, noRevocations, now)
assert(ok.key.status === 'active' && ok.assertion.jti !== null, 'a credential from the active key verifies and carries a jti')
assert(ok.standing.status === 'unchecked', 'with no withdrawal list published, standing is unchecked — not clear')

const beforeRotation = await issue(numOld, { iatShift: -30 * DAY })
assert((await checkCredential(beforeRotation, numDid, trust, noRevocations, now)).key.status === 'retired',
  'a key rotation no longer strands what the old key signed before it was retired')
const afterRotation = await issue(numOld, { iatShift: -1 * DAY })
assert((await reason(() => checkCredential(afterRotation, numDid, trust, noRevocations, now)))
  === 'KEY_NOT_VALID_AT_ISSUANCE', 'the retired key cannot sign anything dated after its retirement')

const legacy = await issue(numNew, { kid: false })
assert((await checkCredential(legacy, numDid, trust, noRevocations, now)).key.status === 'active',
  'a credential issued before kids existed is matched by trying the listed keys')

const stranger = await generateIssuerKeys()
const forged = await issueSdJwt({
  issuerDid: numDid, issuerPrivateJwk: stranger.privateJwk, kid: await keyId(numNew.publicJwk),
  subject, vct: 'x', expiresInSec: 3600,
})
assert((await reason(() => checkCredential(forged, numDid, trust, noRevocations, now))) === 'SIGNATURE_INVALID',
  "a forgery that borrows NUM's kid still fails the signature")
const unknownKid = await issueSdJwt({
  issuerDid: numDid, issuerPrivateJwk: stranger.privateJwk, kid: await keyId(stranger.publicJwk),
  subject, vct: 'x', expiresInSec: 3600,
})
assert((await reason(() => checkCredential(unknownKid, numDid, trust, noRevocations, now))) === 'KEY_UNKNOWN',
  'a key the Root never listed for NUM is refused')

const fakeDid = didWeb('fake-uni.example')
const fake = await issueSdJwt({ issuerDid: fakeDid, issuerPrivateJwk: stranger.privateJwk, subject, vct: 'x', expiresInSec: 3600 })
assert((await reason(() => checkCredential(fake, fakeDid, trust, noRevocations, now))) === 'ISSUER_NOT_LISTED',
  'an institution accredited only in the database is not trusted')

const missing = await reason(() => checkCredential(fresh, numDid, { list: null, failure: 'TRUSTLIST_EXPIRED' }, noRevocations, now))
let unavailable = false
try { await checkCredential(fresh, numDid, { list: null, failure: 'TRUSTLIST_EXPIRED' }, noRevocations, now) }
catch (e) { unavailable = (e as CredentialRefused).unavailable }
assert(missing === 'TRUSTLIST_EXPIRED' && unavailable,
  'no usable list means "could not check" — never a verdict on the credential')

const compromised = await buildTrustList({
  snapshot: [{ ...snapshot[0], keys: [
    { public_jwk: numOld.publicJwk, created_at: iso(now - 400 * DAY), retired_at: iso(rotatedAt) },
    { public_jwk: numNew.publicJwk, created_at: iso(rotatedAt), revoked_at: iso(now - DAY) },
  ] }], previousVersion: 7, rootKey, rootKid, now,
})
const compromisedList = await openTrustList(compromised.document, { roots, now })
assert((await reason(() => checkCredential(fresh, numDid, { list: compromisedList, failure: null }, noRevocations, now)))
  === 'KEY_REVOKED', 'a revoked key vouches for nothing, whatever the date on the credential')

// --- withdrawal -------------------------------------------------------------
console.log('\nwithdrawal')
const numNewKey = await importSigningKey(numNew.privateJwk)
const numNewKid = await keyId(numNew.publicJwk)
const withdrawn = await issue(numNew, { extra: { certificate_id: 'NUM-2026-BBA-0999' } })
const withdrawnJti = (await checkCredential(withdrawn, numDid, trust, noRevocations, now)).assertion.jti!

const rev1 = await buildRevocationList({
  issuerDid: numDid, previous: null, signingKey: numNewKey, kid: numNewKid, now,
  add: [{ jti: withdrawnJti, reason: 'Degree rescinded by the academic board', revokedAt: now }],
})
const opened1 = await openRevocationList(rev1, { list, issuerDid: numDid })
const revs1: RevocationState = { list: opened1, failure: null }

let w: CredentialWithdrawn | null = null
try { await checkCredential(withdrawn, numDid, trust, revs1, now) } catch (e) { w = e as CredentialWithdrawn }
assert(w?.reason === 'CREDENTIAL_REVOKED' && w.withdrawalReason === 'Degree rescinded by the academic board',
  'a withdrawn credential is refused, and the refusal says the institution withdrew it and why')
assert(!w!.unavailable, 'a withdrawal is a verdict, not a "could not check"')

const cleared = await checkCredential(fresh, numDid, trust, revs1, now)
assert(cleared.standing.status === 'clear' && cleared.standing.listVersion === 1,
  'a credential not on the list is clear, with the list version it was checked against')

// Withdraw by the number on the paper — for credentials issued before jtis.
const rev2 = await buildRevocationList({
  issuerDid: numDid, previous: opened1, signingKey: numNewKey, kid: numNewKid, now,
  add: [{ documentId: 'NUM-2026-BBA-0417', reason: 'Issued with the wrong graduation date', revokedAt: now }],
})
const revs2: RevocationState = { list: await openRevocationList(rev2, { list, issuerDid: numDid }), failure: null }
assert((await reason(() => checkCredential(legacy, numDid, trust, revs2, now))) === 'CREDENTIAL_REVOKED',
  'a credential can be withdrawn by its printed document number')
const sameStudentOtherDoc = await issue(numNew, { extra: { certificate_id: 'NUM-2026-TRN-0417' } })
assert((await checkCredential(sameStudentOtherDoc, numDid, trust, revs2, now)).standing.status === 'clear',
  "withdrawing one document does not withdraw the student's others")

// A shared presentation carries what the check needs.
// (`fresh` carries certificate_id NUM-2026-BBA-0417 too, so rev2 rightly
// withdraws it as well; use a credential with its own number.)
const shared = present(sameStudentOtherDoc, ALWAYS_REVEALED)
assert((await checkCredential(shared, numDid, trust, revs2, now)).standing.status === 'clear',
  'a default share can be checked against the withdrawal list')
assert((await reason(() => checkCredential(present(legacy, ALWAYS_REVEALED), numDid, trust, revs2, now)))
  === 'CREDENTIAL_REVOKED', 'a default share of a withdrawn credential is refused')

// The trust list itself would have expired by then; check the revocation
// logic on its own.
const { credentialStatus } = await import('./src/lib/revocation.ts')
const otherDoc = (await checkCredential(sameStudentOtherDoc, numDid, trust, noRevocations, now)).assertion
const lapsedStatus = credentialStatus(otherDoc, revs2.list, now + 40 * DAY)
assert(lapsedStatus.status === 'unchecked' && lapsedStatus.why === 'expired',
  'a lapsed withdrawal list makes standing unchecked, not clear')
assert(credentialStatus((await checkCredential(withdrawn, numDid, trust, noRevocations, now)).assertion, revs2.list, now + 40 * DAY).status === 'revoked',
  'but a credential on a lapsed list is still withdrawn')

console.log('\nwithdrawal lists that must not be believed')
const strangerKey = await importSigningKey(stranger.privateJwk)
const strangerList = await buildRevocationList({
  issuerDid: numDid, previous: null, signingKey: strangerKey, kid: await keyId(stranger.publicJwk), now, add: [],
})
assert((await reason(() => openRevocationList(strangerList, { list, issuerDid: numDid }))) === 'REVOCATIONS_KEY_NOT_ACCEPTED',
  "a list signed by a key the Root did not list for NUM is refused")
const spoofed: SignedDocument = { ...strangerList, signature: { ...strangerList.signature, kid: numNewKid } }
assert((await reason(() => openRevocationList(spoofed, { list, issuerDid: numDid }))) === 'REVOCATIONS_SIGNATURE_INVALID',
  "…and borrowing NUM's kid does not help")
assert((await reason(() => openRevocationList(rev1, { list, issuerDid: fakeDid }))) === 'REVOCATIONS_WRONG_ISSUER',
  "NUM's list cannot be replayed as another institution's")
assert((await reason(() => openRevocationList(rev1, { list, issuerDid: numDid, held: { version: 2, digest: 'x' } })))
  === 'REVOCATIONS_ROLLBACK', 'an older withdrawal list than this verifier has seen is refused — a withdrawal cannot be quietly undone')
const failState: RevocationState = { list: null, failure: 'REVOCATIONS_ROLLBACK' }
let failUnavailable = false
try { await checkCredential(fresh, numDid, trust, failState, now) } catch (e) { failUnavailable = (e as CredentialRefused).unavailable }
assert(failUnavailable, 'a withdrawal list that will not open means "could not check"')
void (null as unknown as OpenedTrustList | OpenedRevocations | TrustRejected | RevocationRejected)

// --- the issuer's key in the browser ---------------------------------------
console.log('\nissuer key custody')
const { holdIssuerKey, getIssuerKey, forgetIssuerKey } = await import('./src/lib/issuerKeyStore.ts')
const held = await holdIssuerKey(numNew.privateJwk, numDid)
assert(held.key.extractable === false, 'the held signing key is non-extractable')
let exported = true
try { await crypto.subtle.exportKey('jwk', held.key) } catch { exported = false }
assert(!exported, 'script on the page can use the key but cannot read it back out')
assert(held.kid === numNewKid, 'the held key carries the kid the trust list knows it by')
const signedByHeld = await issueSdJwt({
  issuerDid: numDid, signingKey: held.key, kid: held.kid, subject, vct: 'x', expiresInSec: 3600,
})
assert((await checkCredential(signedByHeld, numDid, trust, noRevocations, now)).key.kid === numNewKid,
  'a credential signed with the held key verifies against the signed list')
forgetIssuerKey()
assert(getIssuerKey() === null, 'signing out forgets the key')

console.log('\nALL TESTS PASSED')
