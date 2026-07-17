import { getHrSettings } from '@/lib/actions/hr';
import { getDamageItems } from '@/lib/actions/hr-incidents';
import { HrSettingsForm } from '@/components/admin/hr/HrSettingsForm';

export default async function HrSettingsPage() {
  const [settings, damageItemsResult] = await Promise.all([getHrSettings(), getDamageItems()]);
  const damageItems = damageItemsResult.ok ? damageItemsResult.data : [];
  return <HrSettingsForm initialData={settings} initialDamageItems={damageItems} />;
}
