// Run with: npm run test:recovery
//
// Key recovery: a holder whose wallet key is lost, compromised or replaced asks
// each issuer to reissue to the new key, proving continuity with the old key or
// with a fresh identity check; the issuer reissues the same claims and
// withdraws the old credential as corrected.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { importSigningKey, keyId, openTrustList } from './src/lib/trustList.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { checkCredential, CredentialWithdrawn } from './src/lib/credentialCheck.ts'
import { issueSdJwt, present } from './src/lib/sdjwt.ts'
import { ALWAYS_REVEALED } from './src/lib/disclosure.ts'
import { buildRevocationList, openRevocationList } from './src/lib/revocation.ts'
import { IDENTITY_VCT } from './src/lib/identity.ts'
import {
  buildReissueRequest, checkReissueRequest, reissuableClaims, reissueAudience, type ReissueRequestRow,
} from './src/lib/reissue.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const iso = (t: number) => new Date(t * 1000).toISOString()
const root = await generateIssuerKeys(), uni = await generateIssuerKeys(), desk = await generateIssuerKeys(), other = await generateIssuerKeys()
const uniDid = didWeb('num.edu.kh'), deskDid = didWeb('id-desk.example'), otherDid = didWeb('rupp.edu.kh')
const rootKey = await importSigningKey(root.privateJwk)
const { document } = await buildTrustList({
  snapshot: [
    { did: uniDid, name: 'National University of Management', accredited: true, keys: [{ public_jwk: uni.publicJwk, created_at: iso(now - DAY) }] },
    { did: otherDid, name: 'Royal University of Phnom Penh', accredited: true, keys: [{ public_jwk: other.publicJwk, created_at: iso(now - DAY) }] },
    { did: deskDid, name: 'Phnom Penh ID Desk', accredited: true, kind: 'identity_verifier', keys: [{ public_jwk: desk.publicJwk, created_at: iso(now - DAY) }] },
  ],
  previousVersion: 0, rootKey, rootKid: await keyId(root.publicJwk), now,
})
const list = await openTrustList(document, { roots: [root.publicJwk], now })
const trust = { list, failure: null }
const none = { list: null, failure: null }
const sign = async (k: typeof uni) => ({ key: await importSigningKey(k.privateJwk), kid: await keyId(k.publicJwk) })
const U = await sign(uni), D = await sign(desk), O = await sign(other)

// The holder's old key, their new key, and someone else's.
const oldK = await generateIssuerKeys(), newK = await generateIssuerKeys(), thief = await generateIssuerKeys()
const oldKey = await importSigningKey(oldK.privateJwk), newKey = await importSigningKey(newK.privateJwk), thiefKey = await importSigningKey(thief.privateJwk)
const newKid = await keyId(newK.publicJwk)

const degreeClaims = { sub: 'user-1', name: 'Chan Sopheak', institution: 'National University of Management', degree_type: 'BBA',
  major: 'Accounting', graduation_date: '2026-07-15', certificate_id: 'NUM-2026-BBA-0417', photo: 'data:image/jpeg;base64,AAAA' }
const degree = await issueSdJwt({ issuerDid: uniDid, signingKey: U.key, kid: U.kid, jti: crypto.randomUUID(),
  subject: degreeClaims, holderPublicJwk: oldK.publicJwk, vct: 'https://actik.kh/credentials/academic_degree', expiresInSec: 5 * 365 * DAY })
const identityFor = (jwk: typeof newK.publicJwk, name = 'Chan  Sopheak', signer = D, did = deskDid) => issueSdJwt({
  issuerDid: did, signingKey: signer.key, kid: signer.kid, holderPublicJwk: jwk, vct: IDENTITY_VCT,
  subject: { sub: 'user-1', name, institution: 'Phnom Penh ID Desk', verification_level: 'in_person_document',
    evidence_type: 'national_id_card', verified_on: new Date().toISOString().slice(0, 10) } })

