'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { ChevronLeft, Trash2, Printer, CheckCircle2, Users, Banknote, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  addDeduction,
  removeDeduction,
  addAbsence,
  removeAbsence,
  markAsPaid,
  finalizePayrollCycle,
} from '@/lib/actions/hr';
import { useRouter } from 'next/navigation';
import type { PayrollCycle, PayrollItem, PayrollDeduction, PayrollAbsence, Employee, HrSettings } from '@/lib/db/schema';

type EnrichedItem = PayrollItem & {
  employee?: Employee;
  deductions: PayrollDeduction[];
  absences: PayrollAbsence[];
};

type Detail = {
  cycle: PayrollCycle;
  items: EnrichedItem[];
};

interface Props {
  detail: Detail;
  settings: HrSettings;
}

function fmtMoney(n: number | string) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00'), 'd MMM yy', { locale: th }); }
  catch { return d; }
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

// ── Payslip print ─────────────────────────────────────────────────────────────

function PayslipContent({ item, cycle, settings }: { item: EnrichedItem; cycle: PayrollCycle; settings: HrSettings }) {
  const emp = item.employee;
  return (
    <div className="payslip-print text-sm space-y-3">
      <div className="text-center font-bold text-base mb-1">ใบจ่ายเงินเดือน</div>
      <div className="text-center text-xs text-muted-foreground mb-3">งวด: {cycle.name}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
        <span className="text-muted-foreground">ชื่อ-สกุล:</span>
        <span className="font-medium">{emp?.firstName} {emp?.lastName}</span>
        <span className="text-muted-foreground">ประเภท:</span>
        <span>{item.employeeType === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'}</span>
        <span className="text-muted-foreground">ธนาคาร:</span>
        <span>{emp?.bankName ?? '-'} {emp?.bankAccountNumber ? `(${emp.bankAccountNumber})` : ''}</span>
      </div>
      <Separator />
      <div className="space-y-1 text-xs">
        <p className="font-semibold text-foreground">รายได้</p>
        {item.employeeType === 'full_time' ? (
          <>
            <div className="flex justify-between"><span>เงินเดือนฐาน</span><span className="tabular-nums">฿{fmtMoney(item.baseSalary)}</span></div>
            <div className="flex justify-between"><span>Incentive ({item.workDays} วัน × ฿{fmtMoney(item.incentivePerDay)})</span><span className="tabular-nums">฿{fmtMoney(item.incentiveTotal)}</span></div>
          </>
        ) : (
          <div className="flex justify-between"><span>ชั่วโมง ({Number(item.totalHours).toFixed(2)} ชม. × ฿{fmtMoney(item.hourlyRate)})</span><span className="tabular-nums">฿{fmtMoney(item.hourlyTotal)}</span></div>
        )}
        <div className="flex justify-between font-semibold border-t pt-1"><span>รวมรายได้</span><span className="tabular-nums">฿{fmtMoney(item.gross)}</span></div>
      </div>
      {Number(item.totalDeduction) > 0 && (
        <>
          <Separator />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-foreground">หัก</p>
            {item.deductions.filter((d) => d.type === 'advance').map((d) => (
              <div key={d.id} className="flex justify-between text-[var(--status-danger-fg)]">
                <span>เบิก: {d.reason}</span><span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
              </div>
            ))}
            {item.deductions.filter((d) => d.type === 'damage').map((d) => (
              <div key={d.id} className="flex justify-between text-[var(--status-danger-fg)]">
                <span>เสียหาย: {d.reason}</span><span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
              </div>
            ))}
            {Number(item.absenceDeduction) > 0 && (
              <div className="flex justify-between text-[var(--status-danger-fg)]">
                <span>ขาด {item.absenceDays} วัน × ฿{fmtMoney(settings.absenceRatePerDay)}</span>
                <span className="tabular-nums">-฿{fmtMoney(item.absenceDeduction)}</span>
              </div>
            )}
            {Number(item.lateDeduction) > 0 && (
              <div className="flex justify-between text-[var(--status-danger-fg)]">
                <span>สาย {item.lateMinutes} นาที × ฿{fmtMoney(settings.lateRatePerMinute)}</span>
                <span className="tabular-nums">-฿{fmtMoney(item.lateDeduction)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t pt-1 text-[var(--status-danger-fg)]">
              <span>รวมหัก</span><span className="tabular-nums">-฿{fmtMoney(item.totalDeduction)}</span>
            </div>
          </div>
        </>
      )}
      <Separator />
      <div className="flex justify-between font-bold text-base">
        <span>เงินสุทธิ</span>
        <span className="tabular-nums text-foreground">฿{fmtMoney(item.netPay)}</span>
      </div>
      {item.isPaid && (
        <p className="text-xs text-[var(--status-success-fg)] text-center">
          จ่ายแล้ว ({item.paidMethod === 'cash' ? 'เงินสด' : 'โอน'}) เมื่อ{' '}
          {item.paidAt ? format(new Date(item.paidAt), 'd MMM yy HH:mm', { locale: th }) : '-'}
        </p>
      )}
    </div>
  );
}

// ── Item detail panel ─────────────────────────────────────────────────────────

function ItemPanel({ item, cycle, onRefresh, cycleStatus, settings }: {
  item: EnrichedItem;
  cycle: PayrollCycle;
  onRefresh: () => void;
  cycleStatus: string;
  settings: HrSettings;
}) {
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<'advance' | 'damage' | 'absence' | 'late'>('advance');
  const [addForm, setAddForm] = useState({ amount: '', reason: '', occurredDate: '', lateMinutes: '', notes: '' });
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ paidMethod: 'cash' as 'cash' | 'transfer', proofFile: '' });
  const [printSlip, setPrintSlip] = useState(false);

  const emp = item.employee;
  const locked = cycleStatus === 'finalized' || cycleStatus === 'paid';

  function openAdd(type: 'advance' | 'damage' | 'absence' | 'late') {
    setAddType(type);
    setAddForm({ amount: '', reason: '', occurredDate: '', lateMinutes: '', notes: '' });
    setAddOpen(true);
  }

  function submitAdd() {
    startTransition(async () => {
      let result;
      if (addType === 'advance' || addType === 'damage') {
        result = await addDeduction({
          payrollItemId: item.id,
          type: addType,
          amount: Number(addForm.amount),
          reason: addForm.reason,
          occurredDate: addForm.occurredDate || null,
        });
      } else {
        result = await addAbsence({
          payrollItemId: item.id,
          type: addType === 'absence' ? 'absence' : 'late',
          occurredDate: addForm.occurredDate,
          lateMinutes: addType === 'late' ? Number(addForm.lateMinutes) : null,
          notes: addForm.notes || null,
        });
      }
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('เพิ่มรายการแล้ว');
      setAddOpen(false);
      onRefresh();
    });
  }

  function deleteDeduction(id: string) {
    startTransition(async () => {
      const result = await removeDeduction(id);
      if (!result.ok) { toast.error(result.error); return; }
      onRefresh();
    });
  }

  function deleteAbsence(id: string) {
    startTransition(async () => {
      const result = await removeAbsence(id);
      if (!result.ok) { toast.error(result.error); return; }
      onRefresh();
    });
  }

  function submitPay() {
    startTransition(async () => {
      const result = await markAsPaid({
        payrollItemId: item.id,
        paidMethod: payForm.paidMethod,
        paymentProofUrl: payForm.proofFile || null,
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('บันทึกการจ่ายแล้ว');
      setPayOpen(false);
      onRefresh();
    });
  }

  function handleProofUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPayForm((p) => ({ ...p, proofFile: ev.target?.result as string ?? '' }));
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-5">
      {/* รายได้ */}
      <div className="space-y-1.5 text-sm">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">รายได้</p>
        {item.employeeType === 'full_time' ? (
          <>
            <div className="flex justify-between">
              <span>เงินเดือนฐาน</span>
              <span className="tabular-nums font-medium">฿{fmtMoney(item.baseSalary)}</span>
            </div>
            <div className="flex justify-between">
              <span>Incentive ({item.workDays} วัน × ฿{fmtMoney(item.incentivePerDay)})</span>
              <span className="tabular-nums font-medium">฿{fmtMoney(item.incentiveTotal)}</span>
            </div>
          </>
        ) : (
          <div className="flex justify-between">
            <span>ชั่วโมง ({Number(item.totalHours).toFixed(2)} ชม. × ฿{fmtMoney(item.hourlyRate)})</span>
            <span className="tabular-nums font-medium">฿{fmtMoney(item.hourlyTotal)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t border-border pt-2">
          <span>รวมรายได้</span>
          <span className="tabular-nums">฿{fmtMoney(item.gross)}</span>
        </div>
      </div>

      <Separator />

      {/* หักเงิน */}
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">หักเงิน</p>
          {!locked && (
            <div className="flex gap-1 text-xs">
              <button onClick={() => openAdd('advance')} className="text-primary hover:underline">+เบิก</button>
              <span className="text-muted-foreground/60">|</span>
              <button onClick={() => openAdd('damage')} className="text-primary hover:underline">+เสียหาย</button>
              <span className="text-muted-foreground/60">|</span>
              <button onClick={() => openAdd('absence')} className="text-primary hover:underline">+ขาด</button>
              <span className="text-muted-foreground/60">|</span>
              <button onClick={() => openAdd('late')} className="text-primary hover:underline">+สาย</button>
            </div>
          )}
        </div>

        {item.deductions.filter((d) => d.type === 'advance').map((d) => (
          <div key={d.id} className="flex justify-between text-[var(--status-danger-fg)]">
            <span className="flex items-center gap-1">
              เบิก: {d.reason}
              {!locked && (
                <button onClick={() => deleteDeduction(d.id)} className="opacity-60 hover:opacity-100">
                  <Trash2 className="size-3" />
                </button>
              )}
            </span>
            <span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
          </div>
        ))}
        {item.deductions.filter((d) => d.type === 'damage').map((d) => (
          <div key={d.id} className="flex justify-between text-[var(--status-danger-fg)]">
            <span className="flex items-center gap-1">
              เสียหาย: {d.reason}
              {!locked && (
                <button onClick={() => deleteDeduction(d.id)} className="opacity-60 hover:opacity-100">
                  <Trash2 className="size-3" />
                </button>
              )}
            </span>
            <span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
          </div>
        ))}
        {item.absences.filter((a) => a.type === 'absence').map((a) => (
          <div key={a.id} className="flex justify-between text-[var(--status-danger-fg)]">
            <span className="flex items-center gap-1">
              ขาด: {a.occurredDate}
              {!locked && (
                <button onClick={() => deleteAbsence(a.id)} className="opacity-60 hover:opacity-100">
                  <Trash2 className="size-3" />
                </button>
              )}
            </span>
            <span className="tabular-nums">-฿{fmtMoney(settings?.absenceRatePerDay ?? 0)}</span>
          </div>
        ))}
        {item.absences.filter((a) => a.type === 'late').map((a) => (
          <div key={a.id} className="flex justify-between text-[var(--status-danger-fg)]">
            <span className="flex items-center gap-1">
              สาย {a.lateMinutes} นาที ({a.occurredDate})
              {!locked && (
                <button onClick={() => deleteAbsence(a.id)} className="opacity-60 hover:opacity-100">
                  <Trash2 className="size-3" />
                </button>
              )}
            </span>
            <span className="tabular-nums">-฿{fmtMoney(Number(a.lateMinutes ?? 0) * Number(settings?.lateRatePerMinute ?? 0))}</span>
          </div>
        ))}

        {Number(item.totalDeduction) > 0 ? (
          <div className="flex justify-between font-semibold text-[var(--status-danger-fg)] border-t border-border pt-2">
            <span>รวมหัก</span>
            <span className="tabular-nums">-฿{fmtMoney(item.totalDeduction)}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">ไม่มีรายการหัก</p>
        )}
      </div>

      <Separator />

      {/* สุทธิ */}
      <div className="flex justify-between font-bold text-lg">
        <span>เงินสุทธิ</span>
        <span className="tabular-nums text-foreground">฿{fmtMoney(item.netPay)}</span>
      </div>

      {/* Payment status */}
      {item.isPaid ? (
        <div className="rounded-lg bg-[var(--status-success-bg)] border border-[var(--status-success-border)] px-4 py-3 text-xs text-[var(--status-success-fg)] space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="size-4" /> จ่ายแล้ว
          </div>
          <p>วิธี: {item.paidMethod === 'cash' ? 'เงินสด' : 'โอน'}</p>
          {item.paidAt && <p>เมื่อ: {format(new Date(item.paidAt), 'd MMM yy HH:mm', { locale: th })}</p>}
          {item.paymentProofUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.paymentProofUrl} alt="สลิป" className="max-h-32 rounded mt-1" />
          )}
        </div>
      ) : (
        !locked && (
          <Button size="sm" className="w-full" onClick={() => setPayOpen(true)}>
            บันทึกการจ่าย
          </Button>
        )
      )}

      <Button variant="outline" size="sm" className="w-full" onClick={() => setPrintSlip(true)}>
        <Printer className="size-4 mr-1.5" />
        พิมพ์สลิป
      </Button>

      {/* Add deduction / absence Sheet */}
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="right" showCloseButton={false} className="flex flex-col gap-0 p-0 sm:max-w-[380px]">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-base font-semibold text-foreground">
                {addType === 'advance' ? 'เพิ่มรายการเบิก' : addType === 'damage' ? 'เพิ่มรายการเสียหาย' : addType === 'absence' ? 'บันทึกขาด' : 'บันทึกสาย'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{emp?.firstName} {emp?.lastName}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="ปิด" onClick={() => setAddOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {(addType === 'advance' || addType === 'damage') && (
              <>
                <div className="space-y-1.5">
                  <Label>จำนวนเงิน (฿) *</Label>
                  <Input type="number" min="0" step="0.01" value={addForm.amount} onChange={(e) => setAddForm((p) => ({ ...p, amount: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>เหตุผล *</Label>
                  <Input value={addForm.reason} onChange={(e) => setAddForm((p) => ({ ...p, reason: e.target.value }))} placeholder="เช่น เบิกล่วงหน้า / แก้วแตก 3 ใบ" />
                </div>
                <div className="space-y-1.5">
                  <Label>วันที่เกิด</Label>
                  <Input type="date" value={addForm.occurredDate} onChange={(e) => setAddForm((p) => ({ ...p, occurredDate: e.target.value }))} />
                </div>
              </>
            )}
            {addType === 'absence' && (
              <div className="space-y-1.5">
                <Label>วันที่ขาด *</Label>
                <Input type="date" value={addForm.occurredDate} onChange={(e) => setAddForm((p) => ({ ...p, occurredDate: e.target.value }))} />
              </div>
            )}
            {addType === 'late' && (
              <>
                <div className="space-y-1.5">
                  <Label>วันที่สาย *</Label>
                  <Input type="date" value={addForm.occurredDate} onChange={(e) => setAddForm((p) => ({ ...p, occurredDate: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>นาทีสาย *</Label>
                  <Input type="number" min="1" value={addForm.lateMinutes} onChange={(e) => setAddForm((p) => ({ ...p, lateMinutes: e.target.value }))} />
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitAdd} disabled={pending}>บันทึก</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mark as paid Sheet */}
      <Sheet open={payOpen} onOpenChange={setPayOpen}>
        <SheetContent side="right" showCloseButton={false} className="flex flex-col gap-0 p-0 sm:max-w-[380px]">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-base font-semibold text-foreground">บันทึกการจ่ายเงินเดือน</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {emp?.firstName} {emp?.lastName} — <strong>฿{fmtMoney(item.netPay)}</strong>
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="ปิด" onClick={() => setPayOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label>วิธีจ่าย</Label>
              <Select value={payForm.paidMethod} onValueChange={(v) => { if (v) setPayForm((p) => ({ ...p, paidMethod: v as 'cash' | 'transfer' })); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">เงินสด</SelectItem>
                  <SelectItem value="transfer">โอน</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>รูปสลิป / หลักฐาน (ถ้ามี)</Label>
              <Input type="file" accept="image/*" onChange={handleProofUpload} />
              {payForm.proofFile && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={payForm.proofFile} alt="preview" className="max-h-24 rounded border" />
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setPayOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitPay} disabled={pending}>ยืนยันจ่าย</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Payslip print dialog */}
      <Dialog open={printSlip} onOpenChange={setPrintSlip}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>สลิปเงินเดือน</DialogTitle>
          </DialogHeader>
          <PayslipContent item={item} cycle={cycle} settings={settings} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintSlip(false)}>ปิด</Button>
            <Button onClick={() => window.print()}><Printer className="size-4 mr-1.5" />พิมพ์</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PayrollDetailPage({ detail: initialDetail, settings }: Props) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(detail.items[0]?.id ?? null);
  const [pending, startTransition] = useTransition();

  const selectedItem = detail.items.find((i) => i.id === selectedItemId);
  const paidCount = detail.items.filter((i) => i.isPaid).length;
  const totalNet = detail.items.reduce((s, i) => s + Number(i.netPay), 0);

  void setDetail;

  function refresh() {
    router.refresh();
  }

  function handleFinalize() {
    startTransition(async () => {
      const result = await finalizePayrollCycle(detail.cycle.id);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('อนุมัติรอบจ่ายแล้ว');
      router.refresh();
    });
  }

  return (
    <AppShell>
      {/* Back navigation */}
      <div>
        <Link
          href="/hr/payroll"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          รอบทั้งหมด
        </Link>
      </div>

      <PageHeader
        title={detail.cycle.name}
        subtitle={`ช่วงงาน ${fmtDate(detail.cycle.workStartDate)} – ${fmtDate(detail.cycle.workEndDate)} · วันจ่าย ${fmtDate(detail.cycle.payDate)}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={STATUS_LABELS[detail.cycle.status] ?? detail.cycle.status}
              variant={STATUS_BADGE[detail.cycle.status] ?? 'neutral'}
              dot
            />
            {detail.cycle.status === 'draft' && (
              <Button variant="outline" size="sm" onClick={handleFinalize} disabled={pending}>
                อนุมัติรอบนี้
              </Button>
            )}
          </div>
        }
      />

      {/* Summary stats */}
      {detail.items.length > 0 && (
        <StatCardGrid cols={3}>
          <StatCard
            label="พนักงานทั้งหมด"
            value={detail.items.length}
            unit="คน"
            icon={<Users className="size-5" />}
            accent="default"
          />
          <StatCard
            label="จ่ายแล้ว"
            value={paidCount}
            unit={`จาก ${detail.items.length} คน`}
            icon={<CheckCircle2 className="size-5" />}
            accent={paidCount === detail.items.length ? 'success' : paidCount > 0 ? 'info' : 'default'}
          />
          <StatCard
            label="รวมสุทธิทั้งหมด"
            value={`฿${totalNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`}
            icon={<Banknote className="size-5" />}
            accent="success"
          />
        </StatCardGrid>
      )}

      {/* Master-detail layout */}
      <div className="flex gap-6">
        {/* Left: employee list */}
        <div className="w-72 shrink-0">
          <DataCard noPadding title="พนักงาน" subtitle={`${detail.items.length} คน`}>
            {detail.items.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="ไม่มีข้อมูลพนักงาน"
                description="ยังไม่มี payroll item ในรอบนี้"
                size="sm"
              />
            ) : (
              detail.items.map((item) => {
                const emp = item.employee;
                const isSelected = item.id === selectedItemId;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 border-t border-border transition-colors',
                      isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/30',
                    )}
                  >
                    <div className={cn('text-sm font-medium', isSelected ? 'text-primary-foreground' : 'text-foreground')}>
                      {emp?.firstName} {emp?.lastName}
                    </div>
                    <div className={cn('text-xs flex items-center justify-between mt-0.5', isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                      <span>฿{fmtMoney(item.netPay)}</span>
                      {item.isPaid && (
                        <CheckCircle2 className={cn('size-3', isSelected ? 'text-primary-foreground/70' : 'text-[var(--status-success-fg)]')} />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </DataCard>
        </div>

        {/* Right: item detail */}
        <div className="flex-1 min-w-0">
          {selectedItem ? (
            <DataCard
              title={`${selectedItem.employee?.firstName ?? ''} ${selectedItem.employee?.lastName ?? ''}`}
              subtitle={selectedItem.employeeType === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'}
              actions={
                <StatusBadge
                  label={selectedItem.isPaid ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}
                  variant={selectedItem.isPaid ? 'success' : 'neutral'}
                  dot
                />
              }
            >
              <ItemPanel
                item={selectedItem}
                cycle={detail.cycle}
                onRefresh={refresh}
                cycleStatus={detail.cycle.status}
                settings={settings}
              />
            </DataCard>
          ) : (
            <div className="rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] flex items-center justify-center min-h-[300px]">
              <EmptyState
                icon={<Users className="size-5" />}
                title="เลือกพนักงาน"
                description="เลือกพนักงานจากรายชื่อด้านซ้ายเพื่อดูรายละเอียด"
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
