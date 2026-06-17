import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/permissions';
import { ShiftsHistoryClient } from '@/components/staff/ShiftsHistoryClient';

export const metadata = { title: 'รอบแคชเชียร์ — ร้านชาบู ERP' };

export default async function ShiftsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role as Role, 'cashier_shift:manage')) redirect('/pos');

  const canReview = session.user.role === 'owner' || session.user.role === 'manager';

  return <ShiftsHistoryClient role={session.user.role as Role} canReview={canReview} />;
}
