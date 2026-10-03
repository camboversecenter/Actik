-- Employment records, issued by registered employers.
--
-- 1. issuers.kind: 'institution' (may issue every credential type) or
--    'employer' (employment records only). Chosen at registration; after that
--    only an admin changes it. What verifiers believe is the kind the Root
--    signs into the trust list (src/lib/trustListBuild.ts), exported from this
--    column by supabase/queries/export_trustlist_input.sql.
-- 2. The outbox refuses anything but an employment record from an employer.
-- 3. An employment record may carry only its allowed claims. The guard decodes
--    every disclosure of the signed token and refuses anything else — so a
--    salary, a reason for leaving or a performance rating cannot be issued,
--    even by a modified app.
-- 4. Proof requests may ask for employment records (and department, role).
--
-- Nothing reaches the employee's wallet until they accept it (Notifications:
-- claim, or decline).

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
