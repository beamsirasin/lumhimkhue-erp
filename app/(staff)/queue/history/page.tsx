import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/permissions';
import { QueueHistoryPage } from '@/components/staff/QueueHistoryPage';

export const metadata = { title: 'ประวัติคิว — ร้านชาบู ERP' };

export default async function QueueHistory() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role as Role, 'manage_queue')) redirect('/queue');

  return <QueueHistoryPage />;
}
