'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { ChevronRight } from 'lucide-react';
import type { SessionHistoryRow } from '@/lib/actions/history';
import { SessionDetailDialog } from './SessionDetailDialog';

const METHOD_LABEL: Record<string, string> = {
  cash:         'เงินสด',
  cash_qr:      'สด+QR',
  qr_promptpay: 'QR',
  transfer:     'โอน',
  card:         'บัตร',
};

interface PaymentHistoryTableProps {
  rows: SessionHistoryRow[];
  date: string;
}

export function PaymentHistoryTable({ rows, date }: PaymentHistoryTableProps) {
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);

  const paid = rows.filter((r) => r.totalRevenue > 0);

  const SPLIT_COLORS = [
    { border: '#8b5cf6', bg: 'rgba(139,92,246,0.05)', badge: 'bg-violet-100 text-violet-700' },
    { border: '#f97316', bg: 'rgba(249,115,22,0.05)',  badge: 'bg-orange-100 text-orange-700' },
    { border: '#14b8a6', bg: 'rgba(20,184,166,0.05)',  badge: 'bg-teal-100 text-teal-700'    },
    { border: '#ec4899', bg: 'rgba(236,72,153,0.05)',  badge: 'bg-pink-100 text-pink-700'    },
    { border: '#d97706', bg: 'rgba(217,119,6,0.05)',   badge: 'bg-amber-100 text-amber-700'  },
    { border: '#06b6d4', bg: 'rgba(6,182,212,0.05)',   badge: 'bg-cyan-100 text-cyan-700'    },
  ];

  // Map sessionId → frame metadata for split payment groups
  const splitInfo = useMemo(() => {
    type SplitMeta = {
      seqIndex: number; groupSize: number;
      borderColor: string; bgColor: string; badgeClass: string;
      isFirst: boolean; isLast: boolean;
    };
    const map = new Map<string, SplitMeta>();
    let colorIdx = 0;
    const primariesWithChildren = new Set(
      rows.filter((r) => r.parentSessionId).map((r) => r.parentSessionId!),
    );
    for (const primaryId of primariesWithChildren) {
      const primary = rows.find((r) => r.sessionId === primaryId);
      const children = rows.filter((r) => r.parentSessionId === primaryId);
      const group = [...(primary ? [primary] : []), ...children];
      if (group.length < 2) continue;
      const isSplit = group.every((r) => r.tableLabel === group[0].tableLabel);
      if (!isSplit) continue;
      const color = SPLIT_COLORS[colorIdx % SPLIT_COLORS.length];
      colorIdx++;
      const paidGroup = group.filter((r) => r.totalRevenue > 0);
      paidGroup.forEach((row, paidIdx) => {
        map.set(row.sessionId, {
          seqIndex: group.indexOf(row) + 1,
          groupSize: group.length,
          borderColor: color.border,
          bgColor: color.bg,
          badgeClass: color.badge,
          isFirst: paidIdx === 0,
          isLast: paidIdx === paidGroup.length - 1,
        });
      });
    }
    return map;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalRevenue = paid.reduce((s, r) => s + r.totalRevenue, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary — fixed */}
      <div className="shrink-0 grid grid-cols-2 gap-3 p-6 pb-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">รายได้รวม</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            ฿{totalRevenue.toLocaleString('th-TH')}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">จำนวนบิล</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{paid.length}</p>
        </div>
      </div>

      {/* Table — scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {paid.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            ไม่มีการชำระเงินในวันที่ {format(new Date(date), 'd MMMM yyyy', { locale: th })}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">โต๊ะ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">เวลาปิด</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">ผู้เข้าใช้</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">ยอดชำระ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">ช่องทาง</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paid.map((row) => {
                const split = splitInfo.get(row.sessionId);
                return (
                <tr
                  key={row.sessionId}
                  className="border-b border-slate-50 last:border-0 cursor-pointer transition-colors hover:brightness-95"
                  style={split ? {
                    borderLeft:   `3px solid ${split.borderColor}`,
                    borderRight:  `1px solid ${split.borderColor}`,
                    borderTop:    split.isFirst ? `1px solid ${split.borderColor}` : undefined,
                    borderBottom: split.isLast  ? `1px solid ${split.borderColor}` : `1px solid ${split.borderColor}33`,
                    backgroundColor: split.bgColor,
                  } : undefined}
                  onClick={() => setDetailSessionId(row.sessionId)}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-slate-900">
                        {row.tableLabel}
                        {row.zone !== 'ทั่วไป' && (
                          <span className="ml-1 text-xs font-normal text-slate-400">
                            ({row.zone})
                          </span>
                        )}
                      </span>
                      {split && (
                        <span className={`self-start rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${split.badgeClass}`}>
                          ÷ แบ่งชำระ {split.seqIndex}/{split.groupSize}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {row.closedAt
                      ? format(new Date(row.closedAt), 'HH:mm', { locale: th })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.guestCount === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {row.adultCount      > 0 && <div>ผู้ใหญ่ {row.adultCount}</div>}
                        {row.childCount      > 0 && <div>เด็ก {row.childCount}</div>}
                        {row.toddlerCount    > 0 && <div>เด็กเล็ก {row.toddlerCount}</div>}
                        {row.staffCount      > 0 && <div>พนักงาน {row.staffCount}</div>}
                        {row.staffGuestCount > 0 && <div>พนักงานพา {row.staffGuestCount}</div>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                    ฿{row.totalRevenue.toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {row.paymentMethod === 'cash_qr' ? (
                      <div className="space-y-0.5">
                        <div className="font-medium text-slate-700">สด+QR</div>
                        <div className="tabular-nums text-slate-400">
                          สด ฿{row.receivedAmount.toLocaleString('th-TH')}
                        </div>
                        <div className="tabular-nums text-slate-400">
                          QR ฿{(row.totalRevenue - row.receivedAmount).toLocaleString('th-TH')}
                        </div>
                      </div>
                    ) : (
                      row.paymentMethod ? METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod : '—'
                    )}
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
      </div>

      <SessionDetailDialog
        sessionId={detailSessionId}
        onClose={() => setDetailSessionId(null)}
        showPayment
      />
    </div>
  );
}
