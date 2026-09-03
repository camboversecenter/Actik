-- NotificationsBell.tsx subscribes to postgres_changes on pending_credentials
-- to update the bell badge live (new credential issued, or claimed elsewhere).
-- That subscription only ever fires if this table is in the supabase_realtime
-- publication — nothing in this repo's prior migrations added it, so on a
-- project where it was never turned on via the Dashboard either, the bell
-- silently never received a single realtime event. (The app now also has a
-- same-tab event + a polling fallback — see NotificationsBell.tsx/
-- Notifications.tsx — but this is the fix that makes updates instant instead
-- of same-tab-only or up-to-20s-stale.)

alter publication supabase_realtime add table pending_credentials;
