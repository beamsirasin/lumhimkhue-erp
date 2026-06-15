import { getHrSettings } from '@/lib/actions/hr';
import { HrSettingsForm } from '@/components/admin/hr/HrSettingsForm';

export default async function HrSettingsPage() {
  const settings = await getHrSettings();
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-foreground mb-6">ตั้งค่า HR</h2>
      <HrSettingsForm initialData={settings} />
    </div>
  );
}
