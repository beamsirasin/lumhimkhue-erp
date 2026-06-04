import { getEmployees } from '@/lib/actions/hr';
import { EmployeesPage } from '@/components/admin/hr/EmployeesPage';

export default async function HrEmployeesPage() {
  const employees = await getEmployees();
  return <EmployeesPage initialEmployees={employees} />;
}
