'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { Armchair, ListOrdered, LogOut } from 'lucide-react';
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

const STATUS_LABEL: Record<string, string> = {
  waiting: 'รอ',
  called: 'เรียกแล้ว',
  seated: 'นั่งแล้ว',
  left: 'ออกแล้ว',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  waiting: 'warning',
  called: 'info',
  seated: 'success',
  left: 'neutral',
};

function fmt(d: Date | null | undefined) {
  if (!d) return '—';
  return format(new Date(d), 'HH:mm', { locale: th });
}

function QueueHistoryTable({ rows, date }: { rows: QueueHistoryEntry[]; date: string }) {
  const total = rows.length;
  const seated = rows.filter((r) => r.status === 'seated').length;
  const left = rows.filter((r) => r.status === 'left').length;
  const seatedPct = total > 0 ? `${Math.round((seated / total) * 100)}% ของคิวทั้งหมด` : undefined;

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
        <StatCard label="ทั้งหมด" value={total} unit="คิว" icon={<ListOrdered className="size-4" />} />
        <StatCard
          label="นั่งแล้ว"
          value={seated}
          unit="คิว"
          subLabel={seatedPct}
          icon={<Armchair className="size-4" />}
          accent="success"
        />
        <StatCard
          label="ออกแล้ว / ไม่มา"
          value={left}
          unit="คิว"
          icon={<LogOut className="size-4" />}
          accent="warning"
        />
      </StatCardGrid>

      <DataCard title="รายการคิว" subtitle={`${format(new Date(date), 'd MMMM yyyy', { locale: th })} · ${total} รายการ`} noPadding>
        <Table>
          <TableHeader>
            <TableRow className="border-border bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
              <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">เลขคิว</TableHead>
              <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">ชื่อ</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">คน</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">เข้าคิว</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">เรียก</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">นั่ง</TableHead>
              <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">สถานะ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="border-border/60 hover:bg-muted/30">
                <TableCell className="px-4 py-3 font-bold tabular-nums text-foreground">{row.queueNumber}</TableCell>
                <TableCell className="px-4 py-3 font-medium text-foreground">
                  {row.customerName}
                  {row.phone && <span className="ml-1.5 text-xs text-muted-foreground">{row.phone}</span>}
                </TableCell>
                <TableCell className="px-4 py-3 text-center tabular-nums text-foreground">{row.partySize}</TableCell>
                <TableCell className="px-4 py-3 text-center tabular-nums text-muted-foreground">{fmt(row.createdAt)}</TableCell>
                <TableCell className="px-4 py-3 text-center tabular-nums text-muted-foreground">{fmt(row.calledAt)}</TableCell>
                <TableCell className="px-4 py-3 text-center tabular-nums text-muted-foreground">{fmt(row.seatedAt)}</TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <StatusBadge
                    label={STATUS_LABEL[row.status] ?? row.status}
                    variant={STATUS_VARIANT[row.status] ?? 'neutral'}
                    dot
                  />
                </TableCell>
              </TableRow>
            ))}
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
