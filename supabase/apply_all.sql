-- =============================================================================
-- Actik — one script, whole schema. Paste into the Supabase SQL editor and run.
-- =============================================================================
--
-- This is every file in supabase/migrations/ folded into one idempotent script,
-- in order. Run it on a brand-new project or on a project that is already live
-- and behind: both end in the same state, and running it twice changes nothing
-- the second time.
--
-- It is written to be safe on a project that has drifted — every table is
-- `if not exists`, every column `add column if not exists`, every policy
-- dropped before it is created, every function `create or replace`. Nothing
-- here deletes a row.
--
-- The one destructive step is deliberate and happens once: the issuer signing
-- key columns are copied off `issuers` into `issuer_secrets` and then dropped
-- from `issuers`. `issuers` is world-readable (it is the public registry), so
-- an encrypted signing key sitting on it beside its own salt was readable by
-- anyone holding the anon key. If the copy has already happened, the step
-- no-ops.
--
-- After running, the app needs these functions to exist:
--   get_share_for_verification, record_verification, admin_list_profile_emails,
--   issuer_verification_count, check_recipient_by_email
-- and, to verify anything at all, a published Root-signed trust list in
-- `trust_documents` — see README, "The trust Root".
--
-- Regenerating: this file is maintained by hand alongside supabase/migrations/.
-- A new migration goes in both places.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. Tables
-- =============================================================================

-- profiles: one row per auth user. Holds zk-vault envelopes (ciphertext only).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text,
  vault_envelope_pin text,
  vault_pin_salt text,
  vault_envelope_passkey text,
  passkey_id text
);

-- issuers: the trust registry. DID -> public key + accreditation standing.
-- Publicly readable, which is only safe because no key material lives here.
create table if not exists public.issuers (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete set null,
  name text not null,
  did text not null unique,
  public_jwk jsonb not null,
  accredited boolean not null default false,
  created_at timestamptz default now()
);

-- `user_id` mirrors `owner`; several call sites fall back to it.
alter table public.issuers add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.issuers add column if not exists domain text;
alter table public.issuers add column if not exists type text;
alter table public.issuers add column if not exists public_key text;
alter table public.issuers add column if not exists accredited_at timestamptz;
alter table public.issuers add column if not exists accredited_by uuid references auth.users(id) on delete set null;
alter table public.issuers add column if not exists revoked_at timestamptz;
alter table public.issuers add column if not exists revoked_by uuid references auth.users(id) on delete set null;

-- issuer_secrets: the issuer's zk-vault envelopes and encrypted signing key.
-- Owner-only. Not the admin's, not anon's, not the registry's.
create table if not exists public.issuer_secrets (
  owner uuid primary key references auth.users(id) on delete cascade,
  issuer_id uuid references public.issuers(id) on delete cascade,
  vault_envelope_pin text,
  vault_pin_salt text,
  vault_envelope_passkey text,
  passkey_id text,
  signing_key_ciphertext jsonb,
  updated_at timestamptz not null default now()
);

-- pending_credentials: the issuer's outbox, keyed by recipient email.
create table if not exists public.pending_credentials (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  sdjwt text not null,
  issuer_did text not null,
  label text,
  created_at timestamptz default now()
);

alter table public.pending_credentials add column if not exists credential_type text default 'academic_degree';
alter table public.pending_credentials add column if not exists student_photo text;
alter table public.pending_credentials add column if not exists student_name text;
alter table public.pending_credentials add column if not exists student_email text;
alter table public.pending_credentials add column if not exists student_id text;
alter table public.pending_credentials add column if not exists degree_type text;
alter table public.pending_credentials add column if not exists major text;
alter table public.pending_credentials add column if not exists graduation_date timestamp;
alter table public.pending_credentials add column if not exists certificate_id text;
alter table public.pending_credentials add column if not exists institution_name text;

alter table public.pending_credentials drop constraint if exists pending_credentials_issuer_certificate_unique;
alter table public.pending_credentials add constraint pending_credentials_issuer_certificate_unique unique (issuer_did, certificate_id);

-- credentials: the holder's encrypted credentials (zk-vault AES-GCM output).
create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete cascade not null,
  label text,
  cipher text not null,
  iv text not null,
  created_at timestamptz default now()
);

alter table public.credentials add column if not exists credential_type text default 'academic_degree';
alter table public.credentials add column if not exists student_photo text;
alter table public.credentials add column if not exists student_name text;
alter table public.credentials add column if not exists student_email text;
alter table public.credentials add column if not exists student_id text;
alter table public.credentials add column if not exists degree_type text;
alter table public.credentials add column if not exists major text;
alter table public.credentials add column if not exists graduation_date timestamp;
alter table public.credentials add column if not exists certificate_id text;
alter table public.credentials add column if not exists institution_name text;
alter table public.credentials add column if not exists issuer_did text;
alter table public.credentials add column if not exists is_encrypted boolean default true;
alter table public.credentials add column if not exists updated_at timestamp;

alter table public.credentials drop constraint if exists credentials_issuer_certificate_unique;
alter table public.credentials add constraint credentials_issuer_certificate_unique unique (issuer_did, certificate_id);

-- shares: time-limited selective-disclosure presentations for verifiers.
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete cascade not null,
  presentation text not null,
  issuer_did text not null,
  revealed jsonb,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- `recipient_label` is written by ShareCredential.tsx and read by Activity.tsx;
-- it used to exist only in an undated file outside migrations/.
alter table public.shares add column if not exists recipient_label text;
alter table public.shares add column if not exists revoked_at timestamptz;
alter table public.shares add column if not exists credential_id uuid references public.credentials(id) on delete cascade;
alter table public.shares add column if not exists view_count integer not null default 0;
alter table public.shares add column if not exists last_verified_at timestamptz;

-- audit_logs: written by src/lib/auditLog.ts for every accreditation action.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  admin_id uuid references auth.users(id) on delete set null,
  institution_id uuid references public.issuers(id) on delete set null,
  institution_name text,
  "timestamp" timestamptz not null,
  ip_address text,
  user_agent text,
  reason text,
  details jsonb,
  signature text,
  status_before text,
  status_after text,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 2. Functions
-- =============================================================================

-- Role tests. Both are SECURITY DEFINER so that a policy on `profiles` can use
-- them without recursing into that same policy.
create or replace function public.is_admin_or_issuer(user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.profiles
    where id = user_id and role in ('issuer', 'admin')
  );
end;
$$;

create or replace function public.is_admin(user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.profiles
    where id = user_id and role = 'admin'
  );
end;
$$;

revoke all on function public.is_admin_or_issuer(uuid) from public, anon;
grant execute on function public.is_admin_or_issuer(uuid) to authenticated;
revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

-- The issuer-side "does this student have an Actik account?" lookup. Raises
-- instead of silently returning zero rows when the caller is not entitled.
create or replace function public.check_recipient_by_email(p_email text)
returns table(student_id uuid, student_role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_issuer(auth.uid()) then
    raise exception 'not authorized to look up recipients';
  end if;

  return query
    select p.id, p.role
    from public.profiles p
    where lower(p.email) = lower(p_email)
    limit 1;
end;
$$;

revoke all on function public.check_recipient_by_email(text) from public, anon;
grant execute on function public.check_recipient_by_email(text) to authenticated;

-- get_share_for_verification() and record_verification() are defined in
-- section 6, in their current form (which also enforces single-use links).

-- The issuer dashboard's "verified N times". An aggregate, not the rows: an
-- issuer never needed its holders' presentations to get one number.
create or replace function public.issuer_verification_count()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  if auth.uid() is null then
    return 0;
  end if;

  select coalesce(sum(s.view_count), 0) into total
  from public.shares s
  where s.issuer_did in (
    select i.did from public.issuers i
    where auth.uid() = coalesce(i.owner, i.user_id)
  );

  return total;
end;
$$;

revoke all on function public.issuer_verification_count() from public, anon;
grant execute on function public.issuer_verification_count() to authenticated;

-- id + email, to admins. A profile row also carries the holder's vault
-- envelopes and PIN salt, which is why nothing reads whole rows across users.
create or replace function public.admin_list_profile_emails()
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query select p.id, p.email from public.profiles p;
end;
$$;

revoke all on function public.admin_list_profile_emails() from public, anon;
grant execute on function public.admin_list_profile_emails() to authenticated;

-- An issuer may edit its own row but never its own standing. RLS is row-level,
-- so the column rule is a trigger. Admin updates and service-role/SQL-editor
-- sessions (auth.uid() is null) pass through.
create or replace function public.issuers_guard_registry_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;

  if new.accredited    is distinct from old.accredited
     or new.accredited_at is distinct from old.accredited_at
     or new.accredited_by is distinct from old.accredited_by
     or new.revoked_at    is distinct from old.revoked_at
     or new.revoked_by    is distinct from old.revoked_by
     or new.did           is distinct from old.did
     or new.owner         is distinct from old.owner
     or new.user_id       is distinct from old.user_id
  then
    raise exception 'accreditation and identity columns are admin-only'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists issuers_guard_registry_columns on public.issuers;
create trigger issuers_guard_registry_columns
  before update on public.issuers
  for each row execute function public.issuers_guard_registry_columns();

-- handle_new_user() is the on_auth_user_created trigger function, created in
-- the Supabase project rather than here. Triggers invoke it with the definer's
-- privileges regardless of grants, so it needs no PUBLIC grant — but a
-- database without it must not fail this script.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'revoke all on function public.handle_new_user() from public, anon, authenticated';
  end if;
end;
$$;

-- =============================================================================
-- 3. Move the issuer signing keys off the public registry (runs once)
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'issuers'
      and column_name = 'signing_key_ciphertext'
  ) then
    execute $move$
      insert into public.issuer_secrets (
        owner, issuer_id, vault_envelope_pin, vault_pin_salt,
        vault_envelope_passkey, passkey_id, signing_key_ciphertext
      )
      select distinct on (coalesce(i.owner, i.user_id))
             coalesce(i.owner, i.user_id), i.id, i.vault_envelope_pin, i.vault_pin_salt,
             i.vault_envelope_passkey, i.passkey_id, i.signing_key_ciphertext
      from public.issuers i
      where coalesce(i.owner, i.user_id) is not null
        and (i.signing_key_ciphertext is not null
             or i.vault_envelope_pin is not null
             or i.vault_envelope_passkey is not null)
      order by coalesce(i.owner, i.user_id), i.created_at nulls last
      on conflict (owner) do nothing
    $move$;
  end if;
