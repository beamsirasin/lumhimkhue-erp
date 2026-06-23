/**
 * Derives the A/B group of a receiving account from its code.
 *
 * Convention: account codes end with '_a' (group A) or '_b' (group B).
 * Accounts that don't follow this pattern (e.g. legacy_unknown) return null
 * and are exempt from cross-row group consistency checks.
 */
export function getAccountGroup(code: string): 'a' | 'b' | null {
  const suffix = code.split('_').pop()?.toLowerCase();
  if (suffix === 'a') return 'a';
  if (suffix === 'b') return 'b';
  return null;
}
