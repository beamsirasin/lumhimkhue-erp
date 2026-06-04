import { notFound } from 'next/navigation';
import { getPayrollCycleDetail, getHrSettings } from '@/lib/actions/hr';
import { PayrollDetailPage } from '@/components/admin/hr/PayrollDetailPage';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function HrPayrollDetailPage({ params }: Props) {
  const { id } = await params;
  const [detail, settings] = await Promise.all([
    getPayrollCycleDetail(id),
    getHrSettings(),
  ]);
  if (!detail) notFound();
  return <PayrollDetailPage detail={detail} settings={settings} />;
}
