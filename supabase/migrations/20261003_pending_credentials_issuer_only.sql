-- `pending_credentials` is the issuer's outbox, and its insert policy was
-- `with check (true)`: any authenticated user could write a row naming any
-- recipient, under any issuer DID, carrying any token.
--
-- That row is what the holder sees. The notification list and the wallet card
-- render the plain columns — institution_name, degree_type, student_name — so
-- a forged row saying "RUPP — BSc in Information Technology" was
-- indistinguishable from a real one, and a holder who claimed it carried it as
-- genuine until some third-party verifier eventually refused it. The same hole
-- let anyone pre-insert a row under an issuer's DID with a guessed
-- certificate_id and make that issuer's real issuance fail on the unique
-- constraint.
--
-- An insert now has to come from the owner of an accredited issuer row whose
-- `did` matches the `issuer_did` being written. `issuer_did` unqualified is the
-- new row's column — `issuers` has no column of that name, so there is nothing
-- for it to be confused with.
--
-- The holder's half of this is src/lib/claimVerification.ts: the wallet checks
-- the signature against the registry before the vault swallows the credential.

drop policy if exists "issue pending" on public.pending_credentials;
create policy "issue pending" on public.pending_credentials
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.issuers i
      where i.did = issuer_did
        and i.accredited
        and (auth.uid() = i.owner or (i.owner is null and auth.uid() = i.user_id))
    )
  );
