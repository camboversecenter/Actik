# Actik — digital proof of ownership (MVP)

Actik's long-term focus is **RWA (real-world asset) tokenization / digital
proof of ownership**. Digital certificates are the first product — a
deliberate entry point, not the end goal — because they're simpler to build
and have clear early demand (MoEYS accreditation, universities).

This MVP is a Vite + React + TypeScript **PWA** for issuing, holding, and
verifying digital certificates, backed by **Supabase**. It implements the core
lifecycle from the design proposal:

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
verifiers report their credentials' standing as *unchecked*.

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
