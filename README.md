# Actik — issue and manage digital assets (MVP)

Actik has two purposes:

1. **Issue digital assets** — an institution signs an asset in its own name,
   so anyone can check who issued it.
2. **Manage digital assets** — the owner holds their assets, decides who sees
   what, and takes them where they are needed (a share link, a printed copy, a
   CamboVerse museum).

A **digital certificate is one kind of digital asset**, and the first one
built: simple enough to start with, and with clear early demand. The longer
aim is digital proof of ownership for real-world assets (RWA). Code and
formats that are certificate-specific today are named as such, so that other
asset kinds can be added beside them rather than forced into a certificate's
shape.

This MVP is a Vite + React + TypeScript **PWA**, backed by **Supabase**. For
certificates it implements the core lifecycle from the design proposal:

1. **Issue** — an accredited issuer (university / ministry / trainer) signs a
   credential as an **SD-JWT** under a `did:web` identity.
2. **Hold** — the owner claims the credential and stores it **encrypted in a
   zero-knowledge vault** (zk-vault-react). Supabase only ever sees ciphertext.
3. **Share** — the owner builds a **time-limited, selectively-disclosed**
   presentation (reveal degree + name, hide GPA + national ID) as a link.
4. **Verify** — anyone with the link verifies the signature, checks the issuer
   against the **trust registry**, and sees only the disclosed fields. No account
   needed.

> This is a learning MVP, not production. See **Limitations** below.

## What works today

- A faithful, tested minimal **SD-JWT** implementation (`src/lib/sdjwt.ts`):
  salted-hash disclosures, selective presentation, signature + expiry verification.
  Run `npm run test:sdjwt` to see it round-trip (including Khmer text).
- `did:web` issuer identities and ES256 key generation (`src/lib/did.ts`).
- A **trust registry** as the `issuers` table — maps DID → public key + an
  `accredited` flag (MoEYS would own this in production).
- Time-limited shares with server-side expiry (`shares.expires_at`).
- PWA install + offline app shell via `vite-plugin-pwa`.

## Setup

### 1. Install

```bash
npm install
```

### 2. Add the encryption library

