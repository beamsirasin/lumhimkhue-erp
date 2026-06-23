'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { Armchair, ListOrdered, SkipForward } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getQueueHistory } from '@/lib/actions/queue';
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
import type { QueueHistoryEntry } from '@/lib/actions/queue';

/* All current queue statuses + legacy seated/left kept for historical rows */
const STATUS_LABEL: Record<string, string> = {
  waiting:                'รอ',
  waiting_suitable_table: 'รอโต๊ะ',
  called:                 'เรียกแล้ว',
  admitted:               'รับเข้าแล้ว',
  skipped:                'ข้าม',
  cancelled:              'ยกเลิก',
  seated:                 'รับเข้าแล้ว',  // legacy
  left:                   'ออก',           // legacy
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  waiting:                'warning',
  waiting_suitable_table: 'orange',
  called:                 'info',
  admitted:               'success',
  skipped:                'warning',
  cancelled:              'neutral',
  seated:                 'success',  // legacy
  left:                   'neutral',  // legacy
};

function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return format(new Date(d as string), 'HH:mm', { locale: th });
}

function soupText(pots: unknown): string {
  if (!Array.isArray(pots) || !pots.length) return '—';
  return (pots as Array<{ soups?: string[] }>)
    .map(p => p.soups?.join(' + ') ?? '')
    .filter(Boolean)
    .join(' · ');
}

function QueueHistoryTable({ rows, date }: { rows: QueueHistoryEntry[]; date: string }) {
  const total = rows.length;
  const admittedCount = rows.filter(r => r.status === 'admitted' || r.status === 'seated').length;
  const skippedCount  = rows.filter(r => r.status === 'skipped').length;
  const cancelledCount = rows.filter(r => r.status === 'cancelled' || r.status === 'left').length;
  const admittedPct = total > 0
    ? `${Math.round((admittedCount / total) * 100)}% ของคิวทั้งหมด`
    : undefined;

  if (rows.length === 0) {
    return (
      <DataCard>
        <EmptyState
          icon={<ListOrdered className="size-5" />}
          title="ไม่มีประวัติคิว"
          description={`ไม่พบข้อมูลในวันที่ ${format(new Date(date), 'd MMMM yyyy', { locale: th })}`}
          size="lg"
        />
      </DataCard>
    );
  }

  return (
    <div className="space-y-4">
      <StatCardGrid cols={3}>
        <StatCard
          label="ทั้งหมด"
          value={total}
          unit="คิว"
          icon={<ListOrdered className="size-4" />}
        />
        <StatCard
          label="รับเข้าแล้ว"
          value={admittedCount}
          unit="คิว"
          subLabel={admittedPct}
          icon={<Armchair className="size-4" />}
          accent="success"
        />
        <StatCard
          label="ข้าม / ยกเลิก"
          value={skippedCount + cancelledCount}
          unit="คิว"
          icon={<SkipForward className="size-4" />}
          accent="warning"
        />
      </StatCardGrid>

      <DataCard
        title="รายการคิว"
        subtitle={`${format(new Date(date), 'd MMMM yyyy', { locale: th })} · ${total} รายการ`}
        noPadding
      >
        <Table>
          <TableHeader>
            <TableRow className="border-border bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
              <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">คิว</TableHead>
              <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">ผู้ใหญ่/เด็ก</TableHead>
              <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">น้ำซุป</TableHead>
              <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">โต๊ะ</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">เข้าคิว</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">รับเข้า</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">สถานะ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isBilled = row.status === 'admitted' && !!row.billIssued;
              const label: string = isBilled
                ? 'ออกบิลแล้ว'
                : (STATUS_LABEL[row.status] ?? row.status);
              const variant: BadgeVariant = isBilled
                ? 'neutral'
                : (STATUS_VARIANT[row.status] ?? 'neutral');
              const tableNote = (row.plannedTableNote && row.plannedTableNote !== '-')
                ? row.plannedTableNote
                : '—';

              return (
                <TableRow key={row.id} className="border-border/60 hover:bg-muted/30">
                  <TableCell className="px-4 py-3 font-bold tabular-nums text-foreground">
                    {row.queueNumber}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-foreground">
                    ผ{row.adultCount} / ด{row.childCount}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                    {soupText(row.soupPots)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                    {tableNote}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                    {fmtTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                    {fmtTime(row.admittedAt ?? row.seatedAt)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <StatusBadge label={label} variant={variant} dot />
                      {row.skipReason && (
                        <span className="text-xs text-muted-foreground">{row.skipReason}</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataCard>
    </div>
  );
}

export function QueueHistoryPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);

  const { data, isLoading, error } = useQuery({
    queryKey: ['queue-history', selectedDate],
    queryFn: async () => {
      const r = await getQueueHistory(selectedDate);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    staleTime: 60_000,
  });

  return (
    <AppShell className="flex h-full flex-col overflow-hidden space-y-4">
      <PageHeader
        title="ประวัติคิว"
        subtitle={format(new Date(selectedDate), 'EEEE d MMMM yyyy', { locale: th })}
        actions={<HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : error ? (
          <DataCard className="border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]">
            <p className="text-sm text-[var(--status-danger-fg)]">
              เกิดข้อผิดพลาด: {(error as Error).message}
            </p>
          </DataCard>
        ) : (
          <QueueHistoryTable rows={data ?? []} date={selectedDate} />
        )}
      </div>
    </AppShell>
  );
}