end;
$$;

alter table public.issuers
  drop column if exists vault_envelope_pin,
  drop column if exists vault_pin_salt,
  drop column if exists vault_envelope_passkey,
  drop column if exists passkey_id,
  drop column if exists signing_key_ciphertext;

-- =============================================================================
-- 4. Row Level Security
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.issuers             enable row level security;
alter table public.issuer_secrets      enable row level security;
alter table public.pending_credentials enable row level security;
alter table public.credentials         enable row level security;
alter table public.shares              enable row level security;
alter table public.audit_logs          enable row level security;

-- profiles: the owner, and nobody else. No cross-user reads at all — a profile
-- row carries the holder's vault envelopes and PIN salt, and a 6-digit PIN
-- plus its salt is an offline cracking exercise. Admins get id + email through
-- admin_list_profile_emails(); issuers look recipients up through
-- check_recipient_by_email(). Both are SECURITY DEFINER and answer narrowly.
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "issuers and admins can select profiles" on public.profiles;

-- issuers: public read is intended, this is the registry. Safe only because
-- the key material now lives in issuer_secrets.
drop policy if exists "read registry" on public.issuers;
create policy "read registry" on public.issuers for select using (true);

-- Registration always starts unaccredited...
drop policy if exists "manage own issuer" on public.issuers;
create policy "manage own issuer" on public.issuers
  for insert to authenticated
  with check (
    auth.uid() = coalesce(owner, user_id)
    and coalesce(accredited, false) = false
    and accredited_at is null
    and accredited_by is null
    and revoked_at is null
  );

-- ...and an issuer cannot hand its row to someone else. The column rule is the
-- issuers_guard_registry_columns trigger above.
drop policy if exists "update own issuer" on public.issuers;
create policy "update own issuer" on public.issuers
  for update to authenticated
  using (auth.uid() = owner or (owner is null and auth.uid() = user_id))
  with check (auth.uid() = owner or (owner is null and auth.uid() = user_id));

drop policy if exists "admin update issuers" on public.issuers;
create policy "admin update issuers" on public.issuers
  for update using (public.is_admin(auth.uid()));

drop policy if exists "admin delete issuers" on public.issuers;
create policy "admin delete issuers" on public.issuers
  for delete using (public.is_admin(auth.uid()));

-- issuer_secrets: the owning issuer only.
drop policy if exists "own issuer secrets" on public.issuer_secrets;
create policy "own issuer secrets" on public.issuer_secrets
  for all to authenticated
  using (auth.uid() = owner) with check (auth.uid() = owner);

-- pending_credentials: the issuer's outbox. Only the owner of an accredited
-- issuer row may write under that row's DID — this used to be
-- `with check (true)`, so anyone with an account could put a credential in
-- anybody's wallet under any institution's name, and the wallet card, which
-- renders the plain columns, had no way to tell. `issuer_did` unqualified is
-- the new row's column; `issuers` has no column of that name.
-- The recipient reads and deletes rows addressed to their email.
drop policy if exists "issue pending" on public.pending_credentials;
create policy "issue pending" on public.pending_credentials
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.issuers i
      where i.did = issuer_did
        and i.accredited
        and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
    )
  );

drop policy if exists "read my pending" on public.pending_credentials;
create policy "read my pending" on public.pending_credentials
  for select to authenticated using (recipient_email = lower(auth.jwt() ->> 'email'));

drop policy if exists "delete my pending" on public.pending_credentials;
create policy "delete my pending" on public.pending_credentials
  for delete to authenticated using (recipient_email = lower(auth.jwt() ->> 'email'));

-- credentials: only the owner.
drop policy if exists "own credentials" on public.credentials;
create policy "own credentials" on public.credentials
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- shares: the owner manages them, and there is deliberately no public select
-- policy. Verifiers go through get_share_for_verification().
drop policy if exists "owner manages shares" on public.shares;
create policy "owner manages shares" on public.shares
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "public read share" on public.shares;

-- audit_logs: admins write and read; nobody else sees them.
drop policy if exists "admin insert audit_logs" on public.audit_logs;
create policy "admin insert audit_logs" on public.audit_logs
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists "admin select audit_logs" on public.audit_logs;
create policy "admin select audit_logs" on public.audit_logs
  for select to authenticated using (public.is_admin(auth.uid()));

-- =============================================================================
-- 5. Realtime
-- =============================================================================
-- NotificationsBell.tsx subscribes to postgres_changes on pending_credentials.
-- Guarded twice: the publication is the Supabase platform's, and re-adding a
-- table already in it raises rather than no-opping.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'pending_credentials'
     )
  then
    execute 'alter publication supabase_realtime add table public.pending_credentials';
  end if;
end;
$$;

-- =============================================================================
-- 6. Trust layer — supabase/migrations/20261004_trust_layer.sql
-- =============================================================================
-- Trust moves out of this database: verifiers believe a Root-signed trust list
-- and issuer-signed withdrawal lists, and the tables below hold the proposals
-- those lists are built from. Approving an institution in the dashboard no
-- longer makes it trusted on its own; publishing the next signed list does.

-- ---------------------------------------------------------------------------
-- 6.1 profiles.role: a user picks student or issuer; nobody picks admin.
-- ---------------------------------------------------------------------------
-- The "own profile" policy lets a user write their own row — it has to, the
-- vault envelopes live there and GoogleAuth.tsx upserts the role the user picks
-- at sign-up. But it put no limit on *which* role, so
--   update profiles set role = 'admin' where id = auth.uid()
-- succeeded, is_admin() then returned true, and the new "admin" could accredit
-- any institution, their own included — walking straight round the
-- issuers_guard_registry_columns trigger.
--
-- A user may now move between no role, 'student' and 'issuer'. Becoming an
-- admin, or ceasing to be one, happens only where auth.uid() is null: the SQL
-- editor or a service-role key, i.e. somebody with the project's keys.
create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  self_service constant text[] := array['student', 'issuer'];
begin
  if auth.uid() is null then
    return new;  -- SQL editor / service role
  end if;

  if tg_op = 'INSERT' then
    if new.role is not null and not (new.role = any (self_service)) then
      raise exception 'role % cannot be self-assigned', new.role using errcode = '42501';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    if (old.role is not null and not (old.role = any (self_service)))
       or (new.role is not null and not (new.role = any (self_service))) then
      raise exception 'role % cannot be self-assigned', coalesce(new.role, 'null') using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_role();

-- ---------------------------------------------------------------------------
-- 6.2 Columns the app writes that the tracked schema never had
-- ---------------------------------------------------------------------------
-- IssueCredential.tsx writes `type_metadata` for the five non-degree types and
-- Notifications.tsx copies it across on claim; no tracked SQL created it, so
-- non-degree issuance failed on any project built from this repo.
alter table public.pending_credentials add column if not exists type_metadata jsonb;
alter table public.credentials         add column if not exists type_metadata jsonb;
-- The credential's own identifier (its signed `jti`), so the issuer can later
-- withdraw exactly it.
alter table public.pending_credentials add column if not exists credential_jti uuid;
-- The printed (KH1:) copy signed at issuance, delivered to the holder with the
-- credential and moved into their encrypted vault on claim.
alter table public.pending_credentials add column if not exists printed_code text
  check (printed_code is null or (printed_code like 'KH1:%' and length(printed_code) <= 4096));
-- A share link may be limited to N views; 1 makes it single-use.
alter table public.shares add column if not exists max_views integer
  check (max_views is null or max_views > 0);

create or replace function public.try_jsonb(t text)
returns jsonb
language plpgsql
immutable
as $$
begin
  return t::jsonb;
exception when others then
  return null;
end;
$$;

-- Is the caller the owner of an accredited issuer row with this DID?
create or replace function public.owns_accredited_issuer(p_did text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.issuers i
    where i.did = p_did
      and i.accredited
      and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
  )
$$;

