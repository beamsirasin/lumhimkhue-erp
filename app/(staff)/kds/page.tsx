import { redirect } from 'next/navigation';
import { KdsBoard } from '@/components/staff/KdsBoard';
import { getKdsItems } from '@/lib/actions/kds';

export const metadata = { title: 'KDS — ร้านชาบู ERP' };

export default async function KdsPage() {
  const result = await getKdsItems();
  if (!result.ok) redirect('/login');

  return <KdsBoard initialItems={result.data} />;
}
