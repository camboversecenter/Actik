-- Actik schema for Supabase (run in the SQL editor).
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
  name text not null,
  did text not null unique,
  public_jwk jsonb not null,
  accredited boolean not null default false,
  created_at timestamptz default now(),
  -- zk-vault envelope for the issuer's signing private key (ciphertext only —
  -- mirrors profiles' vault_* columns above). signing_key_ciphertext holds the
  -- encrypted privateJwk payload itself, which is outside the vault library's
  -- own envelope contract.
  vault_envelope_pin text,
  vault_pin_salt text,
  vault_envelope_passkey text,
  passkey_id text,
  signing_key_ciphertext jsonb
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
create policy "issuers and admins can select profiles" on profiles
  for select to authenticated using (
    public.is_admin_or_issuer(auth.uid())
  );

-- issuers: public registry (anyone can read), owner can create/update theirs.
create policy "read registry" on issuers for select using (true);
create policy "manage own issuer" on issuers
  for insert with check (auth.uid() = owner);
create policy "update own issuer" on issuers
  for update using (auth.uid() = owner);
create policy "admin update issuers" on issuers
  for update using (
    exists (
      select 1 from public.profiles
      where public.profiles.id = auth.uid()
        and public.profiles.role = 'admin'
    )
  );

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

-- shares: owner manages; ANYONE can read by id (a share link is a bearer token).
create policy "owner manages shares" on shares
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "public read share" on shares
  for select using (true);
