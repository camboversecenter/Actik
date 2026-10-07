# Tokenized real-world assets — design note (not built)

ACTIK's purpose is issuing and managing digital assets with individual
ownership at the centre. Certificates came first, employment records second.
Tokenized real-world assets — land, a vehicle, a share in a cooperative — are
the longer aim. This note records how they would fit, and why nothing is built
yet.

## Why it waits

A token for a real-world asset is only worth what the **official register**
says. A signature from ACTIK, or from any issuer ACTIK admits, does not make
anyone the owner of a plot of land: the cadastre does. So this step waits for
a **legal partner who keeps an official register** and is prepared to sign
statements about it — and for legal advice on what such a statement means
under Cambodian law. Building it before then would produce tokens that look
like ownership and are not.

## What is already in place

The three steps before this one were built so that this one has something to
stand on:

1. **A valid person** — identity verifiers and holder-bound identity
   attestations ([`IDENTITY_VERIFIERS.md`](IDENTITY_VERIFIERS.md)). An asset
   bound to a wallet is bound to the person an identity verifier saw.
2. **Key recovery** — before anything valuable is held, a lost or compromised
   wallet has a way back ([`KEY_RECOVERY.md`](KEY_RECOVERY.md)).
3. **Verified contacts** — a transfer between two people can begin with "is
   it really you, right now?" ([`VERIFIED_CONTACTS.md`](VERIFIED_CONTACTS.md)).

## The shape it would take

- **A fourth trust-list tier, `registrar`**, admitted by the Root only for a
  body that legally keeps a register, and allowed to issue only an
  `asset_record` type. `issuerMayIssue()` gains one case; nothing else may
  issue it.
- **An asset record is a statement by the registrar, not a token that is the
  asset.** It says: register X, entry Y, records holder Z (by the holder key
  and the name on Z's identity attestation) as of date D. It is holder-bound
  and must be issued to a wallet holding an identity attestation whose name
  the registrar checks against its register. Never a national ID number,
  address or valuation in the record itself; the register keeps those.
- **"Current" is always "as of"**, like an employment record's status: the
  register is the truth, and the record is a signed snapshot of it.
- **Transfer happens in the register, not in ACTIK.** The seller and buyer go
  to the registrar (or its online service). ACTIK's role: the seller presents
  their record and identity attestation from one wallet (the review already
  says when they are bound to the same key); the two parties may run a
  verified-contact check; the registrar updates its register, withdraws the
  seller's record as `corrected`, and issues a new one to the buyer's key.
  ACTIK never moves ownership by itself; there is no "send token" button.
- **No public chain of ownership.** Withdrawal lists name no one; a record's
  history lives in the register, where the law already says who may see it.
- **Encumbrances** (a mortgage, a dispute) are the registrar's to state, as a
  field on the record that a verifier must show beside the holder's name.

## Questions for the legal partner

1. What exactly may a signed register extract assert, and for how long is it
   good?
2. Who may ask to see one — and may a holder present it selectively (entry and
   holder, without the valuation)?
3. How is the registrar's own identity check related to an ACTIK identity
   attestation: does one replace, or only support, the other?
4. What happens to an asset record when its holder's key is recovered — is a
   reissue a new register act?

Until these are answered, ACTIK issues no asset records.
