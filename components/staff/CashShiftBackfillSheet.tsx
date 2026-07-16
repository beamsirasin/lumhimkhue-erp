'use client';

/**
 * Phase 16G-A — owner/manager correction tool: assign same-day cash payment
 * rows that have no shift linkage (reconciliation R7a) into a cashier shift
 * after the fact ("ผูกเข้ารอบย้อนหลัง"). Rendered only for owner/manager on
 * the shifts page — deliberately NOT part of the cashier POS flow.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Banknote, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { formatThaiTime } from '@/lib/date-time';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { getCashBackfillData, assignCashRowsToShift } from '@/lib/actions/shift-backfill';

type BackfillData = Extract<Awaited<ReturnType<typeof getCashBackfillData>>, { ok: true }>['data'];

const SHIFT_STATUS_LABEL: Record<string, string> = {
  open: 'เปิดอยู่',
  closed: 'ปิดแล้ว',
  reviewed: 'ตรวจสอบแล้ว',
};

function baht(n: number): string {
  return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CashShiftBackfillSheet({
  initialDate,
  onAssigned,
}: {
  initialDate: string;
  onAssigned?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<BackfillData | null>(null);
  // loading is derived: data for the current date hasn't arrived yet
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetShiftId, setTargetShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestSeq = useRef(0);

  // setState only inside the .then callback (async continuation) — the effect
  // body itself stays setState-free, as react-hooks/set-state-in-effect requires.
  const load = useCallback((d: string) => {
    const seq = ++requestSeq.current;
    void getCashBackfillData(d).then((result) => {
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      if (!result.ok) {
        toast.error(result.error);
        setData(null);
      } else {
        setData(result.data);
      }
      setSelected(new Set());
      setTargetShiftId('');
      setLoadedKey(d);
    });
  }, []);

  useEffect(() => {
    if (open) load(date);
  }, [open, date, load]);

  const loading = open && loadedKey !== date;

  const rows = data?.rows ?? [];
  const shifts = data?.shifts ?? [];
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0);
  const canSubmit = selected.size > 0 && !!targetShiftId && reason.trim().length > 0 && !submitting;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const result = await assignCashRowsToShift({
      paymentRowIds: [...selected],
      shiftId: targetShiftId,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      // list may be stale (e.g. row assigned elsewhere) — reload either way
      load(date);
      return;
    }
    toast.success(
      `ผูกเงินสด ${result.data.assigned} รายการ (${baht(result.data.totalAmount)}) เข้ารอบแล้ว`,
    );
    setReason('');
    load(date);
    onAssigned?.();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50">
        <Banknote className="size-4" />
        ผูกเงินสดเข้ารอบย้อนหลัง
      </SheetTrigger>
      <SheetContent className="flex w-full max-w-lg flex-col gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>ผูกเงินสดเข้ารอบย้อนหลัง (Late shift assignment)</SheetTitle>
          <SheetDescription>
            รายการนี้ไม่ได้แก้ยอดขายหรือยอดรับชำระ เพียงผูกเงินสดเข้ารอบแคชเชียร์ย้อนหลังเพื่อการปิดรอบ
            — ทุกการผูกถูกบันทึกในประวัติการตรวจสอบพร้อมเหตุผล
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* Business day */}
          <div className="space-y-1.5">
            <label htmlFor="bf-date" className="block text-xs font-semibold text-foreground">
              วันที่ (ตามวันทำการ)
            </label>
            <ThaiDateInput
              value={date}
              max={format(new Date(), 'yyyy-MM-dd')}
              onValueChange={setDate}
              className="w-full"
              ariaLabel="วันที่ตามวันทำการ"
            />
          </div>

          {/* Unlinked cash rows */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">
              เงินสดที่ยังไม่ผูกรอบ {loading ? '' : `(${rows.length} รายการ)`}
            </p>
            {loading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> กำลังโหลด…
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Banknote className="size-5" />}
                title="ไม่มีเงินสดค้างผูกในวันนี้"
                size="sm"
              />
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {rows.map((r) => (
                  <label
                    key={r.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40',
                      selected.has(r.id) && 'bg-[var(--surface-primary-subtle)]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="size-4 shrink-0 accent-[var(--primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {formatThaiTime(r.paidAt)}
                        {r.tableLabel ? ` · โต๊ะ ${r.tableLabel}` : ''}
                        {r.receiptNo ? ` · ${r.receiptNo}` : ''}
                      </p>
                      <p className="text-[11px] text-muted-foreground">payment {r.paymentId.slice(0, 8)}…</p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                      {baht(r.amount)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Target shift */}
          <div className="space-y-1.5">
            <label htmlFor="bf-shift" className="block text-xs font-semibold text-foreground">
              รอบแคชเชียร์ปลายทาง (วันเดียวกันเท่านั้น)
            </label>
            <select
              id="bf-shift"
              value={targetShiftId}
              onChange={(e) => setTargetShiftId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">— เลือกรอบ —</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id} disabled={s.status === 'reviewed'}>
                  {formatThaiTime(s.openedAt)} · {s.cashierName} ·{' '}
                  {SHIFT_STATUS_LABEL[s.status] ?? s.status}
                  {s.status === 'reviewed' ? ' (ผูกไม่ได้)' : ''}
                </option>
              ))}
            </select>
            {shifts.length === 0 && !loading && (
              <p className="text-[11px] text-[var(--status-warning-fg)]">
                วันนี้ไม่มีรอบแคชเชียร์ — เปิด/มีรอบของวันเดียวกันก่อนจึงจะผูกได้
              </p>
            )}
          </div>

          {/* Total + reason */}
          <div className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">รวมเงินสดที่เลือก</p>
            <p className="text-lg font-bold tabular-nums text-foreground">{baht(selectedTotal)}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bf-reason" className="block text-xs font-semibold text-foreground">
              เหตุผล <span className="text-destructive">*</span>
            </label>
            <textarea
              id="bf-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น รับเงินก่อนเปิดรอบตอนเช้า / ลืมเปิดรอบ"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting
              ? 'กำลังผูกเข้ารอบ…'
              : `ยืนยันผูกเข้ารอบ (${selected.size} รายการ · ${baht(selectedTotal)})`}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