const ctx = { issuerDid: uniDid, trust, revocationsFor: () => none, now }
const row = (draft: { proof: 'old_key' | 'identity'; credential: string | null; identity: string | null }, jwk = newK.publicJwk): ReissueRequestRow =>
  ({ id: crypto.randomUUID(), issuer_did: uniDid, recipient_email: 'sopheak@example.com', new_holder_jwk: jwk, created_at: iso(now), ...draft })

console.log('continuity by the old key (replaced, still available)')
const byOldKey = await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'old_key', credential: degree, oldKey })
const ready = await checkReissueRequest(row(byOldKey), ctx)
assert(ready.kind === 'ready' && ready.proof === 'old_key' && ready.newKid === newKid, 'the old key’s proof, made for this issuer and the new key, is accepted')
if (ready.kind !== 'ready') throw new Error('unreachable')
assert(JSON.stringify(ready.claims) === JSON.stringify(degreeClaims), 'the same claims are reissued, photo included; iss, iat and exp are set afresh')
assert(!Object.keys(reissuableClaims(degree)).some((k) => ['iss', 'iat', 'exp'].includes(k)), 'no registered claim is copied')
const swapped = await checkReissueRequest(row(byOldKey, thief.publicJwk), ctx)
assert(swapped.kind === 'refused' && swapped.reason === 'REISSUE_OLD_KEY_PROOF', 'the proof cannot be redirected to someone else’s key')
const forged = await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'old_key', credential: degree, oldKey: thiefKey })
const forgedCheck = await checkReissueRequest(row(forged), ctx)
assert(forgedCheck.kind === 'refused' && forgedCheck.reason === 'REISSUE_OLD_KEY_PROOF', 'a copy of the credential proven by any other key is refused')
const toOther = await checkReissueRequest(row(byOldKey), { ...ctx, issuerDid: otherDid })
assert(toOther.kind === 'refused' && toOther.reason === 'REISSUE_NOT_YOUR_CREDENTIAL', 'an issuer cannot reissue another issuer’s credential')
const sameKey = await buildReissueRequest({ issuerDid: uniDid, newKid: await keyId(oldK.publicJwk), proof: 'old_key', credential: degree, oldKey })
const same = await checkReissueRequest(row(sameKey, oldK.publicJwk), ctx)
assert(same.kind === 'refused' && same.reason === 'REISSUE_SAME_KEY', 'nothing is reissued to the key it is already bound to')
const unboundDegree = await issueSdJwt({ issuerDid: uniDid, signingKey: U.key, kid: U.kid, subject: degreeClaims, vct: 'https://actik.kh/credentials/academic_degree' })
const ub = await checkReissueRequest(row(await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'old_key', credential: unboundDegree, oldKey })), ctx)
assert(ub.kind === 'refused' && ub.reason === 'REISSUE_NOT_BOUND', 'an unbound credential has no old key to prove with: identity check instead')

console.log('\nthe issuer reissues, and withdraws the old one as corrected')
const jti2 = crypto.randomUUID()
const reissued = await issueSdJwt({ issuerDid: uniDid, signingKey: U.key, kid: U.kid, jti: jti2, subject: ready.claims,
  holderPublicJwk: ready.newHolderJwk, vct: 'https://actik.kh/credentials/academic_degree', expiresInSec: 5 * 365 * DAY })
const rev = { list: await openRevocationList(await buildRevocationList({ issuerDid: uniDid, previous: null, signingKey: U.key, kid: U.kid, now,
  add: [{ jti: ready.old.assertion.jti, reason: 'corrected', revokedAt: now }] }), { list, issuerDid: uniDid }), failure: null }
