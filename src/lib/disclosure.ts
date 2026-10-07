// What a share always discloses, and why.
//
// Imported by ShareCredential.tsx (which builds the reveal set from it) and by
// test-sdjwt.ts (which asserts a default share still carries the four
// comparison fields). One list, so the promise the share screen makes and the
// disclosures a verifier receives cannot drift apart.

// Claims every share discloses, because withholding them makes the share
// either unusable or unverifiable.
//
// Four of them are the comparison fields a verifier holds against the document
// in their hand — holder name, document number, issuing institution, issue date
// (SPEC-style mustMatchPrintedDocument, see src/lib/sdjwt.ts). Nothing about
// the paper or the PDF is signed, so that comparison is the only thing standing
// between a genuine code and the same code photographed onto a forgery. A share
// that leaves the document number or the date out hands the verifier a
// signature they cannot tie to anything.
//
// The rest is the substance of the credential itself: a Certificate of
// Completion that discloses neither the programme nor the date proves only
// that some institution issued this person something. These claims only exist
// on the credential types that carry them, and present() ignores a name the
// token does not have, so listing them all is safe.
//
// Genuinely sensitive extras — GPA, national ID, major, student number, email,
// the certificate scan — stay opt-in. They are what selective disclosure is
// for.
export const ALWAYS_REVEALED = [
  // registered JWT claims plus the issuing institution
  'institution', 'iss', 'iat', 'exp',
  // who it is about
  'name',
  // academic degree ('degree' is the legacy disclosure name for degree_type)
  'degree_type', 'degree', 'graduation_date', 'certificate_id',
  // attendance / participation
  'sub_type', 'event_name', 'event_date', 'organizer',
  // completion
  'program_name', 'completion_date',
  // merit / excellence
  'achievement_title', 'date_awarded',
  // appreciation / service
  'reason', 'date',
  // professional certification
  'cert_name', 'issuing_body', 'date_certified', 'license_number', 'expiry_date',
  // employment record ('current' is as of the day it was signed)
  'job_title', 'employment_type', 'employment_start', 'employment_end', 'employment_status',
  // identity attestation: a name as on the document, and how it was checked —
  // never the document's number, a birth date or a photo (identity.ts)
  'verification_level', 'evidence_type', 'verified_on',
]
