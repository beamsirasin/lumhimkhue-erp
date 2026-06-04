import { getPayrollCycles } from '@/lib/actions/hr';
import { PayrollListPage } from '@/components/admin/hr/PayrollListPage';

export default async function HrPayrollPage() {
  const cycles = await getPayrollCycles();
  return <PayrollListPage initialCycles={cycles} />;
}
