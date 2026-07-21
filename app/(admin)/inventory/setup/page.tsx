import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { InventoryInitialSetupPage } from '@/components/admin/InventoryInitialSetupPage';
import { getInitialSetupState } from '@/lib/actions/inventory';
import { getInventoryUiPermissions } from '@/lib/auth/inventory-access';

export const metadata = { title: 'ตั้งยอดสต็อกเริ่มต้น — ร้านชาบู ERP' };

export default async function InventorySetupPage() {
  const session = await auth();
  if (!session?.user?.role) redirect('/');
  const result = await getInitialSetupState();
  if (!result.ok) redirect('/inventory');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return (
    <InventoryInitialSetupPage
      initialData={result.data}
      today={today}
      permissions={getInventoryUiPermissions(session.user.role)}
    />
  );
}
