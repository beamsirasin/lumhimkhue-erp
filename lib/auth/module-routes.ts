/**
 * Staff-accessible module → route prefix mapping for the Edge middleware.
 *
 * Security model: two-tier
 *   1. Role-based (primary): enforced in server actions via can(role, action)
 *      and in the middleware for route groups (admin = owner only, etc.)
 *   2. Module-based (secondary): enforced here for cashier / kitchen / manager
 *      when allowedModules is non-empty. Owner always bypasses this layer.
 *
 * Only staff-accessible modules are listed. Admin-only modules
 * (dashboard, menu, pricing-tiles, inventory, …) are excluded because those
 * routes are already owner-only via the adminPrefixes check.
 *
 * Keep in sync with MODULE_HREFS in components/shared/nav-config.ts when
 * adding new staff-accessible route sections.
 */
export const STAFF_MODULE_PREFIXES: Record<string, string[]> = {
  pos:               ['/pos'],
  kds:               ['/kds'],
  queue:             ['/queue'],
  tables:            ['/tables'],
  printers:          ['/printers'],
  'payment-settings': ['/payment-settings'],
  'approval-code':    ['/approval-code'],
  'hr-incidents':     ['/hr-incidents'],
};

/**
 * Returns true when pathname is covered by at least one allowed module's
 * route prefixes, or when allowedModules is empty (no enforcement).
 */
export function isPathAllowedByModules(
  allowedModules: string[],
  pathname: string,
): boolean {
  if (!allowedModules.length) return true;
  return allowedModules.some((mod) => {
    const prefixes = STAFF_MODULE_PREFIXES[mod];
    if (!prefixes) return false;
    return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
  });
}

/**
 * Returns the primary href for the first recognised module in the list,
 * or null when none of the keys maps to a known staff prefix.
 * Used to compute the redirect target when module access is denied.
 */
export function firstModuleHref(allowedModules: string[]): string | null {
  for (const mod of allowedModules) {
    const prefixes = STAFF_MODULE_PREFIXES[mod];
    if (prefixes?.[0]) return prefixes[0];
  }
  return null;
}
