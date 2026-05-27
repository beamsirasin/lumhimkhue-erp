import { redirect } from 'next/navigation';
import { MenuPage } from '@/components/admin/MenuPage';
import { getMenuCRUDData } from '@/lib/actions/menu';

export const metadata = { title: 'จัดการเมนู — ร้านชาบู ERP' };

export default async function Menu() {
  const result = await getMenuCRUDData();
  if (!result.ok) redirect('/login');
  return <MenuPage initialData={result.data} />;
}
