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
- In the SQL editor, run `supabase/schema.sql` (tables + Row Level Security).
- Auth → turn on Email. For quick local testing you can disable email
  confirmation.

### 4. Configure env

```bash
cp .env.example .env   # then fill in your project URL + anon key
```

### 5. Run

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
   that issuer's `accredited` = `true` (this is the MoEYS step).
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
  The `issuers.accredited` check proves *the signer is legitimate*.
- **Recovery.** zk-vault has zero key-recovery by design, so the issuer remains
  the source of truth: a lost vault is recovered by re-issuance, never by the DB.

## Limitations (deliberate MVP scope)

- **No Key Binding (KB-JWT).** Presentations aren't yet bound to the holder's
  key or to a specific verifier/nonce, so a leaked link could be replayed before
  it expires. Adding KB-JWT is the most important next step.
- **No real `did:web` hosting / revocation list.** Issuer keys are resolved from
  the registry table, not from `/.well-known/did.json`, and there's no
  Bitstring Status List yet.
- **Issuer key in browser.** Fine for a demo; production keys belong in a KMS/HSM
  on the issuer's server.
- Replace the hand-rolled SD-JWT with `@sd-jwt/sd-jwt-vc` for production.
```
