-- A candidate chooses how long the employer can see their answer.
--
-- expires_at is set when the answer is sent (1-90 days; 30 when the client does
-- not say). After it passes, the employer's read policy no longer returns the
-- row. The candidate always sees their own answer. Answers sent before this
-- migration have no expiry (null) and stay visible as before.

alter table public.proof_responses add column if not exists expires_at timestamptz;

create or replace function public.proof_responses_expiry()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.expires_at := old.expires_at;
    return new;
  end if;
  if new.expires_at is null then
    new.expires_at := now() + interval '30 days';
  elsif new.expires_at <= now() or new.expires_at > now() + interval '90 days 1 minute' then
    raise exception 'an answer can be shared for 1 to 90 days';
  end if;
  return new;
end;
$$;

drop trigger if exists proof_responses_expiry on public.proof_responses;
create trigger proof_responses_expiry
  before insert or update on public.proof_responses
  for each row execute function public.proof_responses_expiry();

drop policy if exists "candidate and requester read answers" on public.proof_responses;
create policy "candidate and requester read answers" on public.proof_responses
  for select to authenticated using (
    responder = auth.uid()
    or (
      (expires_at is null or expires_at > now())
      and exists (select 1 from public.proof_requests r where r.id = request_id and r.owner = auth.uid())
    )
  );

drop function if exists public.my_proof_responses();
create or replace function public.my_proof_responses()
returns table (
  id uuid, request_id uuid, title text, requester_name text, request_status text,
  items_count int, created_at timestamptz, expires_at timestamptz
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
         jsonb_array_length(p.items), p.created_at, p.expires_at
  from public.proof_responses p
  join public.proof_requests r on r.id = p.request_id
  where p.responder = auth.uid()
  order by p.created_at desc
$$;

revoke all on function public.my_proof_responses() from public, anon;
grant execute on function public.my_proof_responses() to authenticated;
