# src/khsqr — vendored KH-SQR (QRSeal) core

These files are copied from the QRSeal repository, `packages/core/src/`, at
commit `0762ea1163696fa7ed19ebd9dc1bee3737929465`. QRSeal is MIT-licensed,
copyright (c) 2026 Chay Sengtha; the licence text is in `LICENSE` beside this
file.

Only the files the printed lane needs are here: Profile B (credentials) and
what it depends on — base45, a strict CBOR codec, COSE_Sign1, key ids,
errors with stable reason strings, and the trust-list types. Profile A
(payments) is not vendored.

**Do not edit these files except to re-vendor them.** They are checked against
QRSeal's own conformance vectors by `npm run test:printed`; a local edit that
changes behaviour will fail that test, which is the point.

One deliberate deviation, marked `ACTIK DEVIATION` in `profileB.ts`:
`verifyProfileB` takes an interface (`ProfileBTrustSource`) rather than the
`TrustAnchor` class, so Actik can present its own signed trust list and
withdrawal lists to it. QRSeal's `TrustAnchor` still satisfies the interface,
which is how the conformance vectors run against this copy.

To re-vendor: copy the same eight files from a newer QRSeal commit, reapply the
deviation, update the commit above, and run `npm run test:printed`.