let w: unknown = null
try { await checkCredential(degree, uniDid, trust, rev, now) } catch (e) { w = e }
assert(w instanceof CredentialWithdrawn && w.withdrawalReason === 'corrected', 'the old credential no longer verifies: replaced by a corrected one')
const fresh = await checkCredential(reissued, uniDid, trust, rev, now)
assert(fresh.standing.status === 'clear' && (await keyId(fresh.assertion.holderKey!)) === newKid, 'the reissued one stands, bound to the new key')
const again = await checkReissueRequest(row(byOldKey), { ...ctx, revocationsFor: () => rev })
assert(again.kind === 'refused' && again.reason === 'CREDENTIAL_REVOKED', 'the same request cannot be used twice')

console.log('\ncase A: PIN forgotten, wallet reset, credential lost with it')
const newIdentity = await identityFor(newK.publicJwk)
const lost = await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'identity', identity: newIdentity, newKey })
const needs = await checkReissueRequest(row(lost), ctx)
assert(needs.kind === 'needs_records' && needs.identity.name === 'Chan  Sopheak' && needs.identity.verifier === 'Phnom Penh ID Desk',
  'a fresh identity check bound to the new key is accepted; the issuer finds the credential in its own records')

console.log('\ncase B: wallet compromised, credential still held')
const compromised = await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'identity', identity: newIdentity, newKey, credential: degree })
const b = await checkReissueRequest(row(compromised), ctx)
assert(b.kind === 'ready' && b.proof === 'identity' && b.identity?.verifier === 'Phnom Penh ID Desk',
  'the identity check and the credential’s name match: ready to reissue the same claims')
const otherName = await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'identity', identity: await identityFor(newK.publicJwk, 'Chan Sophea'), newKey, credential: degree })
const nm = await checkReissueRequest(row(otherName), ctx)
assert(nm.kind === 'refused' && nm.reason === 'REISSUE_NAME_MISMATCH', 'a different name on the identity check is refused')
const thiefId = await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'identity', identity: await identityFor(thief.publicJwk), newKey: thiefKey, credential: degree })
const ti = await checkReissueRequest(row(thiefId), ctx)
assert(ti.kind === 'refused' && ti.reason === 'REISSUE_IDENTITY_OTHER_KEY', 'an identity check bound to another key cannot move credentials to the new key')
const unprovenId = { proof: 'identity' as const, credential: degree, identity: present(newIdentity, ALWAYS_REVEALED) }
const up = await checkReissueRequest(row(unprovenId), ctx)
assert(up.kind === 'refused' && up.reason === 'HOLDER_PROOF_MISSING', 'an identity check without the new key’s proof is refused')
const replayedId = await buildReissueRequest({ issuerDid: otherDid, newKid, proof: 'identity', identity: newIdentity, newKey, credential: null })
const rp = await checkReissueRequest(row(replayedId), ctx)
assert(rp.kind === 'refused' && rp.reason === 'HOLDER_PROOF_WRONG_AUDIENCE', 'one made for another issuer is refused')
const uniIdentity = await identityFor(newK.publicJwk, 'Chan Sopheak', O, otherDid)
const fromUni = await checkReissueRequest(row(await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'identity', identity: uniIdentity, newKey })), ctx)
assert(fromUni.kind === 'refused' && fromUni.reason === 'TYPE_NOT_ALLOWED_FOR_ISSUER', 'an "identity check" from a university is not one')
const job = await issueSdJwt({ issuerDid: otherDid, signingKey: O.key, kid: O.kid, holderPublicJwk: newK.publicJwk,
  subject: { name: 'Chan Sopheak', job_title: 'Lecturer' }, vct: 'https://actik.kh/credentials/employment_record' })
const notId = await checkReissueRequest(row(await buildReissueRequest({ issuerDid: uniDid, newKid, proof: 'identity', identity: job, newKey })), ctx)
assert(notId.kind === 'refused' && notId.reason === 'REISSUE_NOT_IDENTITY', 'any other credential sent as the identity check is refused')
assert(reissueAudience(uniDid, newKid).includes(uniDid) && reissueAudience(uniDid, newKid).endsWith(newKid), 'the audience names the issuer and the new key')

console.log('\nALL TESTS PASSED')