revoke all on function public.owns_accredited_issuer(text) from public, anon;
grant execute on function public.owns_accredited_issuer(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6.3 issuer_keys: every key an issuer has used, so rotation strands nothing
-- ---------------------------------------------------------------------------
-- `issuers.public_jwk` held one key, overwritten on rotation, so every
-- credential the old key had signed stopped verifying the moment an issuer
-- regenerated. This table keeps the history. It is a *proposal*: the Root
-- reads it when building the signed trust list, and only what the Root signs
-- is trusted.
create table if not exists public.issuer_keys (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references public.issuers(id) on delete cascade,
  public_jwk jsonb not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,   -- rotated out, not compromised
  revoked_at timestamptz    -- compromised: nothing it signed stands
);
create index if not exists issuer_keys_issuer_idx on public.issuer_keys (issuer_id);

-- Existing issuers get their current key as the first entry.
insert into public.issuer_keys (issuer_id, public_jwk, created_at)
select i.id,
       coalesce(i.public_jwk, public.try_jsonb(i.public_key)),
       coalesce(i.created_at, now())
from public.issuers i
where coalesce(i.public_jwk, public.try_jsonb(i.public_key)) is not null
  and not exists (select 1 from public.issuer_keys k where k.issuer_id = i.id);

-- An issuer may add keys and retire or revoke its own. It may not backdate a
-- key (which would let a new key vouch for old credentials), alter one, or
-- bring a retired or revoked key back. Its timestamps are the server's.
create or replace function public.issuer_keys_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.retired_at := null;
    new.revoked_at := null;
    return new;
  end if;

  if new.issuer_id is distinct from old.issuer_id
     or new.public_jwk is distinct from old.public_jwk
     or new.created_at is distinct from old.created_at
     or (old.retired_at is not null and new.retired_at is distinct from old.retired_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
  then
    raise exception 'issuer keys are append-only; a key can be retired or revoked, never altered or restored'
      using errcode = '42501';
  end if;

  if old.retired_at is null and new.retired_at is not null then new.retired_at := now(); end if;
  if old.revoked_at is null and new.revoked_at is not null then new.revoked_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists issuer_keys_guard on public.issuer_keys;
create trigger issuer_keys_guard
  before insert or update on public.issuer_keys
  for each row execute function public.issuer_keys_guard();

alter table public.issuer_keys enable row level security;

drop policy if exists "read issuer keys" on public.issuer_keys;
create policy "read issuer keys" on public.issuer_keys for select using (true);

drop policy if exists "issuer adds own keys" on public.issuer_keys;
create policy "issuer adds own keys" on public.issuer_keys
  for insert to authenticated
  with check (exists (
    select 1 from public.issuers i
    where i.id = issuer_id
      and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
  ));

drop policy if exists "issuer retires own keys" on public.issuer_keys;
create policy "issuer retires own keys" on public.issuer_keys
  for update to authenticated
  using (exists (
    select 1 from public.issuers i
    where i.id = issuer_id
      and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
  ))
  with check (exists (
    select 1 from public.issuers i
    where i.id = issuer_id
      and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
  ));

-- ---------------------------------------------------------------------------
-- 6.4 trust_documents: where the Root-signed trust list is published
-- ---------------------------------------------------------------------------
-- Readable by everyone, writable by nobody through the API — only the SQL
-- editor or a service-role key can publish. That is an operational limit, not
-- the security: verifiers check the Root's signature against a key pinned in
-- the app, so whoever can write here can withhold a list but cannot forge one.
create table if not exists public.trust_documents (
  kind text primary key check (kind = 'trustlist'),
  document jsonb not null,
  version bigint not null,
  updated_at timestamptz not null default now()
);

-- `version` is read from the signed statement itself, and may only go up, so
-- an older list cannot be republished by mistake.
create or replace function public.trust_documents_guard()
returns trigger
language plpgsql
as $$
declare
  stmt jsonb := public.try_jsonb(new.document ->> 'statement');
begin
  if stmt is null or (stmt ->> 'version') is null then
    raise exception 'not a signed trust list: document.statement must be the signed JSON text';
  end if;
  new.version := (stmt ->> 'version')::bigint;
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.version <= old.version then
    raise exception 'trust list version % does not supersede published version %', new.version, old.version;
  end if;
  return new;
end;
$$;

drop trigger if exists trust_documents_guard on public.trust_documents;
create trigger trust_documents_guard
  before insert or update on public.trust_documents
  for each row execute function public.trust_documents_guard();

alter table public.trust_documents enable row level security;
drop policy if exists "read trust documents" on public.trust_documents;
create policy "read trust documents" on public.trust_documents for select using (true);

-- ---------------------------------------------------------------------------
-- 6.5 revocation_lists: each issuer's signed list of withdrawn credentials
-- ---------------------------------------------------------------------------
-- Written by the issuer from its own browser, signed with its own key. The
-- signature is what verifiers trust; the row-level rules here only stop one
-- institution overwriting another's, and stop a version going backwards.
create table if not exists public.revocation_lists (
  issuer_did text primary key,
  document jsonb not null,
  version bigint not null,
  updated_at timestamptz not null default now()
);

create or replace function public.revocation_lists_guard()
returns trigger
language plpgsql
as $$
declare
  stmt jsonb := public.try_jsonb(new.document ->> 'statement');
begin
  if stmt is null or (stmt ->> 'version') is null then
    raise exception 'not a signed revocation list';
  end if;
  if (stmt ->> 'type') is distinct from 'actik/revocations/2' then
    raise exception 'revocation lists must be published as actik/revocations/2 (hashed entries)';
  end if;
  if jsonb_typeof(stmt -> 'revoked') is distinct from 'array' or exists (
    select 1 from jsonb_array_elements(stmt -> 'revoked') e
    where jsonb_typeof(e) <> 'object'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('id', 'reason', 'revokedAt'))
       or (e ->> 'id') !~ '^[0-9A-F]{64}$'
       or (e ->> 'reason') not in ('withdrawn', 'corrected')
  ) then
    raise exception 'a revocation entry may carry only a hashed id, a fixed reason and a date';
  end if;
  if (stmt ->> 'issuer') is distinct from new.issuer_did then
    raise exception 'revocation list names issuer %, stored under %', stmt ->> 'issuer', new.issuer_did;
  end if;
  new.version := (stmt ->> 'version')::bigint;
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.version <= old.version then
    raise exception 'revocation list version % does not supersede published version %', new.version, old.version;
  end if;
  return new;
end;
$$;

drop trigger if exists revocation_lists_guard on public.revocation_lists;
create trigger revocation_lists_guard
  before insert or update on public.revocation_lists
  for each row execute function public.revocation_lists_guard();

alter table public.revocation_lists enable row level security;

-- Public reads see only hashed (version 2) lists; an institution still sees
-- its own version-1 list, so it can renew it.
drop policy if exists "read revocation lists" on public.revocation_lists;
create policy "read revocation lists" on public.revocation_lists for select using (
  public.try_jsonb(document ->> 'statement') ->> 'type' = 'actik/revocations/2'
);
-- owns_accredited_issuer() is not executable by anon, so the owner's own read
-- is a separate policy that applies to signed-in users only.
drop policy if exists "issuer reads own revocations" on public.revocation_lists;
create policy "issuer reads own revocations" on public.revocation_lists
  for select to authenticated using (public.owns_accredited_issuer(issuer_did));


drop policy if exists "issuer publishes own revocations" on public.revocation_lists;
create policy "issuer publishes own revocations" on public.revocation_lists
  for insert to authenticated with check (public.owns_accredited_issuer(issuer_did));

drop policy if exists "issuer updates own revocations" on public.revocation_lists;
create policy "issuer updates own revocations" on public.revocation_lists
  for update to authenticated
  using (public.owns_accredited_issuer(issuer_did))
  with check (public.owns_accredited_issuer(issuer_did));

-- ---------------------------------------------------------------------------
-- 6.6 issued_credentials: what an issuer has issued, written by the database
-- ---------------------------------------------------------------------------
-- Issuing — the irreversible, signed act — used to leave no record an issuer
-- could read: the credential sat in the recipient's inbox, then in the
-- recipient's vault, and both are the recipient's rows. So an issuer could
-- not list what it had issued, and had nothing to withdraw from.
--
-- A trigger writes this log as the outbox row goes in, in the same
-- transaction, so it cannot be skipped and cannot be written on its own:
-- there is no insert policy at all.
create table if not exists public.issued_credentials (
  id uuid primary key default gen_random_uuid(),
  issuer_did text not null,
  jti uuid unique,
  document_id text,
  credential_type text,
  label text,
  recipient_email text,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null
);
create index if not exists issued_credentials_issuer_idx on public.issued_credentials (issuer_did, issued_at desc);

create or replace function public.log_issued_credential()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.issued_credentials
    (issuer_did, jti, document_id, credential_type, label, recipient_email, issued_by)
  values
    (new.issuer_did,
     new.credential_jti,
     coalesce(nullif(new.certificate_id, ''), new.type_metadata ->> 'license_number'),
     new.credential_type,
     new.label,
     new.recipient_email,
     auth.uid());
  return new;
end;
$$;

drop trigger if exists log_issued_credential on public.pending_credentials;
create trigger log_issued_credential
  after insert on public.pending_credentials
  for each row execute function public.log_issued_credential();

alter table public.issued_credentials enable row level security;
drop policy if exists "issuer reads own issuance log" on public.issued_credentials;
create policy "issuer reads own issuance log" on public.issued_credentials
  for select to authenticated
  using (exists (
    select 1 from public.issuers i
    where i.did = issuer_did
      and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
  ));

-- ---------------------------------------------------------------------------
-- 6.7 Single-use share links
-- ---------------------------------------------------------------------------
create or replace function public.get_share_for_verification(p_share_id uuid)
returns table (
  id uuid,
  presentation text,
  issuer_did text,
  disclosed_fields jsonb,
  credential_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shares%rowtype;
  s_json jsonb;
  fields jsonb;
  revoked timestamptz;
  cap integer;
begin
  select * into s from public.shares where public.shares.id = p_share_id;

  if not found then
    return query select null::uuid, null::text, null::text, null::jsonb,
                        null::uuid, null::timestamptz, null::timestamptz, 'not_found'::text;
    return;
  end if;

  -- `disclosed_fields` and `revealed` both exist in the wild.
  s_json := to_jsonb(s);
  fields := coalesce(s_json -> 'disclosed_fields', s_json -> 'revealed', '[]'::jsonb);
  revoked := nullif(s_json ->> 'revoked_at', '')::timestamptz;
  cap := nullif(s_json ->> 'max_views', '')::integer;

  if revoked is not null then
    return query select s.id, null::text, s.issuer_did, null::jsonb,
                        s.credential_id, s.expires_at, s.created_at, 'revoked'::text;
    return;
  end if;

  if s.expires_at <= now() then
    return query select s.id, null::text, s.issuer_did, null::jsonb,
                        s.credential_id, s.expires_at, s.created_at, 'expired'::text;
    return;
  end if;

  -- A capped link that has been used up behaves like an expired one: the
  -- presentation is not handed out again.
  if cap is not null and coalesce(s.view_count, 0) >= cap then
    return query select s.id, null::text, s.issuer_did, null::jsonb,
                        s.credential_id, s.expires_at, s.created_at, 'exhausted'::text;
    return;
  end if;

  return query select s.id, s.presentation, s.issuer_did, fields,
                      s.credential_id, s.expires_at, s.created_at, 'ok'::text;
end;
$$;

revoke all on function public.get_share_for_verification(uuid) from public;
grant execute on function public.get_share_for_verification(uuid) to anon, authenticated;

create or replace function public.record_verification(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shares
  set view_count = coalesce(view_count, 0) + 1,
      last_verified_at = now()
  where id = p_share_id
    and expires_at > now()
    and revoked_at is null
    and (max_views is null or coalesce(view_count, 0) < max_views);
end;
$$;

revoke all on function public.record_verification(uuid) from public;
grant execute on function public.record_verification(uuid) to anon, authenticated;

-- =============================================================================
-- 7. Proof requests (recruitment): see migrations/20261006_proof_requests.sql
-- =============================================================================
-- ---------------------------------------------------------------------------
-- Allowlists
-- ---------------------------------------------------------------------------
create or replace function public.proof_always_revealed()
returns text[]
language sql
immutable
as $$
  select array['institution','iss','iat','exp','name','degree_type','degree','graduation_date',
    'certificate_id','sub_type','event_name','event_date','organizer','program_name','completion_date',
    'achievement_title','date_awarded','reason','date','cert_name','issuing_body','date_certified',
    'license_number','expiry_date']
$$;

-- The extra fields each credential type may be asked for; null for a type a
-- request cannot name.
create or replace function public.proof_requestable_extras(p_type text)
returns text[]
language sql
immutable
as $$
  select case p_type
    when 'academic_degree' then array['major','gpa']
    when 'professional_certification' then array[]::text[]
    when 'completion' then array['duration','department_or_role']
    when 'attendance_participation' then array['role_description']
    when 'merit_excellence' then array['basis_description']
    when 'appreciation_service' then array['capacity']
    else null
  end
$$;

-- base64url → text. Raises on malformed input; callers catch it.
create or replace function public.b64url_text(s text)
returns text
language sql
immutable
strict
as $$
  select convert_from(decode(rpad(translate(s, '-_', '+/'), ((length(s) + 3) / 4) * 4, '='), 'base64'), 'UTF8')
$$;

-- ---------------------------------------------------------------------------
-- proof_requests
-- ---------------------------------------------------------------------------
create table if not exists public.proof_requests (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Self-declared. Actik has not verified who the requester is, and says so.
  requester_name text not null check (length(btrim(requester_name)) between 2 and 120),
  title text not null check (length(btrim(title)) between 2 and 120),
  description text not null default '' check (length(description) <= 2000),
  requirements jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz
);

create index if not exists proof_requests_owner_idx on public.proof_requests (owner);

create or replace function public.proof_requests_guard()
returns trigger
language plpgsql
as $$
declare
  r jsonb;
  extras text[];
  f text;
begin
  if tg_op = 'UPDATE' then
    -- An employer may close a request, once. Nothing else changes after
    -- candidates may have answered it.
    if new.id is distinct from old.id or new.owner is distinct from old.owner
       or new.requester_name is distinct from old.requester_name or new.title is distinct from old.title
       or new.description is distinct from old.description or new.requirements is distinct from old.requirements
       or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
       or old.closed_at is not null then
      raise exception 'a proof request can only be closed, once';
    end if;
    return new;
  end if;

  new.created_at := now();
  if new.expires_at <= now() or new.expires_at > now() + interval '90 days 1 minute' then
    raise exception 'a proof request must expire within 90 days';
  end if;
  if jsonb_typeof(new.requirements) is distinct from 'array'
     or jsonb_array_length(new.requirements) not between 1 and 5 then
    raise exception 'a proof request asks for between 1 and 5 credentials';
  end if;
  for r in select * from jsonb_array_elements(new.requirements) loop
    if jsonb_typeof(r) <> 'object'
       or exists (select 1 from jsonb_object_keys(r) k where k not in ('type', 'extras', 'note')) then
      raise exception 'malformed requirement';
    end if;
    extras := public.proof_requestable_extras(r ->> 'type');
    if extras is null then
      raise exception 'credential type % cannot be requested', r ->> 'type';
    end if;
    if jsonb_typeof(r -> 'extras') is distinct from 'array'
       or jsonb_typeof(r -> 'note') is distinct from 'string' or length(r ->> 'note') > 300 then
      raise exception 'malformed requirement';
    end if;
    for f in select jsonb_array_elements_text(r -> 'extras') loop
      if not (f = any (extras)) then
        raise exception 'field % cannot be requested', f;
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

drop trigger if exists proof_requests_guard on public.proof_requests;
create trigger proof_requests_guard
  before insert or update on public.proof_requests
  for each row execute function public.proof_requests_guard();

alter table public.proof_requests enable row level security;

drop policy if exists "owner reads own proof requests" on public.proof_requests;
create policy "owner reads own proof requests" on public.proof_requests
  for select to authenticated using (owner = auth.uid());

drop policy if exists "signed-in user creates proof requests" on public.proof_requests;
create policy "signed-in user creates proof requests" on public.proof_requests
  for insert to authenticated with check (owner = auth.uid());

drop policy if exists "owner closes own proof requests" on public.proof_requests;
create policy "owner closes own proof requests" on public.proof_requests
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- Anyone with the link may read a request — what is asked, by whom (as they
-- describe themselves), until when. Not who made it, and not who answered.
create or replace function public.get_proof_request(p_id uuid)
returns table (
  id uuid, requester_name text, title text, description text, requirements jsonb,
  expires_at timestamptz, status text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.requester_name, r.title, r.description, r.requirements, r.expires_at,
         case when r.closed_at is not null then 'closed'
              when r.expires_at <= now() then 'expired'
              else 'open' end
  from public.proof_requests r
  where r.id = p_id
$$;

revoke all on function public.get_proof_request(uuid) from public;
grant execute on function public.get_proof_request(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- proof_responses
-- ---------------------------------------------------------------------------
create table if not exists public.proof_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.proof_requests(id) on delete cascade,
  responder uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- How the employer can reach the candidate, in the candidate's words.
  contact text not null check (length(btrim(contact)) between 3 and 200),
  items jsonb not null,
  created_at timestamptz not null default now(),
  unique (request_id, responder)
);

create index if not exists proof_responses_request_idx on public.proof_responses (request_id);

-- Runs as definer: it must read the request, which the candidate cannot select.
create or replace function public.proof_responses_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.proof_requests;
  item jsonb;
  idx int;
  seen int[] := array[]::int[];
  requirement jsonb;
  allowed text[];
  pres text;
  payload jsonb;
  disclosure text;
  claim_name text;
begin
  select * into req from public.proof_requests where id = new.request_id;
  if not found or req.closed_at is not null or req.expires_at <= now() then
    raise exception 'this proof request is not open';
  end if;
  new.created_at := now();

  if jsonb_typeof(new.items) is distinct from 'array'
     or jsonb_array_length(new.items) not between 1 and jsonb_array_length(req.requirements) then
    raise exception 'an answer has between 1 and % items', jsonb_array_length(req.requirements);
  end if;

  for item in select * from jsonb_array_elements(new.items) loop
    if jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) k where k not in ('requirement', 'presentation'))
       or jsonb_typeof(item -> 'requirement') is distinct from 'number'
       or jsonb_typeof(item -> 'presentation') is distinct from 'string' then
      raise exception 'malformed answer item';
    end if;
    idx := (item ->> 'requirement')::int;
    if idx < 0 or idx >= jsonb_array_length(req.requirements) or idx = any (seen) then
      raise exception 'answer item names no requirement, or one twice';
    end if;
    seen := seen || idx;
    requirement := req.requirements -> idx;
    allowed := public.proof_always_revealed()
      || array(select jsonb_array_elements_text(requirement -> 'extras'));
    pres := item ->> 'presentation';
    if length(pres) > 100000 then
      raise exception 'answer item too large';
    end if;

    begin
      payload := public.b64url_text(split_part(split_part(pres, '~', 1), '.', 2))::jsonb;
      if (payload ->> 'vct') is distinct from 'https://actik.kh/credentials/' || (requirement ->> 'type')
         and not ((requirement ->> 'type') = 'academic_degree'
                  and (payload ->> 'vct') = 'https://actik.kh/credentials/degree') then
        raise exception using errcode = 'P0001', message = 'wrong credential type';
      end if;
      for disclosure in
        select d from unnest(string_to_array(pres, '~')) with ordinality as t(d, n) where n > 1 and d <> ''
      loop
        claim_name := public.b64url_text(disclosure)::jsonb ->> 1;
        if claim_name is null or not (claim_name = any (allowed)) then
          raise exception using errcode = 'P0001', message = 'discloses a field the request cannot see';
        end if;
      end loop;
    exception
      when sqlstate 'P0001' then raise;
      when others then raise exception 'malformed presentation';
    end;
  end loop;
  return new;
end;
$$;

drop trigger if exists proof_responses_guard on public.proof_responses;
create trigger proof_responses_guard
  before insert or update on public.proof_responses
  for each row execute function public.proof_responses_guard();

alter table public.proof_responses enable row level security;

drop policy if exists "candidate answers as themselves" on public.proof_responses;
create policy "candidate answers as themselves" on public.proof_responses
  for insert to authenticated with check (responder = auth.uid());

drop policy if exists "candidate and requester read answers" on public.proof_responses;
create policy "candidate and requester read answers" on public.proof_responses
  for select to authenticated using (
    responder = auth.uid()
    or exists (select 1 from public.proof_requests r where r.id = request_id and r.owner = auth.uid())
  );

-- A candidate may take an answer back. Nobody may edit one.
drop policy if exists "candidate withdraws own answer" on public.proof_responses;
create policy "candidate withdraws own answer" on public.proof_responses
  for delete to authenticated using (responder = auth.uid());

-- The candidate's own answers, with what they answered (they cannot select
-- the requests themselves).
create or replace function public.my_proof_responses()
returns table (
  id uuid, request_id uuid, title text, requester_name text, request_status text,
  items_count int, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.request_id, r.title, r.requester_name,
         case when r.closed_at is not null then 'closed'
              when r.expires_at <= now() then 'expired'
              else 'open' end,
         jsonb_array_length(p.items), p.created_at
  from public.proof_responses p
  join public.proof_requests r on r.id = p.request_id
  where p.responder = auth.uid()
  order by p.created_at desc
$$;

revoke all on function public.my_proof_responses() from public, anon;
grant execute on function public.my_proof_responses() to authenticated;

-- =============================================================================
-- 8. Employment records: see migrations/20261007_employment_records.sql
-- =============================================================================
-- ---------------------------------------------------------------------------
-- 1. issuers.kind
-- ---------------------------------------------------------------------------
alter table public.issuers add column if not exists kind text not null default 'institution';
alter table public.issuers drop constraint if exists issuers_kind_check;
alter table public.issuers add constraint issuers_kind_check check (kind in ('institution', 'employer'));

create or replace function public.issuers_guard_registry_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;

  if new.accredited    is distinct from old.accredited
     or new.accredited_at is distinct from old.accredited_at
     or new.accredited_by is distinct from old.accredited_by
     or new.revoked_at    is distinct from old.revoked_at
     or new.revoked_by    is distinct from old.revoked_by
     or new.did           is distinct from old.did
     or new.owner         is distinct from old.owner
     or new.user_id       is distinct from old.user_id
     or new.kind          is distinct from old.kind
  then
    raise exception 'accreditation and identity columns are admin-only'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The outbox: an employer sends employment records only
-- ---------------------------------------------------------------------------
drop policy if exists "issue pending" on public.pending_credentials;
create policy "issue pending" on public.pending_credentials
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.issuers i
      where i.did = issuer_did
        and i.accredited
        and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
        and (i.kind = 'institution' or credential_type = 'employment_record')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. What an employment record may say
-- ---------------------------------------------------------------------------
create or replace function public.employment_record_claims()
returns text[]
language sql
immutable
as $$
  select array['sub','name','institution','iss','iat','exp',
    'job_title','employment_type','employment_start','employment_end','employment_status',
    'department','role_description']
$$;

create or replace function public.pending_credentials_employment_guard()
returns trigger
language plpgsql
as $$
declare
  token text := coalesce(new.sdjwt, '');
  payload jsonb;
  disclosure text;
  claim_name text;
  k text;
begin
  if new.credential_type is distinct from 'employment_record' then
    return new;
  end if;
  if new.printed_code is not null then
    raise exception 'an employment record has no printed code';
  end if;
  if new.type_metadata is not null then
    for k in select jsonb_object_keys(new.type_metadata) loop
      if not (k = any (public.employment_record_claims())) then
        raise exception 'an employment record cannot carry %', k;
      end if;
    end loop;
  end if;
  begin
    payload := public.b64url_text(split_part(split_part(token, '~', 1), '.', 2))::jsonb;
    if (payload ->> 'vct') is distinct from 'https://actik.kh/credentials/employment_record' then
      raise exception using errcode = 'P0001', message = 'an employment record must be signed as one';
    end if;
    for disclosure in
      select d from unnest(string_to_array(token, '~')) with ordinality as t(d, n) where n > 1 and d <> ''
    loop
      claim_name := public.b64url_text(disclosure)::jsonb ->> 1;
      if claim_name is null or not (claim_name = any (public.employment_record_claims())) then
        raise exception using errcode = 'P0001', message = 'an employment record cannot carry ' || coalesce(claim_name, 'that');
      end if;
    end loop;
  exception
    when sqlstate 'P0001' then raise;
    when others then raise exception 'malformed employment record';
  end;
  return new;
end;
$$;

drop trigger if exists pending_credentials_employment_guard on public.pending_credentials;
create trigger pending_credentials_employment_guard
  before insert or update on public.pending_credentials
  for each row execute function public.pending_credentials_employment_guard();

-- ---------------------------------------------------------------------------
-- 4. Proof requests may ask for employment records
-- ---------------------------------------------------------------------------
create or replace function public.proof_always_revealed()
returns text[]
language sql
immutable
as $$
  select array['institution','iss','iat','exp','name','degree_type','degree','graduation_date',
    'certificate_id','sub_type','event_name','event_date','organizer','program_name','completion_date',
    'achievement_title','date_awarded','reason','date','cert_name','issuing_body','date_certified',
    'license_number','expiry_date',
    'job_title','employment_type','employment_start','employment_end','employment_status']
$$;

create or replace function public.proof_requestable_extras(p_type text)
returns text[]
language sql
immutable
as $$
  select case p_type
    when 'academic_degree' then array['major','gpa']
    when 'professional_certification' then array[]::text[]
    when 'completion' then array['duration','department_or_role']
    when 'attendance_participation' then array['role_description']
    when 'merit_excellence' then array['basis_description']
    when 'appreciation_service' then array['capacity']
    when 'employment_record' then array['department','role_description']
    else null
  end
$$;

-- =============================================================================
-- 9. Holder binding: see migrations/20261008_holder_binding.sql
-- =============================================================================
-- Holder binding: credentials bound to the wallet they were issued to.
--
-- Each wallet has a holder key (src/lib/holderKey.ts). Its private half is
-- encrypted with the wallet's own key before it leaves the device, so this
-- table holds ciphertext the database cannot use; its public half is what an
-- issuer writes into a credential as `cnf`. A bound credential must then be
-- presented with a key-binding proof signed by that key, for that one share
-- link or proof request (src/lib/sdjwt.ts: addKeyBinding / checkKeyBinding).

create table if not exists public.holder_keys (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  -- Public only: an EC P-256 point and nothing that could be a private key.
  public_jwk jsonb not null check (
    public_jwk ->> 'kty' = 'EC' and public_jwk ->> 'crv' = 'P-256'
    and public_jwk ? 'x' and public_jwk ? 'y' and not public_jwk ? 'd'
  ),
  private_cipher text not null,
  private_iv text not null,
  created_at timestamptz not null default now()
);

alter table public.holder_keys enable row level security;

drop policy if exists "holder reads own key" on public.holder_keys;
create policy "holder reads own key" on public.holder_keys
  for select to authenticated using (user_id = auth.uid());

-- Made once. There is no update or delete policy: credentials are bound to
-- this key, and replacing it would orphan every one of them.
drop policy if exists "holder creates own key" on public.holder_keys;
create policy "holder creates own key" on public.holder_keys
  for insert to authenticated with check (user_id = auth.uid());

-- The public key of a recipient, for an issuer about to bind a credential to
-- it. Same callers as check_recipient_by_email.
create or replace function public.holder_public_key(p_email text)
returns table (public_jwk jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_issuer(auth.uid()) then
    raise exception 'not authorized to look up recipients';
  end if;
  return query
    select k.public_jwk
    from public.profiles p
    join public.holder_keys k on k.user_id = p.id
    where lower(p.email) = lower(p_email)
    limit 1;
end;
$$;

revoke all on function public.holder_public_key(text) from public, anon;
grant execute on function public.holder_public_key(text) to authenticated;

-- Proof answers may now carry a key-binding JWT after their disclosures.
-- Runs as definer: it must read the request, which the candidate cannot select.
create or replace function public.proof_responses_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.proof_requests;
  item jsonb;
  idx int;
  seen int[] := array[]::int[];
  requirement jsonb;
  allowed text[];
  pres text;
  payload jsonb;
  disclosure text;
  claim_name text;
begin
  select * into req from public.proof_requests where id = new.request_id;
  if not found or req.closed_at is not null or req.expires_at <= now() then
    raise exception 'this proof request is not open';
  end if;
  new.created_at := now();

  if jsonb_typeof(new.items) is distinct from 'array'
     or jsonb_array_length(new.items) not between 1 and jsonb_array_length(req.requirements) then
    raise exception 'an answer has between 1 and % items', jsonb_array_length(req.requirements);
  end if;

  for item in select * from jsonb_array_elements(new.items) loop
    if jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) k where k not in ('requirement', 'presentation'))
       or jsonb_typeof(item -> 'requirement') is distinct from 'number'
       or jsonb_typeof(item -> 'presentation') is distinct from 'string' then
      raise exception 'malformed answer item';
    end if;
    idx := (item ->> 'requirement')::int;
    if idx < 0 or idx >= jsonb_array_length(req.requirements) or idx = any (seen) then
      raise exception 'answer item names no requirement, or one twice';
    end if;
    seen := seen || idx;
    requirement := req.requirements -> idx;
    allowed := public.proof_always_revealed()
      || array(select jsonb_array_elements_text(requirement -> 'extras'));
    pres := item ->> 'presentation';
    if length(pres) > 100000 then
      raise exception 'answer item too large';
    end if;

    begin
      payload := public.b64url_text(split_part(split_part(pres, '~', 1), '.', 2))::jsonb;
      if (payload ->> 'vct') is distinct from 'https://actik.kh/credentials/' || (requirement ->> 'type')
         and not ((requirement ->> 'type') = 'academic_degree'
                  and (payload ->> 'vct') = 'https://actik.kh/credentials/degree') then
        raise exception using errcode = 'P0001', message = 'wrong credential type';
      end if;
      -- A key-bound answer ends with the holder's KB-JWT instead of '~':
      -- that last part is a signature, not a disclosure.
      for disclosure in
        select d from unnest(string_to_array(pres, '~')) with ordinality as t(d, n)
        where n > 1 and d <> ''
          and not (n = cardinality(string_to_array(pres, '~')) and right(pres, 1) <> '~')
      loop
        claim_name := public.b64url_text(disclosure)::jsonb ->> 1;
        if claim_name is null or not (claim_name = any (allowed)) then
          raise exception using errcode = 'P0001', message = 'discloses a field the request cannot see';
        end if;
      end loop;
    exception
      when sqlstate 'P0001' then raise;
      when others then raise exception 'malformed presentation';
    end;
  end loop;
  return new;
end;
$$;


-- =============================================================================
-- 10. Identity verifiers: see migrations/20261009_identity_verifiers.sql
-- =============================================================================
-- ---------------------------------------------------------------------------
-- 1. issuers.kind
-- ---------------------------------------------------------------------------
alter table public.issuers drop constraint if exists issuers_kind_check;
alter table public.issuers add constraint issuers_kind_check
  check (kind in ('institution', 'employer', 'identity_verifier'));

-- ---------------------------------------------------------------------------
-- 2. The outbox: each kind of issuer sends only its own types
-- ---------------------------------------------------------------------------
drop policy if exists "issue pending" on public.pending_credentials;
create policy "issue pending" on public.pending_credentials
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.issuers i
      where i.did = issuer_did
        and i.accredited
        and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
        and (
          (i.kind = 'institution' and credential_type is distinct from 'identity_attestation')
          or (i.kind = 'employer' and credential_type = 'employment_record')
          or (i.kind = 'identity_verifier' and credential_type = 'identity_attestation')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. What an identity attestation may say, and who it is bound to
-- ---------------------------------------------------------------------------
create or replace function public.identity_attestation_claims()
returns text[]
language sql
immutable
as $$
  select array['sub','iss','iat','exp',
    'name','institution','verification_level','evidence_type','verified_on']
$$;

-- Definer: it reads the recipient's holder key, which only its holder may select.
create or replace function public.pending_credentials_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  token text := coalesce(new.sdjwt, '');
  payload jsonb;
  disclosure text;
  claim_name text;
  claim_value jsonb;
  k text;
begin
  if new.credential_type is distinct from 'identity_attestation' then
    -- Nothing else may be signed as an identity attestation either.
    begin
      payload := public.b64url_text(split_part(split_part(token, '~', 1), '.', 2))::jsonb;
    exception when others then
      return new;
    end;
    if (payload ->> 'vct') = 'https://actik.kh/credentials/identity_attestation' then
      raise exception 'an identity attestation must be sent as one';
    end if;
    return new;
  end if;

  if new.printed_code is not null then
    raise exception 'an identity attestation has no printed code';
  end if;
  if new.type_metadata is not null then
    for k in select jsonb_object_keys(new.type_metadata) loop
      if not (k = any (public.identity_attestation_claims())) then
        raise exception 'an identity attestation cannot carry %', k;
      end if;
    end loop;
  end if;

  begin
    payload := public.b64url_text(split_part(split_part(token, '~', 1), '.', 2))::jsonb;
    if (payload ->> 'vct') is distinct from 'https://actik.kh/credentials/identity_attestation' then
      raise exception using errcode = 'P0001', message = 'an identity attestation must be signed as one';
    end if;
    if jsonb_typeof(payload -> 'cnf' -> 'jwk') is distinct from 'object' then
      raise exception using errcode = 'P0001', message = 'an identity attestation must be bound to the person''s wallet key';
    end if;
    for disclosure in
      select d from unnest(string_to_array(token, '~')) with ordinality as t(d, n) where n > 1 and d <> ''
    loop
      claim_name := public.b64url_text(disclosure)::jsonb ->> 1;
      claim_value := public.b64url_text(disclosure)::jsonb -> 2;
      if claim_name is null or not (claim_name = any (public.identity_attestation_claims())) then
        raise exception using errcode = 'P0001', message = 'an identity attestation cannot carry ' || coalesce(claim_name, 'that');
      end if;
      if claim_name = 'verification_level' and claim_value is distinct from '"in_person_document"'::jsonb then
        raise exception using errcode = 'P0001', message = 'unknown verification level';
      end if;
      if claim_name = 'evidence_type' and (jsonb_typeof(claim_value) is distinct from 'string'
         or (claim_value #>> '{}') not in ('national_id_card', 'passport')) then
        raise exception using errcode = 'P0001', message = 'unknown evidence type';
      end if;
    end loop;
  exception
    when sqlstate 'P0001' then raise;
    when others then raise exception 'malformed identity attestation';
  end;

  -- Bound to the recipient's own wallet key, not to any key the issuer chose.
  if not exists (
    select 1
    from public.profiles p
    join public.holder_keys hk on hk.user_id = p.id
    where lower(p.email) = lower(new.recipient_email)
      and hk.public_jwk ->> 'x' = payload -> 'cnf' -> 'jwk' ->> 'x'
      and hk.public_jwk ->> 'y' = payload -> 'cnf' -> 'jwk' ->> 'y'
  ) then
    raise exception 'an identity attestation must be bound to the recipient''s own wallet key';
  end if;
  return new;
end;
$$;

drop trigger if exists pending_credentials_identity_guard on public.pending_credentials;
create trigger pending_credentials_identity_guard
  before insert or update on public.pending_credentials
  for each row execute function public.pending_credentials_identity_guard();

-- ---------------------------------------------------------------------------
-- 4. Proof requests may ask for an identity attestation
-- ---------------------------------------------------------------------------
create or replace function public.proof_always_revealed()
returns text[]
language sql
immutable
as $$
  select array['institution','iss','iat','exp','name','degree_type','degree','graduation_date',
    'certificate_id','sub_type','event_name','event_date','organizer','program_name','completion_date',
    'achievement_title','date_awarded','reason','date','cert_name','issuing_body','date_certified',
    'license_number','expiry_date',
    'job_title','employment_type','employment_start','employment_end','employment_status',
    'verification_level','evidence_type','verified_on']
$$;

create or replace function public.proof_requestable_extras(p_type text)
returns text[]
language sql
immutable
as $$
  select case p_type
    when 'academic_degree' then array['major','gpa']
    when 'professional_certification' then array[]::text[]
    when 'completion' then array['duration','department_or_role']
    when 'attendance_participation' then array['role_description']
    when 'merit_excellence' then array['basis_description']
    when 'appreciation_service' then array['capacity']
    when 'employment_record' then array['department','role_description']
    when 'identity_attestation' then array[]::text[]
    else null
  end
$$;

-- =============================================================================
-- 11. Key recovery: see migrations/20261010_key_recovery.sql
-- =============================================================================
-- ---------------------------------------------------------------------------
-- 1. holder_keys history
-- ---------------------------------------------------------------------------
create or replace function public.jwk_thumbprint(jwk jsonb)
returns text
language sql
immutable
strict
as $$
  -- RFC 7638 for an EC key: members in lexicographic order, no whitespace.
  select rtrim(translate(encode(sha256(convert_to(
    '{"crv":"' || (jwk ->> 'crv') || '","kty":"' || (jwk ->> 'kty') ||
    '","x":"' || (jwk ->> 'x') || '","y":"' || (jwk ->> 'y') || '"}', 'UTF8')), 'base64'), '+/', '-_'), '=')
$$;

alter table public.holder_keys add column if not exists id uuid not null default gen_random_uuid();
alter table public.holder_keys add column if not exists kid text;
alter table public.holder_keys add column if not exists retired_at timestamptz;
alter table public.holder_keys add column if not exists retired_reason text;
alter table public.holder_keys drop constraint if exists holder_keys_retired_reason_check;
alter table public.holder_keys add constraint holder_keys_retired_reason_check check (
  (retired_at is null and retired_reason is null)
  or (retired_at is not null and retired_reason in ('lost', 'compromised', 'replaced'))
);
update public.holder_keys set kid = public.jwk_thumbprint(public_jwk) where kid is null;
alter table public.holder_keys alter column kid set not null;

do $$
begin
  -- One row per user was the primary key; now a user has many rows.
  if exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.holder_keys'::regclass and c.contype = 'p' and a.attname = 'user_id'
  ) then
    alter table public.holder_keys drop constraint holder_keys_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.holder_keys'::regclass and contype = 'p') then
    alter table public.holder_keys add primary key (id);
  end if;
end;
$$;

create unique index if not exists holder_keys_one_active on public.holder_keys (user_id) where retired_at is null;
create unique index if not exists holder_keys_kid on public.holder_keys (kid);

-- What the client sends is the key and its encrypted private half; the rest is
-- decided here.
create or replace function public.holder_keys_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.kid := public.jwk_thumbprint(new.public_jwk);
    new.retired_at := null;
    new.retired_reason := null;
    new.created_at := now();
    return new;
  end if;
  -- Updates come only from retire_holder_key, and only retire — or mark a
  -- retired key compromised after the fact.
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.public_jwk is distinct from old.public_jwk or new.kid is distinct from old.kid
     or new.private_cipher is distinct from old.private_cipher or new.private_iv is distinct from old.private_iv
     or new.created_at is distinct from old.created_at
     or new.retired_at is null
     or (old.retired_at is not null and (
           new.retired_at is distinct from old.retired_at
           or old.retired_reason = 'compromised'
           or new.retired_reason is distinct from 'compromised')) then
    raise exception 'a holder key is never changed, only retired once (or later marked compromised)';
  end if;
  return new;
end;
$$;

drop trigger if exists holder_keys_guard on public.holder_keys;
create trigger holder_keys_guard
  before insert or update on public.holder_keys
  for each row execute function public.holder_keys_guard();

drop policy if exists "holder creates own key" on public.holder_keys;
create policy "holder creates own key" on public.holder_keys
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Retiring a key
-- ---------------------------------------------------------------------------
drop function if exists public.retire_holder_key(text);
create or replace function public.retire_holder_key(p_reason text, p_kid text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  retired text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_reason not in ('lost', 'compromised', 'replaced') then
    raise exception 'unknown reason';
  end if;
  if p_kid is null then
    update public.holder_keys
       set retired_at = now(), retired_reason = p_reason
     where user_id = auth.uid() and retired_at is null
    returning kid into retired;
  else
    -- A named key, active or already retired: only ever to mark it compromised.
    if p_reason <> 'compromised' then
      raise exception 'a named key can only be marked compromised';
    end if;
    update public.holder_keys
       set retired_at = coalesce(retired_at, now()), retired_reason = 'compromised'
     where user_id = auth.uid() and kid = p_kid and retired_reason is distinct from 'compromised'
    returning kid into retired;
  end if;
  -- A compromised key may no longer prove continuity: open requests that
  -- rely on it are declined.
  if p_reason = 'compromised' and retired is not null then
    update public.reissue_requests
       set status = 'declined', resolved_at = now()
     where holder = auth.uid() and status = 'open' and proof = 'old_key' and old_kid = retired;
  end if;
  return retired;
end;
$$;

revoke all on function public.retire_holder_key(text, text) from public, anon;
grant execute on function public.retire_holder_key(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The active key is the one issuers bind to
-- ---------------------------------------------------------------------------
create or replace function public.holder_public_key(p_email text)
returns table (public_jwk jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_issuer(auth.uid()) then
    raise exception 'not authorized to look up recipients';
  end if;
  return query
    select k.public_jwk
    from public.profiles p
    join public.holder_keys k on k.user_id = p.id and k.retired_at is null
    where lower(p.email) = lower(p_email)
    limit 1;
end;
$$;

create or replace function public.pending_credentials_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  token text := coalesce(new.sdjwt, '');
  payload jsonb;
  disclosure text;
  claim_name text;
  claim_value jsonb;
  k text;
begin
  if new.credential_type is distinct from 'identity_attestation' then
    begin
      payload := public.b64url_text(split_part(split_part(token, '~', 1), '.', 2))::jsonb;
    exception when others then
      return new;
    end;
    if (payload ->> 'vct') = 'https://actik.kh/credentials/identity_attestation' then
      raise exception 'an identity attestation must be sent as one';
    end if;
    return new;
  end if;

  if new.printed_code is not null then
    raise exception 'an identity attestation has no printed code';
  end if;
  if new.type_metadata is not null then
    for k in select jsonb_object_keys(new.type_metadata) loop
      if not (k = any (public.identity_attestation_claims())) then
        raise exception 'an identity attestation cannot carry %', k;
      end if;
    end loop;
  end if;

  begin
    payload := public.b64url_text(split_part(split_part(token, '~', 1), '.', 2))::jsonb;
    if (payload ->> 'vct') is distinct from 'https://actik.kh/credentials/identity_attestation' then
      raise exception using errcode = 'P0001', message = 'an identity attestation must be signed as one';
    end if;
    if jsonb_typeof(payload -> 'cnf' -> 'jwk') is distinct from 'object' then
      raise exception using errcode = 'P0001', message = 'an identity attestation must be bound to the person''s wallet key';
    end if;
    for disclosure in
      select d from unnest(string_to_array(token, '~')) with ordinality as t(d, n) where n > 1 and d <> ''
    loop
      claim_name := public.b64url_text(disclosure)::jsonb ->> 1;
      claim_value := public.b64url_text(disclosure)::jsonb -> 2;
      if claim_name is null or not (claim_name = any (public.identity_attestation_claims())) then
        raise exception using errcode = 'P0001', message = 'an identity attestation cannot carry ' || coalesce(claim_name, 'that');
      end if;
      if claim_name = 'verification_level' and claim_value is distinct from '"in_person_document"'::jsonb then
        raise exception using errcode = 'P0001', message = 'unknown verification level';
      end if;
      if claim_name = 'evidence_type' and (jsonb_typeof(claim_value) is distinct from 'string'
         or (claim_value #>> '{}') not in ('national_id_card', 'passport')) then
        raise exception using errcode = 'P0001', message = 'unknown evidence type';
      end if;
    end loop;
  exception
    when sqlstate 'P0001' then raise;
    when others then raise exception 'malformed identity attestation';
  end;

  -- Bound to the recipient's own, current wallet key — not a retired one, and
  -- not any key the issuer chose.
  if not exists (
    select 1
    from public.profiles p
    join public.holder_keys hk on hk.user_id = p.id and hk.retired_at is null
    where lower(p.email) = lower(new.recipient_email)
      and hk.public_jwk ->> 'x' = payload -> 'cnf' -> 'jwk' ->> 'x'
      and hk.public_jwk ->> 'y' = payload -> 'cnf' -> 'jwk' ->> 'y'
  ) then
    raise exception 'an identity attestation must be bound to the recipient''s own wallet key';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reissue requests
-- ---------------------------------------------------------------------------
create table if not exists public.reissue_requests (
  id uuid primary key default gen_random_uuid(),
  holder uuid not null default auth.uid() references auth.users(id) on delete cascade,
  issuer_did text not null references public.issuers(did) on delete cascade,
  -- Filled in by the database from the holder's own account and active key.
  recipient_email text not null,
  new_holder_jwk jsonb not null,
  new_kid text not null,
  proof text not null check (proof in ('old_key', 'identity')),
  -- The credential to reissue, as the holder still has it (all disclosures).
  credential text check (credential is null or length(credential) <= 200000),
  -- For proof = 'identity': an identity attestation presented with the new key's proof.
  identity text check (identity is null or length(identity) <= 100000),
  -- For proof = 'old_key': the retired key whose proof the credential carries.
  old_kid text,
  old_jti uuid,
  status text not null default 'open' check (status in ('open', 'reissued', 'declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists reissue_requests_issuer_idx on public.reissue_requests (issuer_did, created_at desc);
create unique index if not exists reissue_requests_one_open
  on public.reissue_requests (holder, issuer_did, coalesce(old_jti, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';

create or replace function public.reissue_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active public.holder_keys;
  payload jsonb;
  cnf jsonb;
  old_key public.holder_keys;
begin
  if tg_op = 'UPDATE' then
    -- The issuer resolves a request; nothing else about it changes.
    if new.id is distinct from old.id or new.holder is distinct from old.holder
       or new.issuer_did is distinct from old.issuer_did or new.recipient_email is distinct from old.recipient_email
       or new.new_holder_jwk is distinct from old.new_holder_jwk or new.new_kid is distinct from old.new_kid
       or new.proof is distinct from old.proof or new.credential is distinct from old.credential
       or new.identity is distinct from old.identity or new.old_kid is distinct from old.old_kid
       or new.old_jti is distinct from old.old_jti or new.created_at is distinct from old.created_at
       or old.status <> 'open' then
      raise exception 'a reissue request is only ever resolved, once';
    end if;
    new.resolved_at := now();
    return new;
  end if;

  new.holder := auth.uid();
  new.status := 'open';
  new.resolved_at := null;
  new.created_at := now();
  select * into active from public.holder_keys where user_id = new.holder and retired_at is null;
  if not found then
    raise exception 'open your wallet first: it needs a key to reissue to';
  end if;
  new.new_holder_jwk := active.public_jwk;
  new.new_kid := active.kid;
  select lower(email) into new.recipient_email from public.profiles where id = new.holder;
  if new.recipient_email is null then
    raise exception 'no email on this account';
  end if;
  if not exists (select 1 from public.issuers where did = new.issuer_did and accredited) then
    raise exception 'no such issuer';
  end if;

  begin
    if new.credential is not null then
      payload := public.b64url_text(split_part(split_part(new.credential, '~', 1), '.', 2))::jsonb;
      if (payload ->> 'iss') is distinct from new.issuer_did then
        raise exception using errcode = 'P0001', message = 'this credential was not issued by that issuer';
      end if;
      new.old_jti := nullif(payload ->> 'jti', '')::uuid;
    end if;

    if new.proof = 'old_key' then
      if new.credential is null or right(new.credential, 1) = '~' then
        raise exception using errcode = 'P0001', message = 'the old credential must be sent with its key''s proof';
      end if;
      cnf := payload -> 'cnf' -> 'jwk';
      select * into old_key from public.holder_keys
       where user_id = new.holder and public_jwk ->> 'x' = cnf ->> 'x' and public_jwk ->> 'y' = cnf ->> 'y';
      if not found or old_key.retired_at is null then
        raise exception using errcode = 'P0001', message = 'the credential must be bound to one of your retired wallet keys';
      end if;
      if old_key.retired_reason = 'compromised' then
        raise exception using errcode = 'P0001', message = 'a key retired as compromised cannot prove anything any more';
      end if;
      new.old_kid := old_key.kid;
      new.identity := null;
    else
      if new.identity is null or right(new.identity, 1) = '~' then
        raise exception using errcode = 'P0001', message = 'an identity check must be sent with your wallet''s proof';
      end if;
      payload := public.b64url_text(split_part(split_part(new.identity, '~', 1), '.', 2))::jsonb;
      if (payload ->> 'vct') is distinct from 'https://actik.kh/credentials/identity_attestation' then
        raise exception using errcode = 'P0001', message = 'that is not an identity check';
      end if;
      cnf := payload -> 'cnf' -> 'jwk';
      if cnf ->> 'x' is distinct from active.public_jwk ->> 'x' or cnf ->> 'y' is distinct from active.public_jwk ->> 'y' then
        raise exception using errcode = 'P0001', message = 'the identity check must be bound to your current wallet key';
      end if;
      new.old_kid := null;
    end if;
  exception
    when sqlstate 'P0001' then raise;
    when others then raise exception 'malformed reissue request';
  end;
  return new;
end;
$$;

drop trigger if exists reissue_requests_guard on public.reissue_requests;
create trigger reissue_requests_guard
  before insert or update on public.reissue_requests
  for each row execute function public.reissue_requests_guard();

alter table public.reissue_requests enable row level security;

drop policy if exists "holder asks" on public.reissue_requests;
create policy "holder asks" on public.reissue_requests
  for insert to authenticated with check (holder = auth.uid());

drop policy if exists "holder reads own" on public.reissue_requests;
create policy "holder reads own" on public.reissue_requests
  for select to authenticated using (holder = auth.uid());

drop policy if exists "holder withdraws open" on public.reissue_requests;
create policy "holder withdraws open" on public.reissue_requests
  for delete to authenticated using (holder = auth.uid() and status = 'open');

drop policy if exists "issuer reads requests" on public.reissue_requests;
create policy "issuer reads requests" on public.reissue_requests
  for select to authenticated using (
    exists (select 1 from public.issuers i where i.did = issuer_did
            and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id)))
  );

drop policy if exists "issuer resolves requests" on public.reissue_requests;
create policy "issuer resolves requests" on public.reissue_requests
  for update to authenticated using (
    exists (select 1 from public.issuers i where i.did = issuer_did
            and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id)))
  );

-- ---------------------------------------------------------------------------
-- 5. A reissued credential names the one it replaces
-- ---------------------------------------------------------------------------
alter table public.pending_credentials add column if not exists replaces_jti uuid;

-- =============================================================================
-- 12. Verified contacts: see migrations/20261011_verified_contacts.sql
-- =============================================================================
-- ---------------------------------------------------------------------------
-- 1. Contacts, encrypted in the owner's wallet
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_contacts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cipher text not null check (length(cipher) <= 200000),
  iv text not null,
  created_at timestamptz not null default now()
);

create index if not exists wallet_contacts_owner_idx on public.wallet_contacts (owner);
alter table public.wallet_contacts enable row level security;

drop policy if exists "owner reads contacts" on public.wallet_contacts;
create policy "owner reads contacts" on public.wallet_contacts
  for select to authenticated using (owner = auth.uid());
drop policy if exists "owner adds contacts" on public.wallet_contacts;
create policy "owner adds contacts" on public.wallet_contacts
  for insert to authenticated with check (owner = auth.uid());
drop policy if exists "owner updates contacts" on public.wallet_contacts;
create policy "owner updates contacts" on public.wallet_contacts
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "owner deletes contacts" on public.wallet_contacts;
create policy "owner deletes contacts" on public.wallet_contacts
  for delete to authenticated using (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Checks: short-lived, addressed to a key
-- ---------------------------------------------------------------------------
create table if not exists public.contact_checks (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Filled in by the database: the asker's current key, and a fresh nonce.
  from_kid text not null,
  to_kid text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- B's signed answer (a compact JWS), or a refusal.
  response text check (response is null or length(response) <= 4096),
  declined boolean not null default false,
  responded_at timestamptz
);

create index if not exists contact_checks_to_idx on public.contact_checks (to_kid, created_at desc);

create or replace function public.contact_checks_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me text;
begin
  -- Old rows go whenever a new one is made: a check lives for minutes.
  delete from public.contact_checks where created_at < now() - interval '10 minutes';

  new.from_user := auth.uid();
  select kid into me from public.holder_keys where user_id = new.from_user and retired_at is null;
  if me is null then
    raise exception 'open your wallet first: a check is made with your wallet key';
  end if;
  new.from_kid := me;
  if new.to_kid = me then
    raise exception 'you cannot check yourself';
  end if;
  if not exists (select 1 from public.holder_keys where kid = new.to_kid and retired_at is null) then
    -- Not a secret: whoever asks already holds the key. It means the contact
    -- has retired that key, and must be met again for the new one.
    raise exception 'that wallet key is no longer in use: meet again to add the new one';
  end if;
  if (select count(*) from public.contact_checks
      where from_user = new.from_user and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'too many checks in a minute; wait a little';
  end if;
  -- gen_random_uuid() is built in (strong randomness, 122 bits), unlike pgcrypto,
  -- which a Supabase project keeps outside this function's search_path.
  new.nonce := replace(gen_random_uuid()::text, '-', '');
  new.created_at := now();
  new.expires_at := now() + interval '2 minutes';
  new.response := null;
  new.declined := false;
  new.responded_at := null;
  return new;
end;
$$;

drop trigger if exists contact_checks_guard on public.contact_checks;
create trigger contact_checks_guard
  before insert on public.contact_checks
  for each row execute function public.contact_checks_guard();

alter table public.contact_checks enable row level security;

drop policy if exists "asker creates check" on public.contact_checks;
create policy "asker creates check" on public.contact_checks
  for insert to authenticated with check (from_user = auth.uid());

drop policy if exists "asker reads own checks" on public.contact_checks;
create policy "asker reads own checks" on public.contact_checks
  for select to authenticated using (from_user = auth.uid());

-- The one asked sees an open, unexpired check addressed to their current key.
drop policy if exists "asked sees open checks" on public.contact_checks;
create policy "asked sees open checks" on public.contact_checks
  for select to authenticated using (
    expires_at > now() and response is null and not declined
    and to_kid = (select kid from public.holder_keys where user_id = auth.uid() and retired_at is null)
  );

drop policy if exists "asker deletes own checks" on public.contact_checks;
create policy "asker deletes own checks" on public.contact_checks
  for delete to authenticated using (from_user = auth.uid());

-- Answering: only the key it is addressed to, once, before it expires.
create or replace function public.answer_contact_check(p_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me text;
begin
  select kid into me from public.holder_keys where user_id = auth.uid() and retired_at is null;
  if me is null then
    raise exception 'open your wallet first';
  end if;
  update public.contact_checks
     set response = p_response, declined = (p_response is null), responded_at = now()
   where id = p_id and to_kid = me and expires_at > now() and response is null and not declined;
  if not found then
    raise exception 'this check has expired or was already answered';
  end if;
end;
$$;

revoke all on function public.answer_contact_check(uuid, text) from public, anon;
grant execute on function public.answer_contact_check(uuid, text) to authenticated;
