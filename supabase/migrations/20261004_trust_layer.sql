-- The trust layer.
--
-- Until now the `issuers` table *was* the trust root: verifiers believed
-- whatever it said when they asked, so anyone able to write it — a
-- service-role key, a compromised admin account, the profiles.role bug fixed
-- below — could make any institution trusted, or swap its key. This migration
-- moves trust out of the database:
--
--   - a Root key, pinned into the app build and held offline, signs a list of
--     accredited issuers and their keys (src/lib/trustList.ts); verifiers
--     believe that signature, not this database;
--   - each issuer signs its own list of withdrawn credentials
--     (src/lib/revocation.ts);
--   - the database keeps the working state — applications, key history, the
--     issuance log — as proposals the Root reviews when it signs.
--
-- Also: a user can no longer make themselves an admin; issuer keys keep their
-- history so rotation no longer strands old credentials; issuers get a real
-- log of what they issued; share links can be single-use; and the
-- `type_metadata` column that non-degree issuance has always written finally
-- exists.
--
-- Operational consequence, stated plainly: approving an institution in the
-- admin dashboard no longer makes it trusted on its own. It becomes trusted
-- when the Root holder next builds, signs and publishes the list
-- (scripts/build-trustlist.ts). Same for a new or rotated issuer key.

-- ---------------------------------------------------------------------------
-- 1. profiles.role: a user picks student or issuer; nobody picks admin.
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
-- 2. Columns the app writes that the tracked schema never had
-- ---------------------------------------------------------------------------
-- IssueCredential.tsx writes `type_metadata` for the five non-degree types and
-- Notifications.tsx copies it across on claim; no tracked SQL created it, so
-- non-degree issuance failed on any project built from this repo.
alter table public.pending_credentials add column if not exists type_metadata jsonb;
alter table public.credentials         add column if not exists type_metadata jsonb;
-- The credential's own identifier (its signed `jti`), so the issuer can later
-- withdraw exactly it.
alter table public.pending_credentials add column if not exists credential_jti uuid;
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
-- 3. issuer_keys: every key an issuer has used, so rotation strands nothing
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
-- 4. trust_documents: where the Root-signed trust list is published
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
-- 5. revocation_lists: each issuer's signed list of withdrawn credentials
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

drop policy if exists "read revocation lists" on public.revocation_lists;
create policy "read revocation lists" on public.revocation_lists for select using (true);

drop policy if exists "issuer publishes own revocations" on public.revocation_lists;
create policy "issuer publishes own revocations" on public.revocation_lists
  for insert to authenticated with check (public.owns_accredited_issuer(issuer_did));

drop policy if exists "issuer updates own revocations" on public.revocation_lists;
create policy "issuer updates own revocations" on public.revocation_lists
  for update to authenticated
  using (public.owns_accredited_issuer(issuer_did))
  with check (public.owns_accredited_issuer(issuer_did));

-- ---------------------------------------------------------------------------
-- 6. issued_credentials: what an issuer has issued, written by the database
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
-- 7. Single-use share links
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
