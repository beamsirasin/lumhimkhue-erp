import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getEmployees } from '@/lib/actions/hr';
import { EmployeesPage } from '@/components/admin/hr/EmployeesPage';

export default async function HrEmployeesPage() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'hr:manage')) redirect('/login');

  const employees = await getEmployees();
  return <EmployeesPage initialEmployees={employees} userRole={session.user.role} />;
}
