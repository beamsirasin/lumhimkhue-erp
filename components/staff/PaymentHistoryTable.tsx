'use client';

import { useMemo, useState } from 'react';
import { formatThaiDate, formatThaiTime } from '@/lib/date-time';
import { useQuery } from '@tanstack/react-query';
import { Banknote, ChevronRight, Loader2, Printer, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import {
  getFullBillReceiptData,
  getSessionDetail,
  type SessionDetailData,
  type SessionHistoryRow,
} from '@/lib/actions/history';
import { getPosAccountRevenue } from '@/lib/actions/reports/collection';
import { print as printReceipt } from '@/lib/printer/service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
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

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  bank_cash_group: 'บัญชีธนาคาร',
  welfare: 'บัญชีสวัสดิการ',
  cash_drawer: 'ลิ้นชักเงินสด',
  other: 'อื่นๆ',
};

function fmtThb(value: number) {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type SessionChargeLine = {
  key: string;
  label: string;
  quantity: number;
  amount: number;
};

function getSessionChargeLines(detail: SessionDetailData): SessionChargeLine[] {
  const lineMap = new Map<string, SessionChargeLine>();

  function addLine(key: string, label: string, quantity: number, amount: number) {
    const current = lineMap.get(key);
    if (current) {
      current.quantity += quantity;
      current.amount += amount;
      return;
    }
    lineMap.set(key, { key, label, quantity, amount });
  }

  for (const guest of detail.session.guests) {
    const unitPrice = Number(guest.unitPrice);
    addLine(
      'tile:' + guest.pricingTileId,
      guest.pricingTile.name,
      guest.quantity,
      unitPrice * guest.quantity,
    );
  }

  for (const order of detail.orders) {
    for (const item of order.items) {
      if (item.status === 'cancelled' || item.menuItem?.isBuffet) continue;
      const unitPrice = Number(item.menuItem?.extraPrice ?? 0);
      const itemLabel = item.itemName ?? item.menuItem?.name ?? 'รายการเพิ่มเติม';
      addLine(
        'menu:' + (item.menuItemId ?? itemLabel),
        itemLabel,
        item.quantity,
        unitPrice * item.quantity,
      );
    }
  }

  return [...lineMap.values()];
}

interface PaymentHistoryTableProps {
  rows: SessionHistoryRow[];
  date: string;
  /** Deep link: open this session's detail dialog immediately on mount. */
  initialDetailSessionId?: string | null;
}

export function PaymentHistoryTable({ rows, date, initialDetailSessionId = null }: PaymentHistoryTableProps) {
  const [detailSessionId, setDetailSessionId] = useState<string | null>(initialDetailSessionId);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [revenueOpen, setRevenueOpen] = useState(false);
  const [sessionSummaryOpen, setSessionSummaryOpen] = useState(false);

  // Per-account breakdown for the revenue popup — fetched only when opened
  const { data: accountRevenue, isLoading: accountRevenueLoading } = useQuery({
    queryKey: ['pos-account-revenue', date],
    queryFn: () => getPosAccountRevenue(date).then((r) => (r.ok ? r.data : null)),
    enabled: revenueOpen,
    staleTime: 30_000,
  });

  const {
    data: sessionSummaries,
    isLoading: sessionSummariesLoading,
  } = useQuery({
    queryKey: ['pos-session-summary', date, rows.map((row) => row.sessionId)],
    queryFn: async () => Promise.all(
      rows.map(async (row) => {
        const result = await getSessionDetail(row.sessionId);
        return {
          row,
          detail: result.ok ? result.data : null,
          error: result.ok ? null : result.error,
        };
      }),
    ),
    enabled: sessionSummaryOpen,
    staleTime: 30_000,
  });

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
          <button
            type="button"
            onClick={() => setRevenueOpen(true)}
            aria-haspopup="dialog"
            className="w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <StatCard
              label="รายได้รวม"
              value={fmtThb(totalRevenue)}
              subLabel="คลิกเพื่อดูรายได้แยกตามบัญชี"
              icon={<Banknote className="size-4" />}
              accent="success"
              className="h-full cursor-pointer"
            />
          </button>
          <button
            type="button"
            onClick={() => setSessionSummaryOpen(true)}
            aria-haspopup="dialog"
            className="w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <StatCard
              label="จำนวน SESSION"
              value={rows.length}
              unit="SESSION"
              subLabel="คลิกเพื่อดูยอดชำระและรายการในแต่ละ SESSION"
              icon={<ReceiptText className="size-4" />}
              className="h-full cursor-pointer"
            />
          </button>
        </StatCardGrid>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataCard title="รายการชำระเงิน" subtitle={`${formatThaiDate(date)} · ${paid.length} รายการ`} noPadding>
          {paid.length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="size-5" />}
              title="ไม่มีการชำระเงิน"
              description={`ไม่พบการชำระเงินในวันที่ ${formatThaiDate(date)}`}
              size="lg"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">โต๊ะ</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">เวลาเปิด</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">ผู้เข้าใช้</TableHead>
                  <TableHead className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">ยอดชำระ</TableHead>
                  <TableHead className="px-4 py-3 text-xs font-semibold text-muted-foreground">การชำระ · เลขที่ใบเสร็จ</TableHead>
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
                        {row.startedAt
                          ? formatThaiTime(row.startedAt)
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
                          <div className="min-w-[220px] space-y-1.5">
                            <StatusBadge label={`แบ่งชำระ ${events.length} ครั้ง`} variant="warning" />
                            {events.map((event, idx) => {
                              const isPartial = event.settlementType === 'partial';
                              return (
                                <div key={event.id} className="flex items-start gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={`mt-[5px] size-1.5 shrink-0 rounded-full ${isPartial ? 'bg-[var(--status-warning-fg)]' : 'bg-[var(--status-success-fg)]'}`}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between gap-3 whitespace-nowrap">
                                      {event.receiptNo ? (
                                        <span className="font-mono text-[11px] tabular-nums text-foreground">{event.receiptNo}</span>
                                      ) : (
                                        <span className="text-[11px] text-muted-foreground">ไม่มีเลขใบเสร็จ</span>
                                      )}
                                      <span className="text-[11px] font-semibold tabular-nums text-foreground">{fmtThb(event.total)}</span>
                                    </div>
                                    <div className="whitespace-nowrap text-[10px] text-muted-foreground">
                                      ครั้งที่ {idx + 1} · {formatThaiTime(event.paidAt)} · {METHOD_LABEL[event.methodSummary] ?? event.methodSummary}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : events.length === 1 ? (
                          <div className="space-y-1">
                            <StatusBadge
                              label={SETTLEMENT_LABEL[events[0].settlementType] ?? events[0].settlementType}
                              variant={events[0].settlementType === 'partial' ? 'warning' : 'success'}
                            />
                            {events[0].receiptNo && (
                              <div className="font-mono text-[11px] tabular-nums text-foreground">{events[0].receiptNo}</div>
                            )}
                            <div className="text-[11px]">
                              {formatThaiTime(events[0].paidAt)} · {METHOD_LABEL[events[0].methodSummary] ?? events[0].methodSummary}
                            </div>
                          </div>
                        ) : row.paymentMethod === 'cash_qr' ? (
                          <div className="space-y-0.5">
                            {row.receiptNo && (
                              <div className="font-mono text-[11px] tabular-nums text-foreground">{row.receiptNo}</div>
                            )}
                            <div className="font-medium text-foreground">QR+เงินสด</div>
                            <div className="tabular-nums text-muted-foreground">
                              QR ฿{(row.totalRevenue - row.receivedAmount).toLocaleString('th-TH')}
                            </div>
                            <div className="tabular-nums text-muted-foreground">
                              เงินสด ฿{row.receivedAmount.toLocaleString('th-TH')}
                            </div>
                          </div>
                        ) : row.paymentMethod ? (
                          <div className="space-y-0.5">
                            {row.receiptNo && (
                              <div className="font-mono text-[11px] tabular-nums text-foreground">{row.receiptNo}</div>
                            )}
                            <div>{METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod}</div>
                          </div>
                        ) : (
                          '—'
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

      <Dialog open={sessionSummaryOpen} onOpenChange={setSessionSummaryOpen}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto bg-[var(--surface-raised)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>รายละเอียด SESSION</DialogTitle>
            <DialogDescription>
              {formatThaiDate(date)} · {rows.length} SESSION
            </DialogDescription>
          </DialogHeader>

          {sessionSummariesLoading ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
              <Skeleton className="h-44 w-full rounded-xl" />
              <Skeleton className="h-44 w-full rounded-xl" />
            </div>
          ) : !sessionSummaries || sessionSummaries.length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="size-5" />}
              title="ไม่มี SESSION"
              description="ไม่พบ SESSION ที่เปิดในวันที่เลือก"
              size="lg"
            />
          ) : (() => {
            const totalPaid = sessionSummaries.reduce(
              (sum, summary) => sum + (summary.detail?.paidTotal ?? 0),
              0,
            );
            const totalRemaining = sessionSummaries.reduce(
              (sum, summary) => sum + (summary.detail?.remaining ?? 0),
              0,
            );
            const totalBill = sessionSummaries.reduce(
              (sum, summary) => sum + (summary.detail?.billTotal ?? 0),
              0,
            );
            const availableSessionCount = sessionSummaries.filter((summary) => summary.detail).length;
            const fullyPaidSessionCount = sessionSummaries.filter(
              (summary) => summary.detail && summary.detail.paidTotal > 0 && summary.detail.remaining <= 0,
            ).length;
            const unpaidSessionCount = sessionSummaries.filter(
              (summary) => summary.detail && (summary.detail.remaining > 0 || summary.detail.paidTotal <= 0),
            ).length;
            const failedSessionCount = sessionSummaries.length - availableSessionCount;
            const chargeSummaryMap = new Map<string, {
              key: string;
              label: string;
              paidQuantity: number;
              paidAmount: number;
              unpaidQuantity: number;
              unpaidAmount: number;
            }>();

            for (const summary of sessionSummaries) {
              if (!summary.detail) continue;
              const isFullyPaid = summary.detail.paidTotal > 0 && summary.detail.remaining <= 0;

              for (const line of getSessionChargeLines(summary.detail)) {
                const current = chargeSummaryMap.get(line.key) ?? {
                  key: line.key,
                  label: line.label,
                  paidQuantity: 0,
                  paidAmount: 0,
                  unpaidQuantity: 0,
                  unpaidAmount: 0,
                };

                if (isFullyPaid) {
                  current.paidQuantity += line.quantity;
                  current.paidAmount += line.amount;
                } else {
                  current.unpaidQuantity += line.quantity;
                  current.unpaidAmount += line.amount;
                }
                chargeSummaryMap.set(line.key, current);
              }
            }

            const chargeSummaryRows = [...chargeSummaryMap.values()];

            return (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-4">
                    <p className="text-xs text-[var(--status-success-fg)]">รับชำระแล้ว</p>
                    <p className="mt-1 text-xl font-medium tabular-nums text-[var(--status-success-fg)]">
                      {fmtThb(totalPaid)}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--status-success-fg)]">
                      ชำระครบ {fullyPaidSessionCount} SESSION
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-4">
                    <p className="text-xs text-[var(--status-warning-fg)]">ยังไม่ชำระ</p>
                    <p className="mt-1 text-xl font-medium tabular-nums text-[var(--status-warning-fg)]">
                      {fmtThb(totalRemaining)}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--status-warning-fg)]">
                      ยังชำระไม่ครบ {unpaidSessionCount} SESSION
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4">
                    <p className="text-xs text-muted-foreground">ยอดรวม</p>
                    <p className="mt-1 text-xl font-medium tabular-nums text-foreground">{fmtThb(totalBill)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      ทั้งหมด {availableSessionCount} SESSION
                    </p>
                  </div>
                </div>

                <section className="overflow-hidden rounded-xl border border-border bg-[var(--surface-1)]">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="font-medium text-foreground">สรุปตามประเภทรายการ</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      SESSION ที่ชำระบางส่วนจะนับรายการไว้ใน “ยังชำระไม่ครบ” จนกว่าจะชำระครบ
                    </p>
                  </div>

                  {chargeSummaryRows.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                      ยังไม่มีรายการคิดเงิน
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[680px]">
                        <TableHeader>
                          <TableRow className="bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
                            <TableHead className="px-4 py-3">รายการ</TableHead>
                            <TableHead className="px-4 py-3 text-right">ชำระครบแล้ว</TableHead>
                            <TableHead className="px-4 py-3 text-right">ยังชำระไม่ครบ</TableHead>
                            <TableHead className="px-4 py-3 text-right">รวม</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {chargeSummaryRows.map((line) => {
                            const totalQuantity = line.paidQuantity + line.unpaidQuantity;
                            const totalAmount = line.paidAmount + line.unpaidAmount;

                            return (
                              <TableRow key={line.key} className="border-border/60">
                                <TableCell className="px-4 py-3 font-medium text-foreground">
                                  {line.label}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <p className="font-medium tabular-nums text-[var(--status-success-fg)]">
                                    {line.paidQuantity.toLocaleString('th-TH')} รายการ
                                  </p>
                                  <p className="text-[11px] tabular-nums text-muted-foreground">
                                    {fmtThb(line.paidAmount)}
                                  </p>
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <p className="font-medium tabular-nums text-[var(--status-warning-fg)]">
                                    {line.unpaidQuantity.toLocaleString('th-TH')} รายการ
                                  </p>
                                  <p className="text-[11px] tabular-nums text-muted-foreground">
                                    {fmtThb(line.unpaidAmount)}
                                  </p>
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <p className="font-medium tabular-nums text-foreground">
                                    {totalQuantity.toLocaleString('th-TH')} รายการ
                                  </p>
                                  <p className="text-[11px] tabular-nums text-muted-foreground">
                                    {fmtThb(totalAmount)}
                                  </p>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>

                {failedSessionCount > 0 && (
                  <p className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger-fg)]">
                    มี {failedSessionCount} SESSION ที่โหลดรายละเอียดไม่สำเร็จ จึงยังไม่รวมในตารางสรุป
                  </p>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* รายได้แยกตามบัญชี — opened from the revenue stat card */}
      <Dialog open={revenueOpen} onOpenChange={(o) => { if (!o) setRevenueOpen(false); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto bg-[var(--surface-raised)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>รายได้แยกตามบัญชี</DialogTitle>
            <DialogDescription>
              {formatThaiDate(date)}
            </DialogDescription>
          </DialogHeader>

          {accountRevenueLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : !accountRevenue || accountRevenue.accounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              ไม่มีข้อมูลการรับเงินในวันนี้
            </p>
          ) : (
            <div className="space-y-3">
              {accountRevenue.accounts.map((acc) => (
                <div key={acc.accountId} className="rounded-xl border border-border bg-[var(--surface-1)] p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{acc.accountName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {ACCOUNT_TYPE_LABEL[acc.accountType] ?? acc.accountType} · {acc.rowCount} รายการ
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-bold tabular-nums text-foreground">{fmtThb(acc.amount)}</p>
                  </div>
                  {acc.methods.length > 0 && (
                    <div className="mt-2.5 space-y-1 border-t border-border pt-2.5">
                      {acc.methods.map((m) => (
                        <div key={m.methodName} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{m.methodName}</span>
                          <span className="tabular-nums text-foreground">{fmtThb(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between rounded-xl bg-[var(--surface-2)] px-4 py-3">
                <span className="text-sm font-semibold text-foreground">รวมทั้งวัน</span>
                <span className="text-lg font-bold tabular-nums text-foreground">{fmtThb(accountRevenue.total)}</span>
              </div>

              {Math.abs(accountRevenue.total - totalRevenue) > 0.005 && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  * ยอดนี้นับตามเวลารับเงินจริงของวันนี้ จึงอาจต่างจากการ์ด &quot;รายได้รวม&quot;
                  ซึ่งนับตามวันเปิดโต๊ะ (เช่น บิลข้ามเที่ยงคืน หรือรายการระบบเก่าที่ไม่มีข้อมูลบัญชี)
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
