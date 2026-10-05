// Dates on trust screens are written out — 3 October 2026, not 10/3/2026,
// which a reader in Phnom Penh and one in Philadelphia read as different days.
export function longDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
