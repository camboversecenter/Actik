// Run with: npm run test:binding
//
// Holder binding: a credential bound to the wallet it was issued to can only be
// presented with that wallet's proof, made for that one recipient.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { importSigningKey, keyId, openTrustList } from './src/lib/trustList.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { checkCredential } from './src/lib/credentialCheck.ts'
import { issueSdJwt, present, addKeyBinding, readDisclosures, peekJwt, shareAudience } from './src/lib/sdjwt.ts'
import { ALWAYS_REVEALED } from './src/lib/disclosure.ts'
import { buildBoundAnswer, checkAnswer, disclosedNames, proofAudience } from './src/lib/proofRequest.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}
async function reason(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'ACCEPTED' } catch (e) { return (e as { reason?: string }).reason ?? 'THREW' }
}

const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const did = didWeb('num.edu.kh')
const root = await generateIssuerKeys(), num = await generateIssuerKeys()
const holder = await generateIssuerKeys(), thief = await generateIssuerKeys()
const { document } = await buildTrustList({
  snapshot: [{ did, name: 'National University of Management', accredited: true,
    keys: [{ public_jwk: num.publicJwk, created_at: new Date((now - DAY) * 1000).toISOString() }] }],
  previousVersion: 0, rootKey: await importSigningKey(root.privateJwk), rootKid: await keyId(root.publicJwk), now,
})
const trust = { list: await openTrustList(document, { roots: [root.publicJwk], now }), failure: null }
const none = { list: null, failure: null }
const numKey = await importSigningKey(num.privateJwk)
const kid = await keyId(num.publicJwk)
const holderKey = await importSigningKey(holder.privateJwk)
const thiefKey = await importSigningKey(thief.privateJwk)
const subject = { name: 'Chan Sopheak', institution: 'National University of Management', degree_type: 'BBA',
  graduation_date: '2026-07-15', certificate_id: 'NUM-2026-BBA-0417', major: 'Accounting' }
const issue = (holderPublicJwk?: typeof holder.publicJwk) => issueSdJwt({ issuerDid: did, signingKey: numKey, kid, subject,
  holderPublicJwk, vct: 'https://actik.kh/credentials/academic_degree', expiresInSec: 5 * 365 * DAY })
const bound = await issue(holder.publicJwk)
const unbound = await issue()

console.log('binding at issuance')
assert(peekJwt(bound).bound && !peekJwt(unbound).bound, 'the issuer writes the holder key into the signed credential')
const payload = JSON.parse(Buffer.from(bound.split('.')[1], 'base64url').toString())
assert(payload.cnf?.jwk?.x === holder.publicJwk.x && !('d' in payload.cnf.jwk), 'only the public half, never a private part')

console.log('\npresenting a share link')
const A = shareAudience('5f0c6f8e-6a43-4b2a-9d55-2f1c1e7f0a11'), B = shareAudience('0b9d2c1e-1111-4222-8333-944455556666')
const shown = present(bound, ALWAYS_REVEALED)
const proven = await addKeyBinding(shown, holderKey, { audience: A, nonce: crypto.randomUUID() })
const ok = await checkCredential(proven, did, trust, none, now, { holderProof: { audience: A } })
assert(ok.holder.binding === 'bound', "the holder's own wallet, proving for this link, is accepted as bound")
assert(readDisclosures(proven).length === readDisclosures(shown).length && !disclosedNames(proven).some((n) => n.startsWith('\u0000')),
  'the proof is not mistaken for a disclosure')
assert((await reason(() => checkCredential(shown, did, trust, none, now, { holderProof: { audience: A } }))) === 'HOLDER_PROOF_MISSING',
  'a bound credential without its proof is refused — whoever sent it may not be its holder')
assert((await reason(() => checkCredential(proven, did, trust, none, now, { holderProof: { audience: B } }))) === 'HOLDER_PROOF_WRONG_AUDIENCE',
  'copied into another link, it is refused')
const stolen = await addKeyBinding(shown, thiefKey, { audience: A, nonce: 'n' })
assert((await reason(() => checkCredential(stolen, did, trust, none, now, { holderProof: { audience: A } }))) === 'HOLDER_PROOF_INVALID',
  'a proof from any other key is refused')
const parts = proven.split('~')
const trimmed = [parts[0], ...parts.slice(1, -2), parts[parts.length - 1]].join('~')
assert((await reason(() => checkCredential(trimmed, did, trust, none, now, { holderProof: { audience: A } }))) === 'HOLDER_PROOF_INVALID',
  'removing a disclosure after the proof was made breaks it')
const future = await addKeyBinding(shown, holderKey, { audience: A, nonce: 'n', issuedAt: now + 3600 })
assert((await reason(() => checkCredential(future, did, trust, none, now, { holderProof: { audience: A } }))) === 'HOLDER_PROOF_INVALID',
  'a proof dated in the future is refused')

console.log('\nwhere no proof is asked for')
assert((await checkCredential(bound, did, trust, none, now)).holder.binding === 'not_asked',
  'claiming or exporting from your own wallet needs no proof')
const old = await checkCredential(present(unbound, ALWAYS_REVEALED), did, trust, none, now, { holderProof: { audience: A } })
assert(old.holder.binding === 'unbound', 'an unbound credential still verifies, and says it is unbound — check ID')

console.log('\nanswering a proof request')
const req = { id: '7d3f1c2a-1111-4222-8333-944455556666', requirements: [{ type: 'academic_degree', extras: ['major'], note: '' }] }
const other = { ...req, id: '9e8d7c6b-1111-4222-8333-944455556666' }
const answer = await buildBoundAnswer(req.requirements[0], bound, req.id, holderKey)
const checked = await checkAnswer(req, { requirement: 0, presentation: answer }, trust, () => none, now)
assert(checked.kind === 'checked' && checked.checked.holder.binding === 'bound', 'a bound answer is accepted by the request it was made for')
const replay = await checkAnswer(other, { requirement: 0, presentation: answer }, trust, () => none, now)
assert(replay.kind === 'refused' && replay.reason === 'HOLDER_PROOF_WRONG_AUDIENCE', '…and refused by any other request it is replayed to')
let locked: unknown = null
try { await buildBoundAnswer(req.requirements[0], bound, req.id, null) } catch (e) { locked = e }
assert(locked instanceof Error, 'a bound credential cannot be sent without the wallet key')
const plain = await buildBoundAnswer(req.requirements[0], unbound, req.id, null)
assert(plain.endsWith('~'), 'an unbound credential is sent as it is')

console.log('\nALL TESTS PASSED')
