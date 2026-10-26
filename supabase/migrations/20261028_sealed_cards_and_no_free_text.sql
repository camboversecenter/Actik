-- 1. A wallet holds only ciphertext.
--
-- A credential's card — title, institution, major, dates — was kept in plain
-- columns beside the encrypted credential so the wallet list could draw
-- without unlocking. It is now sealed with the vault key in its own small blob
-- (src/lib/walletCard.ts). The plain columns are cleared, and a trigger keeps
-- them empty: an older copy of the app that still writes them has its values
-- dropped rather than refused, so accepting a credential keeps working while
-- it updates. Only `credential_type` stays readable, so a locked wallet can
-- still sort cards by kind. Nothing is lost: every value is inside the
-- encrypted credential, and the wallet seals a card from it on next unlock.
alter table public.credentials add column if not exists card_cipher text;
alter table public.credentials add column if not exists card_iv text;

create or replace function public.credentials_ciphertext_only()
returns trigger
language plpgsql
as $$
begin
  new.label := null;
  new.degree_type := null;
  new.major := null;
  new.graduation_date := null;
  new.institution_name := null;
  new.issuer_did := null;
  new.type_metadata := null;
  new.student_name := null;
  new.student_email := null;
  new.student_id := null;
  new.student_photo := null;
  new.certificate_id := null;
  return new;
end;
$$;

drop trigger if exists credentials_ciphertext_only on public.credentials;
create trigger credentials_ciphertext_only
  before insert or update on public.credentials
  for each row execute function public.credentials_ciphertext_only();

-- The trigger clears each row as it is touched.
update public.credentials set label = null
 where label is not null or degree_type is not null or major is not null or graduation_date is not null
    or institution_name is not null or issuer_did is not null or type_metadata is not null
    or student_name is not null or student_email is not null or student_id is not null
    or student_photo is not null or certificate_id is not null;

-- 2. A proof request has no free text beyond its title and who is asking.
--
-- A box for "the employer's own words" is a box for "how old are you?": the
-- request format is what keeps the excluded questions from being asked
-- (paper, "Asking Less, by Design"). A new request may carry no description
-- and no note on any requirement. Requests written before keep theirs, and
-- the app no longer shows them.
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
  if coalesce(new.description, '') <> '' then
    raise exception 'a proof request has no free-text description';
  end if;
  if new.expires_at <= now() or new.expires_at > now() + interval '90 days 1 minute' then
    raise exception 'a proof request must expire within 90 days';
  end if;
  if jsonb_typeof(new.requirements) is distinct from 'array'
     or jsonb_array_length(new.requirements) not between 1 and 5 then
    raise exception 'a proof request asks for between 1 and 5 credentials';
  end if;
  for r in select * from jsonb_array_elements(new.requirements) loop
    if jsonb_typeof(r) <> 'object'
       or exists (select 1 from jsonb_object_keys(r) k where k not in ('type', 'extras')) then
      raise exception 'a requirement names a credential type and fields from its list, and nothing else';
    end if;
    extras := public.proof_requestable_extras(r ->> 'type');
    if extras is null then
      raise exception 'credential type % cannot be requested', r ->> 'type';
    end if;
    if jsonb_typeof(r -> 'extras') is distinct from 'array' then
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
