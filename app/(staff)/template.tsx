import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isPathAllowedByModules, firstModuleHref } from '@/lib/auth/module-routes';

/**
 * Re-runs on every client-side navigation within (staff)/, unlike layout.tsx
 * which persists across navigations. This is intentional: module enforcement
 * must run on every route change so an admin's mid-session change takes effect
 * on the user's next navigation, not just on full page reload.
 *
 * Uses a minimal DB select (allowedModules + isActive only) rather than the
 * full requireActiveSessionUser() query used by the layout for nav data.
 * Owner role always bypasses the DB call entirely.
 */

const MODULE_ENFORCED_ROLES = ['cashier', 'kitchen', 'manager'];

export default async function StaffTemplate({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Owner is never module-restricted — skip DB entirely
  if (!MODULE_ENFORCED_ROLES.includes(session.user.role)) {
    return <>{children}</>;
  }

  const [freshUser] = await db
    .select({ allowedModules: users.allowedModules, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!freshUser?.isActive) redirect('/login');

  const modules = (freshUser.allowedModules ?? []) as string[];
  if (modules.length > 0) {
    const headersList = await headers();
    const pathname = headersList.get('x-current-path') ?? '';
    if (pathname && !isPathAllowedByModules(modules, pathname)) {
      redirect(firstModuleHref(modules) ?? '/unauthorized');
    }
  }

  return <>{children}</>;
}
