-- Postgres grants EXECUTE to PUBLIC by default when a function is created,
-- so both of these SECURITY DEFINER functions were callable by anon/authenticated
-- even though neither is meant to be hit directly over PostgREST's RPC endpoint:
--   - check_recipient_by_email does its own auth.uid() check internally, but anon
--     should never even reach it (avoid exposing the endpoint + error behavior).
--   - handle_new_user is the on_auth_user_created trigger function; triggers invoke
--     it with the definer's privileges regardless of grants, so it needs no
--     PUBLIC/anon/authenticated grant at all, and calling it directly via RPC
--     (outside trigger context, without a NEW record) is not a supported path.

revoke all on function public.check_recipient_by_email(text) from public, anon;
grant execute on function public.check_recipient_by_email(text) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
