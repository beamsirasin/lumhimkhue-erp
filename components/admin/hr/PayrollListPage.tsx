'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { Plus, Banknote, ChevronRight, X, FileText } from 'lucide-react';
import { createPayrollCycle } from '@/lib/actions/hr';
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
  const [cycles, setCycles] = useState(initialCycles);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', workStartDate: '', workEndDate: '', payDate: '', notes: '' });
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const result = await createPayrollCycle(form);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('สร้างรอบจ่ายแล้ว');
      setOpen(false);
      router.push(`/hr/payroll/${(result.data as { id: string }).id}`);
    });
  }

  function fmtDate(d: string) {
    try { return format(new Date(d + 'T00:00'), 'd MMM yy', { locale: th }); } catch { return d; }
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
        subtitle={`${cycles.length} รอบทั้งหมด`}
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
                  <th className="px-4 py-3 text-left font-medium">ชื่องวด</th>
                  <th className="px-4 py-3 text-left font-medium">ช่วงงาน</th>
                  <th className="px-4 py-3 text-left font-medium">วันจ่าย</th>
                  <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">ยอดสุทธิรวม</th>
                  <th className="px-4 py-3 text-center font-medium">จ่ายแล้ว</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cycles.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => router.push(`/hr/payroll/${c.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {fmtDate(c.workStartDate)} – {fmtDate(c.workEndDate)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(c.payDate)}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge
                        label={STATUS_LABELS[c.status]}
                        variant={STATUS_BADGE[c.status]}
                        dot
                      />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                      ฿{c.totalNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      <span
                        className={cn(
                          'tabular-nums font-medium',
                          c.paidCount === c.totalCount && c.totalCount > 0
                            ? 'text-[var(--status-success-fg)]'
                            : 'text-muted-foreground',
                        )}
                      >
                        {c.paidCount}/{c.totalCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>

      {/* Create payroll cycle Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex flex-col gap-0 p-0 sm:max-w-[440px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-base font-semibold text-foreground">สร้างรอบจ่ายใหม่</p>
              <p className="text-xs text-muted-foreground mt-0.5">กำหนดชื่อและช่วงเวลาของรอบ</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="ปิด"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label>ชื่องวด *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="เช่น งวด 1-14 มิ.ย. 69"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>วันเริ่มงาน *</Label>
                <Input
                  type="date"
                  value={form.workStartDate}
                  onChange={(e) => setForm((p) => ({ ...p, workStartDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>วันสิ้นสุดงาน *</Label>
                <Input
                  type="date"
                  value={form.workEndDate}
                  onChange={(e) => setForm((p) => ({ ...p, workEndDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>วันจ่ายเงิน *</Label>
              <Input
                type="date"
                value={form.payDate}
                onChange={(e) => setForm((p) => ({ ...p, payDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>หมายเหตุ</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="ถ้ามี"
              />
            </div>
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
              ระบบจะสร้าง payroll item ให้พนักงาน active ทุกคนอัตโนมัติ
              พร้อมคำนวณวันทำงานจากตารางงานและชั่วโมงจาก time entries
            </p>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? 'กำลังสร้าง...' : 'สร้างรอบ'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
