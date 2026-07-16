import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { ShiftsHistoryClient } from '@/components/staff/ShiftsHistoryClient';

export const metadata = { title: 'รอบแคชเชียร์ — ร้านชาบู ERP' };

export default async function ShiftsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const canReview = session.user.role === 'owner' || session.user.role === 'manager';
  const canManageShift = can(session.user.role, 'cashier_shift:manage');

  return <ShiftsHistoryClient canReview={canReview} canManageShift={canManageShift} />;
}
