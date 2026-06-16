import { requireActiveSessionUser } from '@/lib/auth/require-active';
import { PrintersPage } from '@/components/staff/PrintersPage';

export const metadata = { title: 'เครื่องพิมพ์ — ร้านชาบู ERP' };

export default async function Printers() {
  await requireActiveSessionUser();
  return <PrintersPage />;
}
