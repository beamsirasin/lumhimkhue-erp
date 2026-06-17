'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Clock, AlertTriangle } from 'lucide-react';
import { getActiveShift, openShift, closeShift, getShiftCashPreview } from '@/lib/actions/shifts';
import type { ShiftCashPreview } from '@/lib/actions/shifts';

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
        <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-200">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="font-medium">รอบเปิด</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              {format(new Date(shift.openedAt), 'HH:mm')} · เงินทอนตั้งต้น ฿{Number(shift.openingFloat).toLocaleString('th-TH')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActualCash('');
              setDiffReason('');
              setPreview(null);
              setPreviewLoading(true);
              setPreviewError(null);
              setModal('close');
              fetchPreview(shift.id);
            }}
            className="rounded-md px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
          >
            ปิดรอบ
          </button>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>ยังไม่ได้เปิดรอบแคชเชียร์</span>
          </div>
          <button
            type="button"
            onClick={() => { setOpeningFloat('0'); setModal('open'); }}
            className="rounded-md px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50 transition-colors"
          >
            เปิดรอบ
          </button>
        </div>
      )}

      {/* ── Open-shift modal ───────────────────────────────────────────────── */}
      {modal === 'open' && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-foreground">เปิดรอบแคชเชียร์</p>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">เงินทอนตั้งต้นในลิ้นชัก (บาท)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleOpen}
                disabled={openLoading}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
              >
                {openLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'เปิดรอบ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Close-shift modal ──────────────────────────────────────────────── */}
      {modal === 'close' && shift && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-foreground">ปิดรอบแคชเชียร์</p>
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
            {/* ── Collection preview ───────────────────────────────── */}
            {previewLoading && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                กำลังโหลดสรุปยอดรับ…
              </div>
            )}
            {previewError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
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
                  <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
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

            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">เงินสดที่นับได้จริง (บาท)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">
                เหตุผล <span className="text-xs text-muted-foreground/70">(ต้องระบุถ้ายอดไม่ตรง)</span>
              </label>
              <input
                type="text"
                value={diffReason}
                onChange={(e) => setDiffReason(e.target.value)}
                placeholder="เช่น ทอนเงินผิด, เงินขาด"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={closeLoading || !actualCash}
                className="flex-1 rounded-xl bg-slate-800 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60 transition-colors"
              >
                {closeLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'ปิดรอบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
