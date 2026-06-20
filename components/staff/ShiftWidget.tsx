'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Clock, AlertTriangle } from 'lucide-react';
import { getActiveShift, openShift, closeShift, getShiftCashPreview } from '@/lib/actions/shifts';
import type { ShiftCashPreview } from '@/lib/actions/shifts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ShiftWidget() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'open' | 'close' | null>(null);

  // Open-shift form state
  const [openingFloat, setOpeningFloat] = useState('0');
  const [openLoading, setOpenLoading] = useState(false);

  // Close-shift form state
  const [actualCash, setActualCash] = useState('');
  const [diffReason, setDiffReason] = useState('');
  const [closeLoading, setCloseLoading] = useState(false);

  // Close-shift preview state
  const [preview, setPreview] = useState<ShiftCashPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { data: shift, isLoading } = useQuery({
    queryKey: ['active-shift'],
    queryFn: () => getActiveShift().then((r) => (r.ok ? r.data : null)),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['active-shift'] });
  }

  async function handleOpen() {
    setOpenLoading(true);
    const res = await openShift({ openingFloat: Number(openingFloat) || 0 });
    setOpenLoading(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success('เปิดรอบแคชเชียร์แล้ว');
    setModal(null);
    setOpeningFloat('0');
    invalidate();
  }

  async function fetchPreview(id: string) {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    const r = await getShiftCashPreview(id);
    setPreviewLoading(false);
    if (!r.ok) { setPreviewError(r.error); return; }
    setPreview(r.data);
  }

  async function handleClose() {
    if (!shift) return;
    setCloseLoading(true);
    const res = await closeShift({
      shiftId: shift.id,
      actualCash: Number(actualCash) || 0,
      differenceReason: diffReason.trim() || undefined,
    });
    setCloseLoading(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success('ปิดรอบแคชเชียร์แล้ว');
    setModal(null);
    setActualCash('');
    setDiffReason('');
    invalidate();
  }

  if (isLoading) {
    return <div className="mb-4 h-10 rounded-lg bg-muted/50 animate-pulse" />;
  }

  return (
    <>
      {/* ── Shift banner ───────────────────────────────────────────────────── */}
      {shift ? (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-[var(--status-success-fg)]">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="font-medium">รอบเปิด</span>
            <span className="opacity-80">
              {format(new Date(shift.openedAt), 'HH:mm')} · เงินทอนตั้งต้น ฿{Number(shift.openingFloat).toLocaleString('th-TH')}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-[var(--status-success-fg)] hover:bg-[var(--status-success-border)]/30 hover:text-[var(--status-success-fg)]"
            onClick={() => {
              setActualCash('');
              setDiffReason('');
              setPreview(null);
              setPreviewLoading(true);
              setPreviewError(null);
              setModal('close');
              fetchPreview(shift.id);
            }}
          >
            ปิดรอบ
          </Button>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-[var(--status-warning-fg)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>ยังไม่ได้เปิดรอบแคชเชียร์</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-[var(--status-warning-fg)] hover:bg-[var(--status-warning-border)]/30 hover:text-[var(--status-warning-fg)]"
            onClick={() => { setOpeningFloat('0'); setModal('open'); }}
          >
            เปิดรอบ
          </Button>
        </div>
      )}

      {/* ── Open-shift dialog ─────────────────────────────────────────────── */}
      <Dialog open={modal === 'open'} onOpenChange={(next) => { if (!next) setModal(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>เปิดรอบแคชเชียร์</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="shift-opening-float">เงินทอนตั้งต้นในลิ้นชัก (บาท)</Label>
            <Input
              id="shift-opening-float"
              type="number"
              min="0"
              step="0.01"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>ยกเลิก</Button>
            <Button onClick={handleOpen} disabled={openLoading}>
              {openLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'เปิดรอบ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Close-shift dialog ────────────────────────────────────────────── */}
      {shift && (
        <Dialog open={modal === 'close'} onOpenChange={(next) => { if (!next) setModal(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>ปิดรอบแคชเชียร์</DialogTitle>
            </DialogHeader>

            {/* Shift summary */}
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>เวลาเปิดรอบ</span>
                <span>{format(new Date(shift.openedAt), 'HH:mm น.')}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>เงินทอนตั้งต้น</span>
                <span>฿{Number(shift.openingFloat).toLocaleString('th-TH')}</span>
              </div>
            </div>

            {/* Collection preview */}
            {previewLoading && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                กำลังโหลดสรุปยอดรับ…
              </div>
            )}
            {previewError && (
              <div className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning-fg)]">
                โหลดสรุปยอดไม่ได้: {previewError}
              </div>
            )}
            {preview && (
              <div className="rounded-lg bg-muted/50 px-3 py-3 text-sm space-y-1.5">
                <p className="text-xs font-semibold text-foreground">สรุปยอดรับในรอบนี้</p>
                <div className="flex justify-between text-muted-foreground">
                  <span>เงินสดจากยอดขาย</span>
                  <span className="tabular-nums font-medium text-foreground">
                    ฿{preview.cashSales.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {preview.promptpayTotal > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>QR PromptPay</span>
                    <span className="tabular-nums">
                      ฿{preview.promptpayTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {preview.welfareTotal > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>สวัสดิการรัฐรับ</span>
                    <span className="tabular-nums">
                      ฿{preview.welfareTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {preview.legacyTotal > 0 && (
                  <div className="rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1.5 text-xs text-[var(--status-warning-fg)]">
                    มีรายการประวัติ QR+เงินสด ฿{preview.legacyTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ซึ่งไม่สามารถแยกเงินสด/QR ได้
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold text-foreground">
                  <span>เงินสดที่ควรมีในลิ้นชัก</span>
                  <span className="tabular-nums">
                    ฿{preview.expectedCashInDrawer.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  ยอดเงินสดที่ควรมี = เงินตั้งต้น + เงินสดจากยอดขาย
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="shift-actual-cash">เงินสดที่นับได้จริง (บาท)</Label>
                <Input
                  id="shift-actual-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-diff-reason">
                  เหตุผล{' '}
                  <span className="text-xs text-muted-foreground font-normal">(ต้องระบุถ้ายอดไม่ตรง)</span>
                </Label>
                <Input
                  id="shift-diff-reason"
                  type="text"
                  value={diffReason}
                  onChange={(e) => setDiffReason(e.target.value)}
                  placeholder="เช่น ทอนเงินผิด, เงินขาด"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setModal(null)}>ยกเลิก</Button>
              <Button onClick={handleClose} disabled={closeLoading || !actualCash}>
                {closeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ปิดรอบ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
