# Security Policy

Actik handles digital credentials and the keys that sign them. Thank you for helping
keep it secure.

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security problems.

Instead, report privately using GitHub's **"Report a vulnerability"** button under the
repository's **Security** tab (private vulnerability reporting), or contact the
maintainers at CamboVerse Center, National University of Management.

Include, where possible:

- A description of the issue and its impact.
- Steps to reproduce (a proof of concept helps a lot).
- The affected area (frontend, SD-JWT code, Supabase policies, issuer key vault).

We aim to acknowledge reports within a few days. Please give us reasonable time to fix
the issue before any public disclosure.

## Scope notes for researchers

- The Supabase **anon key** in the client is public by design; access control relies on
  Row-Level Security and the policies in `supabase/`. Bypassing RLS IS in scope.
- Forging or replaying a credential, share link or presentation, and any way to issue
  without issuer accreditation (the admin approval gate), IS in scope.
- Anything that exposes issuer signing keys or vault plaintext to the server IS in scope.
- Denial-of-service and social-engineering reports are out of scope.

## Known limitations

This is an MVP. Missing Key Binding (KB-JWT), no revocation list and a browser-held
issuer key are documented in the README under "Limitations". Reports that only restate
those are welcome as feature requests, not vulnerabilities.

## Secrets

No real secrets are committed to this repository. The app reads its Supabase URL and
anon key from environment variables only (see `.env.example`). Earlier commits in the
git history contain the public anon key of a development project; it grants only what
RLS allows. If you believe you found a real secret, report it privately as above.
