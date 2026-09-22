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
-- After running, the app needs these five functions to exist:
--   get_share_for_verification, admin_list_profile_emails,
--   issuer_verification_count, record_verification, check_recipient_by_email
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

-- One share, by id, for an anonymous verifier. `shares` has no public read
-- policy: a blanket one let anyone select every holder's presentation, live or
-- not. A dead share never yields its presentation here — expiry and revocation
-- come back as a status so the verifier can say which it was, and when.
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

  return query select s.id, s.presentation, s.issuer_did, fields,
                      s.credential_id, s.expires_at, s.created_at, 'ok'::text;
end;
$$;

revoke all on function public.get_share_for_verification(uuid) from public;
grant execute on function public.get_share_for_verification(uuid) to anon, authenticated;

-- Counts a verification. Gated on the share still being live, so it cannot
-- record a view of something that would not have verified.
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
    and revoked_at is null;
end;
$$;

revoke all on function public.record_verification(uuid) from public;
grant execute on function public.record_verification(uuid) to anon, authenticated;

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

-- pending_credentials: any authenticated user may issue one; the recipient
-- reads and deletes rows addressed to their email.
drop policy if exists "issue pending" on public.pending_credentials;
create policy "issue pending" on public.pending_credentials
  for insert to authenticated with check (true);

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
