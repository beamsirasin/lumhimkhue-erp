import { redirect } from 'next/navigation';
import { PurchaseOrdersPage } from '@/components/admin/PurchaseOrdersPage';
import { getPurchaseOrderListData } from '@/lib/actions/inventory';

export const metadata = { title: 'ใบสั่งซื้อ — ร้านชาบู ERP' };

interface Props {
  searchParams: Promise<{ supplierId?: string }>;
}

export default async function InventoryOrdersPage({ searchParams }: Props) {
  const params = await searchParams;
  const result = await getPurchaseOrderListData();
  if (!result.ok) redirect('/dashboard');
  return (
    <PurchaseOrdersPage
      initialData={result.data}
      initialDataUpdatedAt={Date.now()}
      initialSupplierFilter={params.supplierId}
    />
  );
}
