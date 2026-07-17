import { notFound } from 'next/navigation';
import { getPayrollCycleDetail, getHrSettings } from '@/lib/actions/hr';
import { getDamageItems, getPendingIncidentsForCycle } from '@/lib/actions/hr-incidents';
import { PayrollDetailPage } from '@/components/admin/hr/PayrollDetailPage';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function HrPayrollDetailPage({ params }: Props) {
  const { id } = await params;
  const [detail, settings, damageItemsResult, pendingResult] = await Promise.all([
    getPayrollCycleDetail(id),
    getHrSettings(),
    getDamageItems(),
    getPendingIncidentsForCycle(id),
  ]);
  if (!detail) notFound();
  return (
    <PayrollDetailPage
      detail={detail}
      settings={settings}
      damageItems={damageItemsResult.ok ? damageItemsResult.data : []}
      pendingIncidents={pendingResult.ok ? pendingResult.data : {}}
    />
  );
}
