// Run with: npm run test:sdjwt
// Proves the SD-JWT core round-trips: issue -> selectively present -> verify.
import { generateIssuerKeys, didWeb } from './src/lib/did.ts'
import { issueSdJwt, present, verify, readDisclosures } from './src/lib/sdjwt.ts'
import { ALWAYS_REVEALED } from './src/lib/disclosure.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok -', msg)
}

const { publicJwk, privateJwk } = await generateIssuerKeys()
const issuerDid = didWeb('rupp.edu.kh')
console.log('issuer DID:', issuerDid)

const full = await issueSdJwt({
  issuerDid,
  issuerPrivateJwk: privateJwk,
  vct: 'https://actik.kh/credentials/degree',
  subject: {
    name: 'សុខ ដារ៉ា',
    degree: 'BSc in Information Technology',
    university: 'Royal University of Phnom Penh',
    year: 2025,
    gpa: 3.8,
    national_id: '012345678',
  },
  expiresInSec: 3600,
})
assert(readDisclosures(full).length === 6, 'full credential holds all 6 disclosures')

const presentation = present(full, ['name', 'degree', 'university', 'year'])
assert(readDisclosures(presentation).length === 4, 'presentation holds only 4 disclosures')

const assertion = await verify(presentation, publicJwk)
assert(assertion.issuer === issuerDid, 'issuer matches')
assert(assertion.claims.name === 'សុខ ដារ៉ា', 'Khmer name survived round-trip')
assert(assertion.claims.gpa === undefined, 'hidden gpa is NOT visible to verifier')
assert(assertion.claims.national_id === undefined, 'hidden national_id is NOT visible')

// The result must not offer a verdict. A caller that can read `valid` never
// has to read the fields, and the fields are the only thing that ties a
// credential to the document in front of the reader.
const verdictNames = ['valid', 'isValid', 'ok', 'verified', 'trusted']
for (const name of verdictNames) {
  assert(!(name in (assertion as object)), `result exposes no \`${name}\` accessor`)
}
assert(
  assertion.mustMatchPrintedDocument.subjectName === 'សុខ ដារ៉ា',
  'printed-document comparison carries the subject name',
)

async function rejection(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return (e as { reason?: string }).reason ?? 'NOT_A_REJECTION'
  }
  return 'NO_REJECTION'
}

const other = await generateIssuerKeys()
assert(
  (await rejection(() => verify(presentation, other.publicJwk))) === 'SIGNATURE_INVALID',
  'wrong issuer key is rejected as SIGNATURE_INVALID',
)

const expired = await issueSdJwt({ issuerDid, issuerPrivateJwk: privateJwk, vct: 'test', subject: { x: 1 }, expiresInSec: -10 })
assert(
  (await rejection(() => verify(present(expired, ['x']), publicJwk))) === 'CREDENTIAL_EXPIRED',
  'expired credential is rejected as CREDENTIAL_EXPIRED',
)

// A disclosure the issuer never signed, spliced onto a genuine JWT.
const foreign = await issueSdJwt({ issuerDid, issuerPrivateJwk: privateJwk, vct: 'test', subject: { grade: 'A+' }, expiresInSec: 3600 })
const splicedDisclosure = readDisclosures(foreign)[0].disclosure
const spliced = presentation.replace(/~$/, '') + '~' + splicedDisclosure + '~'
assert(
  (await rejection(() => verify(spliced, publicJwk))) === 'DISCLOSURE_NOT_SIGNED',
  'spliced disclosure is rejected as DISCLOSURE_NOT_SIGNED',
)

// A DEFAULT share — no opt-in fields ticked — must still carry the four
// fields a verifier compares against the document, on every credential type.
// Before ALWAYS_REVEALED it carried two of them: the document number and the
// date were opt-in, so the commonest share handed over a signature the reader
// could not tie to the paper in front of them.
const sensitive = ['gpa', 'national_id', 'major', 'student_id', 'sub']

async function defaultShare(label: string, extra: Record<string, unknown>) {
  const full = await issueSdJwt({
    issuerDid,
    issuerPrivateJwk: privateJwk,
    vct: 'https://actik.kh/credentials/test',
    subject: {
      name: 'Chan Sopheak',
      institution: 'National University of Management',
      sub: 'sopheak.chan@example.com',
      gpa: 3.6,
      national_id: '0000000000',
      major: 'Finance and Banking',
      student_id: 'NUM-21-0417',
      ...extra,
    },
    expiresInSec: 3600,
  })
  const result = await verify(present(full, ALWAYS_REVEALED), publicJwk)
  const m = result.mustMatchPrintedDocument
  assert(
    !!(m.subjectName && m.documentId && m.issuingOrganisation && m.issueDate),
    `${label}: a default share carries all four comparison fields`,
  )
  assert(
    sensitive.every((k) => !(k in result.claims)),
    `${label}: a default share still withholds GPA, national ID, major, student number and subject`,
  )
}

await defaultShare('degree', {
  degree_type: 'Bachelor of Business Administration',
  graduation_date: '2026-07-15',
  certificate_id: 'NUM-2026-BBA-0417',
})
await defaultShare('professional certification', {
  cert_name: 'Certified Public Accountant',
  issuing_body: 'NUM Professional Centre',
  date_certified: '2026-03-02',
  license_number: 'CPA-KH-2026-0188',
})
await defaultShare('completion', {
  program_name: 'Executive Diploma in Management',
  completion_date: '2026-05-20',
  certificate_id: 'NUM-2026-EDM-0032',
})

console.log('\nALL TESTS PASSED')
