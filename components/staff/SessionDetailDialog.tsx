'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { format, differenceInMinutes } from 'date-fns';
import { th } from 'date-fns/locale';
import { Pencil, Trash2, Loader2, AlertTriangle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  getSessionDetail,
  deletePaymentRecord,
  reopenSessionForPayment,
  getPaymentReceiptData,
  getFullBillReceiptData,
} from '@/lib/actions/history';
import { print as printReceipt } from '@/lib/printer/service';
import { ManagerApprovalModal } from '@/components/shared/ManagerApprovalModal';
import { cn } from '@/lib/utils';

const METHOD_LABEL: Record<string, string> = {
  cash:         'เงินสด',
  cash_qr:      'เงินสด + QR',
  qr_promptpay: 'QR PromptPay',
  transfer:     'โอนเงิน',
  card:         'บัตรเครดิต',
};

const SETTLEMENT_LABEL: Record<string, string> = {
  partial: 'รับชำระบางส่วน',
  final:   'ปิดบิลทั้งหมด',
};

function fmtThb(value: number | string | null | undefined) {
  return `฿${Number(value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface SessionDetailDialogProps {
  sessionId: string | null;
  onClose: () => void;
  showPayment?: boolean;
}

export function SessionDetailDialog({ sessionId, onClose, showPayment = false }: SessionDetailDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: () => getSessionDetail(sessionId!).then((r) => (r.ok ? r.data : null)),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  const [delConfirm,  setDelConfirm]  = useState(false);
  const [editConfirm, setEditConfirm] = useState(false);
  // Phase 17POS-AUTH-A3 — which gated action's approval-code modal is open, if any.
  // deletePaymentRecord / reopenSessionForPayment are always approval-gated once
  // role permission passes, so the modal opens directly from the confirm step
  // rather than round-tripping to the server first.
  const [approvalAction, setApprovalAction] = useState<'delete' | 'reopen' | null>(null);
  const [selectedMutationPaymentId, setSelectedMutationPaymentId] = useState<string | null>(null);
  const [printingReceiptId, setPrintingReceiptId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDelConfirm(false);
    setEditConfirm(false);
    setApprovalAction(null);
    setSelectedMutationPaymentId(null);
    setPrintingReceiptId(null);
  }, [sessionId]);

  async function handlePrintPayment(paymentId: string) {
    setPrintingReceiptId(paymentId);
    const result = await getPaymentReceiptData(paymentId);
    if (!result.ok) {
      toast.error(result.error);
      setPrintingReceiptId(null);
      return;
    }
    const printResult = await printReceipt({ type: 'receipt', payment: result.data });
    setPrintingReceiptId(null);
    if (printResult.ok) toast.success('สั่งพิมพ์ใบนี้แล้ว');
  }

  async function handlePrintFullBill() {
    if (!sessionId) return;
    setPrintingReceiptId(`full:${sessionId}`);
    const result = await getFullBillReceiptData(sessionId);
    if (!result.ok) {
      toast.error(result.error);
      setPrintingReceiptId(null);
      return;
    }
    const printResult = await printReceipt({ type: 'receipt', payment: result.data });
    setPrintingReceiptId(null);
    if (printResult.ok) toast.success('สั่งพิมพ์ใบเสร็จรวมแล้ว');
  }

  // Phase 17POS-AUTH-A3 — both mutations always require a valid approval
  // code + reason once role permission passes (see lib/actions/history.ts).
  // These are the ManagerApprovalModal onConfirm handlers.
  async function handleDelete(approval: { code: string; reason: string }) {
    const paymentId = selectedMutationPaymentId ?? data?.session.payment?.id;
    if (!paymentId) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };
    const result = await deletePaymentRecord({ paymentId, reason: approval.reason, approvalCode: approval.code });
    if (!result.ok) return { ok: false as const, error: result.error };
    toast.success('ลบประวัติการชำระเงินแล้ว');
    queryClient.invalidateQueries({ queryKey: ['payment-history'] });
    queryClient.invalidateQueries({ queryKey: ['session-history'] });
    setApprovalAction(null);
    setDelConfirm(false);
    setSelectedMutationPaymentId(null);
    onClose();
    return { ok: true as const };
  }

  async function handleReopen(approval: { code: string; reason: string }) {
    const paymentId = selectedMutationPaymentId ?? data?.session.payment?.id;
    if (!paymentId) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };
    const result = await reopenSessionForPayment({ paymentId, reason: approval.reason, approvalCode: approval.code });
    if (!result.ok) return { ok: false as const, error: result.error };
    toast.success('เปิดบิลใหม่แล้ว — กำลังไปหน้า POS');
    queryClient.invalidateQueries({ queryKey: ['payment-history'] });
    queryClient.invalidateQueries({ queryKey: ['pos-sessions'] });
    setApprovalAction(null);
    setEditConfirm(false);
    setSelectedMutationPaymentId(null);
    onClose();
    router.push('/pos');
    return { ok: true as const };
  }

  /** Phase 17POS-AUTH-A3 — context shown inside the approval-code modal. */
  function approvalContextLines(actionLabel: string): string[] {
    const paymentEvt = data?.session.payments?.find((p) => p.id === selectedMutationPaymentId)
      ?? data?.session.payment
      ?? null;
    if (!data || !paymentEvt) return [];
    const lines = [
      `โต๊ะ ${data.session.table.label}`,
      `การกระทำ: ${actionLabel}`,
    ];
    if (paymentEvt.receiptNo) lines.push(`เลขที่ใบเสร็จ: ${paymentEvt.receiptNo}`);
    lines.push(`จำนวนเงิน: ${fmtThb(paymentEvt.total)}`);
    if (paymentEvt.rows?.length) {
      lines.push(
        `ช่องทาง: ${paymentEvt.rows
          .map((r) => `${r.paymentMethod?.name ?? '—'}/${r.receivingAccount?.name ?? '—'}`)
          .join(', ')}`,
      );
    } else {
      lines.push(`วิธีชำระ: ${METHOD_LABEL[paymentEvt.paymentMethod] ?? paymentEvt.paymentMethod}`);
    }
    return lines;
  }

  return (
    <Dialog open={!!sessionId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-[var(--surface-raised)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>รายละเอียด Session</DialogTitle>
          <DialogDescription>ตรวจสอบประวัติโต๊ะ รายการอาหาร และการชำระเงิน</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
        )}

        {!isLoading && !data && (
          <div className="py-8 text-center text-sm text-muted-foreground">ไม่พบข้อมูล</div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Session header */}
            <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">โต๊ะ</span>
                <span className="font-semibold text-foreground">
                  {data.session.table.label}
                  {data.session.table.zone !== 'ทั่วไป' && (
                    <span className="ml-1 font-normal text-muted-foreground">({data.session.table.zone})</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">เริ่มต้น</span>
                <span className="tabular-nums text-foreground">
                  {format(new Date(data.session.startedAt), 'HH:mm น. (d MMM yy)', { locale: th })}
                </span>
              </div>
              {data.session.closedAt && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">สิ้นสุด</span>
                    <span className="tabular-nums text-foreground">
                      {format(new Date(data.session.closedAt), 'HH:mm น. (d MMM yy)', { locale: th })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">เวลาที่ใช้</span>
                    <span className="tabular-nums text-foreground">
                      {(() => {
                        const min = differenceInMinutes(
                          new Date(data.session.closedAt!),
                          new Date(data.session.startedAt),
                        );
                        return min >= 60
                          ? `${Math.floor(min / 60)} ชม. ${min % 60} น.`
                          : `${min} น.`;
                      })()}
                    </span>
                  </div>
                </>
              )}
              {data.session.notes && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">หมายเหตุ</span>
                  <span className="text-foreground">{data.session.notes}</span>
                </div>
              )}
            </div>

            {/* Guests */}
            {data.session.guests.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  ผู้เข้าใช้บริการ
                </p>
                <div className="space-y-1.5">
                  {data.session.guests.map((g) => (
                    <div key={g.id} className="flex justify-between text-sm">
                      <span className="text-foreground">{g.pricingTile.name} ×{g.quantity}</span>
                      <span className="tabular-nums font-medium text-foreground">
                        ฿{(Number(g.pricingTile.price) * g.quantity).toLocaleString('th-TH')}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
                    <span className="text-foreground">รวม</span>
                    <span className="tabular-nums text-foreground">
                      ฿{data.session.guests
                        .reduce((s, g) => s + Number(g.pricingTile.price) * g.quantity, 0)
                        .toLocaleString('th-TH')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Payments */}
            {showPayment && (() => {
              const paymentEvents = data.session.payments?.length
                ? data.session.payments
                : data.session.payment ? [data.session.payment] : [];

              if (paymentEvents.length === 0) return null;

              // Overall money picture derived from the last event's running
              // totals (paidBefore/total/remainingAfter are server snapshots).
              const lastEvt = paymentEvents[paymentEvents.length - 1];
              const paidTotal = paymentEvents.reduce((s, p) => s + Number(p.total), 0);
              const billTotal =
                Number(lastEvt.paidBefore ?? 0) + Number(lastEvt.total) + Number(lastEvt.remainingAfter ?? 0);
              const remaining = Number(lastEvt.remainingAfter ?? 0);

              return (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      การชำระเงิน{paymentEvents.length > 1 ? ` · แบ่งชำระ ${paymentEvents.length} ครั้ง` : ''}
                    </p>
                    <button
                      type="button"
                      onClick={handlePrintFullBill}
                      disabled={printingReceiptId === `full:${sessionId}`}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
                    >
                      {printingReceiptId === `full:${sessionId}` ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />}
                      พิมพ์ใบเสร็จรวม
                    </button>
                  </div>

                  {/* Summary strip — the whole-bill picture before per-round detail */}
                  <div className="mb-3 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-[var(--surface-2)] text-center">
                    <div className="px-2 py-2.5">
                      <p className="text-[11px] text-muted-foreground">ยอดบิล</p>
                      <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{fmtThb(billTotal)}</p>
                    </div>
                    <div className="px-2 py-2.5">
                      <p className="text-[11px] text-muted-foreground">รับแล้ว</p>
                      <p className="mt-0.5 text-sm font-bold tabular-nums text-[var(--status-success-fg)]">{fmtThb(paidTotal)}</p>
                    </div>
                    <div className="px-2 py-2.5">
                      <p className="text-[11px] text-muted-foreground">คงเหลือ</p>
                      {remaining > 0 ? (
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-[var(--status-danger-fg)]">{fmtThb(remaining)}</p>
                      ) : (
                        <p className="mt-0.5 text-sm font-bold text-[var(--status-success-fg)]">ชำระครบ ✓</p>
                      )}
                    </div>
                  </div>

                  {/* Timeline — numbered rounds; amber = partial, green = final */}
                  <div className="space-y-0">
                    {paymentEvents.map((payment, idx) => {
                      const shiftStatus = payment.shift?.status ?? null;
                      const isSelected = selectedMutationPaymentId === payment.id;
                      const isPartial = payment.settlementType === 'partial';
                      const evtBillTotal =
                        Number(payment.paidBefore ?? 0) + Number(payment.total) + Number(payment.remainingAfter ?? 0);
                      const cumulative = Number(payment.paidBefore ?? 0) + Number(payment.total);
                      const pct = evtBillTotal > 0 ? Math.min(100, (cumulative / evtBillTotal) * 100) : 100;
                      return (
                        <div key={payment.id} className="flex gap-2.5">
                          {/* Round number + connector line */}
                          <div className="flex flex-col items-center">
                            <div
                              className={cn(
                                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums',
                                isPartial
                                  ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                                  : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
                              )}
                            >
                              {idx + 1}
                            </div>
                            {idx < paymentEvents.length - 1 && <div className="w-px flex-1 bg-border" />}
                          </div>

                          <div
                            className={cn(
                              'mb-3 min-w-0 flex-1 space-y-2.5 rounded-xl border p-3 text-sm',
                              isPartial
                                ? 'border-[var(--status-warning-border)] bg-[var(--surface-1)]'
                                : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]/40',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <span className={cn(
                                  'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                  isPartial
                                    ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                                    : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
                                )}>
                                  {SETTLEMENT_LABEL[payment.settlementType] ?? payment.settlementType}
                                </span>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  ครั้งที่ {idx + 1} · {format(new Date(payment.paidAt), 'HH:mm น. (d MMM yy)', { locale: th })}
                                </p>
                              </div>
                              <span className={cn(
                                'tabular-nums text-lg font-bold',
                                isPartial ? 'text-[var(--status-warning-fg)]' : 'text-[var(--status-success-fg)]',
                              )}>
                                +{fmtThb(payment.total)}
                              </span>
                            </div>

                            {/* Running progress after this round */}
                            <div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-border/50">
                                <div
                                  className={cn('h-full rounded-full', isPartial ? 'bg-[var(--status-warning-fg)]' : 'bg-[var(--status-success-fg)]')}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                                <span className="text-muted-foreground">
                                  ก่อนหน้า {fmtThb(payment.paidBefore)} · ครั้งนี้ {fmtThb(payment.total)}
                                </span>
                                {Number(payment.remainingAfter) > 0 ? (
                                  <span className="font-semibold text-[var(--status-danger-fg)]">
                                    คงเหลือ {fmtThb(payment.remainingAfter)}
                                  </span>
                                ) : (
                                  <span className="font-semibold text-[var(--status-success-fg)]">ชำระครบ ✓</span>
                                )}
                              </div>
                            </div>

                          {payment.rows?.length > 0 ? (
                            <div className="space-y-2 pt-0.5">
                              <span className="text-xs text-muted-foreground">ช่องทางรับเงิน</span>
                              {payment.rows.map((pr) => (
                                <div key={pr.id} className="rounded-lg border border-border bg-[var(--surface-1)] px-2.5 py-2 space-y-1">
                                  <div className="flex justify-between text-xs font-medium text-foreground">
                                    <span>{pr.paymentMethod?.name ?? '—'} / {pr.receivingAccount?.name ?? '—'}</span>
                                    <span className="tabular-nums">{fmtThb(pr.amount)}</span>
                                  </div>
                                  {pr.amountTendered != null && (
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                      <span>รับ</span>
                                      <span className="tabular-nums">{fmtThb(pr.amountTendered)}</span>
                                    </div>
                                  )}
                                  {Number(pr.changeAmount) > 0 && (
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                      <span>ทอน</span>
                                      <span className="tabular-nums">{fmtThb(pr.changeAmount)}</span>
                                    </div>
                                  )}
                                  {pr.payerLabel && (
                                    <div className="text-xs text-muted-foreground">ผู้ชำระ: {pr.payerLabel}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">วิธีชำระ</span>
                              <span className="text-foreground">
                                {METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod}
                              </span>
                            </div>
                          )}
                          {payment.notes && (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">หมายเหตุ</span>
                              <span className="text-right text-foreground max-w-[60%]">{payment.notes}</span>
                            </div>
                          )}

                          {!isSelected && (
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => void handlePrintPayment(payment.id)}
                                disabled={printingReceiptId === payment.id}
                                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 disabled:opacity-50 transition-colors"
                              >
                                {printingReceiptId === payment.id ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                                พิมพ์ซ้ำใบนี้
                              </button>
                              <button
                                type="button"
                                onClick={() => { setSelectedMutationPaymentId(payment.id); setEditConfirm(true); setDelConfirm(false); }}
                                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
                              >
                                <Pencil className="size-4" />แก้ไขการชำระเงิน
                              </button>
                              <button
                                type="button"
                                onClick={() => { setSelectedMutationPaymentId(payment.id); setDelConfirm(true); setEditConfirm(false); }}
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] px-4 py-2.5 text-sm font-medium text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] transition-colors"
                              >
                                <Trash2 className="size-4" />ลบ
                              </button>
                            </div>
                          )}

                          {isSelected && editConfirm && (
                            <div className="mt-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 space-y-2">
                              <p className="text-sm font-semibold text-[var(--status-warning-fg)]">ยืนยันแก้ไขการชำระเงิน?</p>
                              <p className="text-xs text-[var(--status-warning-fg)]">
                                การชำระเงินเดิมจะถูกยกเลิก บิลจะกลับสู่หน้า POS เพื่อชำระใหม่ — ต้องใช้รหัสอนุมัติในขั้นตอนถัดไป
                              </p>
                              {shiftStatus === 'reviewed' && (
                                <div className="flex items-start gap-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-2 text-xs text-[var(--status-danger-fg)]">
                                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                  <span>รอบแคชเชียร์นี้ตรวจสอบแล้ว ไม่สามารถแก้ไขได้</span>
                                </div>
                              )}
                              {shiftStatus === 'closed' && (
                                <div className="flex items-start gap-2 rounded-md border border-[var(--status-orange-border)] bg-[var(--status-orange-bg)] px-2.5 py-2 text-xs text-[var(--status-orange-fg)]">
                                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                  <span>รอบแคชเชียร์ปิดแล้ว — การแก้ไขจะทำให้ยอดรอบนี้ไม่ตรง</span>
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => { setEditConfirm(false); setSelectedMutationPaymentId(null); }}
                                  className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-card disabled:opacity-50"
                                >
                                  ยกเลิก
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setApprovalAction('reopen')}
                                  disabled={shiftStatus === 'reviewed'}
                                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--status-warning-fg)] py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                >
                                  ถัดไป: กรอกรหัสอนุมัติ
                                </button>
                              </div>
                            </div>
                          )}

                          {isSelected && delConfirm && (
                            <div className="mt-2 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3 space-y-2">
                              <p className="text-sm font-semibold text-[var(--status-danger-fg)]">ยืนยันลบประวัติการชำระเงิน?</p>
                              <p className="text-xs text-[var(--status-danger-fg)]">
                                ประวัติการรับเงินครั้งนี้จะถูกลบถาวร และระบบจะปรับสถานะบิลตามยอดคงเหลือ — ต้องใช้รหัสอนุมัติในขั้นตอนถัดไป
                              </p>
                              {shiftStatus === 'reviewed' && (
                                <div className="flex items-start gap-2 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-2 text-xs text-[var(--status-danger-fg)]">
                                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                  <span>รอบแคชเชียร์นี้ตรวจสอบแล้ว ไม่สามารถลบได้</span>
                                </div>
                              )}
                              {shiftStatus === 'closed' && (
                                <div className="flex items-start gap-2 rounded-md border border-[var(--status-orange-border)] bg-[var(--status-orange-bg)] px-2.5 py-2 text-xs text-[var(--status-orange-fg)]">
                                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                  <span>รอบแคชเชียร์ปิดแล้ว — การลบจะทำให้ยอดรอบนี้ไม่ตรง</span>
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => { setDelConfirm(false); setSelectedMutationPaymentId(null); }}
                                  className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-card disabled:opacity-50"
                                >
                                  ยกเลิก
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setApprovalAction('delete')}
                                  disabled={shiftStatus === 'reviewed'}
                                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                                >
                                  ถัดไป: กรอกรหัสอนุมัติ
                                </button>
                              </div>
                            </div>
                          )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Orders */}
            {data.orders.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  รายการอาหาร ({data.orders.flatMap((o) => o.items).length} รายการ)
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {data.orders.flatMap((o) =>
                    o.items.map((item) => (
                      <div key={item.id} className="flex justify-between text-xs text-foreground">
                        <span>
                          {item.menuItem?.name ?? (item as typeof item & { itemName?: string | null }).itemName ?? '-'}
                          {item.notes && <span className="ml-1 text-muted-foreground">({item.notes})</span>}
                          {item.status === 'cancelled' && <span className="ml-1 text-[var(--status-danger-fg)]">[ยกเลิก]</span>}
                        </span>
                        <div className="flex gap-2 shrink-0">
                          <span className="tabular-nums text-muted-foreground">×{item.quantity}</span>
                          {!item.menuItem?.isBuffet && (
                            <span className="tabular-nums text-[var(--status-danger-fg)]">
                              +฿{(Number(item.menuItem?.extraPrice ?? 0) * item.quantity).toLocaleString('th-TH')}
                            </span>
                          )}
                        </div>
                      </div>
                    )),
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>

      {/* Phase 17POS-AUTH-A3 — approval code required for owner-only delete
          and owner/manager reopen of a completed payment. Permission (`can`)
          is already checked server-side before this modal can even be
          reached; the code is a second approval step, not a grant. */}
      <ManagerApprovalModal
        open={approvalAction === 'delete'}
        description="การลบบิลหรือรายการชำระเงินต้องใช้รหัสอนุมัติ"
        contextLines={approvalContextLines('ลบบิล / ลบรายการชำระเงิน')}
        onCancel={() => setApprovalAction(null)}
        onConfirm={handleDelete}
      />
      <ManagerApprovalModal
        open={approvalAction === 'reopen'}
        description="การยกเลิก/แก้ไขบิลที่ชำระแล้วต้องใช้รหัสอนุมัติ"
        contextLines={approvalContextLines('ยกเลิกบิล / แก้ไขการชำระเงิน')}
        onCancel={() => setApprovalAction(null)}
        onConfirm={handleReopen}
      />
    </Dialog>
  );
}
