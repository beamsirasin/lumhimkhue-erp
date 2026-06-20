'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { toast } from 'sonner';
import { Plus, MoreHorizontal, Users, ChevronDown, ChevronRight, X } from 'lucide-react';
import { createEmployee, updateEmployee, deleteEmployee } from '@/lib/actions/hr';
import type { Employee } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

const THAI_BANKS = [
  'กสิกรไทย',
  'ไทยพาณิชย์',
  'กรุงเทพ',
  'กรุงไทย',
  'กรุงศรีอยุธยา',
  'ทหารไทยธนชาต',
  'ออมสิน',
  'ธ.ก.ส.',
  'ซีไอเอ็มบี',
  'ยูโอบี',
  'แลนด์แอนด์เฮ้าส์',
  'ทิสโก้',
  'เกียรตินาคินภัทร',
];

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  bankName: string;
  bankAccountNumber: string;
  nationalId: string;
  taxId: string;
  socialSecurityNumber: string;
  employmentEndDate: string;
  ssfRegistered: boolean;
  type: 'full_time' | 'part_time';
  status: 'active' | 'inactive';
  baseSalaryPerCycle: string;
  incentivePerDay: string;
  hourlyRate: string;
  startDate: string;
  notes: string;
};

const defaultForm: FormState = {
  firstName: '',
  lastName: '',
  phone: '',
  bankName: '',
  bankAccountNumber: '',
  nationalId: '',
  taxId: '',
  socialSecurityNumber: '',
  employmentEndDate: '',
  ssfRegistered: true,
  type: 'full_time',
  status: 'active',
  baseSalaryPerCycle: '',
  incentivePerDay: '0',
  hourlyRate: '',
  startDate: '',
  notes: '',
};

interface Props {
  initialEmployees: Employee[];
  userRole: string;
}

function maskNationalId(id: string | null | undefined): string {
  if (!id) return '-';
  return `*********${id.slice(-4)}`;
}

