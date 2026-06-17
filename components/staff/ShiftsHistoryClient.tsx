'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { ShiftHistoryTable } from '@/components/staff/ShiftHistoryTable';
import { listShifts } from '@/lib/actions/shifts';
import type { Role } from '@/lib/auth/permissions';

interface Props {
  role: Role;
  canReview: boolean;
}

export function ShiftsHistoryClient({ canReview }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['shift-history', selectedDate],
    queryFn: () =>
      listShifts({
        dateFrom: selectedDate,
        dateTo: `${selectedDate}T23:59:59`,
      }).then((r) => (r.ok ? r.data : [])),
    staleTime: 30_000,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['shift-history', selectedDate] });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 pt-6 pb-0">
        <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden overflow-y-auto">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <ShiftHistoryTable rows={rows} canReview={canReview} onRefresh={refresh} />
        )}
      </div>
    </div>
  );
}
