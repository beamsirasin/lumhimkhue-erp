'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { SessionHistoryTable } from '@/components/staff/SessionHistoryTable';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { getSessionHistory } from '@/lib/actions/history';

export default function HistoryPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['session-history', selectedDate],
    queryFn: () => getSessionHistory(selectedDate).then((r) => (r.ok ? r.data : [])),
    staleTime: 0,
  });

  return (
    <AppShell className="flex h-full flex-col overflow-hidden space-y-4">
      <PageHeader
        title="ประวัติ Session"
        subtitle={format(new Date(selectedDate), 'EEEE d MMMM yyyy', { locale: th })}
        actions={<HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : (
          <SessionHistoryTable rows={rows} date={selectedDate} />
        )}
      </div>
    </AppShell>
  );
}
