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

