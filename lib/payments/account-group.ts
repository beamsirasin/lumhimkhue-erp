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

/**
 * True when checkout rows span more than one A/B account group.
 * Accounts without a group suffix (null) are exempt and never cause a mix.
 * Golden extraction of the cross-row consistency check in processPayment.
 */
export function hasMixedAccountGroups(accountCodes: string[]): boolean {
  const groups = new Set(
    accountCodes.map(getAccountGroup).filter((g): g is 'a' | 'b' => g !== null),
  );
  return groups.size > 1;
}
