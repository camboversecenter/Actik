# The museum seam: what ACTIK hands CamboVerse

CamboVerse's personal museum (`camboverse/docs/MUSEUM.md`) hangs a person's
certificates in a virtual room. That design gives ACTIK identity, issuing, the
files, redaction, verification state and withdrawal, and gives CamboVerse the
room. This document is ACTIK's side of the seam: the file a holder exports,
how CamboVerse should read it, and ACTIK's answers to MUSEUM.md §13.

It is written to be read next to MUSEUM.md. Rule numbers (rule 3, rule 7…)
are MUSEUM.md §5's.

Actik's purpose is to **issue** and to **manage** digital assets; a
certificate is one kind of asset, and the only kind built so far. Exporting to
a museum is part of managing: the owner takes an asset they hold and decides
how it is shown. So `exhibit.kind` is `"certificate"` for certificates and
`"work"` for employment records (docs/EMPLOYMENT_RECORDS.md), and other asset
kinds will be added as further values — with their own rules for what is
signed, what is shown and what is covered — rather than by stretching the
certificate fields. CamboVerse should treat an unknown `kind` as something to
refuse, not to guess at.

## 1. How a certificate gets into a room

1. The institution issues the credential in ACTIK. For a degree or a
   professional certification with a document number, it also signs a
   **printed code** — a QRSeal Profile B `KH1:` string — whose `dh` claim is
   the hash of the certificate file it issued. The code travels with the
   credential.
2. The holder claims it. Their app checks the credential's signature against
   the Root-signed trust list, checks the printed code on its own and that it
   names the same document, holder and institution, and stores both,
   encrypted, in their vault. A printed code that does not belong is left
   behind; the credential is still kept.
3. In the wallet, the holder opens the credential and taps **Add to museum**:
   - they crop the picture and cover anything they do not want shown — the
     app tells them which sensitive fields this credential carries (student
     number, national ID, date of birth…), since those are probably printed on
     it too;
   - they choose who may see it: **only me** (default), **people I send a
     link to**, or **anyone** — "anyone" needs a separate confirmation that
     they checked the picture;
   - they choose whether to include the institution's signed code, and are
     told what it reveals (name, document number, institution, date).
4. The app builds the exhibit file on the device and the holder downloads or
   copies it. They add it to their room in CamboVerse.

Nothing in step 3 or 4 touches the network except one check: a credential the
institution has withdrawn is refused (rule 9). If that check cannot be made
right now, export continues — the file carries what CamboVerse needs to make
the check itself.

## 2. The file: `actik/exhibit/1`

A JSON object. A real one (values shortened, fictional person):

```json
{
  "type": "actik/exhibit/1",
  "exportedAt": 1791043200,
  "exhibit": {
    "kind": "certificate",
    "title": "Bachelor of Business Administration",
    "khmerTitle": null,
    "issuerName": "National University of Management",
    "issuerDid": "did:web:num.edu.kh",
    "date": "2026-07-15"
  },
  "source": {
    "actikDocumentId": "6f1c2e9a-0000-4000-8000-000000000001",
    "fileSha256": "3108aa7d48933e51b68cf9366bb7c32c5c1f0e9b2d6a4f8e7d3c2b1a09f8e7d6",
    "fileType": "image/png",
    "publicImage": "data:image/jpeg;base64,/9j/4AAQ…",
    "actikVisibility": "private"
  },
  "verification": "self-asserted",
  "credential": "KH1:6BF…",
  "withdrawal": {
    "issuer": "did:web:num.edu.kh",
    "ids": ["8C1F…(64 hex)", "02AB…(64 hex)"]
  }
}
```

| Field | Meaning |
|---|---|
| `exhibit.title`, `issuerName`, `date` | From the credential's **signed** claims, not from what someone typed beside it. `khmerTitle` is always `null`: ACTIK never guesses Khmer (rule 10). |
| `source.actikDocumentId` | The wallet's id for the credential. Stable; meaningless outside ACTIK. |
| `source.fileSha256` | Lowercase hex SHA-256 of the **original** issued file, as the institution issued it (rule 7). The first 32 characters equal the printed code's `dh` (QRSeal stores the first 16 bytes). `null` only if the credential carries no file. |
| `source.fileType` | Media type of that original. A PDF has no `publicImage`. |
| `source.publicImage` | The picture the holder prepared: cropped, covered areas burned into the pixels, at most 1200 px on its long side, re-encoded as JPEG (which drops EXIF location and device data). `null` for a PDF or when the holder chose no picture. **Never the original.** |
| `source.actikVisibility` | The most the holder allows: `private` · `link` · `public`. CamboVerse shows the stricter of this and the room's own setting (rule 3). |
| `verification` | Always `self-asserted`. ACTIK does not tell CamboVerse a credential is genuine; in phase 2 CamboVerse checks `credential` itself, on the viewer's device (rules 1, 8). |
| `credential` | The institution's QRSeal Profile B code, or `null` (no printed code, or the holder left it out). |
| `withdrawal` | The entry hashes under which this credential would appear on its issuer's withdrawal list. `null` if the credential has neither a jti nor a document number. |

