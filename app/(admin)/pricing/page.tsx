import { redirect } from 'next/navigation';

// Redirect old /admin/pricing → /admin/pricing-tiles
export default function OldPricingRedirect() {
  redirect('/admin/pricing-tiles');
}
