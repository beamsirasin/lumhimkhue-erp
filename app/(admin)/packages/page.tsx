import { redirect } from 'next/navigation';
import { PackagesPage } from '@/components/admin/PackagesPage';
import { getPackagesCRUD } from '@/lib/actions/packages';

export const metadata = { title: 'จัดการแพ็กเกจ — ร้านชาบู ERP' };

export default async function Packages() {
  const result = await getPackagesCRUD();
  if (!result.ok) redirect('/login');
  return <PackagesPage initialData={result.data} />;
}
