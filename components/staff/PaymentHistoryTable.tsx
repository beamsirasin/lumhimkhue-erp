'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { Banknote, ChevronRight, Loader2, Printer, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import {
  getFullBillReceiptData,
  type SessionHistoryRow,
} from '@/lib/actions/history';
import { print as printReceipt } from '@/lib/printer/service';
import { Button } from '@/components/ui/button';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SessionDetailDialog } from './SessionDetailDialog';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  cash_qr: 'QR+เงินสด',
  qr_promptpay: 'QR',
  transfer: 'โอน',
  card: 'บัตร',
};

const SETTLEMENT_LABEL: Record<string, string> = {
  partial: 'รับบางส่วน',
  final: 'ปิดบิล',
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
    { border: '#f97316', bg: 'rgba(249,115,22,0.05)', badge: 'bg-orange-100 text-orange-700' },
    { border: '#14b8a6', bg: 'rgba(20,184,166,0.05)', badge: 'bg-teal-100 text-teal-700' },
    { border: '#ec4899', bg: 'rgba(236,72,153,0.05)', badge: 'bg-pink-100 text-pink-700' },
    { border: '#d97706', bg: 'rgba(217,119,6,0.05)', badge: 'bg-amber-100 text-amber-700' },
    { border: '#06b6d4', bg: 'rgba(6,182,212,0.05)', badge: 'bg-cyan-100 text-cyan-700' },
  ];

  const splitInfo = useMemo(() => {
    type SplitMeta = {
      seqIndex: number;
      groupSize: number;
      borderColor: string;
      bgColor: string;
      badgeClass: string;
      isFirst: boolean;
      isLast: boolean;
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 pb-4">
        <StatCardGrid cols={2}>
          <StatCard
            label="รายได้รวม"
            value={fmtThb(totalRevenue)}
            icon={<Banknote className="size-4" />}
            accent="success"
          />
          <StatCard
            label="จำนวนบิล"
            value={paid.length}
            unit="บิล"
            icon={<ReceiptText className="size-4" />}
          />
        </StatCardGrid>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataCard title="รายการชำระเงิน" subtitle={`${format(new Date(date), 'd MMMM yyyy', { locale: th })} · ${paid.length} รายการ`} noPadding>
          {paid.length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="size-5" />}
              title="ไม่มีการชำระเงิน"
              description={`ไม่พบการชำระเงินในวันที่ ${format(new Date(date), 'd MMMM yyyy', { locale: th })}`}
              size="lg"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">เลขที่บิล</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">โต๊ะ</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">เวลาปิด</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">ผู้เข้าใช้</TableHead>
                  <TableHead className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">ยอดชำระ</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">ช่องทาง</TableHead>
                  <TableHead className="px-4 py-3" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paid.map((row) => {
                  const split = splitInfo.get(row.sessionId);
                  const events = row.paymentEvents ?? [];
                  return (
                    <TableRow
                      key={row.sessionId}
                      className="cursor-pointer border-border/60 hover:bg-muted/30"
                      style={split ? {
                        borderLeft: `3px solid ${split.borderColor}`,
                        borderRight: `1px solid ${split.borderColor}`,
                        borderTop: split.isFirst ? `1px solid ${split.borderColor}` : undefined,
                        borderBottom: split.isLast ? `1px solid ${split.borderColor}` : `1px solid ${split.borderColor}33`,
                        backgroundColor: split.bgColor,
                      } : undefined}
                      onClick={() => setDetailSessionId(row.sessionId)}
                    >
                      <TableCell className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                        {row.receiptNo ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex flex-col gap-1">
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
                      </TableCell>
                      <TableCell className="px-4 py-3 tabular-nums text-foreground">
                        {row.closedAt
                          ? format(new Date(row.closedAt), 'HH:mm', { locale: th })
                          : '—'}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs text-foreground">
                        {row.guestCount === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {row.adultCount > 0 && <div>ผู้ใหญ่ {row.adultCount}</div>}
                            {row.childCount > 0 && <div>เด็ก {row.childCount}</div>}
                            {row.toddlerCount > 0 && <div>เด็กเล็ก {row.toddlerCount}</div>}
                            {row.staffCount > 0 && <div>พนักงาน {row.staffCount}</div>}
                            {row.staffGuestCount > 0 && <div>พนักงานพา {row.staffGuestCount}</div>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        <div className="text-base font-bold tabular-nums text-foreground">
                          {fmtThb(row.paidTotal ?? row.totalRevenue)}
                        </div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">
                          ยอดบิล {fmtThb(row.billTotal || row.totalRevenue)}
                        </div>
                        {row.remaining > 0 ? (
                          <span className="mt-1 inline-flex rounded-full border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--status-danger-fg)]">
                            ค้าง {fmtThb(row.remaining)}
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-[var(--status-success-fg)]">ชำระครบ ✓</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                        {events.length > 1 ? (
                          <div className="space-y-1">
                            <StatusBadge label={`แบ่งชำระ ${events.length} ครั้ง`} variant="warning" />
                            {events.map((event, idx) => {
                              const isPartial = event.settlementType === 'partial';
                              return (
                                <div key={event.id} className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
                                  <span
                                    aria-hidden="true"
                                    className={`size-1.5 shrink-0 rounded-full ${isPartial ? 'bg-[var(--status-warning-fg)]' : 'bg-[var(--status-success-fg)]'}`}
                                  />
                                  <span className="font-semibold text-foreground">{idx + 1}.</span>
                                  <span className="tabular-nums">{format(new Date(event.paidAt), 'HH:mm', { locale: th })}</span>
                                  <span>{METHOD_LABEL[event.methodSummary] ?? event.methodSummary}</span>
                                  <span className="ml-auto pl-2 font-semibold tabular-nums text-foreground">{fmtThb(event.total)}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : events.length === 1 ? (
                          <div className="space-y-0.5">
                            <StatusBadge
                              label={SETTLEMENT_LABEL[events[0].settlementType] ?? events[0].settlementType}
                              variant={events[0].settlementType === 'partial' ? 'warning' : 'success'}
                            />
                            <div className="text-[11px]">
                              {format(new Date(events[0].paidAt), 'HH:mm', { locale: th })} · {METHOD_LABEL[events[0].methodSummary] ?? events[0].methodSummary}
                            </div>
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
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePrintFullBill(row.sessionId);
                            }}
                            disabled={printingId === `full:${row.sessionId}`}
                          >
                            {printingId === `full:${row.sessionId}` ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />}
                            พิมพ์รวม
                          </Button>
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DataCard>
      </div>

      <SessionDetailDialog
        sessionId={detailSessionId}
        onClose={() => setDetailSessionId(null)}
        showPayment
      />
    </div>
  );
}
