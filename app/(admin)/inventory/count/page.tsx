import { redirect } from 'next/navigation';
import { StockCountPage } from '@/components/admin/StockCountPage';
import { getStockCountPageData } from '@/lib/actions/inventory';

export const metadata = { title: 'นับสต็อก — ร้านชาบู ERP' };

export default async function InventoryCountPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const result = await getStockCountPageData(today);
  if (!result.ok) redirect('/dashboard');
  return (
    <StockCountPage
      initialData={result.data}
      initialDataUpdatedAt={Date.now()}
      today={today}
    />
  );
}
