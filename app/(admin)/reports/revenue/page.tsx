import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { RevenueReportPage } from '@/components/admin/RevenueReportPage';

export const metadata = { title: 'รายงานรายได้ — ร้านชาบู ERP' };

export default async function RevenueReportRoute() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'view_reports')) redirect('/login');

  return <RevenueReportPage />;
}
