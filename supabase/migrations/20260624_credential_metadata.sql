-- Was supabase/migration_metadata.sql — loose and undated, same as the share
-- activity fields. Lower stakes (schema.sql declares these columns inline for
-- a fresh project) but it has to be in the ordered set for an older project to
-- converge. Dated first: everything after it assumes these columns.

-- Migration: Update credentials and pending_credentials tables to store certificate metadata

-- 1. Update credentials table
alter table credentials add column if not exists student_photo text;
alter table credentials add column if not exists student_name text;
alter table credentials add column if not exists student_email text;
alter table credentials add column if not exists student_id text;
alter table credentials add column if not exists degree_type text;
alter table credentials add column if not exists major text;
alter table credentials add column if not exists graduation_date timestamp;
alter table credentials add column if not exists certificate_id text;
alter table credentials add column if not exists issuer_did text;
alter table credentials add column if not exists is_encrypted boolean default true;
alter table credentials add column if not exists updated_at timestamp;

-- Constraint: certificate_id must be unique per issuer (composite unique on issuer_did + certificate_id)
alter table credentials drop constraint if exists credentials_issuer_certificate_unique;
alter table credentials add constraint credentials_issuer_certificate_unique unique (issuer_did, certificate_id);


-- 2. Update pending_credentials table
alter table pending_credentials add column if not exists student_photo text;
alter table pending_credentials add column if not exists student_name text;
alter table pending_credentials add column if not exists student_email text;
alter table pending_credentials add column if not exists student_id text;
alter table pending_credentials add column if not exists degree_type text;
alter table pending_credentials add column if not exists major text;
alter table pending_credentials add column if not exists graduation_date timestamp;
alter table pending_credentials add column if not exists certificate_id text;
-- Note: issuer_did already exists on pending_credentials, but we query ADD COLUMN just in case of empty base setup.
alter table pending_credentials add column if not exists issuer_did text;

-- Constraint: certificate_id must be unique per issuer (composite unique on issuer_did + certificate_id)
alter table pending_credentials drop constraint if exists pending_credentials_issuer_certificate_unique;
alter table pending_credentials add constraint pending_credentials_issuer_certificate_unique unique (issuer_did, certificate_id);
