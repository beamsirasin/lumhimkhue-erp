import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getStoreSettings } from '@/lib/actions/store';
import { getPaymentFoundationDefaults } from '@/lib/payments/foundation';
import { StoreSettingsForm } from '@/components/admin/StoreSettingsForm';

export const metadata = { title: 'ตั้งค่าบิล — ร้านชาบู ERP' };

export default async function Settings() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings')) redirect('/login');

  const [settingsResult, { accounts }] = await Promise.all([
    getStoreSettings(),
    getPaymentFoundationDefaults(),
  ]);
  const settings = settingsResult.ok ? settingsResult.data : null;

  if (!settings) return null;

  const activeAccounts = accounts
    .filter((a) => a.isActive && a.code !== 'legacy_unknown')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return <StoreSettingsForm initialData={settings} receivingAccounts={activeAccounts} />;
}
