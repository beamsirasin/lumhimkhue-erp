import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SidebarLayout } from '@/components/shared/SidebarLayout';
import { getInventoryAlertCount } from '@/lib/actions/inventory';
import type { Role } from '@/lib/auth/permissions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // proxy.ts already blocks non-owners from admin routes; double-check here
  if (session.user.role !== 'owner') redirect('/');

  const role = session.user.role as Role;
  const name = session.user.name ?? 'Owner';

  const { lowStockCount, pendingApprovalCount } = await getInventoryAlertCount();

  const badgeCounts: Record<string, number> = {};
  if (lowStockCount > 0) badgeCounts['/inventory'] = lowStockCount;
  if (pendingApprovalCount > 0) badgeCounts['/inventory/orders'] = pendingApprovalCount;

  return (
    <SidebarLayout
      role={role}
      userName={name}
      badgeCounts={badgeCounts}
      uiLayout={session.user.uiLayout ?? null}
      allowedModules={session.user.allowedModules ?? []}
    >
      {children}
    </SidebarLayout>
  );
}
