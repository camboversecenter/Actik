# Holder binding

A credential proves who it was issued to. Holder binding makes it also prove
that it is being presented **from the wallet it was issued to** — so a copy in
someone else's hands, or a presentation lifted from one employer and replayed
to another, is refused.

It follows SD-JWT's key binding: `cnf` in the signed credential, and a
key-binding JWT (`kb+jwt`) on each presentation.

## How it works

1. **Every wallet has a holder key.** The first time a wallet is unlocked, the
   app makes a P-256 key pair (`src/lib/holderKey.ts`). The private half is
   encrypted with the wallet's own key — the same end-to-end encryption as the
   credentials — and stored in `holder_keys`; the database holds ciphertext it
   cannot use. The holder's PIN or passkey opens it on any of their devices. In
   memory it is a non-extractable CryptoKey: it signs, and cannot be read out.
   It is never replaced: credentials are bound to it.
2. **The issuer binds the credential.** When the recipient already has a
   wallet, the issuing form looks up their public key (`holder_public_key`,
   callable by issuers only) and signs it into the credential as
   `cnf: { jwk }`. The review screen says whether the credential will be bound.
   A recipient with no wallet yet gets an unbound credential, as before.
3. **Claiming checks it is yours.** A bound credential is accepted into a
   wallet only if it is bound to that wallet's key.
4. **Presenting carries the wallet's proof.** A share link or a proof-request
   answer of a bound credential ends with a key-binding JWT signed by the
   holder key. It names its audience — `actik:share:<link id>` or
   `actik:proof-request:<request id>` — and hashes the exact presentation it
   accompanies (`sd_hash`).
5. **Verifying checks the proof.** The verify page and the employer's review
   require it for every bound credential:

| Presentation | Result |
|---|---|
| bound, proof from the holder's key, for this link or request | accepted; shown as *sent from the wallet it was issued to* |
| bound, no proof | refused: `HOLDER_PROOF_MISSING` |
| bound, proof from any other key, dated in the future, or not matching the disclosures it came with | refused: `HOLDER_PROOF_INVALID` |
| bound, proof made for a different link or request | refused: `HOLDER_PROOF_WRONG_AUDIENCE` |
| unbound | accepted; shown as *not bound to a wallet — check ID* |

Claiming a credential and exporting it from one's own wallet need no proof.

## What it does and does not prove

It proves the presentation came from the wallet the credential was issued to.
It does not prove which person is holding that wallet: someone who knows the
holder's PIN, or is handed their unlocked phone, can present for them. That is
why the candidate's name is still shown and an ID check at interview is still
advised — binding removes copying and replay, not collusion.

Credentials issued before this, or to people without a wallet at the time,
stay unbound and are labelled so. They can be bound by being issued again once
the holder has a wallet.

## Files

- `src/lib/sdjwt.ts` — `cnf` at issuance; `addKeyBinding`, `checkKeyBinding`
- `src/lib/holderKey.ts`, `src/components/HolderKeyKeeper.tsx`
- `src/lib/credentialCheck.ts` — `holderProof` option and `holder` result
- `src/lib/proofRequest.ts` — `buildBoundAnswer`, `proofAudience`
- `supabase/migrations/20261008_holder_binding.sql` (also `apply_all.sql`
  section 9): `holder_keys`, `holder_public_key`, and the answer guard reading
  past the proof
- `test-binding.ts` (`npm run test:binding`)
