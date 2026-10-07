# Key recovery

Every wallet has a holder key, and credentials are bound to it
([`HOLDER_BINDING.md`](HOLDER_BINDING.md)). That is what makes a credential
the holder's own — and it means that when the key goes, the credentials
bound to it can no longer be presented by their holder. Before anything
valuable is held in a wallet, there has to be a way back. This is it.

There is no recovery service and no escrowed key. A lost key stays lost. What
is recovered is the **credentials**: each issuer reissues them to a new key,
once the holder has shown it is the same person.

## Keys keep a history

`holder_keys` holds every key a person has had: at most one **active** key and
any number of **retired** ones. A key is never edited, reactivated or deleted:
credentials signed to it still name it. The database computes each key's RFC
7638 thumbprint itself (`jwk_thumbprint`), and refuses any change except
retirement.

`retire_holder_key(reason)` is the only way a key changes:

| Reason | When | Can it still prove continuity? |
|---|---|---|
| `lost` | PIN forgotten, wallet reset (the reset retires it automatically) | No — it cannot be opened |
| `compromised` | someone else may have the unlocked phone or the PIN | **No, never** — whoever compromised it could make the same proof |
| `replaced` | retired on purpose, still in the wallet | Yes |

A key retired as lost or replaced can later be marked compromised, never the
reverse; doing so declines any open request that relies on it. After any
retirement the next unlock makes a new key, and issuers bind to that one
(`holder_public_key` returns only the active key; an identity attestation must
be bound to it).

## The two cases

**A — forgotten PIN, new wallet.** The wallet is reset; the key and the
credentials sealed with it are gone. The person goes to an identity verifier in
person ([`IDENTITY_VERIFIERS.md`](IDENTITY_VERIFIERS.md)) and gets a new
identity attestation bound to the new key. Then, for each issuer that issued
them something, they send a reissue request with that attestation. The issuer
finds the credential in its own records (its issuance log, by the person's
email) and issues it again from the usual form, which opens with the email and
the attested name filled in.

**B — compromised wallet.** The person retires the key as compromised. They
still have their credentials (the wallet opens), but the old key proves
nothing any more, so they too get a fresh identity attestation. Their request
carries the old credential, so the issuer can reissue exactly what it signed.

A holder who retired a key on purpose (`replaced`) can skip the identity check:
the old key, still in the wallet, signs the request.

## The reissue request

A request (`reissue_requests`) names one issuer and carries:

- `proof = old_key`: the old credential with every disclosure, plus a
  key-binding proof from the **old** key whose audience is
  `actik:reissue:<issuer DID>:<new key thumbprint>`; or
- `proof = identity`: an identity attestation bound to the **new** key, with
  that key's proof for the same audience, and the old credential if the holder
  still has it.

The audience names the new key, so a proof cannot be redirected to anyone
else's key, and names the issuer, so it cannot be replayed to another issuer.

The database fills in who is asking, their email and their **current** key;
the holder cannot name a key. It refuses an old-key proof from a key that is
not one of the holder's retired keys, or that was retired as compromised; an
identity attestation bound to anything but the current key; a credential sent
to an issuer that did not issue it; and a second open request for the same
credential. The issuer can only resolve a request (reissued or declined), once.

The issuer's app checks every request before showing it
(`checkReissueRequest`, `src/lib/reissue.ts`):

- the old credential verifies as **this** issuer's own, and is not already
  withdrawn (a request cannot be used twice);
- old key: the proof verifies against the key the credential is bound to, for
  this issuer and the new key;
- identity: the attestation comes from an identity verifier, is bound to the
  new key, carries the new key's proof for this issuer, and its name matches
  the credential's (case and spacing ignored; nothing fuzzy).

## Reissuing

**Reissue to the new key** signs the same claims again (everything the old
credential disclosed, with fresh `iss`, `iat`, `exp` and `jti`), bound to the
new key, into the person's inbox with `replaces_jti` naming the old one. Then
the issuer's withdrawal list gains the old credential as `corrected`, so a copy
in the wrong hands stops verifying. When the person accepts, their wallet
removes the copy it replaces — or any copy of that document it can no longer
open — so one wallet never holds both.

A printed copy is not affected: it was never bound, and the withdrawal names
only the old credential's `jti`.

## Limits, stated in the app too

- If someone has the unlocked phone or the PIN, they can present the
  credentials until the key is retired.
- If they reach an identity verifier with the person's own document before the
  person does, they could ask for reissues too. The identity verifier's
  in-person photo comparison is what stands in the way.
- Recovery takes the person's effort and each issuer's: one request per
  issuer, each reviewed by a person at the issuer.

Tests: `test-recovery.ts`. SQL checked on PostgreSQL 16.
