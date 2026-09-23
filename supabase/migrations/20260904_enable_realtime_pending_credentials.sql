-- NotificationsBell.tsx subscribes to postgres_changes on pending_credentials
-- to update the bell badge live (new credential issued, or claimed elsewhere).
-- That subscription only ever fires if this table is in the supabase_realtime
-- publication — nothing in this repo's prior migrations added it, so on a
-- project where it was never turned on via the Dashboard either, the bell
-- silently never received a single realtime event. (The app now also has a
-- same-tab event + a polling fallback — see NotificationsBell.tsx/
-- Notifications.tsx — but this is the fix that makes updates instant instead
-- of same-tab-only or up-to-20s-stale.)

-- Guarded twice: `supabase_realtime` is created by the Supabase platform (a
-- database built from this repo alone has no such publication), and adding a
-- table that is already in it raises rather than no-opping.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'pending_credentials'
     )
  then
    execute 'alter publication supabase_realtime add table public.pending_credentials';
  end if;
end;
$$;
