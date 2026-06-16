import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PurchaseOrdersPage } from '@/components/admin/PurchaseOrdersPage';
import { getPurchaseOrderListData } from '@/lib/actions/inventory';

export const metadata = { title: 'ใบสั่งซื้อ — ร้านชาบู ERP' };

interface Props {
  searchParams: Promise<{ supplierId?: string }>;
}

export default async function InventoryOrdersPage({ searchParams }: Props) {
  const [params, session, result] = await Promise.all([
    searchParams,
    auth(),
    getPurchaseOrderListData(),
  ]);
  if (!result.ok) redirect('/dashboard');
  return (
    <PurchaseOrdersPage
      initialData={result.data}
      initialSupplierFilter={params.supplierId}
      userRole={session?.user?.role}
    />
  );
}
