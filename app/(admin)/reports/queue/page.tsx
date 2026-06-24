import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { QueueReportPage } from '@/components/admin/QueueReportPage';

export const metadata = { title: 'รายงานคิว — ร้านชาบู ERP' };

export default async function QueueReportRoute() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'view_reports')) redirect('/login');

  return <QueueReportPage />;
}
