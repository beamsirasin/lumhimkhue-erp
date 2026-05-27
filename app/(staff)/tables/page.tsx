import { redirect } from 'next/navigation';
import { TableGrid } from '@/components/staff/TableGrid';
import { getTablesWithSessions, getActivePricingTiers } from '@/lib/actions/tables';

export const metadata = { title: 'จัดการโต๊ะ — ร้านชาบู ERP' };

export default async function TablesPage() {
  const [tablesResult, tiersResult] = await Promise.all([
    getTablesWithSessions(),
    getActivePricingTiers(),
  ]);

  if (!tablesResult.ok || !tiersResult.ok) redirect('/login');

  return (
    <TableGrid
      initialTables={tablesResult.data}
      pricingTiers={tiersResult.data}
    />
  );
}
