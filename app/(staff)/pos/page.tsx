import { redirect } from 'next/navigation';
import { PosTerminal } from '@/components/staff/PosTerminal';
import { getPosSessionsForPos } from '@/lib/actions/pos';

export const metadata = { title: 'POS — ร้านชาบู ERP' };

export default async function PosPage() {
  const result = await getPosSessionsForPos();
  if (!result.ok) redirect('/login');

  return <PosTerminal initialSessions={result.data} />;
}
