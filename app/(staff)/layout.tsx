import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SidebarLayout } from '@/components/shared/SidebarLayout';
import type { Role } from '@/lib/auth/permissions';

const roleHome: Record<Role, string> = {
  owner: '/dashboard',
  cashier: '/pos',
  kitchen: '/kds',
  host: '/queue',
};

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = session.user.role as Role;
  const name = session.user.name ?? 'Staff';

  return (
    <SidebarLayout role={role} userName={name}>
      {children}
    </SidebarLayout>
  );
}
