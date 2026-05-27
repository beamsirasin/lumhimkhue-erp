import { redirect } from 'next/navigation';
import { DashboardPage } from '@/components/admin/DashboardPage';
import { getDashboardData } from '@/lib/actions/dashboard';

export const metadata = { title: 'แดชบอร์ด — ร้านชาบู ERP' };

export default async function Dashboard() {
  const result = await getDashboardData();
  if (!result.ok) redirect('/login');

  return <DashboardPage initialData={result.data} />;
}
