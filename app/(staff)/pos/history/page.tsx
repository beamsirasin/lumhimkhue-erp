'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { PaymentHistoryTable } from '@/components/staff/PaymentHistoryTable';
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 pt-6 pb-0">
        <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-slate-400">กำลังโหลด...</div>
        ) : (
          <PaymentHistoryTable rows={rows} date={selectedDate} />
        )}
      </div>
    </div>
  );
}
