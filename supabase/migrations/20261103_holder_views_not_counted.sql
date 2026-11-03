-- A holder opening their own share link does not use it up.
--
-- A single-use link (max_views = 1) was spent by the first open, whoever made
-- it. Holders who checked their link before sending it found it already dead
-- when the other person opened it. When the person opening the link is signed
-- in as the share's owner, the open is not counted, and a used-up link still
-- opens for them. Everyone else is counted exactly as before. A holder who is
-- not signed in on that browser is indistinguishable from anyone else, so
-- that open still counts.

create or replace function public.get_share_for_verification(p_share_id uuid)
returns table (
  id uuid,
  presentation text,
  issuer_did text,
  disclosed_fields jsonb,
  credential_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shares%rowtype;
  s_json jsonb;
  fields jsonb;
  revoked timestamptz;
  cap integer;
begin
  select * into s from public.shares where public.shares.id = p_share_id;

  if not found then
    return query select null::uuid, null::text, null::text, null::jsonb,
                        null::uuid, null::timestamptz, null::timestamptz, 'not_found'::text;
    return;
  end if;

  -- `disclosed_fields` and `revealed` both exist in the wild.
  s_json := to_jsonb(s);
  fields := coalesce(s_json -> 'disclosed_fields', s_json -> 'revealed', '[]'::jsonb);
  revoked := nullif(s_json ->> 'revoked_at', '')::timestamptz;
  cap := nullif(s_json ->> 'max_views', '')::integer;

  if revoked is not null then
    return query select s.id, null::text, s.issuer_did, null::jsonb,
                        s.credential_id, s.expires_at, s.created_at, 'revoked'::text;
    return;
  end if;

  if s.expires_at <= now() then
    return query select s.id, null::text, s.issuer_did, null::jsonb,
                        s.credential_id, s.expires_at, s.created_at, 'expired'::text;
    return;
  end if;

  -- A capped link that has been used up behaves like an expired one: the
  -- presentation is not handed out again — except to its owner, whose opens
  -- never counted towards the cap.
  if cap is not null and coalesce(s.view_count, 0) >= cap
     and auth.uid() is distinct from s.owner then
    return query select s.id, null::text, s.issuer_did, null::jsonb,
                        s.credential_id, s.expires_at, s.created_at, 'exhausted'::text;
    return;
  end if;

  return query select s.id, s.presentation, s.issuer_did, fields,
                      s.credential_id, s.expires_at, s.created_at, 'ok'::text;
end;
$$;

revoke all on function public.get_share_for_verification(uuid) from public;
grant execute on function public.get_share_for_verification(uuid) to anon, authenticated;

create or replace function public.record_verification(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shares
  set view_count = coalesce(view_count, 0) + 1,
      last_verified_at = now()
  where id = p_share_id
    and owner is distinct from auth.uid()
    and expires_at > now()
    and revoked_at is null
    and (max_views is null or coalesce(view_count, 0) < max_views);
end;
$$;

revoke all on function public.record_verification(uuid) from public;
grant execute on function public.record_verification(uuid) to anon, authenticated;
