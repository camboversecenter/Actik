-- NOT THE SETUP FILE ANY MORE. Run supabase/apply_all.sql instead: it is every
-- migration folded into one idempotent script, and it is the only file that
-- leaves a database in a state the app can actually run against — the trigger
-- and the five RPCs the app calls do not exist here.
--
-- This file is kept as the original bootstrap, matching what a project created
-- from it looked like before supabase/migrations/ existed. If you edit it,
-- edit apply_all.sql too, or the next person inherits the drift this comment
-- is standing in for.
--
-- Enables pgcrypto for gen_random_uuid().
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Holds zk-vault envelopes (ciphertext only).
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text,
  vault_envelope_pin text,
  vault_pin_salt text,
  vault_envelope_passkey text,
  passkey_id text
);

-- ---------------------------------------------------------------------------
-- issuers: the TRUST REGISTRY. Maps an issuer DID to its public key + whether
-- it is accredited. `accredited` would be controlled by MoEYS in production.
-- ---------------------------------------------------------------------------
create table if not exists issuers (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete set null,
  -- mirrors `owner`; several call sites fall back to it (see
  -- migrations/20260817_admin_registry_schema_and_audit_log.sql).
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  did text not null unique,
  public_jwk jsonb not null,
  accredited boolean not null default false,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- issuer_secrets: the issuer's zk-vault envelopes and the encrypted signing
-- key. Deliberately NOT on `issuers`: that table is world-readable (it is the
-- registry), and an encrypted signing key published beside its salt is an
-- offline cracking exercise, not a secret. Owner-only, no anon, no admin.
-- ---------------------------------------------------------------------------
create table if not exists issuer_secrets (
  owner uuid primary key references auth.users(id) on delete cascade,
  issuer_id uuid references issuers(id) on delete cascade,
  vault_envelope_pin text,
  vault_pin_salt text,
  vault_envelope_passkey text,
  passkey_id text,
  signing_key_ciphertext jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pending_credentials: an issuer's "outbox" keyed by recipient email. The
-- holder claims these, encrypts them into their vault, then deletes the row.
-- ---------------------------------------------------------------------------
create table if not exists pending_credentials (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  sdjwt text not null,
  issuer_did text not null,
  label text,
  student_photo text,
  student_name text,
  student_email text,
  student_id text,
  degree_type text,
  major text,
  graduation_date timestamp,
  certificate_id text,
  created_at timestamptz default now(),
  constraint pending_credentials_issuer_certificate_unique unique (issuer_did, certificate_id)
);

-- ---------------------------------------------------------------------------
-- credentials: the holder's encrypted credentials (zk-vault AES-GCM output).
-- ---------------------------------------------------------------------------
create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete cascade not null,
  label text,
  cipher text not null,
  iv text not null,
  student_photo text,
  student_name text,
  student_email text,
  student_id text,
  degree_type text,
  major text,
  graduation_date timestamp,
  certificate_id text,
  issuer_did text,
  is_encrypted boolean default true,
  created_at timestamptz default now(),
  updated_at timestamp,
  constraint credentials_issuer_certificate_unique unique (issuer_did, certificate_id)
);

-- ---------------------------------------------------------------------------
-- shares: time-limited selective-disclosure presentations for verifiers.
-- ---------------------------------------------------------------------------
create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete cascade not null,
  presentation text not null,
  issuer_did text not null,
  revealed jsonb,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table profiles enable row level security;
alter table issuers enable row level security;
alter table issuer_secrets enable row level security;
alter table pending_credentials enable row level security;
alter table credentials enable row level security;
alter table shares enable row level security;

-- profiles: only the owner, but issuers and admins can view profiles.
-- To prevent infinite recursion, we use a security definer function to check the user's role.
create or replace function public.is_admin_or_issuer(user_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = user_id
      and role in ('issuer', 'admin')
  );
end;
$$ language plpgsql security definer;

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
-- No cross-user profile reads: a profile row carries the holder's vault
-- envelopes and PIN salt. The admin dashboard reads id + email through
-- admin_list_profile_emails() instead (migrations/20260910_rls_hardening.sql).

-- issuers: public registry (anyone can read), owner can create/update theirs.
-- Public read is intended: this is the registry. It is only safe because the
-- signing-key material lives in issuer_secrets, not here.
create policy "read registry" on issuers for select using (true);
-- Registration always starts unaccredited, and an issuer may never write its
-- own standing. The column-level half of that rule is the
-- issuers_guard_registry_columns trigger (migrations/20260910_rls_hardening.sql).
create policy "manage own issuer" on issuers
  for insert to authenticated with check (
    auth.uid() = coalesce(owner, user_id)
    and coalesce(accredited, false) = false
  );
create policy "update own issuer" on issuers
  for update to authenticated
  using (auth.uid() = owner or (owner is null and auth.uid() = user_id))
  with check (auth.uid() = owner or (owner is null and auth.uid() = user_id));
create policy "admin update issuers" on issuers
  for update using (
    exists (
      select 1 from public.profiles
      where public.profiles.id = auth.uid()
        and public.profiles.role = 'admin'
    )
  );

-- issuer_secrets: the owning issuer, and nobody else.
create policy "own issuer secrets" on issuer_secrets
  for all to authenticated
  using (auth.uid() = owner) with check (auth.uid() = owner);

-- pending_credentials: any authenticated user may create (issue) one; the
-- recipient reads/deletes rows addressed to their email.
create policy "issue pending" on pending_credentials
  for insert to authenticated with check (true);
create policy "read my pending" on pending_credentials
  for select to authenticated using (recipient_email = lower(auth.jwt() ->> 'email'));
create policy "delete my pending" on pending_credentials
  for delete to authenticated using (recipient_email = lower(auth.jwt() ->> 'email'));

-- credentials: only the owner.
create policy "own credentials" on credentials
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- shares: owner manages. There is deliberately no public select policy — a
-- blanket one lets any anon caller enumerate every holder's presentation.
-- Verifiers call get_share_for_verification(id), which hands back the
-- presentation only while the share is neither expired nor revoked
-- (migrations/20260910_rls_hardening.sql).
create policy "owner manages shares" on shares
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
