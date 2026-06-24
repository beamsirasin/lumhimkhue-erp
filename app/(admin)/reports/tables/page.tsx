import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { TableReportPage } from '@/components/admin/TableReportPage';

export const metadata = { title: 'รายงานโต๊ะ — ร้านชาบู ERP' };

export default async function TablesReportRoute() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'view_reports')) redirect('/login');

  return <TableReportPage />;
}
