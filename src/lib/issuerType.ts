// What an issuer is called on screen. `kind` is what the Root signs into the
// trust list (it decides what the issuer may issue), so it wins over the
// free-text `type` picked at registration. Rows registered before `type` was
// saved have none: they read as "Institution", never a guessed "University".

export function issuerTypeLabel(type?: string | null, kind?: string | null): string {
  if (kind === 'employer') return 'Employer'
  if (kind === 'identity_verifier') return 'Identity verifier'
  return type || 'Institution'
}
