import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { KitchenReportPage } from '@/components/admin/KitchenReportPage';

export const metadata = { title: 'รายงานครัว — ร้านชาบู ERP' };

export default async function KitchenReportRoute() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'view_reports')) redirect('/login');

  return <KitchenReportPage />;
}
