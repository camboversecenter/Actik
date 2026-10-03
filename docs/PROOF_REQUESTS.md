# Proof requests

Recruitment where the candidate stays in control. An employer says what they
need to see; a candidate answers from their own wallet; the employer's app
checks each answer against the institution that issued it.

This is *managing* digital assets (see the README): the owner decides which
asset to show, to whom, and how much of it.

## The flow

1. **Ask.** Any signed-in account opens **Requests → New request** and says
   who is asking (as they describe themselves), what it is for, and which
   credentials they need: up to five, each a credential type plus, optionally,
   extra fields from a short list for that type, and a note in their own words
   ("in accounting or finance"). A request is open for 1–90 days.
2. **Share.** The request has a link and a QR code: `/request/<id>`. Anyone
   with it can read what is asked, signed in or not. There is no list of
   requests to browse.
3. **Answer.** The candidate taps **Answer from my Actik wallet**, signs in if
   needed (and comes back to the request), and unlocks their wallet. For each
   requirement the app offers the matching credentials, each already checked on
   the device — a withdrawn one is shown as withdrawn and cannot be chosen. The
   candidate sees exactly what the employer will see, chooses how they may be
   contacted, and sends. They can skip a requirement, and withdraw the whole
   answer later.
4. **Review.** The employer sees each answer checked on their own device
   against the Root-signed trust list and the institution's withdrawal list:
   who issued it first, then the fields, then its standing. There is no tick.

## What can never be asked

A request names fields from a per-type allowlist and nothing else:

| Type | Always shown | May also be asked |
|---|---|---|
| Academic degree | name, institution, degree, graduation date, certificate number | major, GPA |
| Professional certification | name, institution, certification, issuing body, date, licence number, expiry | — |
| Completion | name, institution, type, programme, completion date | duration, department or role |
| Attendance or participation | name, institution, type, event, date, organiser | role |
| Merit or excellence | name, institution, achievement, date awarded | basis of award |
| Appreciation or service | name, institution, type, reason, date | capacity |

So there is no way to ask for **date of birth or age, sex, marital status, a
photograph, national ID, student number, place of birth, religion or
ethnicity, or an email or phone number**. Job advertisements that specify
age, sex or marital status are the problem this rules out.

The allowlist is enforced three times:

1. the candidate's app discloses only allowlisted fields, whatever a request
   says (`buildAnswer` in `src/lib/proofRequest.ts`);
2. the database decodes every disclosure in every answer and refuses a
   response carrying anything else, or a credential of the wrong type
   (`proof_responses_guard`, `supabase/migrations/20261006_proof_requests.sql`);
3. the employer's app refuses to display an answer that discloses anything
   else — not even its allowed part.

The candidate's **name is always shown**, because a credential proves who it
was issued to, not who is presenting it. The employer is told to check the
person's ID at interview. Binding a credential to its holder cryptographically
is not built yet (it is the same open question as the museum's D5).

## Who sees what

| | Sees |
|---|---|
| Anyone with the link | the request: requester (self-described), title, description, what is asked, expiry |
| The employer | their own requests, and the answers to them: the contact the candidate left, and the allowed fields of each credential |
| The candidate | their own answers, and the requests they answered |
| Nobody else | anything |

The employer never sees the candidate's account, their other credentials or
their wallet. The candidate's account email is not shared unless they leave it
as the contact. Answers are stored as presentations in the database (as share
links are); end-to-end encrypting them to the employer is a possible next
step.

Rules in the database: a request can be closed once and otherwise never
edited; an answer can be withdrawn by the candidate and never edited; the
employer cannot delete or alter answers; one answer per candidate per request;
nothing can be answered once a request is closed or expired.

## What it does not do

- **Verify the requester.** The requester's name is as they state it, and is
  labelled that way. Tying a request to a registered organisation is a
  possible next step.
- **Rank or filter candidates.** The employer reads answers; Actik does not
  score them.
- **Search people.** Employers cannot browse wallets, which are end-to-end
  encrypted in any case.
- **Accept self-added items.** Only credentials an institution issued can
  answer, so "issued" and "added by me" cannot be confused.

## Files

- `src/lib/proofRequest.ts` — the format, the allowlist, building and checking
  answers (pure).
- `src/lib/proofRequestApi.ts` — reading and writing requests and answers.
- `src/pages/requests/` — the screens.
- `supabase/migrations/20261006_proof_requests.sql` (also in `apply_all.sql`
  section 7).
- `test-proof.ts` (`npm run test:proof`).
