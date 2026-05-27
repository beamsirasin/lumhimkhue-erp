import { redirect } from 'next/navigation';
import { TableGrid } from '@/components/staff/TableGrid';
import { getTablesWithSessions, getActivePricingTiles } from '@/lib/actions/tables';

export const metadata = { title: 'จัดการโต๊ะ — ร้านชาบู ERP' };

export default async function TablesPage() {
  const [tablesResult, tilesResult] = await Promise.all([
    getTablesWithSessions(),
    getActivePricingTiles('guest'),
  ]);

  if (!tablesResult.ok || !tilesResult.ok) redirect('/login');

  return (
    <TableGrid
      initialTables={tablesResult.data}
      pricingTiles={tilesResult.data}
    />
  );
}
