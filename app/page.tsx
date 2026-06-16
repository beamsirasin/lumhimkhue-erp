import { redirect } from 'next/navigation';
import { requireActiveSessionUser } from '@/lib/auth/require-active';
import { firstModuleHref } from '@/lib/auth/module-routes';

// Default landing page per role.
// manager → /pos (not /dashboard — admin routes are owner-only).
const ROLE_HOME: Record<string, string> = {
  owner:   '/dashboard',
  manager: '/pos',
  cashier: '/pos',
  kitchen: '/kds',
};

// Must match MODULE_ENFORCED_ROLES in lib/auth/config.ts.
const MODULE_ENFORCED_ROLES = ['cashier', 'kitchen', 'manager'];

export default async function Home() {
  const { freshUser } = await requireActiveSessionUser();
  const role = freshUser.role;
  const modules = (freshUser.allowedModules ?? []) as string[];

  // For enforced roles with an explicit module list, go to the first allowed
  // module rather than the generic role home (which may not be in the list).
  if (MODULE_ENFORCED_ROLES.includes(role) && modules.length > 0) {
    const href = firstModuleHref(modules);
    if (href) redirect(href);
    // No recognisable module in the list → fall through to role default.
    // The middleware will then redirect to /unauthorized if needed.
  }

  redirect(ROLE_HOME[role] ?? '/pos');
}
