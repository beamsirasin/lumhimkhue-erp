'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { formatThaiDate } from '@/lib/date-time';
import { CheckCircle2, CookingPot, ListChecks, XCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getKdsHistory } from '@/lib/actions/kds';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import { AppShell } from '@/components/ui/app-shell';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { KdsHistoryRow } from '@/lib/actions/kds';

const STATION_LABEL: Record<string, string> = {
  meat: 'เนื้อสัตว์',
  seafood: 'อาหารทะเล',
  vegetable: 'ผัก',
  noodle: 'เส้น',
  dessert: 'ของหวาน',
  drink: 'เครื่องดื่ม',
  sauce: 'ซอส',
};

const STATION_VARIANT: Record<string, BadgeVariant> = {
  meat: 'danger',
  seafood: 'info',
  vegetable: 'success',
  noodle: 'warning',
  dessert: 'purple',
  drink: 'cyan',
  sauce: 'orange',
};

function HistoryTable({ rows, date }: { rows: KdsHistoryRow[]; date: string }) {
  const totalOrdered = rows.reduce((s, r) => s + r.totalQty, 0);
  const totalServed = rows.reduce((s, r) => s + r.servedQty, 0);
  const totalCancelled = rows.reduce((s, r) => s + r.cancelledQty, 0);
  const servedPct = totalOrdered > 0 ? `${Math.round((totalServed / totalOrdered) * 100)}% ของรายการทั้งหมด` : undefined;

  const stations = [...new Set(rows.map((r) => r.station))];

  if (rows.length === 0) {
    return (
      <DataCard>
        <EmptyState
          icon={<CookingPot className="size-5" />}
          title="ไม่มีประวัติครัว"
          description={`ไม่พบข้อมูลในวันที่ ${formatThaiDate(date)}`}
          size="lg"
        />
      </DataCard>
    );
  }

  return (
    <div className="space-y-4">
      <StatCardGrid cols={3}>
        <StatCard label="สั่งทั้งหมด" value={totalOrdered} unit="รายการ" icon={<ListChecks className="size-4" />} />
        <StatCard
          label="เสิร์ฟแล้ว"
          value={totalServed}
          unit="รายการ"
          subLabel={servedPct}
          icon={<CheckCircle2 className="size-4" />}
          accent="success"
        />
        <StatCard
          label="ยกเลิก"
          value={totalCancelled}
          unit="รายการ"
          icon={<XCircle className="size-4" />}
          accent="danger"
        />
      </StatCardGrid>

      {stations.map((station) => {
        const stationRows = rows.filter((r) => r.station === station);
        const stTotal = stationRows.reduce((s, r) => s + r.totalQty, 0);
        const stServed = stationRows.reduce((s, r) => s + r.servedQty, 0);
        const stCancelled = stationRows.reduce((s, r) => s + r.cancelledQty, 0);
        const allServed = stTotal > 0 && stServed + stCancelled === stTotal;
        return (
          <DataCard
            key={station}
            title={STATION_LABEL[station] ?? station}
            subtitle={`รวม ${stTotal} รายการ`}
            actions={(
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <StatusBadge
                  label={`เสิร์ฟ ${stServed}/${stTotal}`}
                  variant={allServed ? 'success' : (STATION_VARIANT[station] ?? 'neutral')}
                  dot
                />
                {stCancelled > 0 && <StatusBadge label={`ยกเลิก ${stCancelled}`} variant="danger" />}
              </div>
            )}
            noPadding
          >
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">รายการ</TableHead>
                  <TableHead className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">สั่ง</TableHead>
                  <TableHead className="px-4 py-3 text-right text-xs font-semibold text-[var(--status-success-fg)]">เสิร์ฟ</TableHead>
                  <TableHead className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">รอ</TableHead>
                  <TableHead className="px-4 py-3 text-right text-xs font-semibold text-[var(--status-danger-fg)]">ยกเลิก</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stationRows.map((row, i) => (
                  <TableRow key={`${row.station}-${row.itemName}-${i}`} className="border-border/60 hover:bg-muted/30">
                    <TableCell className="px-4 py-3 font-medium text-foreground">{row.itemName}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{row.totalQty}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums text-[var(--status-success-fg)]">{row.servedQty}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.pendingQty}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums text-[var(--status-danger-fg)]">{row.cancelledQty || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </DataCard>
        );
      })}
    </div>
  );
}

export function KdsHistoryPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);

  const { data, isLoading, error } = useQuery({
    queryKey: ['kds-history', selectedDate],
    queryFn: async () => {
      const r = await getKdsHistory(selectedDate);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    staleTime: 60_000,
  });

  return (
    <AppShell className="flex h-full flex-col overflow-hidden space-y-4">
      <PageHeader
        title="ประวัติครัว"
        subtitle={formatThaiDate(selectedDate)}
        actions={<HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : error ? (
          <DataCard className="border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]">
            <p className="text-sm text-[var(--status-danger-fg)]">
              เกิดข้อผิดพลาด: {(error as Error).message}
            </p>
          </DataCard>
        ) : (
          <HistoryTable rows={data ?? []} date={selectedDate} />
        )}
      </div>
    </AppShell>
  );
}
