'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { Plus, Banknote, ChevronRight, FileText, Loader2, CalendarDays } from 'lucide-react';
import { createPayrollCycle } from '@/lib/actions/hr';
import { formatThaiDate, formatThaiShortDate, formatThaiShortDateRange } from '@/lib/date-time';
import { cn } from '@/lib/utils';

type CycleRow = {
  id: string;
  name: string;
  workStartDate: string;
  workEndDate: string;
  payDate: string;
  status: 'draft' | 'finalized' | 'paid';
  paidCount: number;
  totalCount: number;
  totalNet: number;
};

interface Props {
  initialCycles: CycleRow[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'ร่าง',
  finalized: 'อนุมัติแล้ว',
  paid: 'จ่ายแล้ว',
};

type BadgeVariant = 'neutral' | 'info' | 'success';
const STATUS_BADGE: Record<string, BadgeVariant> = {
  draft: 'neutral',
  finalized: 'info',
  paid: 'success',
};

export function PayrollListPage({ initialCycles }: Props) {
  const router = useRouter();
  const [cycles] = useState(initialCycles);
  const [open, setOpen] = useState(false);
  // No manual name — the cycle is identified by its pay date
  const [form, setForm] = useState({ workStartDate: '', workEndDate: '', payDate: '', notes: '' });
  const [pending, startTransition] = useTransition();

  const dateOrderInvalid = Boolean(
    form.workStartDate && form.workEndDate && form.workEndDate < form.workStartDate,
  );
  const workDays = form.workStartDate && form.workEndDate && !dateOrderInvalid
    ? differenceInCalendarDays(parseISO(form.workEndDate), parseISO(form.workStartDate)) + 1
    : 0;
  // The pay date IS the cycle's name (server still requires a name string)
  const generatedName = form.payDate ? `จ่ายวันที่ ${formatThaiShortDate(form.payDate)}` : '';
  const canCreate = Boolean(form.workStartDate && form.workEndDate && form.payDate && !dateOrderInvalid);

  function handleCreate() {
    if (!canCreate) {
      toast.error(dateOrderInvalid ? 'วันสิ้นสุดงานต้องไม่ก่อนวันเริ่มงาน' : 'กรุณาเลือกวันที่ให้ครบ');
      return;
    }
    startTransition(async () => {
      const result = await createPayrollCycle({ ...form, name: generatedName });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('สร้างรอบจ่ายแล้ว');
      setOpen(false);
      setForm({ workStartDate: '', workEndDate: '', payDate: '', notes: '' });
      router.push(`/hr/payroll/${(result.data as { id: string }).id}`);
    });
  }

  function fmtDate(d: string) {
    return formatThaiDate(d, d);
  }

  // Summary stats derived from loaded cycle data
  const draftCount = cycles.filter((c) => c.status === 'draft').length;
  const paidCount = cycles.filter((c) => c.status === 'paid').length;
  const totalNetPaid = cycles
    .filter((c) => c.status === 'paid')
    .reduce((s, c) => s + c.totalNet, 0);

  return (
    <AppShell>
      <PageHeader
        title="เงินเดือน / รอบจ่าย"
        subtitle={`${cycles.length} รอบทั้งหมด — แตะที่รอบเพื่อดูและบันทึกการจ่าย`}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            สร้างรอบจ่ายใหม่
          </Button>
        }
      />

      {/* Summary stats */}
      {cycles.length > 0 && (
        <StatCardGrid cols={3}>
          <StatCard
            label="รอบทั้งหมด"
            value={cycles.length}
            unit="รอบ"
            icon={<FileText className="size-5" />}
            accent="default"
          />
          <StatCard
            label="รอบค้างดำเนินการ"
            value={draftCount}
            unit="รอบ"
            icon={<FileText className="size-5" />}
            accent={draftCount > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="ยอดจ่ายแล้วรวม"
            value={`฿${totalNetPaid.toLocaleString('th-TH', { minimumFractionDigits: 0 })}`}
            subLabel={`${paidCount} รอบที่จ่ายแล้ว`}
            icon={<Banknote className="size-5" />}
            accent="success"
          />
        </StatCardGrid>
      )}

      {/* Payroll runs table */}
      <DataCard noPadding title="รอบการจ่ายเงินเดือน" subtitle={`${cycles.length} รอบ`}>
        {cycles.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title="ยังไม่มีรอบจ่าย"
            description="สร้างรอบจ่ายแรกเพื่อเริ่มคำนวณเงินเดือนพนักงาน"
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                สร้างรอบจ่ายใหม่
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">วันจ่าย</th>
                  <th className="px-4 py-3 text-left font-medium">ช่วงงาน</th>
                  <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">ยอดสุทธิรวม</th>
                  <th className="px-4 py-3 text-center font-medium">จ่ายแล้ว</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cycles.map((c) => {
                  const progress = c.totalCount > 0 ? Math.round((c.paidCount / c.totalCount) * 100) : 0;
                  const allPaid = c.paidCount === c.totalCount && c.totalCount > 0;
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => router.push(`/hr/payroll/${c.id}`)}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-primary-subtle)] text-primary">
                            <CalendarDays className="size-4" />
                          </span>
                          <span className="font-semibold text-foreground whitespace-nowrap">{fmtDate(c.payDate)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                        {fmtDate(c.workStartDate)} – {fmtDate(c.workEndDate)}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <StatusBadge
                          label={STATUS_LABELS[c.status]}
                          variant={STATUS_BADGE[c.status]}
                          dot
                        />
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-foreground">
                        ฿{c.totalNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className={cn(
                              'tabular-nums text-xs font-medium',
                              allPaid ? 'text-[var(--status-success-fg)]' : 'text-muted-foreground',
                            )}
                          >
                            {c.paidCount}/{c.totalCount} คน
                          </span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                allPaid ? 'bg-[var(--status-success-fg)]' : 'bg-primary',
                              )}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>

      {/* Create payroll cycle — centered dialog */}
      <Dialog
        open={open}
        onOpenChange={(o) => { if (!pending) setOpen(o); }}
      >
        <DialogContent
          showCloseButton={!pending}
          className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]"
        >
          <DialogHeader className="shrink-0 border-b border-border bg-muted/30 px-6 py-5 sm:px-7">
            <div className="flex items-start gap-3.5 pr-10">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-[var(--surface-primary-subtle)] text-primary shadow-sm">
                <Banknote className="size-5" />
              </div>
              <div className="min-w-0 pt-0.5">
                <DialogTitle className="text-lg font-semibold">สร้างรอบจ่ายใหม่</DialogTitle>
                <DialogDescription className="mt-1 text-sm">
                  เลือกช่วงวันทำงานและวันจ่ายเงิน — รอบจะใช้วันจ่ายเป็นชื่อโดยอัตโนมัติ
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6 sm:px-7">
            {/* Work range */}
            <section className="space-y-3">
              <p className="text-sm font-semibold text-foreground">ช่วงวันทำงานที่จะคำนวณ</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 rounded-xl border border-border bg-background p-3.5 shadow-sm">
                  <Label className="text-xs font-semibold text-muted-foreground">วันเริ่มงาน</Label>
                  <ThaiDateInput
                    value={form.workStartDate}
                    onValueChange={(workStartDate) => setForm((p) => ({
                      ...p,
                      workStartDate,
                      workEndDate: !workStartDate || (p.workEndDate && p.workEndDate < workStartDate) ? '' : p.workEndDate,
                    }))}
                    className="h-10 bg-card"
                    ariaLabel="เลือกวันเริ่มงาน"
                  />
                </div>
                <div className="space-y-1.5 rounded-xl border border-border bg-background p-3.5 shadow-sm">
                  <Label className="text-xs font-semibold text-muted-foreground">วันสิ้นสุดงาน</Label>
                  <ThaiDateInput
                    value={form.workEndDate}
                    onValueChange={(workEndDate) => setForm((p) => ({ ...p, workEndDate }))}
                    min={form.workStartDate || undefined}
                    disabled={!form.workStartDate}
                    placeholder={form.workStartDate ? 'วว/ดด/พ.ศ.' : 'เลือกวันเริ่มก่อน'}
                    className="h-10 bg-card"
                    ariaLabel="เลือกวันสิ้นสุดงาน"
                  />
                </div>
              </div>
            </section>

            {/* Pay date */}
            <section className="space-y-3">
              <p className="text-sm font-semibold text-foreground">วันจ่ายเงิน</p>
              <div className="space-y-1.5 rounded-xl border border-border bg-background p-3.5 shadow-sm">
                <Label className="text-xs font-semibold text-muted-foreground">วันที่จะจ่ายเงินพนักงาน</Label>
                <ThaiDateInput
                  value={form.payDate}
                  onValueChange={(payDate) => setForm((p) => ({ ...p, payDate }))}
                  min={form.workEndDate || undefined}
                  className="h-10 bg-card"
                  ariaLabel="เลือกวันจ่ายเงิน"
                />
              </div>
            </section>

            {/* Preview */}
            <div
              className={cn(
                'flex min-h-20 items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors',
                generatedName && canCreate
                  ? 'border-primary/20 bg-[var(--surface-primary-subtle)]'
                  : 'border-dashed border-border bg-muted/25',
              )}
            >
              <div className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                generatedName && canCreate ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}>
                <CalendarDays className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">รอบที่จะสร้าง</p>
                <p className={cn('mt-0.5 truncate text-sm font-semibold', generatedName && canCreate ? 'text-foreground' : 'text-muted-foreground')}>
                  {generatedName && canCreate
                    ? `${generatedName} · ช่วงงาน ${formatThaiShortDateRange(form.workStartDate, form.workEndDate, ' – ')}`
                    : 'เลือกช่วงวันทำงานและวันจ่ายเงินให้ครบ'}
                </p>
              </div>
              {workDays > 0 && canCreate && (
                <span className="shrink-0 rounded-lg border border-primary/15 bg-background/80 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-primary">
                  {workDays} วันงาน
                </span>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="payroll-notes" className="text-sm font-semibold">
                หมายเหตุ <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
              </Label>
              <Textarea
                id="payroll-notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="เช่น รอบพิเศษก่อนเทศกาล"
                className="min-h-20 resize-none"
                maxLength={500}
              />
            </div>

            <p className="rounded-xl bg-muted/30 p-3.5 text-xs leading-relaxed text-muted-foreground">
              ระบบจะสร้างรายการเงินเดือนให้พนักงานที่ทำงานอยู่ทุกคนโดยอัตโนมัติ
              พร้อมคำนวณวันทำงานจากตารางงาน และชั่วโมงทำงานจากบันทึกเวลา
            </p>
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t border-border bg-muted/30 px-6 py-4 sm:px-7">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button onClick={handleCreate} disabled={pending || !canCreate} className="min-w-32">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {pending ? 'กำลังสร้าง...' : 'สร้างรอบจ่าย'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
