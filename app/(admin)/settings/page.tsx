import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getStoreSettings } from '@/lib/actions/store';
import { StoreSettingsForm } from '@/components/admin/StoreSettingsForm';

export const metadata = { title: 'ตั้งค่าบิล — ร้านชาบู ERP' };

export default async function Settings() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings')) redirect('/login');

  const result = await getStoreSettings();
  const settings = result.ok ? result.data : null;

  if (!settings) return null;
  return <StoreSettingsForm initialData={settings} />;
}
