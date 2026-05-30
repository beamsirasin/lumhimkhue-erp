import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/permissions';
import { KdsHistoryPage } from '@/components/staff/KdsHistoryPage';

export const metadata = { title: 'ประวัติครัว — ร้านชาบู ERP' };

export default async function KdsHistory() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role as Role, 'view_kds')) redirect('/kds');

  return <KdsHistoryPage />;
}
