'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { formatThaiDate } from '@/lib/date-time';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { ShiftWidget } from '@/components/staff/ShiftWidget';
import { ShiftHistoryTable } from '@/components/staff/ShiftHistoryTable';
import { AppShell } from '@/components/ui/app-shell';
import { DataCard } from '@/components/ui/section-card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { listShifts } from '@/lib/actions/shifts';

interface Props {
  canReview: boolean;
  canManageShift: boolean;
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

export function ShiftsHistoryClient({ canReview, canManageShift }: Props) {
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
    enabled: canReview,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['shift-history', selectedDate] });
  }

  return (
    <AppShell className="flex h-full min-h-0 flex-col overflow-hidden space-y-4">
      <PageHeader
        title="รอบแคชเชียร์"
        subtitle={canReview
          ? 'เปิด–ปิดรอบ ตรวจนับเงินสด และตรวจสอบประวัติในที่เดียว'
          : canManageShift
            ? 'เปิดรอบ รับชำระ และปิดรอบเพื่อส่งต่องานหรือจบวัน'
            : 'ตรวจสอบสถานะและปิดรอบวันระดับร้านด้วย Approval Code'}
        actions={canReview ? (
          <div className="flex items-center gap-2">
            <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          </div>
        ) : undefined}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
        <ShiftWidget canManageShift={canManageShift} />
        {canReview && (
          <DataCard
            title="ประวัติและตรวจสอบรอบการรับเงิน"
            subtitle={`${formatThaiDate(selectedDate)} · ${rows.length.toLocaleString('th-TH')} รอบ`}
            noPadding
          >
            {isLoading ? (
              <ShiftTableSkeleton />
            ) : (
              <ShiftHistoryTable rows={rows} canReview={canReview} onRefresh={refresh} />
            )}
          </DataCard>
        )}
      </div>
    </AppShell>
  );
}
