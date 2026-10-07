# Identity verifiers and identity attestations

Individual ownership needs a valid person behind the wallet. A degree bound to
a wallet proves it is being shown from the wallet it was issued to; it does not
prove who holds that wallet. An **identity attestation** closes that gap
without building a register of people: someone admitted for the purpose sees
the person in person, with their original document, and signs one fact into
that person's own wallet.

## The third tier

The trust list carries each issuer's **kind**, signed by the Root:

| Kind | May issue | Shown to verifiers as |
|---|---|---|
| `institution` | every credential type **except identity attestations** | Accredited institution |
| `employer` | employment records only | Registered employer |
| `identity_verifier` | **identity attestations only** | Identity verifier |

Identity needs its own admission. A university's key does not make it a place
that checks passports, and an identity verifier's key does not make it a
university. `issuerMayIssue()` in `src/lib/trustList.ts` is the rule; every
verifier applies it (`TYPE_NOT_ALLOWED_FOR_ISSUER`), and the database outbox
policy applies it again.

- An office registers like any issuer and picks **Identity verifier** as its
  type. Only an admin changes the kind afterwards.
- It is trusted only once the Root signs the next trust list. The build prints
  each tier for review and refuses an unknown kind rather than admit anyone at
  a wider tier.
- A list signed before kinds existed reads as all institutions, and therefore
  admits no identity verifier.

## What an attestation says, and never says

| Claim | Value |
|---|---|
| `name` | exactly as on the document |
| `institution` | the identity verifier's name |
| `verification_level` | `in_person_document` |
| `evidence_type` | `national_id_card` or `passport` |
| `verified_on` | the day the document was seen |
| `sub`, `iss`, `iat`, `exp` | as on every credential |

**Never**: the document number, a date of birth, a photo, a face template, a
fingerprint, an address, a note, a scan. This is enforced four times:

1. The issuing form has no place for them and no file upload.
   `identityClaims()` (`src/lib/identity.ts`) is the whole list.
2. The database guard `pending_credentials_identity_guard` decodes the signed
   token and refuses any claim outside `identity_attestation_claims()`, any
   evidence type or level not listed, and a printed code.
3. Every verifier refuses an attestation that discloses anything else
   (`IDENTITY_CLAIM_NOT_ALLOWED`).
4. The verifier keeps no copy: there is nothing to keep.

## Bound, or not at all

An attestation anyone could present says "someone called Chan Sopheak exists",
which is worthless. So it is **always holder-bound** (`cnf`, see
[`HOLDER_BINDING.md`](HOLDER_BINDING.md)):

- The issuing form refuses unless the person already has a wallet key
  (`holder_public_key`).
- The database refuses an attestation without `cnf`, and one whose `cnf` is not
  the recipient's own wallet key — an issuer cannot bind it to a key of its
  choosing.
- `checkCredential` refuses an unbound attestation (`IDENTITY_NOT_BOUND`), and
  so does the printed lane: an identity check is never printed, because paper
  cannot carry a holder proof. Nor is it ever a museum exhibit.

## The issuing form

Only identity verifiers see the type, and they see nothing else. The form asks
for the person's email (they must already have a wallet), the name as on the
document, which document was seen, and the day. A required confirmation reads:

> I have seen the original document in person and compared its photo with the
> person in front of me.

It is never saved in a draft; it is given at the moment of issuing. The wording
says "person", not "student". The attestation reaches the wallet only if the
person accepts it.

## Where it is used

- **Proof requests.** An employer may ask for an identity check (no extras).
  When an answer's credentials were all presented with proofs from **the same
  holder key** and one of them is an identity attestation, the review says so:
  "the degree and the identity check are bound to the same wallet". That is
  evidence — the verifier saw the person who holds this wallet — and still not
  a verdict: the reviewer compares the name and meets the person.
- **Share links.** Like any bound credential, with the holder's proof.
- **Key recovery** (see [`KEY_RECOVERY.md`](KEY_RECOVERY.md)): a fresh
  attestation bound to a new wallet key is how a person who lost their wallet
  proves continuity to issuers.
- **Verified contacts** (see [`VERIFIED_CONTACTS.md`](VERIFIED_CONTACTS.md)):
  a contact card can carry one, so the other side knows whose key it is.

## What it does not do

- It is not an identity register. ACTIK keeps no list of people, documents or
  faces; the attestation lives end-to-end encrypted in the person's wallet. The
  issuer's own log keeps what it keeps for any credential: the type, a label,
  the recipient's email and the credential id.
- It does not prove the document was genuine, only that an admitted verifier
  looked at it in person and judged it to be. Admission is where that judgment
  is placed.
- It cannot stop a person lending their unlocked phone and PIN to someone else.
