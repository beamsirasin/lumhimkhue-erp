import { redirect } from 'next/navigation';
import { QueueBoard } from '@/components/staff/QueueBoard';
import { getQueueList } from '@/lib/actions/queue';

export const metadata = { title: 'จัดการคิว — ร้านชาบู ERP' };

export default async function QueuePage() {
  const result = await getQueueList();
  if (!result.ok) redirect('/login');

  return <QueueBoard initialEntries={result.data} />;
}
