// Run with: npm run test:contacts
//
// Verified contacts: a first link made in person or with a card carrying a
// bound identity check, then "is it really you, right now?" answered by a
// signature from the other person's wallet key.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { importSigningKey, keyId, openTrustList } from './src/lib/trustList.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { issueSdJwt } from './src/lib/sdjwt.ts'
import { IDENTITY_VCT } from './src/lib/identity.ts'
import { buildRevocationList, openRevocationList } from './src/lib/revocation.ts'
import {
  makeContactCard, openContactCard, signPresence, verifyPresence, ContactRefused, PresenceRefused,
  CONTACT_CARD_PREFIX, PRESENCE_MAX_AGE_SECONDS,
} from './src/lib/contacts.ts'

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
const root = await generateIssuerKeys(), desk = await generateIssuerKeys(), uni = await generateIssuerKeys()
const deskDid = didWeb('id-desk.example'), uniDid = didWeb('num.edu.kh')
const { document } = await buildTrustList({
  snapshot: [
    { did: deskDid, name: 'Phnom Penh ID Desk', accredited: true, kind: 'identity_verifier', keys: [{ public_jwk: desk.publicJwk, created_at: iso(now - DAY) }] },
    { did: uniDid, name: 'National University of Management', accredited: true, keys: [{ public_jwk: uni.publicJwk, created_at: iso(now - DAY) }] },
  ],
  previousVersion: 0, rootKey: await importSigningKey(root.privateJwk), rootKid: await keyId(root.publicJwk), now,
})
const list = await openTrustList(document, { roots: [root.publicJwk], now })
const ctx = { trust: { list, failure: null }, revocationsFor: () => ({ list: null, failure: null }), now }
const D = { key: await importSigningKey(desk.privateJwk), kid: await keyId(desk.publicJwk) }
const U = { key: await importSigningKey(uni.privateJwk), kid: await keyId(uni.publicJwk) }

const a = await generateIssuerKeys(), b = await generateIssuerKeys(), mallory = await generateIssuerKeys()
const A = { key: await importSigningKey(a.privateJwk), kid: await keyId(a.publicJwk), jwk: a.publicJwk }
const B = { key: await importSigningKey(b.privateJwk), kid: await keyId(b.publicJwk), jwk: b.publicJwk }
const M = { key: await importSigningKey(mallory.privateJwk), kid: await keyId(mallory.publicJwk), jwk: mallory.publicJwk }
const identityOf = (jwk: typeof b.publicJwk, signer = D, did = deskDid, vct = IDENTITY_VCT) => issueSdJwt({
  issuerDid: did, signingKey: signer.key, kid: signer.kid, holderPublicJwk: jwk, vct, jti: crypto.randomUUID(),
  subject: { sub: 'u', name: 'Sok Dara', institution: 'Phnom Penh ID Desk', verification_level: 'in_person_document',
    evidence_type: 'passport', verified_on: '2026-10-01' } })

console.log('the first link')
const plainCard = await makeContactCard({ publicJwk: B.jwk, key: B.key })
assert(plainCard.startsWith(CONTACT_CARD_PREFIX) && !plainCard.includes('"d"'), 'an in-person card carries the public key, nothing private')
const opened = await openContactCard(plainCard, ctx)
assert(opened.kid === B.kid && opened.identity === null, 'scanned in person: the key, and a name the scanner gives it')
const bIdentity = await identityOf(B.jwk)
const idCard = await makeContactCard({ publicJwk: B.jwk, key: B.key, identity: bIdentity })
const openedId = await openContactCard(idCard, ctx)
assert(openedId.kid === B.kid && openedId.identity?.name === 'Sok Dara' && openedId.identity.verifier === 'Phnom Penh ID Desk',
  'a card with an identity check: the name comes from the check, and who checked is shown')
// Mallory puts B's identity check on a card with Mallory's own key.
const stolen = JSON.parse(Buffer.from(idCard.slice(CONTACT_CARD_PREFIX.length), 'base64url').toString())
const swapped = CONTACT_CARD_PREFIX + Buffer.from(JSON.stringify({ ...stolen, jwk: M.jwk })).toString('base64url')
assert((await reason(() => openContactCard(swapped, ctx))) === 'HOLDER_PROOF_WRONG_AUDIENCE',
  'someone else’s identity check on a card with your own key is refused')
const mallorysOwn = await makeContactCard({ publicJwk: M.jwk, key: M.key, identity: bIdentity })
assert((await reason(() => openContactCard(mallorysOwn, ctx))) === 'HOLDER_PROOF_INVALID',
  '…even re-proven: only B’s key can prove B’s identity check')
