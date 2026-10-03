# Employment records

Proof of work, issued by the employer and held by the employee. A record says
"this person works, or worked, here, in this job, from this date" — signed by
the employer, accepted by the employee, and shown by the employee wherever they
need it: a proof request, a share link, a CamboVerse museum.

It is a second kind of digital asset beside certificates, built on the same
issuing, wallet, withdrawal and verification as they are.

## Who may issue them: registered employers

The trust list now carries each issuer's **kind**, signed by the Root:

| Kind | May issue | Shown to verifiers as |
|---|---|---|
| `institution` | every credential type, including employment records for its own staff | Accredited institution |
| `employer` | **employment records only** | Registered employer |

- A company registers like an institution and picks **Employer** as its type.
  The kind is fixed at registration; after that only an admin can change it.
- It is trusted only once the Root holder builds and signs the next trust list.
  The build prints each issuer's tier so the Root checks it as carefully as the
  name, and refuses to sign an issuer whose kind it does not recognise.
- A list signed before kinds existed reads as all institutions, which is what
  they were.
- Verifiers refuse a non-employment credential from an employer with
  `TYPE_NOT_ALLOWED_FOR_ISSUER`, in the app and on printed codes. The database
  refuses it at the outbox too.

The tier is shown next to the issuer's name everywhere a credential is checked,
so a job record from a three-person shop never borrows a university's weight.

## What a record says, and never says

| Always | Optional | Never |
|---|---|---|
| name, employer, job title, employment type (full-time, part-time, contract, internship, volunteer), start date, status (current / ended) and end date | department, role in a line | salary, reason for leaving, performance or disciplinary notes, a free-text note, an attached file |

"Never" is enforced, not just left off the form: the outbox guard decodes every
disclosure of the signed record and refuses any claim outside the allowed set
(`pending_credentials_employment_guard`), so a modified app cannot slip a salary
in. A record people fear to accept, or that can be used against them, is a
record they will not carry.

**"Current" is as of the day the employer signed it.** Every screen shows it
that way: *Current, as of 3 October 2026 (when the employer signed it)*. When the
job ends or the title changes, the employer issues a new record and withdraws
the old one as *replaced by a corrected credential*. Verifiers then refuse the
old one with that reason and accept the new one.

## The employee decides

A record reaches the employee's inbox, never their wallet directly. They
**accept** it (their app checks the signature and the employer's tier first,
then stores it encrypted) or **decline** it, which deletes the offer. Nothing
unaccepted appears anywhere the employee shows their credentials. This is the
protection against spam and against records the employee disputes.

## Where it is used

- **Proof requests** can ask for an employment record, and additionally for the
  department or role line. Every answer shows the job title, type, dates and
  status.
- **Share links and the verify page** show the record with the employer's tier.
- **Museum export** hangs it as `kind: "work"`.
- **Printed certificates** do not apply: a record has no document number.

## Files

- `src/lib/trustList.ts` (`IssuerKind`, `issuerMayIssue`),
  `src/lib/trustListBuild.ts`, `scripts/build-trustlist.ts`
- `src/pages/app/IssueCredential.tsx` (the form), `Notifications.tsx` (decline),
  `CredentialDetail.tsx`, `src/lib/claimDisplay.ts` ("current as of")
- `supabase/migrations/20261007_employment_records.sql` (also in
  `apply_all.sql`, section 8)
- `test-employment.ts` (`npm run test:employment`)
