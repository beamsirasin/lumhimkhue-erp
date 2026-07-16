'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { ChevronLeft, Trash2, Printer, CheckCircle2, Users, Banknote, Plus, BadgeCheck, Undo2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime, formatThaiShortDate } from '@/lib/date-time';
import {
  addDeduction,
  removeDeduction,
  addAbsence,
  removeAbsence,
  markAsPaid,
  finalizePayrollCycle,
  unfinalizePayrollCycle,
  updatePayrollItemEarnings,
  deletePayrollCycle,
} from '@/lib/actions/hr';
import { printPayslip, paidChannelLabel } from '@/lib/hr/payslip-print';
import { deptLabelOf } from '@/lib/hr/departments';
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
  return formatThaiDate(d, d);
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

const PAID_METHOD_LABELS: Record<string, string> = {
  cash: 'เงินสด',
  transfer: 'โอน',
  mixed: 'เงินสด+โอน',
};

/**
 * Compress a proof image client-side before it travels as a base64 data-URL
 * through a Server Action. Next.js caps the action body at ~1MB, so large
 * camera photos must be resized/re-encoded — target ≤ ~450KB per image so
 * two images plus the rest of the payload stay under the limit.
 */
async function compressImageFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('ไฟล์รูปไม่ถูกต้อง'));
    image.src = dataUrl;
  });

  const render = (maxSide: number, quality: number): string => {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };

  const MAX_CHARS = 450_000;
  let out = render(1600, 0.8);
  if (out.length > MAX_CHARS) out = render(1200, 0.7);
  if (out.length > MAX_CHARS) out = render(900, 0.55);
  return out;
}

// ── 80mm thermal payslip template ────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slipRow(label: string, value: string, bold = false): string {
  return `<div class="row${bold ? ' bold' : ''}"><span class="name">${escHtml(label)}</span><span class="value">${escHtml(value)}</span></div>`;
}