const uniId = await identityOf(B.jwk, U, uniDid)
assert((await reason(async () => openContactCard(await makeContactCard({ publicJwk: B.jwk, key: B.key, identity: uniId }), ctx))) === 'TYPE_NOT_ALLOWED_FOR_ISSUER',
  'an "identity check" from a university is refused')
const degree = await identityOf(B.jwk, U, uniDid, 'https://actik.kh/credentials/academic_degree')
assert((await reason(async () => openContactCard(await makeContactCard({ publicJwk: B.jwk, key: B.key, identity: degree }), ctx))) === 'CARD_NOT_IDENTITY',
  'a degree in place of an identity check is refused')
const withdrawnId = await identityOf(B.jwk)
const rev = await openRevocationList(await buildRevocationList({ issuerDid: deskDid, previous: null, signingKey: D.key, kid: D.kid, now,
  add: [{ jti: JSON.parse(Buffer.from(withdrawnId.split('.')[1], 'base64url').toString()).jti, reason: 'withdrawn', revokedAt: now }] }), { list, issuerDid: deskDid })
assert((await reason(async () => openContactCard(await makeContactCard({ publicJwk: B.jwk, key: B.key, identity: withdrawnId }),
  { ...ctx, revocationsFor: () => ({ list: rev, failure: null }) }))) === 'CREDENTIAL_REVOKED', 'a withdrawn identity check is refused')
assert((await reason(() => openContactCard('https://evil.example/?card=1', ctx))) === 'CARD_NOT_A_CARD', 'a link is not a card')
const priv = CONTACT_CARD_PREFIX + Buffer.from(JSON.stringify({ jwk: b.privateJwk })).toString('base64url')
assert((await reason(() => openContactCard(priv, ctx))) === 'CARD_MALFORMED', 'a card carrying a private key is refused, not stored')

console.log('\n"is it really you, right now?"')
const nonce = 'f00dfeedf00dfeedf00dfeedf00dfeed'
const answer = await signPresence({ key: B.key, signerKid: B.kid, nonce, audienceKid: A.kid, now })
const ok = await verifyPresence(answer, { contactJwk: B.jwk, nonce, audienceKid: A.kid, askedAt: now - 5, now: now + 3 })
assert(ok.confirmedAt === now, 'B’s answer, from B’s wallet key, for A and this nonce: A is shown when B confirmed')
const fake = await signPresence({ key: M.key, signerKid: M.kid, nonce, audienceKid: A.kid, now })
assert((await reason(() => verifyPresence(fake, { contactJwk: B.jwk, nonce, audienceKid: A.kid, askedAt: now, now }))) === 'PRESENCE_SIGNATURE_INVALID',
  'an impostor without B’s wallet cannot answer for B')
assert((await reason(() => verifyPresence(answer, { contactJwk: B.jwk, nonce: 'other', audienceKid: A.kid, askedAt: now, now }))) === 'PRESENCE_WRONG_NONCE',
  'an old answer cannot be replayed to a new check')
assert((await reason(() => verifyPresence(answer, { contactJwk: B.jwk, nonce, audienceKid: M.kid, askedAt: now, now }))) === 'PRESENCE_WRONG_AUDIENCE',
  'an answer made for A cannot be passed on to someone else')
assert((await reason(() => verifyPresence(answer, { contactJwk: B.jwk, nonce, audienceKid: A.kid, askedAt: now, now: now + PRESENCE_MAX_AGE_SECONDS + 1 }))) === 'PRESENCE_STALE',
  'an answer older than two minutes is not "right now"')
assert((await reason(() => verifyPresence(answer, { contactJwk: B.jwk, nonce, audienceKid: A.kid, askedAt: now + 600, now: now + 610 }))) === 'PRESENCE_STALE',
  'an answer signed before the check was asked is refused')
const future = await signPresence({ key: B.key, signerKid: B.kid, nonce, audienceKid: A.kid, now: now + 3600 })
assert((await reason(() => verifyPresence(future, { contactJwk: B.jwk, nonce, audienceKid: A.kid, askedAt: now, now }))) === 'PRESENCE_FUTURE',
  'an answer dated in the future is refused')
const kbAsPresence = answer.split('.').slice(0, 2).join('.') + '.' + fake.split('.')[2]
assert((await reason(() => verifyPresence(kbAsPresence, { contactJwk: B.jwk, nonce, audienceKid: A.kid, askedAt: now, now }))) === 'PRESENCE_SIGNATURE_INVALID',
  'a tampered answer is refused')
let p: unknown = null
try { await verifyPresence(fake, { contactJwk: B.jwk, nonce, audienceKid: A.kid, askedAt: now, now }) } catch (e) { p = e }
assert(p instanceof PresenceRefused && !(p instanceof ContactRefused), 'refusals are reasons, never a yes/no')

console.log('\nALL TESTS PASSED')
