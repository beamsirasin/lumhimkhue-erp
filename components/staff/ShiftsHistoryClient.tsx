'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CashShiftBackfillSheet } from '@/components/staff/CashShiftBackfillSheet';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { ShiftHistoryTable } from '@/components/staff/ShiftHistoryTable';
import { AppShell } from '@/components/ui/app-shell';
import { DataCard } from '@/components/ui/section-card';
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
    <AppShell className="flex h-full flex-col overflow-hidden space-y-4">
      <PageHeader
        title="รอบแคชเชียร์"
        subtitle={format(new Date(selectedDate), 'EEEE d MMMM yyyy', { locale: th })}
        actions={
          <div className="flex items-center gap-2">
            {/* Phase 16G-A: owner/manager-only correction tool (canReview = owner/manager) */}
            {canReview && (
              <CashShiftBackfillSheet initialDate={selectedDate} onAssigned={refresh} />
            )}
            <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataCard title="ประวัติและตรวจสอบรอบการรับเงิน" subtitle={`${rows.length} รอบ`} noPadding>
          {isLoading ? (
            <ShiftTableSkeleton />
          ) : (
            <ShiftHistoryTable rows={rows} canReview={canReview} onRefresh={refresh} />
          )}
        </DataCard>
      </div>
    </AppShell>
  );
}
