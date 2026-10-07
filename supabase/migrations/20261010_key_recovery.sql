-- Key recovery: a wallet key can be replaced, and credentials follow it.
--
-- 1. holder_keys keeps history. A user has at most one active key and any
--    number of retired ones; a retired key is never reactivated or deleted,
--    because credentials signed to it still name it. Each key carries its RFC
--    7638 thumbprint (`kid`), computed here, not taken from the client.
-- 2. retire_holder_key(reason [, kid]): the only way a key changes. 'lost'
--    (forgotten PIN, wallet reset), 'compromised' (someone else has the
--    wallet) or 'replaced' (retired on purpose while still available). The
--    next unlock makes a new key (src/lib/holderKey.ts). A key already retired
--    as lost or replaced can later be marked compromised, never the reverse.
-- 3. holder_public_key and the identity-attestation guard use the active key.
-- 4. reissue_requests: the holder asks an issuer to reissue a credential to
--    their new key, proving continuity with either
--      - 'old_key':  the old credential, presented with a proof from the old
--                    key (only if that key was not retired as compromised), or
--      - 'identity': a fresh identity attestation bound to the new key, with
--                    that key's proof; the old credential is attached if the
--                    holder still has it.
--    The database fills in who is asking and their active key; the issuer's
--    app checks the proofs (src/lib/reissue.ts), reissues with the usual
--    issuing code and withdraws the old credential as 'corrected'.
-- 5. pending_credentials.replaces_jti: a reissued credential names the one it
--    replaces, so the holder's wallet can swap the old copy for the new.

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
