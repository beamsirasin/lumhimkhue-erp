import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ReorderRecommendationPage } from '@/components/admin/ReorderRecommendationPage';
import { getReorderRecommendationPageData } from '@/lib/actions/inventory';
import { getInventoryUiPermissions } from '@/lib/auth/inventory-access';

export const metadata = { title: 'คำแนะนำสั่งซื้อ — ร้านชาบู ERP' };

export default async function InventoryReorderPage() {
  const session = await auth();
  if (!session?.user?.role) redirect('/');
  const result = await getReorderRecommendationPageData();
  if (!result.ok) redirect('/inventory');
  return (
    <ReorderRecommendationPage
      initialData={result.data}
      permissions={getInventoryUiPermissions(session.user.role)}
    />
  );
}
