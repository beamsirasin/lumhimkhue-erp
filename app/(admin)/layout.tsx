import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SidebarLayout } from '@/components/shared/SidebarLayout';
import type { Role } from '@/lib/auth/permissions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // proxy.ts already blocks non-owners from admin routes; double-check here
  if (session.user.role !== 'owner') redirect('/');

  const role = session.user.role as Role;
  const name = session.user.name ?? 'Owner';

  return (
    <SidebarLayout role={role} userName={name}>
      {children}
    </SidebarLayout>
  );
}
