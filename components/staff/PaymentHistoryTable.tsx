'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { ChevronRight, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  getFullBillReceiptData,
  type SessionHistoryRow,
} from '@/lib/actions/history';
import { print as printReceipt } from '@/lib/printer/service';
import { SessionDetailDialog } from './SessionDetailDialog';

const METHOD_LABEL: Record<string, string> = {
  cash:         'เงินสด',
  cash_qr:      'QR+เงินสด',
  qr_promptpay: 'QR',
  transfer:     'โอน',
  card:         'บัตร',
};

const SETTLEMENT_LABEL: Record<string, string> = {
  partial: 'รับบางส่วน',
  final:   'ปิดบิล',
};

function fmtThb(value: number) {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface PaymentHistoryTableProps {
  rows: SessionHistoryRow[];
  date: string;
}

export function PaymentHistoryTable({ rows, date }: PaymentHistoryTableProps) {
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

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

  async function handlePrintFullBill(sessionId: string) {
    const key = `full:${sessionId}`;
    setPrintingId(key);
    const result = await getFullBillReceiptData(sessionId);
    if (!result.ok) {
      toast.error(result.error);
      setPrintingId(null);
      return;
    }
    const printResult = await printReceipt({ type: 'receipt', payment: result.data });
    setPrintingId(null);
    if (printResult.ok) toast.success('สั่งพิมพ์ใบเสร็จรวมแล้ว');
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary — fixed */}
      <div className="shrink-0 grid grid-cols-2 gap-3 p-6 pb-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">รายได้รวม</p>
          <p className="mt-1.5 text-xl font-bold text-foreground">
            ฿{totalRevenue.toLocaleString('th-TH')}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">จำนวนบิล</p>
          <p className="mt-1.5 text-xl font-bold text-foreground">{paid.length}</p>
        </div>
      </div>

      {/* Table — scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {paid.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            ไม่มีการชำระเงินในวันที่ {format(new Date(date), 'd MMMM yyyy', { locale: th })}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">เลขที่บิล</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">โต๊ะ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">เวลาปิด</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">ผู้เข้าใช้</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">ยอดชำระ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">ช่องทาง</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paid.map((row) => {
                const split = splitInfo.get(row.sessionId);
                const events = row.paymentEvents ?? [];
                return (
                <tr
                  key={row.sessionId}
                  className="border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/30"
                  style={split ? {
                    borderLeft:   `3px solid ${split.borderColor}`,
                    borderRight:  `1px solid ${split.borderColor}`,
                    borderTop:    split.isFirst ? `1px solid ${split.borderColor}` : undefined,
                    borderBottom: split.isLast  ? `1px solid ${split.borderColor}` : `1px solid ${split.borderColor}33`,
                    backgroundColor: split.bgColor,
                  } : undefined}
                  onClick={() => setDetailSessionId(row.sessionId)}
                >
                  <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground font-mono">
                    {row.receiptNo ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-foreground">
                        {row.tableLabel}
                        {row.zone !== 'ทั่วไป' && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
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
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {row.closedAt
                      ? format(new Date(row.closedAt), 'HH:mm', { locale: th })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground">
                    {row.guestCount === 0 ? (
                      <span className="text-muted-foreground">—</span>
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
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                    <div className="text-xs font-normal text-muted-foreground">ยอดบิล {fmtThb(row.billTotal || row.totalRevenue)}</div>
                    <div className="text-xs font-normal text-emerald-600">รับรวม {fmtThb(row.paidTotal ?? row.totalRevenue)}</div>
                    <div className={`text-xs font-normal ${row.remaining > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                      คงเหลือ {fmtThb(row.remaining ?? 0)}
                    </div>
                    ฿{row.totalRevenue.toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {events.length > 0 ? (
                      <div className="space-y-1">
                        {events.length > 1 && (
                          <span className="inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            รับชำระ {events.length} ครั้ง
                          </span>
                        )}
                        {events.map((event, idx) => (
                          <div key={event.id} className="rounded-md border border-border/70 bg-background/70 px-2 py-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                event.settlementType === 'partial'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {idx + 1}. {SETTLEMENT_LABEL[event.settlementType] ?? event.settlementType}
                              </span>
                              <span className="tabular-nums font-semibold text-foreground">{fmtThb(event.total)}</span>
                            </div>
                            <div className="mt-0.5 flex justify-between gap-2 text-[11px]">
                              <span>{format(new Date(event.paidAt), 'HH:mm', { locale: th })} · {METHOD_LABEL[event.methodSummary] ?? event.methodSummary}</span>
                              <span className="tabular-nums">คงเหลือ {fmtThb(event.remainingAfter)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : row.paymentMethod === 'cash_qr' ? (
                      <div className="space-y-0.5">
                        <div className="font-medium text-foreground">QR+เงินสด</div>
                        <div className="tabular-nums text-muted-foreground">
                          QR ฿{(row.totalRevenue - row.receivedAmount).toLocaleString('th-TH')}
                        </div>
                        <div className="tabular-nums text-muted-foreground">
                          เงินสด ฿{row.receivedAmount.toLocaleString('th-TH')}
                        </div>
                      </div>
                    ) : (
                      row.paymentMethod ? METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod : '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePrintFullBill(row.sessionId);
                        }}
                        disabled={printingId === `full:${row.sessionId}`}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
                      >
                        {printingId === `full:${row.sessionId}` ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />}
                        พิมพ์รวม
                      </button>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
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
