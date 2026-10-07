# Verified contacts — "is it really you, right now?"

A video call or a voice message can now be faked well enough to fool family.
A signature from someone's own wallet key cannot be faked without their
unlocked phone and their PIN. Verified contacts turn that into a check anyone
can run in the middle of a call: tap **Check**, and the other person's wallet
answers.

## No register, no graph

- There is no directory of people and no stored contact graph. Each person's
  contacts live in `wallet_contacts`, **end-to-end encrypted** with their own
  wallet key like their credentials: the database sees ciphertext, not who
  knows whom.
- A check travels as a short-lived row in `contact_checks`, addressed to a
  wallet key by its thumbprint (`holder_keys.kid`, computed by the database).
  It lives two minutes; rows older than ten minutes are deleted whenever a new
  check is made, and the asker deletes theirs as soon as it is settled. While
  it lives it says that one key asked another — the minimum a relay needs.

## The first link

Two ways, and nothing else:

1. **In person, by QR.** Each scans the other's code (Contacts → Your card),
   which carries only their holder public key, and gives the contact a name.
2. **A contact card with an identity check.** The card carries an identity
   attestation bound to the card's key ([`IDENTITY_VERIFIERS.md`](IDENTITY_VERIFIERS.md)),
   with that key's proof (audience `actik:contact-card:<kid>`). The receiving
   app verifies it like any credential — a Root-admitted identity verifier,
   not withdrawn, bound to *this* key — and takes the name from it. Someone
   else's identity check pasted onto a card with your own key is refused.

The contact stores the key exactly as received. Every later check is verified
against that stored key, never against one the database supplies.

## The check

1. A taps **Check B**. The database fills in A's current key and a fresh nonce
   (`gen_random_uuid`), sets a two-minute expiry, and refuses checks to a
   retired key ("meet again to add the new one"), to oneself, or more than
   five a minute.
2. B's app, unlocked, sees a check addressed to B's current key and shows
   **"A is asking you to confirm it's you, right now"** — A's name from B's
   *own* contacts. If A is not one of them, it says so and advises declining.
3. B approves **with their PIN** (or passkey), entered there and then (an unlocked phone in
   someone else's hand is not enough). B's app signs a compact JWS,
   `typ: actik-presence+jwt`, `{nonce, aud: A's key thumbprint, sub: B's key
   thumbprint, iat}`, with B's holder key. `answer_contact_check` accepts it
   only for the addressed key, once, before expiry. B can decline instead.
4. A's app verifies the answer against B's key **from A's contacts**: the
   signature and `typ`, the nonce, the audience (A's own key), and the time
   (signed no earlier than the check was asked, at most two minutes ago, not
   in the future). It then shows **"B confirmed at hh:mm"** — a time, not a
   tick — or why not (`messageForPresence`).

The answer is bound to the nonce and to A's key, so it cannot be replayed to a
later check or passed on to someone else.

## Never a spoken code

A code read aloud over a faked call is relayed by the faker in real time. The
app never asks for one, and says so.

## What it cannot do (also shown in the app)

- **Someone holding B's unlocked phone and PIN** can approve. The check proves
  B's wallet answered, not who is holding it.
- **Double impersonation.** If the first link was made with an impostor — in
  person, or from a card with no identity check — every later check confirms
  the impostor. A card with an identity check narrows this to whoever the
  identity verifier saw in person.
- It does not say anything about what B says on the call, only that B's wallet
  was in B's hands (with B's PIN) at that moment.
- When B retires their key (see [`KEY_RECOVERY.md`](KEY_RECOVERY.md)), checks
  to the old key are refused; the contact must be added again.

Code: `src/lib/contacts.ts` (cards, signing, verifying — pure),
`src/lib/contactsApi.ts`, `src/pages/app/Contacts.tsx`,
`src/components/PresencePrompt.tsx`. Database:
`supabase/migrations/20261011_verified_contacts.sql`. Tests:
`test-contacts.ts`; SQL checked on PostgreSQL 16.
