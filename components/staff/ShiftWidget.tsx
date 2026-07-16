'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  LockKeyhole,
  UnlockKeyhole,
  WalletCards,
} from 'lucide-react';
import {
  closeShift,
  closeStoreDay,
  getActiveShift,
  getShiftCashPreview,
  getStoreDayStatus,
  openShift,
  reopenStoreDay,
} from '@/lib/actions/shifts';
import type { ShiftCashPreview } from '@/lib/actions/shifts';
import { ManagerApprovalModal } from '@/components/shared/ManagerApprovalModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatThaiDate, formatThaiTime } from '@/lib/date-time';

function formatBaht(value: number | string): string {
  return `฿${Number(value).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ShiftWidget({ canManageShift }: { canManageShift: boolean }) {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'open' | 'close-shift' | null>(null);
  const [approvalIntent, setApprovalIntent] = useState<'close-day' | 'reopen-day' | null>(null);
  const [openingFloat, setOpeningFloat] = useState('0');
  const [openLoading, setOpenLoading] = useState(false);
  const [actualCash, setActualCash] = useState('');
  const [diffReason, setDiffReason] = useState('');
  const [closeLoading, setCloseLoading] = useState(false);
  const [preview, setPreview] = useState<ShiftCashPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { data: shift, isLoading } = useQuery({
    queryKey: ['active-shift'],
    queryFn: () => getActiveShift().then((result) => (result.ok ? result.data : null)),
    refetchInterval: 30_000,
    staleTime: 20_000,
    enabled: canManageShift,
  });

  const {
    data: dayState,
    isLoading: isDayLoading,
    error: dayStatusError,
  } = useQuery({
    queryKey: ['store-business-day'],
    queryFn: async () => {
      const result = await getStoreDayStatus();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const parsedActualCash = actualCash.trim() === '' ? null : Number(actualCash);
  const liveDifference = preview && parsedActualCash != null && Number.isFinite(parsedActualCash)
    ? Math.round((parsedActualCash - preview.expectedCashInDrawer) * 100) / 100
    : null;
  const requiresReason = liveDifference != null && Math.abs(liveDifference) >= 0.01;
  const storeClosed = dayState?.status === 'closed';

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['active-shift'] });
    void queryClient.invalidateQueries({ queryKey: ['shift-history'] });
    void queryClient.invalidateQueries({ queryKey: ['store-business-day'] });
  }

  async function handleOpen() {
    setOpenLoading(true);
    const result = await openShift({ openingFloat: Number(openingFloat) || 0 });
    setOpenLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('เปิดรอบแคชเชียร์แล้ว');
    setModal(null);
    setOpeningFloat('0');
    invalidate();
  }

  async function fetchPreview(id: string) {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    const result = await getShiftCashPreview(id);
    setPreviewLoading(false);
    if (!result.ok) {
      setPreviewError(result.error);
      return;
    }
    setPreview(result.data);
  }

  function openCloseDialog() {
    if (!shift) return;
    setActualCash('');
    setDiffReason('');
    setPreview(null);
    setPreviewError(null);
    setModal('close-shift');
    void fetchPreview(shift.id);
  }

  async function handleClose() {
    if (!shift) return;
    setCloseLoading(true);
    const result = await closeShift({
      shiftId: shift.id,
      actualCash: Number(actualCash) || 0,
      differenceReason: diffReason.trim() || undefined,
    });
    setCloseLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('ปิดรอบเรียบร้อยแล้ว');
    setModal(null);
    setActualCash('');
    setDiffReason('');
    setPreview(null);
    invalidate();
  }

  async function handleStoreDayApproval({ code, reason }: { code: string; reason: string }) {
    if (!approvalIntent) return { ok: false, error: 'ไม่พบรายการที่ต้องอนุมัติ' };

    const result = approvalIntent === 'close-day'
      ? await closeStoreDay({ approvalCode: code, reason })
      : await reopenStoreDay({ approvalCode: code, reason });

    if (!result.ok) return { ok: false, error: result.error };

    toast.success(approvalIntent === 'close-day'
      ? 'ปิดรอบวันระดับร้านเรียบร้อยแล้ว'
      : 'เปิดวันทำการอีกครั้งเรียบร้อยแล้ว');
    setApprovalIntent(null);
    invalidate();
    return { ok: true };
  }

  if (isLoading || isDayLoading) {
    return (
      <div className="rounded-2xl border border-border bg-[var(--surface-1)] p-5 shadow-[var(--shadow-card)]">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-36 animate-pulse rounded-xl bg-muted/60" />
      </div>
    );
  }

  return (
    <>
      <section
        className={cn(
          'mb-5 rounded-2xl border p-5 shadow-[var(--shadow-card)] sm:p-6',
          storeClosed
            ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]'
            : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]',
        )}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-1)] shadow-[var(--shadow-card)]',
                storeClosed ? 'text-[var(--status-danger-fg)]' : 'text-[var(--status-success-fg)]',
              )}
            >
              <CalendarDays className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-medium text-foreground">สถานะวันทำการระดับร้าน</h2>
                <StatusBadge
                  label={storeClosed ? 'ปิดรอบวันแล้ว' : 'เปิดรับชำระ'}
                  variant={storeClosed ? 'danger' : 'success'}
                  dot
                  size="md"
                />
              </div>
              {dayState && (
                <p className="mt-1 text-sm font-medium text-foreground">
                  วันที่ {formatThaiDate(dayState.businessDate)}
                </p>
              )}
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {storeClosed
                  ? 'หยุดรับชำระใหม่ทุกช่องทางและหยุดเปิดรอบแคชเชียร์ใหม่ทั้งร้าน แต่รอบที่เปิดค้างอยู่ยังตรวจนับและปิดรอบได้'
                  : 'ร้านเปิดรับชำระและเปิดรอบแคชเชียร์ได้ตามปกติ ปิดรอบวันได้ทุกเมื่อโดยใช้รหัสอนุมัติ'}
              </p>
              {dayStatusError && (
                <p className="mt-2 text-xs text-[var(--status-danger-fg)]">
                  โหลดสถานะวันทำการไม่สำเร็จ กรุณาลองใหม่ก่อนรับชำระหรือเปิดรอบ
                </p>
              )}
            </div>
          </div>

          {dayState && !dayStatusError && (
            <Button
              type="button"
              variant={storeClosed ? 'default' : 'destructive'}
              className="min-h-11 w-full shrink-0 px-5 sm:w-auto"
              onClick={() => setApprovalIntent(storeClosed ? 'reopen-day' : 'close-day')}
            >
              {storeClosed ? <UnlockKeyhole className="size-4" /> : <LockKeyhole className="size-4" />}
              {storeClosed ? 'เปิดวันอีกครั้ง' : 'ปิดรอบวัน'}
            </Button>
          )}
        </div>
      </section>

      {canManageShift && (
        <section className="overflow-hidden rounded-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium text-foreground">จัดการรอบปัจจุบัน</h2>
              <StatusBadge
                label={shift ? 'กำลังเปิดรอบ' : 'ยังไม่ได้เปิดรอบ'}
                variant={shift ? 'success' : 'warning'}
                dot
                size="md"
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              รองรับหลายรอบต่อวัน ปิดรอบเพื่อตรวจนับและส่งต่องานให้แคชเชียร์กะถัดไป
            </p>
          </div>
          {shift ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full px-4 sm:w-auto"
              onClick={openCloseDialog}
            >
              <Clock3 className="size-4" />
              ปิดรอบ
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-11 w-full px-5 sm:w-auto"
              disabled={storeClosed || Boolean(dayStatusError)}
              onClick={() => {
                setOpeningFloat('0');
                setModal('open');
              }}
            >
              <WalletCards className="size-4" />
              {storeClosed ? 'ร้านปิดรอบวันแล้ว' : 'เปิดรอบแคชเชียร์'}
            </Button>
          )}
        </div>

        <div className="p-5 sm:p-6">
          {shift ? (
            <div className="rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-1)] text-[var(--status-success-fg)] shadow-[var(--shadow-card)]">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--status-success-fg)]">พร้อมรับชำระเงินสด</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    รอบนี้เปิดอยู่ ระบบกำลังรวมยอดรับของรอบปัจจุบันเพื่อใช้ตรวจนับตอนปิดรอบ
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-[var(--surface-1)] p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="size-4" />
                    เวลาเปิดรอบ
                  </div>
                  <p className="mt-2 text-2xl font-medium tabular-nums text-foreground">
                    {formatThaiTime(shift.openedAt)} น.
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-[var(--surface-1)] p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Banknote className="size-4" />
                    เงินทอนตั้งต้น
                  </div>
                  <p className="mt-2 text-2xl font-medium tabular-nums text-foreground">
                    {formatBaht(shift.openingFloat)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-1)] text-[var(--status-warning-fg)] shadow-[var(--shadow-card)]">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--status-warning-fg)]">ยังไม่พร้อมรับเงินสด</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    ระบุเงินทอนที่มีอยู่จริงในลิ้นชักเพื่อเริ่มรอบ ระบบจะใช้ยอดนี้คำนวณเงินสดที่ควรเหลือตอนปิดรอบ
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-5 min-h-11 w-full border-[var(--status-warning-border)] bg-[var(--surface-1)] sm:w-auto"
                disabled={storeClosed || Boolean(dayStatusError)}
                onClick={() => {
                  setOpeningFloat('0');
                  setModal('open');
                }}
              >
                เริ่มเปิดรอบ
                <ArrowRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
        </section>
      )}

      <Dialog open={modal === 'open'} onOpenChange={(next) => { if (!next) setModal(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pr-8">
            <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-[var(--surface-primary-subtle)] text-primary">
              <WalletCards className="size-5" />
            </div>
            <DialogTitle className="text-lg">เปิดรอบแคชเชียร์</DialogTitle>
            <DialogDescription>
              ตรวจนับเงินในลิ้นชักก่อนเริ่มงาน แล้วบันทึกเป็นเงินทอนตั้งต้นของรอบนี้
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4">
            <Label htmlFor="shift-opening-float" className="text-sm text-foreground">
              เงินทอนตั้งต้นในลิ้นชัก
            </Label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-lg text-muted-foreground">฿</span>
              <Input
                id="shift-opening-float"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={openingFloat}
                onChange={(event) => setOpeningFloat(event.target.value)}
                className="h-14 bg-[var(--surface-1)] pl-10 text-right text-2xl font-medium tabular-nums"
                autoFocus
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              ใส่ 0.00 ได้ หากเริ่มรอบโดยไม่มีเงินทอน
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setModal(null)}>
              ยกเลิก
            </Button>
            <Button className="min-h-11 px-5" onClick={() => void handleOpen()} disabled={openLoading}>
              {openLoading ? <Loader2 className="size-4 animate-spin" /> : <WalletCards className="size-4" />}
              {openLoading ? 'กำลังเปิดรอบ…' : 'ยืนยันเปิดรอบ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shift && (
        <Dialog
          open={modal === 'close-shift'}
          onOpenChange={(next) => { if (!next) setModal(null); }}
        >
          <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader className="pr-8">
              <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-[var(--surface-primary-subtle)] text-primary">
                <Clock3 className="size-5" />
              </div>
              <DialogTitle className="text-lg">ตรวจนับและปิดรอบ</DialogTitle>
              <DialogDescription>
                ตรวจสอบยอดรับและนับเงินสดจริงก่อนส่งต่องานให้แคชเชียร์กะถัดไป
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4">
                <p className="text-xs text-muted-foreground">เวลาเปิดรอบ</p>
                <p className="mt-1 text-lg font-medium tabular-nums text-foreground">
                  {formatThaiTime(shift.openedAt)} น.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4">
                <p className="text-xs text-muted-foreground">เงินทอนตั้งต้น</p>
                <p className="mt-1 text-lg font-medium tabular-nums text-foreground">
                  {formatBaht(shift.openingFloat)}
                </p>
              </div>
            </div>

            {previewLoading && (
              <div className="flex min-h-28 items-center justify-center gap-2 rounded-xl border border-border bg-[var(--surface-2)] text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                กำลังสรุปยอดรับในรอบ…
              </div>
            )}

            {previewError && (
              <div className="rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-4 text-sm text-[var(--status-warning-fg)]">
                โหลดสรุปยอดไม่ได้: {previewError}
              </div>
            )}

            {preview && (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="border-b border-border bg-[var(--surface-2)] px-4 py-3">
                  <p className="text-sm font-medium text-foreground">สรุปยอดรับในรอบนี้</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{preview.rowCount.toLocaleString('th-TH')} รายการรับเงิน</p>
                </div>
                <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                  <div className="space-y-2 p-4 text-sm">
                    <div className="flex justify-between gap-4 text-muted-foreground">
                      <span>เงินสดจากยอดขาย</span>
                      <span className="font-medium tabular-nums text-foreground">{formatBaht(preview.cashSales)}</span>
                    </div>
                    <div className="flex justify-between gap-4 text-muted-foreground">
                      <span>QR PromptPay</span>
                      <span className="tabular-nums text-foreground">{formatBaht(preview.promptpayTotal)}</span>
                    </div>
                    {preview.welfareTotal > 0 && (
                      <div className="flex justify-between gap-4 text-muted-foreground">
                        <span>สวัสดิการรัฐรับ</span>
                        <span className="tabular-nums text-foreground">{formatBaht(preview.welfareTotal)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col justify-center bg-[var(--surface-primary-subtle)] p-4">
                    <p className="text-xs text-muted-foreground">เงินสดที่ควรมีในลิ้นชัก</p>
                    <p className="mt-1 text-3xl font-medium tabular-nums text-foreground">
                      {formatBaht(preview.expectedCashInDrawer)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">เงินตั้งต้น + เงินสดจากยอดขาย</p>
                  </div>
                </div>
                {preview.legacyTotal > 0 && (
                  <div className="border-t border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-xs text-[var(--status-warning-fg)]">
                    มีรายการประวัติ QR+เงินสด {formatBaht(preview.legacyTotal)} ซึ่งไม่สามารถแยกเงินสดและ QR ได้
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4 sm:p-5">
              <Label htmlFor="shift-actual-cash" className="text-sm text-foreground">
                เงินสดที่นับได้จริง
              </Label>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-lg text-muted-foreground">฿</span>
                <Input
                  id="shift-actual-cash"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={actualCash}
                  onChange={(event) => setActualCash(event.target.value)}
                  placeholder="0.00"
                  className="h-14 bg-[var(--surface-1)] pl-10 text-right text-2xl font-medium tabular-nums"
                  autoFocus
                />
              </div>

              {liveDifference != null && (
                <div
                  className={cn(
                    'mt-3 flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm',
                    Math.abs(liveDifference) < 0.01
                      ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                      : 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
                  )}
                >
                  <span>{Math.abs(liveDifference) < 0.01 ? 'ยอดตรงกับระบบ' : 'ส่วนต่างจากระบบ'}</span>
                  <span className="font-medium tabular-nums">
                    {liveDifference > 0 ? '+' : ''}{formatBaht(liveDifference)}
                  </span>
                </div>
              )}

              <div className="mt-4 space-y-1.5">
                <Label htmlFor="shift-diff-reason" className="text-sm text-foreground">
                  เหตุผลส่วนต่าง
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {requiresReason ? '(จำเป็น)' : '(กรอกเมื่อยอดไม่ตรง)'}
                  </span>
                </Label>
                <Input
                  id="shift-diff-reason"
                  type="text"
                  value={diffReason}
                  onChange={(event) => setDiffReason(event.target.value)}
                  placeholder="เช่น ทอนเงินผิด หรือเงินขาด"
                  className="min-h-11 bg-[var(--surface-1)]"
                  aria-required={requiresReason}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-xs leading-relaxed text-[var(--status-warning-fg)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              หลังปิดรอบ ให้แคชเชียร์กะถัดไปเปิดรอบใหม่ก่อนเริ่มรับเงินสด
            </div>

            <DialogFooter>
              <Button variant="outline" className="min-h-11" onClick={() => setModal(null)}>
                ย้อนกลับ
              </Button>
              <Button
                className="min-h-11 px-5"
                onClick={() => void handleClose()}
                disabled={closeLoading || actualCash.trim() === '' || (requiresReason && diffReason.trim() === '')}
              >
                {closeLoading
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Clock3 className="size-4" />}
                {closeLoading ? 'กำลังปิดรอบ…' : 'ยืนยันปิดรอบ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ManagerApprovalModal
        open={approvalIntent !== null}
        description={approvalIntent === 'close-day'
          ? 'การปิดรอบวันจะหยุดรับชำระใหม่และหยุดเปิดรอบแคชเชียร์ใหม่ทั้งร้านทันที'
          : 'การเปิดวันอีกครั้งจะอนุญาตให้รับชำระและเปิดรอบแคชเชียร์ใหม่ในวันเดียวกัน'}
        contextLines={[
          `วันทำการ: ${dayState ? formatThaiDate(dayState.businessDate) : '-'}`,
          approvalIntent === 'close-day'
            ? `สถานะปัจจุบัน: เปิดรับชำระ${shift ? ' · มีรอบแคชเชียร์เปิดค้างอยู่' : ''}`
            : 'สถานะปัจจุบัน: ปิดรอบวันแล้ว',
        ]}
        reasonRequired
        confirmLabel={approvalIntent === 'close-day' ? 'อนุมัติปิดรอบวัน' : 'อนุมัติเปิดวันอีกครั้ง'}
        reasonPlaceholder={approvalIntent === 'close-day'
          ? 'ระบุเหตุผลที่ปิดรอบวัน'
          : 'ระบุเหตุผลที่เปิดวันทำการอีกครั้ง'}
        onCancel={() => setApprovalIntent(null)}
        onConfirm={handleStoreDayApproval}
      />
    </>
  );
}