export function EmployeesPage({ initialEmployees, userRole }: Props) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [legalOpen, setLegalOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const filterEmployee = (e: Employee) =>
    filterStatus === 'all' || e.status === filterStatus;

  const fullTime = employees.filter((e) => e.type === 'full_time' && filterEmployee(e));
  const partTime = employees.filter((e) => e.type === 'part_time' && filterEmployee(e));

  function openCreate() {
    setEditingId(null);
    setForm(defaultForm);
    setLegalOpen(false);
    setOpen(true);
  }

  function openEdit(emp: Employee) {
    setEditingId(emp.id);
    setForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      phone: emp.phone ?? '',
      bankName: emp.bankName ?? '',
      bankAccountNumber: emp.bankAccountNumber ?? '',
      nationalId: emp.nationalId ?? '',
      taxId: emp.taxId ?? '',
      socialSecurityNumber: emp.socialSecurityNumber ?? '',
      employmentEndDate: emp.employmentEndDate ?? '',
      ssfRegistered: emp.ssfRegistered,
      type: emp.type,
      status: emp.status,
      baseSalaryPerCycle: emp.baseSalaryPerCycle ?? '',
      incentivePerDay: emp.incentivePerDay ?? '0',
      hourlyRate: emp.hourlyRate ?? '',
      startDate: emp.startDate ?? '',
      notes: emp.notes ?? '',
    });
    setLegalOpen(false);
    setOpen(true);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    const currentEditingId = editingId;
    const payload = {
      ...form,
      nationalId: form.nationalId || null,
      taxId: form.taxId || null,
      socialSecurityNumber: form.socialSecurityNumber || null,
      employmentEndDate: form.employmentEndDate || null,
      baseSalaryPerCycle: form.baseSalaryPerCycle ? Number(form.baseSalaryPerCycle) : null,
      incentivePerDay: Number(form.incentivePerDay || 0),
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
      startDate: form.startDate || null,
    };

    startTransition(async () => {
      const result = currentEditingId
        ? await updateEmployee(currentEditingId, payload)
        : await createEmployee(payload);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(currentEditingId ? 'แก้ไขข้อมูลแล้ว' : 'เพิ่มพนักงานแล้ว');
      setOpen(false);
      router.refresh();
      if (!currentEditingId && 'data' in result && result.data) {
        setEmployees((prev) => [...prev, result.data as Employee]);
      } else if (currentEditingId) {
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === currentEditingId
              ? {
                  ...e,
                  ...payload,
                  baseSalaryPerCycle: payload.baseSalaryPerCycle != null ? String(payload.baseSalaryPerCycle) : null,
                  hourlyRate: payload.hourlyRate != null ? String(payload.hourlyRate) : null,
                  incentivePerDay: String(payload.incentivePerDay),
                }
              : e,
          ),
        );
      }
    });
  }

  function handleDelete(emp: Employee) {
    if (!confirm(`ลบพนักงาน "${emp.firstName} ${emp.lastName}"?\n(ถ้ามีประวัติเงินเดือน จะ set เป็น inactive แทน)`)) return;
    startTransition(async () => {
      const result = await deleteEmployee(emp.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('ลบแล้ว');
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
    });
  }

  const isOwner = userRole === 'owner';

  return (
    <AppShell>
      <PageHeader
        title="ข้อมูลพนักงาน"
        subtitle={`พนักงานทั้งหมด ${employees.length} คน`}
        actions={
          <div className="flex items-center gap-3">
            <Select
              value={filterStatus}
              onValueChange={(v) => { if (v) setFilterStatus(v as typeof filterStatus); }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกสถานะ</SelectItem>
                <SelectItem value="active">ทำงานอยู่</SelectItem>
                <SelectItem value="inactive">ไม่ active</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4" />
              เพิ่มพนักงาน
            </Button>
          </div>
        }
      />

      {/* Full-time section */}
      <DataCard
        noPadding
        title="พนักงานประจำ"
        subtitle={`${fullTime.length} คน`}
      >
        {fullTime.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="ไม่มีพนักงานประจำ"
            description={filterStatus !== 'all' ? 'ลองเปลี่ยนตัวกรองสถานะ' : 'เพิ่มพนักงานประจำใหม่ด้วยปุ่มด้านบน'}
            size="sm"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">ชื่อ-สกุล</th>
                  <th className="px-4 py-3 text-left font-medium">เบอร์</th>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">เงินเดือน/รอบ</th>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">Incentive/วัน</th>
                  <th className="px-4 py-3 text-center font-medium">ประกันสังคม</th>
                  <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fullTime.map((emp) => (
                  <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {emp.firstName} {emp.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{emp.phone ?? '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      ฿{Number(emp.baseSalaryPerCycle ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      ฿{Number(emp.incentivePerDay ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge
                        label={emp.ssfRegistered ? 'สมัครแล้ว' : 'ไม่ได้สมัคร'}
                        variant={emp.ssfRegistered ? 'success' : 'neutral'}
                        dot
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge
                        label={emp.status === 'active' ? 'ทำงาน' : 'inactive'}
                        variant={emp.status === 'active' ? 'success' : 'neutral'}
                        dot
                      />
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          aria-label="เมนูการดำเนินการ"
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(emp)}>
                            แก้ไข
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDelete(emp)}
                          >
                            ลบ
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>

      {/* Part-time section */}
      <DataCard
        noPadding
        title="พาร์ทไทม์"
        subtitle={`${partTime.length} คน`}
      >
        {partTime.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="ไม่มีพนักงานพาร์ทไทม์"
            description={filterStatus !== 'all' ? 'ลองเปลี่ยนตัวกรองสถานะ' : 'เพิ่มพนักงานพาร์ทไทม์ใหม่ด้วยปุ่มด้านบน'}
            size="sm"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">ชื่อ-สกุล</th>
                  <th className="px-4 py-3 text-left font-medium">เบอร์</th>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">เรท/ชม.</th>
                  <th className="px-4 py-3 text-center font-medium">ประกันสังคม</th>
                  <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {partTime.map((emp) => (
                  <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {emp.firstName} {emp.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{emp.phone ?? '-'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      ฿{Number(emp.hourlyRate ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge
                        label={emp.ssfRegistered ? 'สมัครแล้ว' : 'ไม่ได้สมัคร'}
                        variant={emp.ssfRegistered ? 'success' : 'neutral'}
                        dot
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge
                        label={emp.status === 'active' ? 'ทำงาน' : 'inactive'}
                        variant={emp.status === 'active' ? 'success' : 'neutral'}
                        dot
                      />
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          aria-label="เมนูการดำเนินการ"
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(emp)}>
                            แก้ไข
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDelete(emp)}
                          >
                            ลบ
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>

      {/* Sheet form */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex flex-col gap-0 p-0 sm:max-w-[540px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-base font-semibold text-foreground">
                {editingId ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {editingId ? 'แก้ไขข้อมูลพนักงาน' : 'กรอกข้อมูลพนักงานใหม่'}
              </p>
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
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* ข้อมูลส่วนตัว */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ข้อมูลส่วนตัว</p>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>ชื่อ *</Label>
                  <Input value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} placeholder="ชื่อ" />
                </div>
                <div className="space-y-1.5">
                  <Label>นามสกุล *</Label>
                  <Input value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} placeholder="นามสกุล" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>เบอร์โทรศัพท์</Label>
                <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="08X-XXX-XXXX" />
              </div>
            </section>

            {/* ข้อมูลธนาคาร */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ข้อมูลธนาคาร</p>
              <Separator />
              <div className="space-y-1.5">
                <Label>ธนาคาร</Label>
                <Select value={form.bankName} onValueChange={(v) => setField('bankName', v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกธนาคาร" />
                  </SelectTrigger>
                  <SelectContent>
                    {THAI_BANKS.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>เลขบัญชี</Label>
                <Input value={form.bankAccountNumber} onChange={(e) => setField('bankAccountNumber', e.target.value)} placeholder="XXX-X-XXXXX-X" />
              </div>
            </section>

            {/* ข้อมูลการเงินและกฎหมาย */}
            <section className="space-y-3">
              <button
                type="button"
                onClick={() => setLegalOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-left"
              >
                {legalOpen
                  ? <ChevronDown className="size-3.5 text-muted-foreground" />
                  : <ChevronRight className="size-3.5 text-muted-foreground" />
                }
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ข้อมูลการเงินและกฎหมาย</p>
              </button>
              {legalOpen && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>เลขบัตรประชาชน (13 หลัก)</Label>
                      {isOwner || !editingId ? (
                        <Input
                          value={form.nationalId}
                          onChange={(e) => setField('nationalId', e.target.value)}
                          placeholder="1234567890123"
                          maxLength={13}
                        />
                      ) : (
                        <Input
                          value={form.nationalId ? maskNationalId(form.nationalId) : ''}
                          disabled
                          className="text-muted-foreground bg-muted/30"
                          placeholder="—"
                        />
                      )}
                      {!isOwner && editingId && (
                        <p className="text-[11px] text-muted-foreground">เฉพาะ owner เท่านั้นที่เห็นเลขเต็ม</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label>เลขประจำตัวผู้เสียภาษี</Label>
                      <Input
                        value={form.taxId}
                        onChange={(e) => setField('taxId', e.target.value)}
                        placeholder="1234567890123"
                        maxLength={13}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>เลขประกันสังคม</Label>
                      <Input
                        value={form.socialSecurityNumber}
                        onChange={(e) => setField('socialSecurityNumber', e.target.value)}
                        placeholder="เช่น 1234567890"
                        maxLength={15}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>วันสิ้นสุดการจ้างงาน</Label>
                        <Input
                          type="date"
                          value={form.employmentEndDate}
                          onChange={(e) => setField('employmentEndDate', e.target.value)}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={form.ssfRegistered}
                        onChange={(e) => setField('ssfRegistered', e.target.checked)}
                      />
                      <span className="text-sm text-foreground">สมัครประกันสังคม (SSF 5% สูงสุด ฿750/เดือน)</span>
                    </label>
                  </div>
                </>
              )}
            </section>

            {/* ประเภทการจ้าง */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ประเภทการจ้าง</p>
              <Separator />
              <div className="flex gap-3">
                {(['full_time', 'part_time'] as const).map((t) => (
                  <label
                    key={t}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 cursor-pointer text-sm font-medium transition-colors',
                      form.type === t
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:border-border',
                    )}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      checked={form.type === t}
                      onChange={() => setField('type', t)}
                    />
                    {t === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'}
                  </label>
                ))}
              </div>
              {form.type === 'full_time' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>เงินเดือนต่อรอบ (฿) *</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.baseSalaryPerCycle}
                      onChange={(e) => setField('baseSalaryPerCycle', e.target.value)}
                      placeholder="เช่น 9000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Incentive ต่อวันทำงาน (฿)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.incentivePerDay}
                      onChange={(e) => setField('incentivePerDay', e.target.value)}
                      placeholder="เช่น 30"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>เรทต่อชั่วโมง (฿) *</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.hourlyRate}
                    onChange={(e) => setField('hourlyRate', e.target.value)}
                    placeholder="เช่น 65"
                  />
                </div>
              )}
            </section>

            {/* อื่นๆ */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">อื่นๆ</p>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>วันเริ่มงาน</Label>
                  <Input type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>สถานะ</Label>
                  <Select value={form.status} onValueChange={(v) => { if (v) setField('status', v as 'active' | 'inactive'); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">ทำงานอยู่</SelectItem>
                      <SelectItem value="inactive">ไม่ active</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>หมายเหตุ</Label>
                <Input value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" />
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {pending ? 'กำลังบันทึก...' : editingId ? 'บันทึก' : 'เพิ่มพนักงาน'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
