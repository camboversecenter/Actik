-- RLS hardening: four policies that said "true", and the revoked-share gap.
--
-- Every hole below is reachable by anyone holding the anon key, which ships in
-- the client bundle. Nothing here changes what the app can do for the user it
-- belongs to; it changes what everyone else can do.
--
--   1. issuers  — `update ... using (auth.uid() = owner)` had no WITH CHECK and
--                 no column restriction, so an issuer could set its own
--                 `accredited` flag. The trust decision in VerifyCredential.tsx
--                 (check 4) rests on exactly that flag. The insert policy had
--                 the same gap: nothing stopped `insert ... accredited = true`.
--   2. issuers  — `for select using (true)` covers every column, including the
--                 zk-vault envelopes and `signing_key_ciphertext`. Publishing
--                 an encrypted signing key plus its salt to anonymous callers
--                 turns "zero knowledge" into an offline cracking exercise.
--                 The secrets move to their own owner-only table.
--   3. shares   — `for select using (true)` with no row scoping: an anonymous
--                 caller could `select * from shares` and take every holder's
--                 presentation, expired or not, revoked or not. Verification
--                 now goes through an RPC that returns the presentation only
--                 while the share is live.
--   4. profiles — every issuer and admin could select every profile row, vault
--                 envelopes included. The admin dashboard only ever wanted
--                 id + email; it gets an RPC for that instead.
--
-- The revoked-share gap (Activity.tsx sets `revoked_at`, no verifier ever read
-- it, so a revoked link kept verifying) closes with 3.

-- Columns this migration depends on. They were added by loose files outside
-- supabase/migrations/, so a project restored from schema.sql alone may lack
-- them; adding them here makes this migration self-contained.
alter table public.shares add column if not exists revoked_at timestamptz;
alter table public.shares add column if not exists credential_id uuid references public.credentials(id) on delete cascade;
alter table public.shares add column if not exists view_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- 0. Role helper. `is_admin_or_issuer` already exists; accreditation is an
--    admin-only act, so it needs the narrower test.
-- ---------------------------------------------------------------------------
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

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. issuers: an issuer may edit its own row, but never its own standing.
-- ---------------------------------------------------------------------------

-- WITH CHECK on the insert: registration always starts unaccredited.
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

-- WITH CHECK on the update: an issuer cannot hand its row to someone else.
drop policy if exists "update own issuer" on public.issuers;
create policy "update own issuer" on public.issuers
  for update to authenticated
  using (auth.uid() = owner or (owner is null and auth.uid() = user_id))
  with check (auth.uid() = owner or (owner is null and auth.uid() = user_id));

-- RLS is row-level, so the column rule is a trigger. Admin updates and
-- service-role/SQL-editor sessions (auth.uid() is null) pass through.
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

-- ---------------------------------------------------------------------------
-- 2. issuer_secrets: the signing-key vault, off the public-read table.
--    No anon access, no admin access — only the issuer that owns it.
-- ---------------------------------------------------------------------------
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

alter table public.issuer_secrets enable row level security;

drop policy if exists "own issuer secrets" on public.issuer_secrets;
create policy "own issuer secrets" on public.issuer_secrets
  for all to authenticated
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

-- Move whatever the live table holds, then drop the columns.
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

-- `issuers` may now stay publicly readable: what is left is the registry
-- proper — name, did, public key, accreditation standing.

-- ---------------------------------------------------------------------------
-- 3. shares: no blanket read. A verifier gets one share, by id, while live.
-- ---------------------------------------------------------------------------
drop policy if exists "public read share" on public.shares;

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

  -- `disclosed_fields` and `revealed` both exist in the wild (see
  -- VerifyCredential.tsx's fallback); read whichever this project has.
  s_json := to_jsonb(s);
  fields := coalesce(s_json -> 'disclosed_fields', s_json -> 'revealed', '[]'::jsonb);
  revoked := nullif(s_json ->> 'revoked_at', '')::timestamptz;

  -- A dead share never yields its presentation: that is the whole point of
  -- routing verification through this function. Expiry and revocation are
  -- reported so the verifier can say which it was, and when.
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

-- The issuer dashboard used to sum `view_count` by selecting the issuer's
-- shares outright, which only worked because of the blanket read policy — and
-- handed the issuer every holder's presentation to get one number. It gets the
-- number and nothing else. (This also drops the 1000-row PostgREST cap the
-- client-side sum silently hit.)
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

-- ---------------------------------------------------------------------------
-- 4. profiles: issuers and admins no longer read whole profile rows.
-- ---------------------------------------------------------------------------
drop policy if exists "issuers and admins can select profiles" on public.profiles;

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
