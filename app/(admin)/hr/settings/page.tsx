import { getHrSettings } from '@/lib/actions/hr';
import { HrSettingsForm } from '@/components/admin/hr/HrSettingsForm';

export default async function HrSettingsPage() {
  const settings = await getHrSettings();
  return (
    <div className="page-shell max-w-2xl">
      <h1 className="text-xl font-bold tracking-tight text-foreground">ตั้งค่า HR</h1>
      <HrSettingsForm initialData={settings} />
    </div>
  );
}
