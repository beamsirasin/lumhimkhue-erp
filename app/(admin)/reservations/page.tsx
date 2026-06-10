import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { tables } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { ReservationsPage } from '@/components/admin/ReservationsPage';

export const metadata = { title: 'การจองโต๊ะ — ร้านชาบู ERP' };

export default async function ReservationsRoute() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const tableList = await db
    .select({ id: tables.id, label: tables.label, capacity: tables.capacity })
    .from(tables)
    .where(eq(tables.deletedAt, null as never))
    .orderBy(asc(tables.label));

  return <ReservationsPage tables={tableList} />;
}