What the file does **not** carry, on purpose:

- **The original file.** ACTIK keeps it, inside the credential, in the
  holder's encrypted vault.
- **Any "verified" flag.** See `verification`.
- **An account identity.** How a room is bound to an ACTIK person is D5, and
  still open (§4, question 3). A field nobody can check would be read as if
  someone had.
- **Document numbers or jtis in a searchable form** — unless the holder
  includes the printed code, which carries the document number in readable
  form (the holder is told). `withdrawal.ids` are hashes; see §3.4.

## 3. How CamboVerse should read it

### 3.1 Refuse what is not this format

Require `type === "actik/exhibit/1"` and `verification === "self-asserted"`.
Ignore unknown fields. Never render `publicImage` unless it is a
`data:image/jpeg;base64,` URL; store it, do not hot-link anything.

### 3.2 Visibility (rule 3)

`effective = stricter(room.visibility, source.actikVisibility)` with
`private` < `link` < `public`. Enforce it where the room is served, not in
the page: an exhibit whose effective visibility is `private` is not sent to
anyone but the owner.

The file is a snapshot. If a holder later wants an exhibit less visible, they
change or remove it in CamboVerse; ACTIK has no way to reach into a room, and
by D4 should not.

### 3.3 Phase 2: is it what it says?

Only when `credential` is present:

1. Verify `credential` as QRSeal Profile B against **ACTIK's** Root-signed
   trust list (`actik/trustlist/1`). ACTIK's verifier for this is pure and
   network-free: `src/lib/printedCredential.ts` (`verifyPrintedCredential`)
   with `src/lib/trustList.ts` and `src/lib/revocation.ts`, over the vendored
   QRSeal core in `src/khsqr/`. CamboVerse can vendor the same files and pin
   the same Root public key.
2. Require the code's issuer to equal `exhibit.issuerDid`.
3. Require `dh` to be **present** (MUSEUM.md §8 finding 1 — mandatory for the
   museum though QRSeal says SHOULD) and equal to
   `source.fileSha256.slice(0, 32)`. Without it, show the signed four fields
   beside the picture for a person to compare, and draw no mark.
4. Show the issuer first, then the state (rule 8). Never a tick.

Note the limit: `dh` matches the **original** file, which CamboVerse never
has. It proves the code was issued for the file whose hash the owner's ACTIK
app computed — it does not prove the redacted picture came from that file. A
viewer still sees the four signed fields and the picture side by side.

### 3.4 Withdrawal (rule 9)

Each issuer publishes a signed withdrawal list (`actik/revocations/2`) in
ACTIK's `revocation_lists` table, publicly readable. Its entries are only:

```json
{ "id": "<64 uppercase hex>", "reason": "withdrawn" | "corrected", "revokedAt": 1791043200 }
```

where `id` = QRSeal's `revocationEntryId(issuer, documentNumber)`, or the same
function over `"jti:" + jti`. The list names no one: no document number, no
jti, no free-text reason.

To take an exhibit down: open the issuer's list against ACTIK's trust list
(signature by a key the trust list accepts for that issuer, version never
going backwards), then hide the exhibit if any of `withdrawal.ids` is on it.
A `corrected` entry means the institution issued a corrected credential; the
owner should export that one instead.

**How fresh.** Lists are re-signed at least every 30 days and expire after
at most 31. Recommendation for CamboVerse:

- fetch ACTIK's trust list and the withdrawal lists **on CamboVerse's server**
  on a schedule (daily), and serve them with the room — they are signed, so a
  mirror cannot alter them, and viewers' devices never contact ACTIK (D4);
- on a listed id: hide the exhibit, always, even if the list has expired;
- with no unexpired list for that issuer: phase 1 is unaffected (everything is
  self-asserted anyway); phase 2 must not show the "issued" state — show the
  exhibit as self-asserted with the signed fields, and say the issuer's
  withdrawal list could not be checked.

An offline verifier can be up to the refresh interval behind the institution;
a withdrawal is never instantaneous.

## 4. Answers to MUSEUM.md §13 (questions for ACTIK)

**1. What does ACTIK hand CamboVerse for one document?**
The `actik/exhibit/1` file in §2, built on the holder's device from their
vault and exported by them (download or copy). Not an API call: D4.

**2. Does ACTIK store the original file's SHA-256, and a separate redacted
public image?**
ACTIK stores the original file itself, inside the signed credential (claim
`photo`), in the holder's end-to-end encrypted vault. Its SHA-256 is computed
from those bytes at export, and the printed code's `dh` is signed over the
same bytes at issuance, so the two agree by construction (tested). The
redacted public image is **not** stored by ACTIK: it is made at export, on the
device, and travels in the exhibit file. ACTIK cannot host a public image
without either breaking the vault's encryption or learning who views which
room. So, against MUSEUM.md §10, the precise split is: **ACTIK holds the
original; CamboVerse holds the hash, the holder-prepared picture and the
arrangement.**

