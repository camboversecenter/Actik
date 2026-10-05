# Federation: many ACTIK installations, one hub that holds no personal data

**Status: design only. Not to be built yet.**

ACTIK is open source, so anyone may run their own installation — a
university, a training provider, an employer, another country. This document
records how separate installations would connect through a hub that holds only
public, signed documents, and what the code must avoid now so that this stays
possible.

It is deliberately not built. Build it when both of these are true:

1. ACTIK has real use: at least one pilot with a real issuer and a real
   employer.
2. A second organisation has committed to running its own installation.

Until then there is one hosted installation, the code is open, and the hub
would be a list with one entry.

## 1. The shape

```
            ┌──────────── hub (public, signed documents only) ────────────┐
            │  list of installations · mirrors of trust & withdrawal lists │
            │  credential-type definitions · conformance suite · directory │
            └───────────────▲───────────────────────▲─────────────────────┘
                            │ fetch, verify         │ fetch, verify
   ┌────────────────────────┴───┐         ┌─────────┴──────────────────────┐
   │ installation A (university)│         │ installation B (hosted service) │
   │ Root A · issuers · wallets │◀───────▶│ Root B · issuers · employers    │
   └────────────────────────────┘ direct  └────────────────────────────────┘
                     wallet ↔ verifier, never through the hub
```

Credentials, presentations, proof answers, wallets and exhibits **never pass
through the hub.** A wallet talks to the verifier or employer directly, on
whatever installation each is.

## 2. What the hub does

| Job | What it holds | Personal data |
|---|---|---|
| Signs the **list of installations** (§3) | each installation's Root keys and list addresses | none |
| **Mirrors** every installation's trust list and issuers' withdrawal lists | signed documents it cannot alter | none — withdrawal entries are hashes |
| Publishes the **credential-type definitions** | which claims each type carries, what is always disclosed, what may be requested | none |
| Publishes the **conformance suite** (§6) | test vectors | none |
| Keeps a **directory**: which installation an issuer DID or a request address belongs to | addresses | none |

What it must never do: store a credential or presentation, see a proof
request's answers, log which credential was checked by whom, or offer any
search over people.

## 3. The list of installations (`actik/installations/1`, draft)

The same pattern as the EU's list of trusted lists: one signed list pointing to
many signed lists.

```json
{
  "type": "actik/installations/1",
  "version": 12,
  "issuedAt": 1791043200,
  "expires": 1793721600,
  "installations": [
    {
      "id": "edu.example-university",
      "name": "Example University",
      "origin": "https://actik.example-university.edu.kh",
      "rootKeys": [{ "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }],
      "trustLists": ["https://actik.example-university.edu.kh/trustlist", "https://hub.example/mirror/edu.example-university/trustlist"],
      "status": "active",
      "conformance": "actik-conformance/1",
      "since": 1780000000
    }
  ]
}
```

Signed by the hub key, valid for at most 31 days, refused on rollback, like a
trust list. Apps pin the **hub key** instead of a single Root.

A verifier then:

1. opens the hub's list against the pinned hub key;
2. for each active installation, fetches its trust list from any listed mirror
   and opens it against **that installation's** Root keys;
3. takes the union of issuers, each tagged with its installation. An issuer DID
   claimed by two installations is refused, not merged.

The verifier still decides offline from documents it holds. Nothing is looked
up per credential.

## 4. What changes in ACTIK when it is built

| Today | Federated |
|---|---|
| One pinned Root (`VITE_TRUST_ROOT_KEYS`) | A pinned hub key, plus the Roots it lists |
| Trust list read from this installation's database | Each installation's list, from its own address or a mirror |
| Withdrawal lists read from this database | From the issuer's installation; the trust-list entry carries the address |
| Wallet tied to one installation | Encrypted wallet export and import, **including the holder key** — bound credentials are useless without it |
| Proof requests and shares within one installation | A standard exchange across installations (§5) |

## 5. Protocols: adopt, don't invent

Use the OpenID standards for verifiable credentials — **OpenID4VCI** for
issuing to a wallet on another installation, **OpenID4VP** for presenting to a
verifier on another installation — rather than ACTIK-only messages. That also
makes ACTIK work with other wallets, including Europe's.

The limits on what a proof request may ask (docs/PROOF_REQUESTS.md) must
survive this. A foreign wallet may not enforce them, so under federation the
**receiving** side carries them: the database guard and the requester's
application refuse any answer that discloses a field outside the allowlist, as
they already do.

## 6. Conformance

An installation joins the hub by passing the conformance suite, not by paying.
The suite is ACTIK's tests exported as fixed vectors, the way the QRSeal
specification publishes its own: for every format (`actik/trustlist/1`,
`actik/revocations/2`, `actik/exhibit/1`, SD-JWT with key binding, KH-SQR
Profile B), a set of inputs and the exact accept/refuse result and reason
string expected. Formats are versioned; a version, once published, never
changes meaning.

## 7. Governance (the hard part)

- **The hub key** decides which installations count. It is held by a neutral
  body under published rules, not by any operator that sells hosting.
- **Admission** of an installation: passes the conformance suite, publishes its
  admission rules for issuers, keeps its trust list current. **Suspension**: a
  public reason, and the installation's issuers stop verifying until it is
  restored.
- **The weakest installation sets the bar.** One installation admitting a
  diploma mill lowers trust for all. The hub's rules for installations must
  therefore include minimum rules for admitting issuers, and verifiers should
  be able to show which installation an issuer came from.
- **Sustainability.** The hub earns nothing and must be republished at least
  every 31 days for as long as credentials need to verify. It is a public good
  and needs funding as one.
- **Relation to the national platform.** The hub connects ACTIK installations.
  It is not a national trust authority and must not be presented as one.

## 8. Decide before the first real credential is issued

Nothing has been issued yet, so these cost nothing to change now. After the
first real credential they cost a migration, or are permanent: every credential
signs them in.

1. **Credential-type namespace.** `vct` values are
   `https://actik.kh/credentials/<type>`. Choose a namespace the project
   actually controls and will keep for decades (a domain held for the project,
   or a URN that needs no domain). It is signed into every credential.
2. **Binding audiences name the verifier.** Key-binding audiences are
   `actik:share:<id>` and `actik:proof-request:<id>`. Under federation they
   should be the verifier's address, e.g.
   `https://<installation origin>/request/<id>`, as OpenID4VP does, so that a
   proof made for one installation can never be accepted by another.
3. **Trust-list issuer entries carry their withdrawal-list address.** An
   optional field now, so that verifiers on other installations know where to
   fetch it.
4. **Wallet export format.** Define it (credentials plus the encrypted holder
   key) before anyone holds a bound credential they might need to move.

## 9. Already done

- Issuer identifiers are `did:web`, unique by web domain across installations.
- Credentials are self-contained signed documents that verify anywhere the
  issuer's keys are known.
- All signed formats carry a type and version.
- Withdrawal lists name no one, so mirroring them publicly is safe.
- Personal data stays in end-to-end encrypted wallets; nothing about people
  would need to reach a hub.
