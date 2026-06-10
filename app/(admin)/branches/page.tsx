import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getBranches } from '@/lib/actions/branches';
import { BranchesPage } from '@/components/admin/BranchesPage';

export const metadata = { title: 'จัดการสาขา — ร้านชาบู ERP' };

export default async function BranchesRoute() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'owner') redirect('/login');

  const result = await getBranches();
  if (!result.ok) redirect('/dashboard');

  return <BranchesPage initialBranches={result.data} />;
}
