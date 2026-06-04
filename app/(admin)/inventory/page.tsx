import { redirect } from 'next/navigation';
import { InventoryDashboard } from '@/components/admin/InventoryDashboard';
import { getInventoryDashboard } from '@/lib/actions/inventory';

export const metadata = { title: 'ภาพรวมสต็อก — ร้านชาบู ERP' };

export default async function InventoryPage() {
  const result = await getInventoryDashboard();
  if (!result.ok) redirect('/dashboard');
  return (
    <InventoryDashboard
      initialData={result.data}
      initialDataUpdatedAt={Date.now()}
    />
  );
}
