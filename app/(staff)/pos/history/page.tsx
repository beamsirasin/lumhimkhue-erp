'use client';

import { use, useState } from 'react';
import { format } from 'date-fns';
import { formatThaiDate } from '@/lib/date-time';
import { useQuery } from '@tanstack/react-query';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { PaymentHistoryTable } from '@/components/staff/PaymentHistoryTable';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { getSessionHistory } from '@/lib/actions/history';

export default function PaymentHistoryPage({
  searchParams,
}: {
  // Deep link (e.g. from the approval-code history): ?date=yyyy-MM-dd&session=<id>
  searchParams: Promise<{ date?: string; session?: string }>;
}) {
  const params = use(searchParams);
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(() =>
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today,
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['payment-history', selectedDate],
    queryFn: () => getSessionHistory(selectedDate).then((r) => (r.ok ? r.data : [])),
    staleTime: 30_000,
  });

  return (
    <AppShell className="flex h-full flex-col overflow-hidden space-y-4">
      <PageHeader
        title="ประวัติการชำระเงิน"
        subtitle={formatThaiDate(selectedDate)}
        actions={<HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : (
          <PaymentHistoryTable
            rows={rows}
            date={selectedDate}
            initialDetailSessionId={params.session ?? null}
          />
        )}
      </div>
    </AppShell>
  );
}
