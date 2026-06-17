import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getPaymentSettings } from '@/lib/actions/payment-settings';
import { PaymentSettingsPage } from '@/components/admin/PaymentSettingsPage';

export const metadata = { title: 'Payment Settings' };

export default async function PaymentSettingsRoute() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role, 'payment_settings:manage')) redirect('/');

  const result = await getPaymentSettings();
  if (!result.ok) redirect('/');

  return <PaymentSettingsPage initialData={result.data} />;
}
