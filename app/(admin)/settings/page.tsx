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

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground mb-6">ตั้งค่าบิล</h1>
      {settings && <StoreSettingsForm initialData={settings} />}
    </div>
  );
}
