// How a signed claim's value is shown to a person.
//
// One rule matters more than formatting: an employment record's "current" is
// true as of the day the employer signed it, not today. It is always shown
// with that date.

import { longDate } from './dates'

type T = (key: string, vars?: Record<string, string | number>) => string

export function displayClaim(t: T, key: string, value: unknown, issuedAt: number | null): string {
  if (key === 'employment_status') {
    if (value === 'current') return t('proof.employment_current_as_of', { date: issuedAt ? longDate(issuedAt) : '—' })
    if (value === 'ended') return t('proof.employment_ended')
  }
  if (key === 'employment_type' && typeof value === 'string' && /^[a-z_]+$/.test(value)) {
    const label = t(`proof.employment_type_${value}`)
    if (label !== `proof.employment_type_${value}`) return label
  }
  if ((key === 'evidence_type' || key === 'verification_level') && typeof value === 'string' && /^[a-z_]+$/.test(value)) {
    const label = t(`proof.${key}_${value}`)
    if (label !== `proof.${key}_${value}`) return label
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
}
