'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { ShiftHistoryTable } from '@/components/staff/ShiftHistoryTable';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { listShifts } from '@/lib/actions/shifts';
import type { Role } from '@/lib/auth/permissions';

interface Props {
  role: Role;
  canReview: boolean;
}

function ShiftTableSkeleton() {
  return (
    <div className="space-y-2 px-4 py-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20 ml-auto" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
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
      <div className="shrink-0 px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title="รอบแคชเชียร์"
          subtitle="ประวัติและตรวจสอบรอบการรับเงิน"
          noBorder
        />
        <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden overflow-y-auto">
        {isLoading ? (
          <ShiftTableSkeleton />
        ) : (
          <ShiftHistoryTable rows={rows} canReview={canReview} onRefresh={refresh} />
        )}
      </div>
    </div>
  );
}
