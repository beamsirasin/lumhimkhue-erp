import { redirect } from 'next/navigation';
import { StaffPage } from '@/components/admin/StaffPage';
import { getStaffList } from '@/lib/actions/staff';

export const metadata = { title: 'จัดการ User — ร้านชาบู ERP' };

export default async function Users() {
  const result = await getStaffList();
  if (!result.ok) redirect('/login');
  return <StaffPage initialData={result.data} />;
}
