// Run with: npm run test:claim
//
// The claim gate: a credential only enters the holder's vault if a key the
// Root-signed trust list accepts for that issuer actually signed it. These are
// the cases that used to walk straight through — a token signed by a
// stranger, a token that names a different issuer from the row that carried
// it, a row with no token at all.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { issueSdJwt } from './src/lib/sdjwt.ts'
import { importSigningKey, keyId, openTrustList } from './src/lib/trustList.ts'
import { buildTrustList } from './src/lib/trustListBuild.ts'
import { checkCredential, ClaimRefused, signedOr, type TrustState } from './src/lib/credentialCheck.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return e instanceof ClaimRefused ? e.reason : 'NOT_A_REFUSAL'
  }
  return 'NO_REFUSAL'
}

const now = Math.floor(Date.now() / 1000)
const root = await generateIssuerKeys()
const rupp = await generateIssuerKeys()
const ruppDid = didWeb('rupp.edu.kh')
const attacker = await generateIssuerKeys()

const { document } = await buildTrustList({
  snapshot: [{
    did: ruppDid, name: 'Royal University of Phnom Penh', accredited: true,
    // stored as a JSON string, as one of this project's code paths does
    keys: [{ public_jwk: JSON.stringify(rupp.publicJwk), created_at: new Date(Date.now() - 86400_000).toISOString() }],
  }],
  previousVersion: 0,
  rootKey: await importSigningKey(root.privateJwk),
  rootKid: await keyId(root.publicJwk),
  now,
})
const trust: TrustState = { list: await openTrustList(document, { roots: [root.publicJwk], now }), failure: null }
const none = { list: null, failure: null }
const check = (sdjwt: string | null, did: string | null) => checkCredential(sdjwt, did, trust, none, now)

const claims = {
  name: 'សុខ ដារ៉ា',
  institution: 'Royal University of Phnom Penh',
  degree_type: 'BSc in Information Technology',
  certificate_id: 'RUPP-2026-0001',
  major: 'Software Engineering',
  graduation_date: '2026-07-15',
}
function issue(key: typeof rupp, did = ruppDid, expiresInSec = 3600) {
  return issueSdJwt({
    issuerDid: did, issuerPrivateJwk: key.privateJwk,
    vct: 'https://actik.kh/credentials/academic_degree', subject: claims, expiresInSec,
  })
}

const genuine = await issue(rupp)
const ok = await check(genuine, ruppDid)
assert(ok.assertion.issuer === ruppDid, 'a genuine credential is accepted')
assert(ok.issuer.name === 'Royal University of Phnom Penh', 'the institution name comes from the signed list')

// What the wallet card will show comes from the signed claims, not the row.
assert(signedOr(ok.assertion, 'institution', 'TYPED BY HAND') === 'Royal University of Phnom Penh',
  'display values are taken from the signed claims')
assert(signedOr(ok.assertion, 'nickname', 'from the row') === 'from the row',
  'a claim the credential does not carry falls back to the row')

const forged = await issue(attacker)
const wrongIssuer = await issue(rupp, didWeb('other.edu.kh'))
const expired = await issue(rupp, ruppDid, -10)

assert((await refusal(() => check(forged, ruppDid))) === 'SIGNATURE_INVALID',
  "a credential signed by someone else under RUPP's name is refused")
assert((await refusal(() => check(genuine, didWeb('other.edu.kh')))) === 'ISSUER_NOT_LISTED',
  'a row naming an issuer the Root never listed is refused')
assert((await refusal(() => check(wrongIssuer, ruppDid))) === 'ISSUER_MISMATCH',
  'a row whose issuer_did disagrees with the signed token is refused')
assert((await refusal(() => check(null, ruppDid))) === 'NO_CREDENTIAL', 'a row with no token is refused')
assert((await refusal(() => check(genuine, null))) === 'NO_ISSUER', 'a row with no issuer is refused')
assert((await refusal(() => checkCredential(genuine, ruppDid, { list: null, failure: 'TRUSTLIST_MISSING' }, none, now)))
  === 'TRUSTLIST_MISSING', 'with no signed trust list nothing is claimed, and nothing is blamed on the credential')
assert((await refusal(() => check(expired, ruppDid))) === 'CREDENTIAL_EXPIRED',
  'an expired credential is refused')

console.log('\nALL TESTS PASSED')
