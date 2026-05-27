import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { PricingTilesPage } from '@/components/admin/PricingTilesPage';
import { getPricingTiles } from '@/lib/actions/pricing';

export const metadata = { title: 'Pricing Tiles — ร้านชาบู ERP' };

export default async function PricingTilesRoute() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role, 'pricing_tile:edit')) redirect('/');

  const result = await getPricingTiles();
  if (!result.ok) redirect('/login');

  return <PricingTilesPage initialData={result.data} />;
}
