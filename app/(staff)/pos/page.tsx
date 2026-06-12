import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PosTerminal } from '@/components/staff/PosTerminal';
import { getPosSessionsForPos } from '@/lib/actions/pos';

export const metadata = { title: 'POS — ร้านชาบู ERP' };

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const [session, result, params] = await Promise.all([
    auth(),
    getPosSessionsForPos(),
    searchParams,
  ]);

  if (!session?.user || !result.ok) redirect('/login');

  return (
    <PosTerminal
      initialSessions={result.data}
      cashierName={session.user.name ?? 'พนักงาน'}
      initialSelectedId={params.session ?? null}
    />
  );
}
