import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { ReportsPage } from '@/components/admin/ReportsPage';

export const metadata = { title: 'รายงาน — ร้านชาบู ERP' };

export default async function Reports() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'view_reports')) redirect('/login');

  return <ReportsPage />;
}
