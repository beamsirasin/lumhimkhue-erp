import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getEmployeeIncidentPageData } from '@/lib/actions/hr-incidents';
import { EmployeeIncidentsPage } from '@/components/admin/hr/EmployeeIncidentsPage';

export const metadata = { title: 'รายงานพนักงาน' };

export default async function HrIncidentsRoute() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role, 'hr:incident:manage')) redirect('/');

  const result = await getEmployeeIncidentPageData();
  if (!result.ok) redirect('/');

  return (
    <EmployeeIncidentsPage
      employees={result.data.employees}
      incidents={result.data.incidents}
      currentUserId={result.data.currentUserId}
      role={result.data.role}
    />
  );
}
