-- Identity verifiers, and the identity attestation they issue.
--
-- 1. issuers.kind gains 'identity_verifier': a third Root-signed tier, which
--    checks an original ID card or passport in person and issues identity
--    attestations, and nothing else. What verifiers believe is the kind the
--    Root signs into the trust list (src/lib/trustListBuild.ts).
-- 2. The outbox allows each kind only its own types: an institution
--    everything except identity attestations (identity needs its own
--    admission), an employer employment records, an identity verifier
--    identity attestations.
-- 3. An identity attestation must be signed as one, must be bound to the
--    recipient's own wallet key (`cnf`), may carry only its allowed claims,
--    and has no printed code. The guard decodes the signed token: an ID
--    number, a birth date, a photo or a note cannot be issued, even by a
--    modified app.
-- 4. Proof requests may ask for an identity attestation (no extras).
--
-- ACTIK keeps no register of people: the attestation goes to the person's
-- wallet, end-to-end encrypted, and the issuer's log keeps only what it keeps
-- for any credential (type, label, recipient email, jti).

-- ---------------------------------------------------------------------------
-- 1. issuers.kind
-- ---------------------------------------------------------------------------
alter table public.issuers drop constraint if exists issuers_kind_check;
alter table public.issuers add constraint issuers_kind_check
  check (kind in ('institution', 'employer', 'identity_verifier'));

-- ---------------------------------------------------------------------------
-- 2. The outbox: each kind of issuer sends only its own types
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
        and (
          (i.kind = 'institution' and credential_type is distinct from 'identity_attestation')
          or (i.kind = 'employer' and credential_type = 'employment_record')
          or (i.kind = 'identity_verifier' and credential_type = 'identity_attestation')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. What an identity attestation may say, and who it is bound to
-- ---------------------------------------------------------------------------
create or replace function public.identity_attestation_claims()
returns text[]
language sql
immutable
as $$
  select array['sub','iss','iat','exp',
    'name','institution','verification_level','evidence_type','verified_on']
$$;

-- Definer: it reads the recipient's holder key, which only its holder may select.
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
    -- Nothing else may be signed as an identity attestation either.
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

  -- Bound to the recipient's own wallet key, not to any key the issuer chose.
  if not exists (
    select 1
    from public.profiles p
    join public.holder_keys hk on hk.user_id = p.id
    where lower(p.email) = lower(new.recipient_email)
      and hk.public_jwk ->> 'x' = payload -> 'cnf' -> 'jwk' ->> 'x'
      and hk.public_jwk ->> 'y' = payload -> 'cnf' -> 'jwk' ->> 'y'
  ) then
    raise exception 'an identity attestation must be bound to the recipient''s own wallet key';
  end if;
  return new;
end;
$$;

drop trigger if exists pending_credentials_identity_guard on public.pending_credentials;
create trigger pending_credentials_identity_guard
  before insert or update on public.pending_credentials
  for each row execute function public.pending_credentials_identity_guard();

-- ---------------------------------------------------------------------------
-- 4. Proof requests may ask for an identity attestation
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
    'job_title','employment_type','employment_start','employment_end','employment_status',
    'verification_level','evidence_type','verified_on']
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
    when 'identity_attestation' then array[]::text[]
    else null
  end
$$;
