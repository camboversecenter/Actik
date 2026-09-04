-- institution_name has never existed as a column on either
-- pending_credentials or credentials (confirmed live: both error with
-- "column ... institution_name does not exist"). The real institution name
-- only ever lived inside the encrypted SD-JWT payload (the `institution`
-- claim, set in IssueCredential.tsx), which requires a full vault unlock +
-- decrypt to read. Wallet.tsx/WalletCategory.tsx/Notifications.tsx render a
-- lightweight card list without unlocking the vault, so they've always
-- shown a blank/fallback institution name on every card — this adds the
-- plain-column fast path the UI code already expects (IssueCredential.tsx's
-- `insertData.institution_name` / Notifications.tsx's `PendingCredential.
-- institution_name`, both pre-existing but writing/reading nothing).
--
-- This is a display convenience only — it duplicates the `institution`
-- claim already inside the signed credential rather than replacing it, so
-- it doesn't change what's cryptographically signed.

alter table pending_credentials add column if not exists institution_name text;
alter table credentials add column if not exists institution_name text;
