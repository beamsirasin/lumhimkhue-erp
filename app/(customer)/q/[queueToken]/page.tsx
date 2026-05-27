import { notFound } from 'next/navigation';
import { getQueueStatus } from '@/lib/actions/queue';
import { QueueStatus } from '@/components/customer/QueueStatus';

interface Props {
  params: Promise<{ queueToken: string }>;
}

export default async function QueueStatusPage({ params }: Props) {
  const { queueToken } = await params;

  const result = await getQueueStatus(queueToken);
  if (!result.ok) notFound();

  return <QueueStatus token={queueToken} initialData={result.data} />;
}
