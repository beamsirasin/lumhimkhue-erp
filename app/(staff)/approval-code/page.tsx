import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getManagerApprovalCodeState } from '@/lib/actions/manager-approval';
import { ManagerApprovalCodePage } from '@/components/admin/ManagerApprovalCodePage';

export const metadata = { title: 'รหัสอนุมัติ' };

export default async function ApprovalCodeRoute() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session.user.role, 'approval_code:manage')) redirect('/');

  const result = await getManagerApprovalCodeState();
  if (!result.ok) redirect('/');

  return <ManagerApprovalCodePage initialData={result.data} />;
}
