import { getEmployees } from '@/lib/actions/hr';
import { TimeEntriesPage } from '@/components/admin/hr/TimeEntriesPage';

export default async function HrTimePage() {
  const employees = await getEmployees({ type: 'part_time', status: 'active' });
  return <TimeEntriesPage initialEmployees={employees} />;
}
