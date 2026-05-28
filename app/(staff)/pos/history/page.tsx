'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { SessionHistoryTable } from '@/components/staff/SessionHistoryTable';
import { getSessionHistory } from '@/lib/actions/history';

export default function PaymentHistoryPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['payment-history', selectedDate],
    queryFn: () => getSessionHistory(selectedDate).then((r) => (r.ok ? r.data : [])),
    staleTime: 30_000,
  });

  return (
    <div className="flex gap-6 p-6 min-h-screen items-start">
      <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      <div className="flex-1 min-w-0">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-slate-400">กำลังโหลด...</div>
        ) : (
          <SessionHistoryTable rows={rows} date={selectedDate} />
        )}
      </div>
    </div>
  );
}
