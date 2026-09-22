-- The admin (MoEYS) trust-registry dashboard (src/pages/admin/AdminDashboard.tsx)
-- reads/writes several `issuers` columns and an `audit_logs` table that were
-- never captured in schema.sql or a migration — they only exist in the live
-- project. AdminDashboard.tsx defensively catches "column does not exist"
-- (Postgres 42703) and falls back to a minimal payload, which is why nothing
-- visibly broke, but the tracked schema has been silently out of sync. This
-- migration brings it back in line.

-- ---------------------------------------------------------------------------
-- issuers: columns the admin dashboard depends on for approve/revoke/restore
-- and for displaying institution detail (domain, type, public_key string form,
-- who accredited/revoked and when). `user_id` mirrors `owner` — several call
-- sites (RegisterIssuer.tsx, IssuerDashboard.tsx, AdminDashboard.tsx) fall
-- back to it when `owner`-based inserts/updates fail on a 42703.
-- ---------------------------------------------------------------------------
alter table issuers add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table issuers add column if not exists domain text;
alter table issuers add column if not exists type text;
alter table issuers add column if not exists public_key text;
alter table issuers add column if not exists accredited_at timestamptz;
alter table issuers add column if not exists accredited_by uuid references auth.users(id) on delete set null;
alter table issuers add column if not exists revoked_at timestamptz;
alter table issuers add column if not exists revoked_by uuid references auth.users(id) on delete set null;

-- AdminDashboard.tsx's "Reject application" action does a hard DELETE on a
-- pending issuer row, but schema.sql never had a delete policy for issuers —
-- only insert/update. Without this, reject only worked if it was silently
-- falling through on a service-role context; make the admin path explicit.
drop policy if exists "admin delete issuers" on issuers;
create policy "admin delete issuers" on issuers
  for delete using (
    exists (
      select 1 from public.profiles
      where public.profiles.id = auth.uid()
        and public.profiles.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- audit_logs: written by src/lib/auditLog.ts for every accreditation action
-- (approve/revoke/reject/restore/export). Matches the AuditLogEntry interface.
-- ---------------------------------------------------------------------------
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  admin_id uuid references auth.users(id) on delete set null,
  institution_id uuid references issuers(id) on delete set null,
  institution_name text,
  "timestamp" timestamptz not null,
  ip_address text,
  user_agent text,
  reason text,
  details jsonb,
  signature text,
  status_before text,
  status_after text,
  created_at timestamptz not null default now()
);

alter table audit_logs enable row level security;

drop policy if exists "admin insert audit_logs" on audit_logs;
create policy "admin insert audit_logs" on audit_logs
  for insert to authenticated with check (
    exists (
      select 1 from public.profiles
      where public.profiles.id = auth.uid()
        and public.profiles.role = 'admin'
    )
  );

drop policy if exists "admin select audit_logs" on audit_logs;
create policy "admin select audit_logs" on audit_logs
  for select to authenticated using (
    exists (
      select 1 from public.profiles
      where public.profiles.id = auth.uid()
        and public.profiles.role = 'admin'
    )
  );
