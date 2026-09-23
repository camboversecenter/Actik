-- Was supabase/migration_add_share_activity_fields.sql — loose at the top of
-- supabase/, undated, outside migrations/, so anyone applying migrations in
-- order missed it. `recipient_label` exists nowhere else in the tracked SQL,
-- yet ShareCredential.tsx writes it and Activity.tsx reads it: a project
-- rebuilt from schema.sql plus migrations/ would fail on every share.
-- Dated before 20260903, whose record_verification() reads `revoked_at`.

alter table shares add column if not exists recipient_label text;
alter table shares add column if not exists revoked_at timestamptz;
