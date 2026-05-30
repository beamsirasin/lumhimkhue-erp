'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { differenceInMinutes } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import type { SessionHistoryRow } from '@/lib/actions/history';
import { SessionDetailDialog } from './SessionDetailDialog';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  qr_promptpay: 'QR',
  transfer: 'โอน',
  card: 'บัตร',
};

type Filter = 'all' | 'primary' | 'secondary';

interface SessionHistoryTableProps {
  rows: SessionHistoryRow[];
  date: string;
}

export function SessionHistoryTable({ rows, date }: SessionHistoryTableProps) {
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const primaryCount   = rows.filter((r) => !r.parentSessionId).length;
  const secondaryCount = rows.filter((r) =>  r.parentSessionId).length;

  const filtered = filter === 'primary'
    ? rows.filter((r) => !r.parentSessionId)
    : filter === 'secondary'
      ? rows.filter((r) =>  r.parentSessionId)
      : rows;

  const totalRevenue = filtered.reduce((s, r) => s + r.totalRevenue, 0);
  const totalGuests  = filtered.reduce((s, r) => s + r.guestCount,   0);
  const paidSessions = filtered.filter((r) => r.totalRevenue > 0).length;

  return (
    <div className="p-6 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">รายได้รวม</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            ฿{totalRevenue.toLocaleString('th-TH')}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">จำนวน session</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{filtered.length}</p>
          <p className="text-xs text-slate-400">{paidSessions} ที่ชำระแล้ว</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">ผู้เข้าใช้รวม</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totalGuests} คน</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {([
          { key: 'all',       label: 'ทั้งหมด',     count: rows.length },
          { key: 'primary',   label: 'บัญชีหลัก',   count: primaryCount },
          { key: 'secondary', label: 'บัญชีรอง',    count: secondaryCount },
        ] as { key: Filter; label: string; count: number }[]).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === key
                ? 'bg-slate-800 text-white'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              filter === key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            {filter === 'all'
              ? `ไม่มีข้อมูลในวันที่ ${format(new Date(date), 'd MMMM yyyy', { locale: th })}`
              : `ไม่มี${filter === 'primary' ? 'บัญชีหลัก' : 'บัญชีรอง'}ในวันนี้`}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">โต๊ะ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">เริ่ม</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">สิ้นสุด</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">เวลา</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">คน</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">รายได้</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">ช่องทาง</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const durationMin = row.closedAt
                  ? differenceInMinutes(new Date(row.closedAt), new Date(row.startedAt))
                  : null;
                const isOpen      = row.status !== 'closed';
                const isSecondary = !!row.parentSessionId;

                return (
                  <tr
                    key={row.sessionId}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setDetailSessionId(row.sessionId)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {row.tableLabel}
                          {row.zone !== 'ทั่วไป' && (
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              ({row.zone})
                            </span>
                          )}
                        </span>
                        {isSecondary ? (
                          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                            รอง
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                            หลัก
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {format(new Date(row.startedAt), 'HH:mm', { locale: th })}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {row.closedAt
                        ? format(new Date(row.closedAt), 'HH:mm', { locale: th })
                        : isOpen
                          ? <span className="text-green-600 text-xs font-medium">ยังเปิดอยู่</span>
                          : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-500 text-xs">
                      {durationMin !== null
                        ? durationMin >= 60
                          ? `${Math.floor(durationMin / 60)}ชม. ${durationMin % 60}น.`
                          : `${durationMin}น.`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.guestCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                      {row.totalRevenue > 0
                        ? `฿${row.totalRevenue.toLocaleString('th-TH')}`
                        : <span className="text-xs font-normal text-slate-400">ไม่มีการชำระ</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {row.paymentMethod ? METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="size-4 text-slate-400" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail dialog */}
      <SessionDetailDialog
        sessionId={detailSessionId}
        onClose={() => setDetailSessionId(null)}
      />
    </div>
  );
}