zk-vault-react ships as source you copy in. Follow `src/vault/README.md`:
clone https://github.com/sengtha/zk-vault-react and copy its `src/zk-vault/`
into `src/vault/zk-vault/` and its `src/components/` into `src/vault/components/`.
(Until you do, the build fails on the vault imports — that's expected.)

### 3. Create the Supabase project

- Create a project at supabase.com.
- In the SQL editor, run `supabase/apply_all.sql` — tables, Row Level Security,
  functions and triggers, in one idempotent script. It is safe to re-run, and
  it is also how you bring an existing project up to date.
  (`supabase/migrations/` holds the same changes as individual dated files;
  `supabase/schema.sql` is the original bootstrap and is no longer complete on
  its own.)
- Auth → turn on Email. For quick local testing you can disable email
  confirmation.

### 4. Create the trust Root and publish the first trust list

Verifiers do not trust the database. They trust a list of accredited
institutions and their keys, signed by a **Root** key whose public half is
pinned into the app build and whose private half never touches a server.
Approving an institution in the admin dashboard is a request; it takes effect
when the Root holder signs and publishes the next list.

```bash
# Once, offline. Refuses to write inside this repository.
npx tsx scripts/trust-root-keygen.ts --out /media/usb/actik-root.private.jwk.json
# → prints VITE_TRUST_ROOT_KEYS='[...]' for step 5
```

Then, whenever the registry changes and **at least every 30 days** (a list
expires, and verifiers stop verifying rather than trust a stale one):

1. In the SQL editor run `supabase/queries/export_trustlist_input.sql`; save the
   JSON cell as `trustlist-input.json`.
2. Build and sign:
   ```bash
   npx tsx scripts/build-trustlist.ts --root /media/usb/actik-root.private.jwk.json \
     --input trustlist-input.json --previous trustlist-current.json --out trustlist-next.json
   ```
   (omit `--previous` the very first time). Read the summary it prints: it is
   exactly who verifiers will trust for the next 30 days.
3. Paste the `insert into public.trust_documents …` statement it prints into
   the SQL editor. Keep `trustlist-next.json` as next time's `--previous`.

Keep the Root private key on removable media or in an HSM, with a second copy
somewhere physically separate. Anyone holding it can declare any institution
accredited.

**Institutions** sign their own withdrawal lists from the app (Issued
credentials → Withdrawals) and must renew them at least every 30 days, or
verifiers report their credentials' standing as *unchecked*. The lists are
public, so they name no one: each entry is a hash of the issuer and the
document number (or jti), one of two fixed reasons (`withdrawn`, `corrected`)
and a date. An institution still holding a list in the older plaintext format
is told to renew it; until it does, only it can read that list.

**Key changes.** When an institution regenerates its key, the old one is
retired (what it signed keeps verifying) and the new one is recorded — but
credentials signed with the new key do not verify until the next list is
published. If a key is *compromised*, set `revoked_at` on its `issuer_keys`
row in the SQL editor and publish a new list: nothing it signed verifies after
that.

### 5. Configure env

```bash
cp .env.example .env   # project URL, anon key, and VITE_TRUST_ROOT_KEYS from step 4
```

### 6. Run

```bash
npm run dev            # http://localhost:5173
npm run build          # production build (after the vault library is added)
npm run preview
```

> WebAuthn/passkeys and the vault require a **secure context** — `localhost` is
> fine; otherwise serve over HTTPS.

## Printed certificates

Actik has two lanes, with one trust layer underneath both:

| | In-app share | Printed certificate |
|---|---|---|
| The QR carries | a link to `/verify/<id>` | the signed credential itself (`KH1:…`) |
| Verified | in a browser, online | in the Actik app, at `/scan` |
| Selective disclosure | yes (SD-JWT) | no — four fields, printed and signed |

After issuing a **degree** (with a certificate number) or a **professional
certification** (with a licence number), the success screen offers a printable
certificate. Its QR code is QRSeal's Profile B: the holder name, document
number, issuing institution and issue date are signed into it and printed
beside it, verbatim. Credentials without a document number cannot be printed —
the verifier would have nothing on the paper to compare.

**Verifying.** Open `/scan` in the Actik app (camera, a photo of the code, or
paste). The scanner refuses every link except this app's own `/verify/…` pages,
so a lookalike QR on a forged certificate cannot send anyone to a website. A
verified certificate shows the four signed fields to compare with the paper — a
genuine code copied onto a forged certificate still verifies, and only that
comparison catches it — plus its standing against the institution's withdrawal
list. Withdrawing a credential in the app withdraws its printed copy too.

**The holder keeps the printed code.** It is signed before the credential goes
out and travels with it; when the holder claims the credential, their app
checks the code on its own and that it names the same document, holder and
institution, then stores it in their encrypted vault. The holder can reprint
the certificate from the wallet (credential → **Print certificate**).

**What is QRSeal and what is Actik.** The wire format, signature check, issuer
binding and reason strings are QRSeal's, vendored unmodified in `src/khsqr/`
and checked against QRSeal's own conformance vectors (`npm run test:printed`).
Which keys are trusted and which credentials are withdrawn come from Actik's
Root-signed trust list and withdrawal lists. One deliberate difference: QRSeal
stops trusting a key once it expires; Actik keeps trusting a *retired* key for
what it signed before retirement, so rotating a key does not void every printed
certificate. A suspected compromise must therefore be a key **revocation**.

**Hosting.** The scanner needs the camera: serve the app with
`Permissions-Policy: camera=(self)` (not `camera=()`). The Khmer font is bundled
(`@fontsource/noto-sans-khmer`) so certificates print with correct shaping and
the scanner works offline.

## Paper

`paper/` holds a preprint describing this design and what has and has not been
tested: *Proof Without a Verdict* (`make -C paper` builds `main.pdf` and
`main-twocol.pdf`). Its test counts come from `npm test`, and its sizes and
timings from `npm run measure`.

## Holder binding

Every wallet has its own key, kept encrypted with the wallet. When the
recipient already has a wallet, the issuer binds the credential to that key,
and every share link or proof-request answer then carries a proof from it, made
for that one recipient. A copy in someone else's hands, or an answer replayed to
another employer, is refused. Unbound credentials (issued before a wallet
existed) still verify and are labelled "check ID". Details:
[`docs/HOLDER_BINDING.md`](docs/HOLDER_BINDING.md).

## Employment records

Proof of work: a **registered employer** — a trust-list tier signed by the Root,
shown to every verifier, allowed to issue employment records only — signs a
record of job title, type and dates. It reaches the employee's wallet only if
they accept it; they can decline. It never carries salary, reason for leaving or
ratings (the database refuses them). "Current" is always shown as of the day it
was signed. Details: [`docs/EMPLOYMENT_RECORDS.md`](docs/EMPLOYMENT_RECORDS.md).

## Proof requests (recruitment)

An employer asks for proof — **Requests → New request**: up to five credential
types, with a few optional extra fields per type — and shares the link. A
candidate answers from their own wallet with only the fields the request may
see, and can withdraw the answer later. The employer's app checks each answer
against the issuing institution, issuer first, no tick. A request cannot ask
for date of birth, sex, marital status, a photograph, national ID or student
number; the database refuses any answer that carries them. Details:
[`docs/PROOF_REQUESTS.md`](docs/PROOF_REQUESTS.md).

## Personal museum (CamboVerse)

A holder can add a credential to a CamboVerse personal museum: credential →
**Add to museum**. They crop the picture and cover what should not be shown,
choose who may see it (only me by default), and choose whether to include the
institution's signed printed code. The app builds an `actik/exhibit/1` file on
the device — the original file's SHA-256, the prepared picture, the code — and
never the original file. A withdrawn credential cannot be exported. Format,
how CamboVerse should read it, and the open identity question (D5):
[`docs/MUSEUM_EXPORT.md`](docs/MUSEUM_EXPORT.md).

## Try the full flow

1. Sign up as `issuer@example.com`, go to **Issue**, register an issuer
   (e.g. name "RUPP", domain `rupp.edu.kh`). In the Supabase table editor set
   that issuer's `accredited` = `true`, then build and publish a trust list
   (step 4 above) so verifiers trust it.
2. Still in the same browser session, issue a degree to `student@example.com`.
   (The issuer's private key is held in memory for the session only.)
3. Sign out, sign up as `student@example.com`, set up the vault, tap
   **Check for new** to claim the credential into the encrypted vault.
4. **Share with an employer** — pick fields to reveal, set an expiry, copy the
   link.
5. Open the link in a private window (no login) to see the verifier result.

## Architecture notes

- **Signed ≠ encrypted.** The SD-JWT is signed (authenticity). Confidentiality
  comes from zk-vault at rest and TLS in transit. A verifier always reads the
  disclosed fields in clear — selective disclosure controls *what* they see.
- **Trust registry is the point.** A valid signature only proves *who signed*.
  The Root-signed trust list proves *the signer is legitimate* — and because it
  is signed by a key pinned in the app, not read from a table, nobody with
  database access can add an institution or swap its key.
- **Recovery.** zk-vault has zero key-recovery by design, so the issuer remains
  the source of truth: a lost vault is recovered by re-issuance, never by the DB.

## Limitations (deliberate MVP scope)

- **No Key Binding (KB-JWT).** Presentations aren't bound to the holder's key,
  so a forwarded or leaked link can be replayed until it expires, is revoked,
  or — if the holder chose *one view only* — has been opened once.
- **No `did:web` hosting.** Issuer keys come from the Root-signed trust list,
  not from `/.well-known/did.json`.
- **Issuer key in the browser.** It is held as a non-extractable key in memory,
  so script on the page can use it while the session is open but cannot copy it
  out. Production keys still belong in a KMS/HSM on the issuer's side.
- **One mirror, no timestamp role.** The trust list is published from this
  Supabase project only, and a first-time verifier will accept any genuine,
  unexpired list (up to 31 days old). QRSeal's separate timestamp role and
  independent mirrors would close both; neither is built.
- Replace the hand-rolled SD-JWT with `@sd-jwt/sd-jwt-vc` for production.
```
