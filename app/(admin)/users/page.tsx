import { redirect } from 'next/navigation';
import { StaffPage } from '@/components/admin/StaffPage';
import { getStaffList } from '@/lib/actions/staff';
import { getMenuLabels } from '@/lib/actions/store';

export const metadata = { title: 'จัดการ User — ร้านชาบู ERP' };

export default async function Users() {
  const [result, menuLabels] = await Promise.all([getStaffList(), getMenuLabels()]);
  if (!result.ok) redirect('/login');
  return <StaffPage initialData={result.data} initialMenuLabels={menuLabels} />;
}
