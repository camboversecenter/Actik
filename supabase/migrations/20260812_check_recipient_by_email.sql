-- The issuer-side "does this student have an Actik account?" lookup used to be
-- a plain `select * from profiles where email = ...`. That query is subject to
-- the "own profile" / "issuers and admins can select profiles" RLS policies,
-- so if the caller's own profile.role was ever missing or not exactly
-- 'issuer'/'admin', the select would silently return zero rows — indistinguishable
-- in the UI from the student genuinely not having an account.
--
-- This function makes the authorization check explicit (raises instead of
-- silently filtering) and returns a definite exists/not-exists answer.
create or replace function public.check_recipient_by_email(p_email text)
returns table(student_id uuid, student_role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_issuer(auth.uid()) then
    raise exception 'not authorized to look up recipients';
  end if;

  return query
    select p.id, p.role
    from public.profiles p
    where lower(p.email) = lower(p_email)
    limit 1;
end;
$$;

grant execute on function public.check_recipient_by_email(text) to authenticated;
