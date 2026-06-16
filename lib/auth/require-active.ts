import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Use in protected server layouts instead of plain auth().
 *
 * Fast-path: JWT isActive === false → redirect immediately (no DB hit).
 * Slow-path: DB SELECT fetches fresh user settings so navLayout, allowedModules,
 *   and uiLayout changes made by an admin take effect on the next page navigation
 *   without requiring the affected user to log out.
 *
 * Excluded from the select: passwordHash and any other sensitive column.
 */
export async function requireActiveSessionUser() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  if (session.user.isActive === false) redirect('/login');

  const [freshUser] = await db
    .select({
      id:             users.id,
      name:           users.name,
      role:           users.role,
      branchId:       users.branchId,
      isActive:       users.isActive,
      uiLayout:       users.uiLayout,
      allowedModules: users.allowedModules,
      navLayout:      users.navLayout,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!freshUser || !freshUser.isActive) redirect('/login');

  return { session, freshUser };
}
