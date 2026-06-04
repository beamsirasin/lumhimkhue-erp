import { redirect } from 'next/navigation';
import { SuppliersPage } from '@/components/admin/SuppliersPage';
import { getSupplierPageData } from '@/lib/actions/inventory';

export const metadata = { title: 'ผู้ขาย — ร้านชาบู ERP' };

export default async function InventorySuppliersPage() {
  const result = await getSupplierPageData();
  if (!result.ok) redirect('/dashboard');
  return (
    <SuppliersPage
      initialData={result.data}
      initialDataUpdatedAt={Date.now()}
    />
  );
}
