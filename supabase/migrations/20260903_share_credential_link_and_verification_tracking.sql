-- Two gaps closed here:
--
-- 1. `shares` had no `credential_id` — a share link could never be tied back
--    to the credential it was generated from, so per-credential share counts
--    were not computable at all.
--
-- 2. Verification was (and remains) fully read-only: VerifyCredential.tsx
--    never wrote anything on a successful check. `view_count`/`last_verified_at`
--    plus this RPC give the wallet/issuer-dashboard something real to show
--    ("verified N times") without adding a full event-log table.
--
-- The RPC exists because `shares`' RLS is public-read/owner-write only (see
-- schema.sql: "owner manages shares" / "public read share") — there is no
-- policy letting an anonymous verifier update a row directly, and there
-- shouldn't be one (an open anon UPDATE policy would let anyone touch any
-- share's view_count directly, or worse, other columns, with no validation
-- at all). A SECURITY DEFINER function scoped to exactly this one increment,
-- gated on the share still being valid, matches the one existing RPC pattern
-- in this codebase (check_recipient_by_email) instead of introducing a new,
-- looser access pattern.
--
-- Note: this only counts verifications going forward — a verification is
-- not tamper-proof under this design (nothing stops a caller from invoking
-- the RPC directly, repeatedly, without ever loading the verify page; this
-- app has no server-side rate limiting anywhere else either, so that's a
-- pre-existing risk tolerance, not a new one introduced here).

alter table shares add column if not exists credential_id uuid references credentials(id) on delete cascade;
alter table shares add column if not exists view_count integer not null default 0;
alter table shares add column if not exists last_verified_at timestamptz;

create or replace function public.record_verification(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Silently no-ops if the share doesn't exist, is expired, or was revoked —
  -- this is called fire-and-forget right after a successful verify, so there
  -- is no user-facing outcome to report either way.
  update public.shares
  set view_count = coalesce(view_count, 0) + 1,
      last_verified_at = now()
  where id = p_share_id
    and expires_at > now()
    and revoked_at is null;
end;
$$;

revoke all on function public.record_verification(uuid) from public;
grant execute on function public.record_verification(uuid) to anon, authenticated;
