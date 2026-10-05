-- Proof requests: recruitment where the candidate stays in control.
--
-- An employer publishes a request (proof_requests) and shares its link. A
-- candidate answers from their own wallet (proof_responses) with presentations
-- that disclose only the fields the request may see. See src/lib/proofRequest.ts.
--
-- The database is the second of three places the field allowlist is enforced
-- (the candidate's app is the first, the employer's app the third). It decodes
-- every disclosure in every answer and refuses a response that carries a claim
-- the request could not ask for — national ID, student number, date of birth,
-- photograph, email — even if a modified app tried to send one. The allowlist
-- here must match src/lib/disclosure.ts (ALWAYS_REVEALED) and
-- src/lib/proofRequest.ts (REQUESTABLE).
--
-- There is deliberately no way to list requests or answers beyond your own:
-- a request is reached by its link, and answers are seen only by the candidate
-- who gave them and the employer who asked.

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
