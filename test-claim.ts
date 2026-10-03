// Run with: npm run test:claim
//
// The claim gate: a credential only enters the holder's vault if the issuer's
// registered key actually signed it. These cases are the ones that used to
// walk straight through — a token signed by a stranger, a token that names a
// different issuer from the row that carried it, a row with no token at all.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { issueSdJwt } from './src/lib/sdjwt.ts'
import { checkIssuedCredential, ClaimRefused, signedOr, readPublicJwk } from './src/lib/credentialCheck.ts'

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

const rupp = await generateIssuerKeys()
const ruppDid = didWeb('rupp.edu.kh')
const attacker = await generateIssuerKeys()

const claims = {
  name: 'សុខ ដារ៉ា',
  institution: 'Royal University of Phnom Penh',
  degree_type: 'BSc in Information Technology',
  certificate_id: 'RUPP-2026-0001',
  major: 'Software Engineering',
  graduation_date: '2026-07-15',
}

const genuine = await issueSdJwt({
  issuerDid: ruppDid,
  issuerPrivateJwk: rupp.privateJwk,
  vct: 'https://actik.kh/credentials/academic_degree',
  subject: claims,
  expiresInSec: 3600,
})

// The registry row, in both shapes this project writes.
const rowJsonb = { did: ruppDid, public_jwk: rupp.publicJwk, accredited: true }
const rowString = { did: ruppDid, public_key: JSON.stringify(rupp.publicJwk), accredited: true }

const ok = await checkIssuedCredential(genuine, ruppDid, { row: rowJsonb, failed: false })
assert(ok.issuer === ruppDid, 'a genuine credential is accepted')
assert(
  (await checkIssuedCredential(genuine, ruppDid, { row: rowString, failed: false })).issuer === ruppDid,
  'the registry key is read whether stored as jsonb or as a JSON string',
)
assert(readPublicJwk({ public_key: 'not json' }) === null, 'an unparseable registry key reads as absent')

// What the wallet card will show comes from the signed claims, not the row.
assert(signedOr(ok, 'institution', 'TYPED BY HAND') === 'Royal University of Phnom Penh',
  'display values are taken from the signed claims')
assert(signedOr(ok, 'nickname', 'from the row') === 'from the row',
  'a claim the credential does not carry falls back to the row')

// The hole this closes: anyone could write a pending row naming RUPP.
const forged = await issueSdJwt({
  issuerDid: ruppDid,
  issuerPrivateJwk: attacker.privateJwk,
  vct: 'https://actik.kh/credentials/academic_degree',
  subject: claims,
  expiresInSec: 3600,
})
assert(
  (await refusal(() => checkIssuedCredential(forged, ruppDid, { row: rowJsonb, failed: false })))
    === 'SIGNATURE_INVALID',
  "a credential signed by someone else under RUPP's name is refused",
)

// A genuine token from one issuer, carried by a row claiming another.
assert(
  (await refusal(() => checkIssuedCredential(genuine, 'did:web:other.edu.kh', { row: { did: 'did:web:other.edu.kh', public_jwk: rupp.publicJwk }, failed: false })))
    === 'ISSUER_MISMATCH',
  'a row whose issuer_did disagrees with the signed token is refused',
)

assert((await refusal(() => checkIssuedCredential(genuine, ruppDid, { row: null, failed: false })))
  === 'ISSUER_UNKNOWN', 'an issuer absent from the registry is refused')
assert((await refusal(() => checkIssuedCredential(genuine, ruppDid, { row: null, failed: true })))
  === 'REGISTRY_UNAVAILABLE', 'an unreadable registry is reported as unavailable, not as a bad credential')
assert((await refusal(() => checkIssuedCredential(null, ruppDid, { row: rowJsonb, failed: false })))
  === 'NO_CREDENTIAL', 'a row with no token is refused')
assert((await refusal(() => checkIssuedCredential(genuine, null, { row: rowJsonb, failed: false })))
  === 'NO_ISSUER', 'a row with no issuer is refused')
assert((await refusal(() => checkIssuedCredential(genuine, ruppDid, { row: { did: ruppDid }, failed: false })))
  === 'ISSUER_KEY_MALFORMED', 'a registry row with no usable key is reported as unchecked')

const expired = await issueSdJwt({
  issuerDid: ruppDid,
  issuerPrivateJwk: rupp.privateJwk,
  vct: 'test',
  subject: claims,
  expiresInSec: -10,
})
assert((await refusal(() => checkIssuedCredential(expired, ruppDid, { row: rowJsonb, failed: false })))
  === 'CREDENTIAL_EXPIRED', 'an expired credential is refused')

console.log('\nALL TESTS PASSED')