function buildPayslipHtml(item: EnrichedItem, cycle: PayrollCycle, settings: HrSettings): string {
  const emp = item.employee;
  const parts: string[] = [];

  parts.push('<div class="center bold" style="font-size:16px;">ใบจ่ายเงินเดือน</div>');
  parts.push(`<div class="center small">งวดจ่ายวันที่ ${escHtml(formatThaiDate(cycle.payDate))}</div>`);
  parts.push(`<div class="center small">ช่วงงาน ${escHtml(formatThaiDate(cycle.workStartDate))} – ${escHtml(formatThaiDate(cycle.workEndDate))}</div>`);
  parts.push('<hr />');

  parts.push(slipRow('ชื่อ-สกุล', `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim()));
  parts.push(slipRow('แผนก', deptLabelOf(emp?.department)));
  parts.push(slipRow('ประเภท', item.employeeType === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'));
  parts.push(slipRow('ช่องทางจ่าย', paidChannelLabel(item)));
  parts.push('<hr />');

  parts.push('<div class="bold">รายได้</div>');
  if (item.employeeType === 'full_time') {
    parts.push(slipRow('เงินเดือนฐาน', `฿${fmtMoney(item.baseSalary)}`));
    parts.push(slipRow(`Incentive (${item.workDays} วัน × ฿${fmtMoney(item.incentivePerDay)})`, `฿${fmtMoney(item.incentiveTotal)}`));
  } else {
    parts.push(slipRow(`ชั่วโมง (${Number(item.totalHours).toFixed(2)} ชม. × ฿${fmtMoney(item.hourlyRate)})`, `฿${fmtMoney(item.hourlyTotal)}`));
  }
  parts.push(slipRow('รวมรายได้', `฿${fmtMoney(item.gross)}`, true));

  if (Number(item.totalDeduction) > 0) {
    parts.push('<hr />');
    parts.push('<div class="bold">รายการหัก</div>');
    for (const d of item.deductions.filter((d) => d.type === 'advance')) {
      parts.push(slipRow(`เบิก: ${d.reason}`, `-฿${fmtMoney(d.amount)}`));
    }
    for (const d of item.deductions.filter((d) => d.type === 'damage')) {
      parts.push(slipRow(`เสียหาย: ${d.reason}`, `-฿${fmtMoney(d.amount)}`));
    }
    if (Number(item.absenceDeduction) > 0) {
      parts.push(slipRow(`ขาด ${item.absenceDays} วัน × ฿${fmtMoney(settings.absenceRatePerDay)}`, `-฿${fmtMoney(item.absenceDeduction)}`));
    }
    if (Number(item.lateDeduction) > 0) {
      parts.push(slipRow(`สาย ${item.lateMinutes} นาที × ฿${fmtMoney(settings.lateRatePerMinute)}`, `-฿${fmtMoney(item.lateDeduction)}`));
    }
    parts.push(slipRow('รวมหัก', `-฿${fmtMoney(item.totalDeduction)}`, true));
  }

  parts.push('<hr />');
  parts.push(`<div class="row bold" style="font-size:16px;"><span class="name">เงินสุทธิ</span><span class="value">฿${escHtml(fmtMoney(item.netPay))}</span></div>`);

  if (item.isPaid) {
    parts.push(
      `<div class="center small" style="margin-top:4px;">จ่ายแล้ว (${escHtml(PAID_METHOD_LABELS[item.paidMethod ?? ''] ?? '-')})${item.paidAt ? ` เมื่อ ${escHtml(formatThaiDateTime(item.paidAt))}` : ''}</div>`,
    );
  }

  parts.push(`
<div style="display:flex;gap:16px;margin-top:44px;">
  <div style="flex:1;text-align:center;">
    <div style="border-bottom:1px dotted #000;height:52px;"></div>
    <div style="margin-top:6px;">ผู้จ่ายเงิน</div>
  </div>
  <div style="flex:1;text-align:center;">
    <div style="border-bottom:1px dotted #000;height:52px;"></div>
    <div style="margin-top:6px;">ผู้รับเงิน</div>
  </div>
</div>`);

  return parts.join('\n');
}

// ── Payslip print ─────────────────────────────────────────────────────────────

function PayslipContent({ item, cycle, settings }: { item: EnrichedItem; cycle: PayrollCycle; settings: HrSettings }) {
  const emp = item.employee;
  return (
    <div className="payslip-print text-sm space-y-3">
      <div className="text-center font-bold text-base mb-1">ใบจ่ายเงินเดือน</div>
      <div className="text-center text-xs text-muted-foreground mb-3">
        งวดจ่ายวันที่ {formatThaiDate(cycle.payDate)} · ช่วงงาน {formatThaiDate(cycle.workStartDate)} – {formatThaiDate(cycle.workEndDate)}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
        <span className="text-muted-foreground">ชื่อ-สกุล:</span>
        <span className="font-medium">{emp?.firstName} {emp?.lastName}</span>
        <span className="text-muted-foreground">แผนก:</span>
        <span>{deptLabelOf(emp?.department)}</span>
        <span className="text-muted-foreground">ประเภท:</span>
        <span>{item.employeeType === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'}</span>
        <span className="text-muted-foreground">ช่องทางจ่าย:</span>
        <span>{paidChannelLabel(item)}</span>
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
          จ่ายแล้ว ({PAID_METHOD_LABELS[item.paidMethod ?? ''] ?? '-'}) เมื่อ{' '}
          {formatThaiDateTime(item.paidAt)}
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
  const [payEditing, setPayEditing] = useState(false);
  const [payForm, setPayForm] = useState({
    paidMethod: 'cash' as 'cash' | 'transfer' | 'mixed',
    cashAmount: '',
    transferAmount: '',
    proofFile: '',
    proofFile2: '',
  });
  const [printSlip, setPrintSlip] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ baseSalary: '', workDays: '', incentivePerDay: '' });

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

  function openPay(editing: boolean) {
    setPayEditing(editing);
    const net = String(Number(item.netPay));
    setPayForm(
      editing
        ? {
            paidMethod: (item.paidMethod ?? 'cash') as 'cash' | 'transfer' | 'mixed',
            cashAmount: item.paidCashAmount != null ? String(Number(item.paidCashAmount)) : net,
            transferAmount: item.paidTransferAmount != null ? String(Number(item.paidTransferAmount)) : net,
            proofFile: item.paymentProofUrl ?? '',
            proofFile2: item.paymentProofUrl2 ?? '',
          }
        : { paidMethod: 'cash', cashAmount: net, transferAmount: net, proofFile: '', proofFile2: '' },
    );
    setPayOpen(true);
  }

  function submitPay() {
    startTransition(async () => {
      const result = await markAsPaid({
        payrollItemId: item.id,
        paidMethod: payForm.paidMethod,
        paidCashAmount: payForm.paidMethod !== 'transfer' ? Number(payForm.cashAmount) || null : null,
        paidTransferAmount: payForm.paidMethod !== 'cash' ? Number(payForm.transferAmount) || null : null,
        paymentProofUrl: payForm.proofFile || null,
        // Slot 2 is only meaningful for mixed payments — never submit a stale image.
        paymentProofUrl2: payForm.paidMethod === 'mixed' ? (payForm.proofFile2 || null) : null,
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(payEditing ? 'อัปเดตการจ่ายแล้ว' : 'บันทึกการจ่ายแล้ว');
      setPayOpen(false);
      onRefresh();
    });
  }

  function handleProofUpload(slot: 'proofFile' | 'proofFile2') {
    return async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const compressed = await compressImageFile(file);
        setPayForm((p) => ({ ...p, [slot]: compressed }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'อัปโหลดรูปไม่สำเร็จ');
      }
    };
  }

  function openEdit() {
    setEditForm({
      baseSalary: String(Number(item.baseSalary)),
      workDays: String(item.workDays),
      incentivePerDay: String(Number(item.incentivePerDay)),
    });
    setEditOpen(true);
  }

  function submitEdit() {
    startTransition(async () => {
      const result = await updatePayrollItemEarnings({
        payrollItemId: item.id,
        baseSalary: Number(editForm.baseSalary),
        workDays: Number(editForm.workDays),
        incentivePerDay: Number(editForm.incentivePerDay),
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('บันทึกรายได้แล้ว');
      setEditOpen(false);
      onRefresh();
    });
  }

  function handlePrintSlip() {
    startTransition(async () => {
      const result = await printPayslip(item, cycle, settings, buildPayslipHtml(item, cycle, settings));
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('ส่งพิมพ์สลิปแล้ว');
    });
  }

  return (
    <div className="space-y-5">
      {/* รายได้ */}
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">รายได้</p>
          {!locked && item.employeeType === 'full_time' && (
            <button
              type="button"
              onClick={openEdit}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-[var(--surface-primary-subtle)] hover:text-primary"
            >
              <Pencil className="size-3" />
              แก้ไข
            </button>
          )}
        </div>
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
            <div className="flex flex-wrap gap-1.5">
              {([
                ['advance', 'เบิก'],
                ['damage', 'เสียหาย'],
                ['absence', 'ขาด'],
                ['late', 'สาย'],
              ] as const).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => openAdd(type)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-[var(--surface-primary-subtle)] hover:text-primary"
                >
                  <Plus className="size-3" />
                  {label}
                </button>
              ))}
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

      {/* สุทธิ */}
      <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-[var(--surface-primary-subtle)] px-4 py-3.5">
        <span className="font-semibold text-foreground">เงินสุทธิที่ต้องจ่าย</span>
        <span className="text-xl font-bold tabular-nums text-primary">฿{fmtMoney(item.netPay)}</span>
      </div>

      {/* Payment status */}
      {item.isPaid ? (
        <div className="rounded-lg bg-[var(--status-success-bg)] border border-[var(--status-success-border)] px-4 py-3 text-xs text-[var(--status-success-fg)] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="size-4" /> จ่ายแล้ว
            </div>
            {!locked && (
              <button
                type="button"
                onClick={() => openPay(true)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--status-success-border)] bg-background/60 px-2 py-1 text-[11px] font-medium text-[var(--status-success-fg)] transition-colors hover:bg-background"
              >
                <Pencil className="size-3" />
                แก้ไข
              </button>
            )}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="opacity-80">ช่องทาง:</span>
            <span className="font-medium">{paidChannelLabel(item)}</span>
            <span className="opacity-80">ยอดที่จ่าย:</span>
            <span className="font-semibold tabular-nums">
              ฿{fmtMoney(
                (Number(item.paidCashAmount ?? 0) + Number(item.paidTransferAmount ?? 0)) || Number(item.netPay),
              )}
            </span>
            {item.paidAt && (
              <>
                <span className="opacity-80">เมื่อ:</span>
                <span>{formatThaiDateTime(item.paidAt)}</span>
              </>
            )}
            <span className="opacity-80">หลักฐาน:</span>
            <span>
              {item.paymentProofUrl || item.paymentProofUrl2
                ? `${[item.paymentProofUrl, item.paymentProofUrl2].filter(Boolean).length} รูป`
                : 'ไม่มีรูปแนบ'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.paymentProofUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.paymentProofUrl} alt="หลักฐานรูปที่ 1" className="max-h-32 rounded mt-1 border border-[var(--status-success-border)]" />
            )}
            {item.paymentProofUrl2 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.paymentProofUrl2} alt="หลักฐานรูปที่ 2" className="max-h-32 rounded mt-1 border border-[var(--status-success-border)]" />
            )}
          </div>
        </div>
      ) : (
        !locked && (
          <Button className="w-full" onClick={() => openPay(false)}>
            <Banknote className="size-4" />
            บันทึกการจ่าย
          </Button>
        )
      )}

      <Button variant="outline" className="w-full" onClick={() => setPrintSlip(true)}>
        <Printer className="size-4 mr-1.5" />
        พิมพ์สลิป
      </Button>

      {/* Edit earnings — centered dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border bg-muted/30 px-6 py-4">
            <DialogTitle className="text-base font-semibold">แก้ไขรายได้</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {emp?.firstName} {emp?.lastName} — ระบบจะคำนวณยอดสุทธิใหม่อัตโนมัติ
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label>เงินเดือนฐาน (฿) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editForm.baseSalary}
                onChange={(e) => setEditForm((p) => ({ ...p, baseSalary: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>จำนวนวันทำงาน (วัน) *</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={editForm.workDays}
                onChange={(e) => setEditForm((p) => ({ ...p, workDays: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Incentive ต่อวัน (฿) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editForm.incentivePerDay}
                onChange={(e) => setEditForm((p) => ({ ...p, incentivePerDay: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              Incentive รวม: ฿{fmtMoney((Number(editForm.workDays) || 0) * (Number(editForm.incentivePerDay) || 0))}
              {' · '}
              รวมรายได้ใหม่: ฿{fmtMoney((Number(editForm.baseSalary) || 0) + (Number(editForm.workDays) || 0) * (Number(editForm.incentivePerDay) || 0))}
            </p>
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-muted/30 px-6 py-4">
            <Button variant="outline" onClick={() => setEditOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitEdit} disabled={pending}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add deduction / absence — centered dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border bg-muted/30 px-6 py-4">
            <DialogTitle className="text-base font-semibold">
              {addType === 'advance' ? 'เพิ่มรายการเบิก' : addType === 'damage' ? 'เพิ่มรายการเสียหาย' : addType === 'absence' ? 'บันทึกขาด' : 'บันทึกสาย'}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {emp?.firstName} {emp?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
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
                  <ThaiDateInput value={addForm.occurredDate} onValueChange={(occurredDate) => setAddForm((p) => ({ ...p, occurredDate }))} ariaLabel="เลือกวันที่เกิดรายการ" />
                </div>
              </>
            )}
            {addType === 'absence' && (
              <div className="space-y-1.5">
                <Label>วันที่ขาด *</Label>
                <ThaiDateInput value={addForm.occurredDate} onValueChange={(occurredDate) => setAddForm((p) => ({ ...p, occurredDate }))} ariaLabel="เลือกวันที่ขาด" />
              </div>
            )}
            {addType === 'late' && (
              <>
                <div className="space-y-1.5">
                  <Label>วันที่สาย *</Label>
                  <ThaiDateInput value={addForm.occurredDate} onValueChange={(occurredDate) => setAddForm((p) => ({ ...p, occurredDate }))} ariaLabel="เลือกวันที่มาสาย" />
                </div>
                <div className="space-y-1.5">
                  <Label>นาทีสาย *</Label>
                  <Input type="number" min="1" value={addForm.lateMinutes} onChange={(e) => setAddForm((p) => ({ ...p, lateMinutes: e.target.value }))} />
                </div>
              </>
            )}
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-muted/30 px-6 py-4">
            <Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitAdd} disabled={pending}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as paid — centered dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border bg-muted/30 px-6 py-4">
            <DialogTitle className="text-base font-semibold">
              {payEditing ? 'แก้ไขการจ่ายเงินเดือน' : 'บันทึกการจ่ายเงินเดือน'}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {emp?.firstName} {emp?.lastName} — ยอดสุทธิ <strong className="text-foreground">฿{fmtMoney(item.netPay)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label>วิธีจ่าย</Label>
              <Select value={payForm.paidMethod} onValueChange={(v) => { if (v) setPayForm((p) => ({ ...p, paidMethod: v as 'cash' | 'transfer' | 'mixed' })); }}>
                <SelectTrigger>
                  <SelectValue>{PAID_METHOD_LABELS[payForm.paidMethod]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">เงินสด</SelectItem>
                  <SelectItem value="transfer">โอน</SelectItem>
                  <SelectItem value="mixed">เงินสด+โอน</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payForm.paidMethod === 'mixed' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>เงินสด (฿) *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={payForm.cashAmount}
                      onChange={(e) => setPayForm((p) => ({ ...p, cashAmount: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>โอน (฿) *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={payForm.transferAmount}
                      onChange={(e) => setPayForm((p) => ({ ...p, transferAmount: e.target.value }))}
                    />
                  </div>
                </div>
                {(() => {
                  const sum = (Number(payForm.cashAmount) || 0) + (Number(payForm.transferAmount) || 0);
                  const net = Number(item.netPay);
                  return (
                    <p className={cn('text-xs tabular-nums', Math.abs(sum - net) < 0.005 ? 'text-muted-foreground' : 'text-[var(--status-warning-fg)]')}>
                      รวม ฿{fmtMoney(sum)} / ยอดสุทธิ ฿{fmtMoney(net)}
                      {Math.abs(sum - net) >= 0.005 && ' — ยอดรวมไม่เท่ายอดสุทธิ'}
                    </p>
                  );
                })()}
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>จำนวนเงิน (฿) *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payForm.paidMethod === 'cash' ? payForm.cashAmount : payForm.transferAmount}
                  onChange={(e) =>
                    setPayForm((p) =>
                      p.paidMethod === 'cash'
                        ? { ...p, cashAmount: e.target.value }
                        : { ...p, transferAmount: e.target.value },
                    )
                  }
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>
                {payForm.paidMethod === 'mixed' ? 'รูปสลิป / หลักฐาน รูปที่ 1 (ถ้ามี)' : 'รูปสลิป / หลักฐาน (ถ้ามี)'}
              </Label>
              <Input type="file" accept="image/*" onChange={handleProofUpload('proofFile')} />
              {payForm.proofFile && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={payForm.proofFile} alt="preview" className="max-h-24 rounded border" />
              )}
            </div>
            {payForm.paidMethod === 'mixed' && (
              <div className="space-y-1.5">
                <Label>รูปสลิป / หลักฐาน รูปที่ 2 (ถ้ามี)</Label>
                <Input type="file" accept="image/*" onChange={handleProofUpload('proofFile2')} />
                {payForm.proofFile2 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={payForm.proofFile2} alt="preview 2" className="max-h-24 rounded border" />
                )}
              </div>
            )}
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-muted/30 px-6 py-4">
            <Button variant="outline" onClick={() => setPayOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitPay} disabled={pending}>
              <Banknote className="size-4" />
              {payEditing ? 'บันทึกการแก้ไข' : 'ยืนยันจ่าย'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payslip print dialog */}
      <Dialog open={printSlip} onOpenChange={setPrintSlip}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>สลิปเงินเดือน</DialogTitle>
          </DialogHeader>
          <PayslipContent item={item} cycle={cycle} settings={settings} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintSlip(false)}>ปิด</Button>
            <Button onClick={handlePrintSlip} disabled={pending}><Printer className="size-4 mr-1.5" />พิมพ์สลิป</Button>
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
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  const selectedItem = detail.items.find((i) => i.id === selectedItemId);
  const paidCount = detail.items.filter((i) => i.isPaid).length;
  const totalNet = detail.items.reduce((s, i) => s + Number(i.netPay), 0);

  void setDetail;

  function refresh() {
    router.refresh();
  }

  function handleFinalize() {
    openConfirm(
      'อนุมัติรอบจ่ายนี้? หลังอนุมัติจะไม่สามารถเพิ่ม/ลบรายการหักได้อีก',
      () => {
        startTransition(async () => {
          const result = await finalizePayrollCycle(detail.cycle.id);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('อนุมัติรอบจ่ายแล้ว');
          router.refresh();
        });
      },
      { confirmLabel: 'อนุมัติ', variant: 'default' },
    );
  }

  function handleDeleteCycle() {
    openConfirm(
      'ลบรอบจ่ายนี้? รายการเงินเดือนและรายการหักทั้งหมดในรอบจะถูกลบถาวร',
      () => {
        startTransition(async () => {
          const result = await deletePayrollCycle(detail.cycle.id);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('ลบรอบจ่ายแล้ว');
          router.push('/hr/payroll');
          router.refresh();
        });
      },
      { confirmLabel: 'ลบรอบจ่าย', variant: 'danger' },
    );
  }

  function handleUnfinalize() {
    openConfirm(
      'ยกเลิกการอนุมัติรอบจ่ายนี้? รอบจะกลับเป็นสถานะร่างและแก้ไขรายการหักได้อีกครั้ง',
      () => {
        startTransition(async () => {
          const result = await unfinalizePayrollCycle(detail.cycle.id);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('ยกเลิกการอนุมัติแล้ว');
          router.refresh();
        });
      },
      { confirmLabel: 'ยกเลิกการอนุมัติ', variant: 'danger' },
    );
  }

  return (
    <AppShell>
      {confirmDialog}

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
        title={`จ่ายวันที่ ${formatThaiShortDate(detail.cycle.payDate)}`}
        subtitle={`ช่วงงาน ${fmtDate(detail.cycle.workStartDate)} – ${fmtDate(detail.cycle.workEndDate)}${detail.cycle.notes ? ` · ${detail.cycle.notes}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={STATUS_LABELS[detail.cycle.status] ?? detail.cycle.status}
              variant={STATUS_BADGE[detail.cycle.status] ?? 'neutral'}
              dot
            />
            {detail.cycle.status === 'draft' && (
              <>
                {paidCount === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDeleteCycle}
                    disabled={pending}
                    className="text-[var(--status-danger-fg)] hover:text-[var(--status-danger-fg)]"
                  >
                    <Trash2 className="size-4" />
                    ลบรอบนี้
                  </Button>
                )}
                <Button size="sm" onClick={handleFinalize} disabled={pending}>
                  <BadgeCheck className="size-4" />
                  อนุมัติรอบนี้
                </Button>
              </>
            )}
            {detail.cycle.status === 'finalized' && paidCount === 0 && (
              <Button size="sm" variant="outline" onClick={handleUnfinalize} disabled={pending}>
                <Undo2 className="size-4" />
                ยกเลิกการอนุมัติ
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

      {/* Master-detail layout — list stacks on top for tablet portrait */}
      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Left: employee list */}
        <div className="w-full shrink-0 lg:w-80">
          <DataCard noPadding title="พนักงาน" subtitle={`${detail.items.length} คน · แตะเพื่อดูรายละเอียด`}>
            {detail.items.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="ไม่มีข้อมูลพนักงาน"
                description="ยังไม่มีรายการเงินเดือนในรอบนี้"
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
                      'w-full border-t border-border px-4 py-3 text-left transition-colors',
                      isSelected
                        ? 'border-l-2 border-l-primary bg-[var(--surface-primary-subtle)]'
                        : 'border-l-2 border-l-transparent hover:bg-muted/30',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('truncate text-sm font-semibold', isSelected ? 'text-primary' : 'text-foreground')}>
                        {emp?.firstName} {emp?.lastName}
                      </span>
                      {item.isPaid ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--status-success-fg)]">
                          <CheckCircle2 className="size-3" />
                          จ่ายแล้ว
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-muted-foreground">ยังไม่จ่าย</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      ฿{fmtMoney(item.netPay)}
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
