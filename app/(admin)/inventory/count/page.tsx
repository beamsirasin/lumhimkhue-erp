import { redirect } from 'next/navigation';
import { StockCountPage } from '@/components/admin/StockCountPage';
import { getStockCountPageData } from '@/lib/actions/inventory';

export const metadata = { title: 'นับสต็อก — ร้านชาบู ERP' };

export default async function InventoryCountPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const dateStr =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const result = await getStockCountPageData(dateStr);
  if (!result.ok) redirect('/dashboard');
  return (
    <StockCountPage
      initialData={result.data}
      today={dateStr}
      defaultTab={(params.tab === 'history' ? 'history' : 'daily') as 'daily' | 'history'}
    />
  );
}