**3. How does a CamboVerse room prove it belongs to an ACTIK identity?**
It cannot yet. Nothing in ACTIK today vouches for a person to a third party:
issuing and verifying work without it, and the exhibit file deliberately
carries no identity. This is D5 and needs both sides. The recommendation:

- ACTIK runs a small signing service (a Supabase Edge Function holding a key
  listed in ACTIK's trust list under its own role) that, for a signed-in
  holder, signs a short statement binding **a pairwise identifier** for
  CamboVerse (so CamboVerse and ACTIK cannot join a person's activity across
  services) to **a public key the holder's CamboVerse room generates**;
- the room presents that statement once, when it is created or claimed —
  never when someone views it, so ACTIK never learns who looks at whose room;
- exhibits stay unbound to identity in phase 1. Binding "the person named on
  the certificate" to "the room's owner" is the separate, harder question
  (MUSEUM.md §8 finding 3), and the honest phase-2 answer is the name on the
  credential shown beside the room owner's chosen display name — not a claim
  that they are the same person.

This needs a server-side key ACTIK does not have yet. It was not built here
because it should be decided with CamboVerse, not guessed.

**4. Does ACTIK issue QRSeal credentials, and with `dh`?**
Yes. At issuance, for degrees and professional certifications that carry a
document number, ACTIK signs a QRSeal Profile B code, using the vendored
QRSeal core (commit `0762ea1`, passes all 13 of QRSeal's Profile B verify
vectors). `dh` is included whenever the institution attached the certificate
file — always for degrees, where the file is required; for a professional
certification only if one was attached. A code without `dh` still verifies,
but by §3.3 it gets no mark in the museum. The other four credential types (participation, completion, merit,
appreciation) have no document number and get no printed code; their
exhibits stay self-asserted. One deviation from QRSeal to know about: ACTIK
accepts a key that was valid **when the code was signed** (a retired key still
vouches for what it signed before retirement), where QRSeal §3.1a requires
validity at verification and asks long-lived documents to use cohort keys.
Degrees therefore keep verifying after a key rotation as long as the Root
keeps the retired key on the list.

**5. How does a room learn of a revocation, and how fresh must the list be?**
From the issuer's public withdrawal list, matched against the exhibit's
`withdrawal.ids` — §3.4.

**6. Can a person show a document without exposing ID numbers on it?**
For the museum, by **redaction**: the exhibit's picture is a holder-prepared,
covered, reduced copy, and the app names the sensitive fields the credential
carries. Selective disclosure exists in ACTIK (SD-JWT shares) but does not
help a picture. The printed code contains no national ID or student number —
only name, document number, institution, date and the file hash — and the
holder chooses whether to include it.

Governance questions 7–9 are for people, not code. Two facts that bear on
them: ACTIK's trust list is currently published in one place (its Supabase
project), not at three independent mirrors, so it does not yet meet QRSeal
§4.4; and the Root ceremony (README, setup step 4) names a role, not an
institution.

## 5. Rule by rule

| Rule | Where ACTIK meets it |
|---|---|
| 1, 8 — nothing looks official in phase 1; never a boolean | `verification` is always `self-asserted`; the file has no verified flag (tested) |
| 2 — self-added is not second-class | The export says plainly it will show as added by the owner, as a statement, not a warning |
| 3 — stricter visibility wins | `actikVisibility`; CamboVerse enforces (§3.2) |
| 4 — private by default | Export defaults to "only me"; "anyone" needs a confirmation |
| 5 — redaction is a normal step | Cover and crop are part of export; sensitive fields named; picture reduced and re-encoded |
| 6 — file, public image and credential are separate | `fileSha256`, `publicImage`, `credential` |
| 7 — keep the original's SHA-256 | `fileSha256`, consistent with `dh` |
| 9 — revoked disappears | Withdrawn credentials cannot be exported; `withdrawal.ids` let CamboVerse take an exhibit down later |
| 10 — no CDN, Khmer never guessed | Export is local; fonts are bundled; `khmerTitle` is `null`. New Khmer UI strings are marked `TODO(km-review)` |

## 6. Tests

- `test-museum.ts` (`npm run test:museum`): the package's fields, that the
  original never leaves, `fileSha256` ↔ `dh`, withdrawal ids matching both a
  jti withdrawal and a document-number withdrawal, refusals.
- `test-printed.ts`: the claim-time check of a printed copy (kept; another
  document, issuer or holder refused; damaged refused) and reprint fields.
- `test-trust.ts`: withdrawal lists name no one; free text and extra fields
  refused; old-format lists still withdraw and are republished as hashes.
