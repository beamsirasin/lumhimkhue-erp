import { getScheduleCycles, getHrSettings } from '@/lib/actions/hr';
import { getEmployees } from '@/lib/actions/hr';
import { SchedulePage } from '@/components/admin/hr/SchedulePage';

export default async function HrSchedulePage() {
  const [cycles, settings, employees] = await Promise.all([
    getScheduleCycles(),
    getHrSettings(),
    getEmployees({ status: 'active' }),
  ]);

  return <SchedulePage initialCycles={cycles} settings={settings} initialEmployees={employees} />;
}
