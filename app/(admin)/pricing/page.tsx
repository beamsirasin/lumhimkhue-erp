import { redirect } from 'next/navigation';
import { PricingPage } from '@/components/admin/PricingPage';
import { getPricingTiers } from '@/lib/actions/pricing';

export const metadata = { title: 'ราคาตามประเภทคน — ร้านชาบู ERP' };

export default async function PricingRoute() {
  const result = await getPricingTiers();
  if (!result.ok) redirect('/login');

  return <PricingPage initialTiers={result.data} />;
}
