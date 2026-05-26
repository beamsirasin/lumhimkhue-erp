import { redirect } from 'next/navigation';
import { TableGrid } from '@/components/staff/TableGrid';
import { getTablesWithSessions, getActivePackages } from '@/lib/actions/tables';

export const metadata = { title: 'จัดการโต๊ะ — ร้านชาบู ERP' };

export default async function TablesPage() {
  const [tablesResult, packagesResult] = await Promise.all([
    getTablesWithSessions(),
    getActivePackages(),
  ]);

  if (!tablesResult.ok || !packagesResult.ok) redirect('/login');

  return (
    <TableGrid
      initialTables={tablesResult.data}
      packages={packagesResult.data}
    />
  );
}
