import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PosTerminal } from '@/components/staff/PosTerminal';
import { getPosSessionsForPos } from '@/lib/actions/pos';

export const metadata = { title: 'POS — ร้านชาบู ERP' };

export default async function PosPage() {
  const [session, result] = await Promise.all([
    auth(),
    getPosSessionsForPos(),
  ]);

  if (!session?.user || !result.ok) redirect('/login');

  return (
    <PosTerminal
      initialSessions={result.data}
      cashierName={session.user.name ?? 'พนักงาน'}
    />
  );
}
