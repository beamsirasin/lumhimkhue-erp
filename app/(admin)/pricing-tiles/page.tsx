import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { PricingPage } from '@/components/admin/PricingPage';
import { getPricingTiles } from '@/lib/actions/pricing';

export const metadata = { title: 'Pricing Tiles — ร้านชาบู ERP' };

export default async function PricingTilesRoute() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role, 'pricing_tile:edit')) redirect('/');

  const result = await getPricingTiles('guest');
  if (!result.ok) redirect('/login');

  return <PricingPage initialTiers={result.data} />;
}
