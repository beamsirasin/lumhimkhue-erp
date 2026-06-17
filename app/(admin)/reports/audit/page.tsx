import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AuditReportPage } from '@/components/admin/AuditReportPage';

export const metadata = { title: 'รายงานตรวจสอบ — ร้านชาบู ERP' };

export default async function AuditReportRoute() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = session.user.role;
  if (role !== 'owner' && role !== 'manager') redirect('/dashboard');

  return <AuditReportPage />;
}
