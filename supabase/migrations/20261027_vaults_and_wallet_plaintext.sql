-- 1. The vaults table. The app has always read and written it (the wallet's
--    sealed envelope and how it is unlocked), but it was created by hand on
--    the hosted project and never written down, so a project built from
--    these files had no wallet. This is the hosted table as it stands.
create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  encrypted_envelope text not null,
  unlock_method text not null check (unlock_method in ('passkey', 'pin')),
  created_at timestamptz default now()
);

alter table public.vaults enable row level security;

drop policy if exists "own vault" on public.vaults;
create policy "own vault" on public.vaults
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. A wallet holds ciphertext. The student number and the document number
--    were also being written in plain text beside it when a credential was
--    accepted; the app no longer writes them, and the copies already there
--    go. Each is still inside the encrypted credential, which is the copy the
--    wallet shows and shares from.
update public.credentials
   set student_id = null, certificate_id = null
 where student_id is not null or certificate_id is not null;
