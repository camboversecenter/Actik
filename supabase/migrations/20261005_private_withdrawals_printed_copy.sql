-- Withdrawal lists that name no one, and the printed copy for the holder.
--
-- 1. revocation_lists is public, and version 1 of the list format carried the
--    document numbers and jtis of withdrawn credentials, plus the issuer's
--    free-text reason, in the clear. Version 2 (actik/revocations/2, see
--    src/lib/revocation.ts) carries only hashes and one of two fixed reasons.
--    From here the database accepts only version 2, with nothing in an entry
--    beyond id, reason and revokedAt, and a version-1 row is readable only by
--    the institution that published it — until it renews its list, which
--    rewrites it as version 2 with every withdrawal kept.
--
--    Trade-off, stated plainly: while an institution has not yet renewed a
--    version-1 list, verifiers see no list for it and report the standing of
--    its credentials as "unchecked" rather than "withdrawn". The Withdrawals
--    page tells the institution to renew.
--
-- 2. pending_credentials.printed_code: the KH1: printed code the institution
--    signs at issuance travels with the credential, so the holder keeps it in
--    their encrypted vault and can reprint or hand it on.

create or replace function public.revocation_lists_guard()
returns trigger
language plpgsql
as $$
declare
  stmt jsonb := public.try_jsonb(new.document ->> 'statement');
begin
  if stmt is null or (stmt ->> 'version') is null then
    raise exception 'not a signed revocation list';
  end if;
  if (stmt ->> 'type') is distinct from 'actik/revocations/2' then
    raise exception 'revocation lists must be published as actik/revocations/2 (hashed entries)';
  end if;
  if jsonb_typeof(stmt -> 'revoked') is distinct from 'array' or exists (
    select 1 from jsonb_array_elements(stmt -> 'revoked') e
    where jsonb_typeof(e) <> 'object'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('id', 'reason', 'revokedAt'))
       or (e ->> 'id') !~ '^[0-9A-F]{64}$'
       or (e ->> 'reason') not in ('withdrawn', 'corrected')
  ) then
    raise exception 'a revocation entry may carry only a hashed id, a fixed reason and a date';
  end if;
  if (stmt ->> 'issuer') is distinct from new.issuer_did then
    raise exception 'revocation list names issuer %, stored under %', stmt ->> 'issuer', new.issuer_did;
  end if;
  new.version := (stmt ->> 'version')::bigint;
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.version <= old.version then
    raise exception 'revocation list version % does not supersede published version %', new.version, old.version;
  end if;
  return new;
end;
$$;

drop policy if exists "read revocation lists" on public.revocation_lists;
create policy "read revocation lists" on public.revocation_lists for select using (
  public.try_jsonb(document ->> 'statement') ->> 'type' = 'actik/revocations/2'
);
-- owns_accredited_issuer() is not executable by anon, so the owner's own read
-- is a separate policy that applies to signed-in users only.
drop policy if exists "issuer reads own revocations" on public.revocation_lists;
create policy "issuer reads own revocations" on public.revocation_lists
  for select to authenticated using (public.owns_accredited_issuer(issuer_did));

alter table public.pending_credentials add column if not exists printed_code text
  check (printed_code is null or (printed_code like 'KH1:%' and length(printed_code) <= 4096));
