-- Verified contacts: "is it really you, right now?" — the deepfake check.
--
-- No central register and no stored contact graph:
--
-- 1. wallet_contacts holds each person's own contacts, end-to-end encrypted
--    with their wallet key like their credentials. The database sees
--    ciphertext: not who knows whom.
-- 2. contact_checks holds a short-lived challenge, addressed to a wallet key
--    by its thumbprint (holder_keys.kid). A asks; the database adds a nonce;
--    B's app, holding that key, sees the request and answers by signing
--    {nonce, aud = A's key, iat} with B's holder key; A's app verifies it
--    against B's key from A's own contacts. Rows live for minutes: expired
--    ones are deleted whenever a new check is made, and anyone can delete
--    their own. What a row reveals while it lives — that A's key asked B's
--    key — is the minimum a relay needs, and is gone with it.
--
-- The database never checks the answer's signature and never says "verified":
-- the asker's app does, against the key the asker stored when they met.

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
