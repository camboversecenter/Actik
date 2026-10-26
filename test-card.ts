// What a wallet card carries. The card is sealed with the vault key, but it is
// still the one thing a wallet list opens: it carries what the card shows, and
// nothing that identifies the person or the document.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { importSigningKey, keyId } from './src/lib/trustList.ts'
import { issueSdJwt, peekJwt } from './src/lib/sdjwt.ts'
import { cardFromSdJwt, sealCard } from './src/lib/walletCard.ts'

let failed = 0
const assert = (ok: unknown, msg: string) => { console.log(`  ${ok ? 'ok' : 'FAIL'} - ${msg}`); if (!ok) failed++ }

const DAY = 86400
const num = await generateIssuerKeys()
const numDid = didWeb('num.edu.kh')
const issue = async (type: string, subject: Record<string, unknown>) => issueSdJwt({
  issuerDid: numDid, signingKey: await importSigningKey(num.privateJwk), kid: await keyId(num.publicJwk),
  subject, vct: `https://actik.kh/credentials/${type}`, expiresInSec: 5 * 365 * DAY,
})

console.log('a degree card')
const degree = await issue('academic_degree', {
  name: 'Chan Sopheak', institution: 'National University of Management', degree_type: 'Bachelor of Business Administration',
  major: 'Accounting', graduation_date: '2026-07-15', certificate_id: 'NUM-2026-BBA-0417', student_id: 'NUM-S-20220417',
  photo: 'data:image/png;base64,AAAA',
})
const card = cardFromSdJwt(degree)
assert(card.title === 'Bachelor of Business Administration', 'its title is the degree')
assert(card.institution_name === 'National University of Management' && card.issuer_did === numDid, 'it names the institution and its DID')
assert(card.major === 'Accounting' && card.graduation_date === '2026-07-15', 'it shows the major and the date')
assert(card.jti === peekJwt(degree).jti, 'it carries the credential id, so a reissue can find the copy it replaces')
const text = JSON.stringify(card)
assert(!text.includes('NUM-2026-BBA-0417') && !text.includes('NUM-S-20220417'), 'no document number, no student number')
assert(!text.includes('Chan Sopheak') && !text.includes('base64'), 'no name, no photo')

console.log('an employment record card')
const job = await issue('employment_record', {
  name: 'Chan Sopheak', employer: 'Angkor Accounting Co.', job_title: 'Junior accountant',
  employment_type: 'full_time', employment_start: '2026-08-01', employment_status: 'current',
})
const jobCard = cardFromSdJwt(job)
assert(jobCard.title === 'Junior accountant' && jobCard.graduation_date === '2026-08-01', 'its title is the job, its date the start')

console.log('an identity check card')
const id = await issue('identity_attestation', {
  name: 'Chan Sopheak', institution: 'Phnom Penh Identity Office', verification_level: 'in_person_document',
  evidence_type: 'national_id_card', verified_on: '2026-10-01',
})
const idCard = cardFromSdJwt(id)
assert(idCard.title === undefined && idCard.graduation_date === '2026-10-01' && idCard.institution_name === 'Phnom Penh Identity Office',
  'no title claim (the wallet titles it by type), dated the day the document was seen')

console.log('other types keep their date')
for (const [type, claims, date] of [
  ['professional_certification', { cert_name: 'CAT', date_certified: '2026-08-01' }, '2026-08-01'],
  ['attendance_participation', { event_name: 'Forum', event_date: '2026-05-02' }, '2026-05-02'],
  ['merit_excellence', { achievement_title: 'Best thesis', date_awarded: '2026-04-03' }, '2026-04-03'],
  ['appreciation_service', { sub_type: 'Certificate of Appreciation', date: '2026-03-04' }, '2026-03-04'],
] as const) {
  const c = cardFromSdJwt(await issue(type, { name: 'Chan Sopheak', ...claims }))
  assert(c.title && c.graduation_date === date, `${type}: titled and dated`)
}

console.log('sealing')
const sealed = await sealCard(async (d) => ({ cipher: Buffer.from(JSON.stringify(d)).toString('base64'), iv: 'iv' }), card)
assert(sealed.card_iv === 'iv' && JSON.parse(Buffer.from(sealed.card_cipher, 'base64').toString()).title === card.title,
  'the whole card goes into the sealed blob, and only there')

console.log(failed ? `\n${failed} FAILED` : '\nALL TESTS PASSED')
process.exit(failed ? 1 : 0)
