'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { getQueueHistory } from '@/lib/actions/queue';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import type { QueueHistoryEntry } from '@/lib/actions/queue';

const STATUS_LABEL: Record<string, string> = {
  waiting: 'รอ',
  called:  'เรียกแล้ว',
  seated:  'นั่งแล้ว',
  left:    'ออกแล้ว',
};

const STATUS_COLOR: Record<string, string> = {
  waiting: 'bg-yellow-100 text-yellow-700',
  called:  'bg-blue-100 text-blue-700',
  seated:  'bg-green-100 text-green-700',
  left:    'bg-slate-100 text-slate-500',
};

function fmt(d: Date | null | undefined) {
  if (!d) return '—';
  return format(new Date(d), 'HH:mm', { locale: th });
}

function QueueHistoryTable({ rows, date }: { rows: QueueHistoryEntry[]; date: string }) {
  const total  = rows.length;
  const seated = rows.filter((r) => r.status === 'seated').length;
  const left   = rows.filter((r) => r.status === 'left').length;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        ไม่มีข้อมูลในวันที่ {format(new Date(date), 'd MMMM yyyy', { locale: th })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">ทั้งหมด</p>
          <p className="mt-1 text-xl font-bold text-foreground">{total} คิว</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">นั่งแล้ว</p>
          <p className="mt-1 text-xl font-bold text-green-700">{seated} คิว</p>
          {total > 0 && (
            <p className="text-xs text-muted-foreground">
              {Math.round((seated / total) * 100)}%
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">ออกแล้ว / ไม่มา</p>
          <p className="mt-1 text-xl font-bold text-slate-500">{left} คิว</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">เลขคิว</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">ชื่อ</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">คน</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">เข้าคิว</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">เรียก</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">นั่ง</th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2.5 font-bold tabular-nums text-foreground">{row.queueNumber}</td>
                <td className="px-4 py-2.5 font-medium text-foreground">
                  {row.customerName}
                  {row.phone && <span className="ml-1.5 text-xs text-muted-foreground">{row.phone}</span>}
                </td>
                <td className="px-4 py-2.5 text-center tabular-nums text-foreground">{row.partySize}</td>
                <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{fmt(row.createdAt)}</td>
                <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{fmt(row.calledAt)}</td>
                <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{fmt(row.seatedAt)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[row.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 pt-6 pb-0">
        <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto p-6 pt-4 space-y-4">
        <div>
          <h2 className="text-base font-bold tracking-tight text-foreground">ประวัติคิว</h2>
          <p className="text-xs text-muted-foreground">
            {format(new Date(selectedDate), 'EEEE d MMMM yyyy', { locale: th })}
          </p>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">กำลังโหลด…</div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            เกิดข้อผิดพลาด: {(error as Error).message}
          </div>
        ) : (
          <QueueHistoryTable rows={data ?? []} date={selectedDate} />
        )}
      </div>
    </div>
  );
}
