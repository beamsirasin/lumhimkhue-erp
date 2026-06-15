'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { getKdsHistory } from '@/lib/actions/kds';
import { HistoryCalendar } from '@/components/staff/HistoryCalendar';
import type { KdsHistoryRow } from '@/lib/actions/kds';

const STATION_LABEL: Record<string, string> = {
  meat: 'เนื้อสัตว์', seafood: 'อาหารทะเล', vegetable: 'ผัก',
  noodle: 'เส้น', dessert: 'ของหวาน', drink: 'เครื่องดื่ม', sauce: 'ซอส',
};

const STATION_COLOR: Record<string, string> = {
  meat:      'bg-red-100 text-red-700',
  seafood:   'bg-blue-100 text-blue-700',
  vegetable: 'bg-green-100 text-green-700',
  noodle:    'bg-yellow-100 text-yellow-700',
  dessert:   'bg-pink-100 text-pink-700',
  drink:     'bg-cyan-100 text-cyan-700',
  sauce:     'bg-orange-100 text-orange-700',
};

/* ─── Summary table ──────────────────────────────────────────────────────── */

function HistoryTable({ rows, date }: { rows: KdsHistoryRow[]; date: string }) {
  const totalOrdered   = rows.reduce((s, r) => s + r.totalQty,     0);
  const totalServed    = rows.reduce((s, r) => s + r.servedQty,    0);
  const totalCancelled = rows.reduce((s, r) => s + r.cancelledQty, 0);

  const stations = [...new Set(rows.map((r) => r.station))];

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
          <p className="text-xs text-muted-foreground">สั่งทั้งหมด</p>
          <p className="mt-1 text-xl font-bold text-foreground">{totalOrdered} รายการ</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">เสิร์ฟแล้ว</p>
          <p className="mt-1 text-xl font-bold text-green-700">{totalServed} รายการ</p>
          {totalOrdered > 0 && (
            <p className="text-xs text-muted-foreground">
              {Math.round(totalServed / totalOrdered * 100)}%
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">ยกเลิก</p>
          <p className="mt-1 text-xl font-bold text-red-600">{totalCancelled} รายการ</p>
        </div>
      </div>

      {/* Per-station tables */}
      {stations.map((station) => {
        const stationRows = rows.filter((r) => r.station === station);
        const stTotal = stationRows.reduce((s, r) => s + r.totalQty, 0);
        return (
          <div key={station} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATION_COLOR[station] ?? 'bg-muted/50 text-muted-foreground'}`}>
                {STATION_LABEL[station] ?? station}
              </span>
              <span className="text-xs text-muted-foreground">รวม {stTotal} รายการ</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">รายการ</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">สั่ง</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-green-600">เสิร์ฟ</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">รอ</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-red-500">ยกเลิก</th>
                </tr>
              </thead>
              <tbody>
                {stationRows.map((row, i) => (
                  <tr key={i} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium text-foreground">{row.itemName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">{row.totalQty}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{row.servedQty}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{row.pendingQty}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{row.cancelledQty || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 pt-6 pb-0">
        <HistoryCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto p-6 pt-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">ประวัติครัว</h2>
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
          <HistoryTable rows={data ?? []} date={selectedDate} />
        )}
      </div>
    </div>
  );
}
