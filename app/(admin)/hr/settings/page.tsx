import { getHrSettings } from '@/lib/actions/hr';
import { HrSettingsForm } from '@/components/admin/hr/HrSettingsForm';

export default async function HrSettingsPage() {
  const settings = await getHrSettings();
  return <HrSettingsForm initialData={settings} />;
}
