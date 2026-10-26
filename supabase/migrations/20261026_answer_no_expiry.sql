-- An answer stays visible to the requester until the candidate withdraws it
-- (deletes it). There is no duration to choose: whatever the client sends as
-- expires_at is ignored, so an answer cannot be given an end date from outside.
-- Answers sent earlier keep the expiry they already have.

create or replace function public.proof_responses_expiry()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.expires_at := old.expires_at;
  else
    new.expires_at := null;
  end if;
  return new;
end;
$$;
