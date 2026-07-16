'use client';

import { useState, useEffect, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format, formatDistanceToNowStrict, startOfMonth, endOfMonth } from 'date-fns';
import { th } from 'date-fns/locale';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { toast } from 'sonner';
import {
  Plus, MoreHorizontal, Users, X, Search,
  Phone, Landmark, Wallet, ShieldCheck, CalendarDays, Clock, Pencil, Trash2, FileText,
} from 'lucide-react';
import { createEmployee, updateEmployee, deleteEmployee, getTimeEntries } from '@/lib/actions/hr';
import { addHrLookupOption, type HrLookupOption } from '@/lib/actions/hr-options';
import { DEFAULT_DEPARTMENTS, type DeptOption } from '@/lib/hr/departments';
import { formatThaiDate } from '@/lib/date-time';
import type { Employee } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

const DEFAULT_BANKS = [
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

/* ─── Departments (shared with SchedulePage) ─────────────────────────────── */
// DEFAULT_DEPARTMENTS / DeptOption live in lib/hr/departments.ts

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  department: string; // '' = ไม่ระบุ
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
  department: '',
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
  initialOptions: HrLookupOption[];
  userRole: string;
}

function maskNationalId(id: string | null | undefined): string {
  if (!id) return '-';
  return `*********${id.slice(-4)}`;
}

function initialsOf(emp: Employee): string {
  return `${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}`.toUpperCase();
}

function fmtBaht(n: string | number | null | undefined): string {
  return `฿${Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}`;
}

function fmtDate(d: string | null | undefined): string {
  return formatThaiDate(d);
}

function tenureOf(startDate: string | null | undefined): string | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime()) || start > new Date()) return null;
  return formatDistanceToNowStrict(start, { locale: th });
}

function employeePayloadWithStatus(emp: Employee, status: 'active' | 'inactive') {
  return {
    firstName: emp.firstName,
    lastName: emp.lastName,
    phone: emp.phone ?? '',
    department: emp.department ?? null,
    bankName: emp.bankName ?? '',
    bankAccountNumber: emp.bankAccountNumber ?? '',
    nationalId: emp.nationalId ?? null,
    taxId: emp.taxId ?? null,
    socialSecurityNumber: emp.socialSecurityNumber ?? null,
    employmentEndDate: emp.employmentEndDate ?? null,
    ssfRegistered: emp.ssfRegistered,
    type: emp.type,
    status,
    baseSalaryPerCycle: emp.baseSalaryPerCycle != null ? Number(emp.baseSalaryPerCycle) : null,
    incentivePerDay: Number(emp.incentivePerDay ?? 0),
    hourlyRate: emp.hourlyRate != null ? Number(emp.hourlyRate) : null,
    startDate: emp.startDate ?? null,
    notes: emp.notes ?? '',
  };
}

/* ─── Small display helpers ──────────────────────────────────────────────── */

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="mb-1 flex items-center gap-1.5 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {children}
    </p>
  );
}

/** "+ เพิ่มตัวเลือก" popover for user-extensible select lists (แผนก / ธนาคาร) */
function AddOptionPopover({
  kind,
  title,
  placeholder,
  existingLabels,
  onAdded,
}: {
  kind: 'department' | 'bank';
  title: string;
  placeholder: string;
  existingLabels: string[];
  onAdded: (row: HrLookupOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const label = value.trim();
    if (!label || saving) return;
    if (existingLabels.includes(label)) {
      toast.error('มีตัวเลือกนี้อยู่แล้ว');
      return;
    }
    setSaving(true);
    const result = await addHrLookupOption({ kind, label });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`เพิ่ม "${label}" แล้ว`);
    onAdded(result.data);
    setValue('');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
        <Plus className="size-3" />
        เพิ่มตัวเลือก
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="mb-2 text-sm font-medium text-foreground">{title}</p>
        <div className="flex gap-2">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder={placeholder}
            maxLength={50}
          />
          <Button size="sm" onClick={save} disabled={saving || !value.trim()}>
            {saving ? '...' : 'เพิ่ม'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Avatar({ emp, size = 'md' }: { emp: Employee; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-primary-subtle)] font-semibold text-primary',
        size === 'lg' ? 'size-14 text-lg' : 'size-9 text-xs',
      )}
    >
      {initialsOf(emp)}
    </span>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export function EmployeesPage({ initialEmployees, initialOptions, userRole }: Props) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [customOptions, setCustomOptions] = useState<HrLookupOption[]>(initialOptions);

  const departments = useMemo<DeptOption[]>(
    () => [
      ...DEFAULT_DEPARTMENTS,
      ...customOptions
        .filter((o) => o.kind === 'department')
        .map((o) => ({ value: o.label, label: o.label, variant: 'neutral' as BadgeVariant })),
    ],
    [customOptions],
  );
  const banks = useMemo<string[]>(
    () => [...DEFAULT_BANKS, ...customOptions.filter((o) => o.kind === 'bank').map((o) => o.label)],
    [customOptions],
  );
  // Unknown stored values (e.g. option later removed) still render as-is
  const deptOf = (value: string | null | undefined): DeptOption | null =>
    departments.find((d) => d.value === value) ?? (value ? { value, label: value, variant: 'neutral' } : null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterDept, setFilterDept] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [pending, startTransition] = useTransition();
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  /* Detail dialog */
  const [detailEmp, setDetailEmp] = useState<Employee | null>(null);
  const [monthWork, setMonthWork] = useState<{ days: number; hours: number } | null>(null);

  useEffect(() => {
    if (!detailEmp) return;
    let cancelled = false;
    const now = new Date();
    getTimeEntries(
      detailEmp.id,
      format(startOfMonth(now), 'yyyy-MM-dd'),
      format(endOfMonth(now), 'yyyy-MM-dd'),
    )
      .then((rows) => {
        if (cancelled) return;
        const days = new Set(rows.map((r) => r.workDate)).size;
        const hours = rows.reduce((s, r) => s + Number(r.totalHours), 0);
        setMonthWork({ days, hours });
      })
      .catch(() => {
        if (!cancelled) setMonthWork({ days: 0, hours: 0 });
      });
    return () => { cancelled = true; };
  }, [detailEmp]);

  function openDetail(emp: Employee) {
    setMonthWork(null);
    setDetailEmp(emp);
  }

  const q = search.trim().toLowerCase();
  const filterEmployee = (e: Employee) => {
    const matchStatus = filterStatus === 'all' || e.status === filterStatus;
    const matchDept = filterDept === 'all' || e.department === filterDept;
    const matchSearch =
      !q ||
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      (e.phone ?? '').includes(q);
    return matchStatus && matchDept && matchSearch;
  };

  // Same manual order as the schedule grid (sort_order, tie-break by name)
  const byOrder = (a: Employee, b: Employee) =>
    (a.sortOrder - b.sortOrder) || a.firstName.localeCompare(b.firstName, 'th');
  const fullTime = employees.filter((e) => e.type === 'full_time' && filterEmployee(e)).sort(byOrder);
  const partTime = employees.filter((e) => e.type === 'part_time' && filterEmployee(e)).sort(byOrder);
  const activeCount = employees.filter((e) => e.status === 'active').length;

  function openCreate() {
    setEditingId(null);
    setForm(defaultForm);
    setOpen(true);
  }

  function openEdit(emp: Employee) {
    setEditingId(emp.id);
    setForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      phone: emp.phone ?? '',
      department: emp.department ?? '',
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
    setDetailEmp(null);
    setOpen(true);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    const currentEditingId = editingId;
    const payload = {
      ...form,
      department: form.department || null,
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
    openConfirm(
      `ลบพนักงาน "${emp.firstName} ${emp.lastName}"? หากมีประวัติเงินเดือนอยู่ ระบบจะเปลี่ยนสถานะเป็นพ้นสภาพแทนการลบ`,
      () => {
        startTransition(async () => {
          const result = await deleteEmployee(emp.id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success('ลบแล้ว');
          setDetailEmp(null);
          setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
        });
      },
      { confirmLabel: 'ลบ' },
    );
  }

  async function handleStatusToggle(emp: Employee) {
    if (statusUpdatingId) return;
    const nextStatus = emp.status === 'active' ? 'inactive' : 'active';
    const restoreStatus = emp.status;

    setStatusUpdatingId(emp.id);
    setEmployees((prev) => prev.map((row) => (
      row.id === emp.id ? { ...row, status: nextStatus } : row
    )));

    try {
      const result = await updateEmployee(emp.id, employeePayloadWithStatus(emp, nextStatus));
      if (!result.ok) {
        setEmployees((prev) => prev.map((row) => (
          row.id === emp.id ? { ...row, status: restoreStatus } : row
        )));
        toast.error(result.error);
        return;
      }
      toast.success(nextStatus === 'active' ? 'เปลี่ยนสถานะเป็นทำงานแล้ว' : 'เปลี่ยนสถานะเป็นพ้นสภาพแล้ว');
      router.refresh();
    } catch {
      setEmployees((prev) => prev.map((row) => (
        row.id === emp.id ? { ...row, status: restoreStatus } : row
      )));
      toast.error('ไม่สามารถเปลี่ยนสถานะได้ กรุณาลองใหม่');
    } finally {
      setStatusUpdatingId(null);
    }
  }

  const isOwner = userRole === 'owner';

  /* ── Shared table renderer ── */
  function renderTable(list: Employee[], variant: 'full_time' | 'part_time') {
    if (list.length === 0) {
      return (
        <EmptyState
          icon={<Users className="size-5" />}
          title={variant === 'full_time' ? 'ไม่มีพนักงานประจำ' : 'ไม่มีพนักงานพาร์ทไทม์'}
          description={
            filterStatus !== 'all' || filterDept !== 'all' || q
              ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง'
              : 'เพิ่มพนักงานใหม่ด้วยปุ่มด้านบน'
          }
          size="sm"
        />
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)] text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">ชื่อ-สกุล</th>
              <th className="px-4 py-3 text-left font-medium">แผนก</th>
              <th className="px-4 py-3 text-left font-medium">เบอร์</th>
              {variant === 'full_time' ? (
                <>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">เงินเดือน/รอบ</th>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">Incentive/วัน</th>
                </>
              ) : (
                <th className="px-4 py-3 text-right font-medium tabular-nums">เรท/ชม.</th>
              )}
              <th className="px-4 py-3 text-center font-medium">ประกันสังคม</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
              <th className="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.map((emp) => {
              const tenure = tenureOf(emp.startDate);
              const dept = deptOf(emp.department);
              return (
                <tr
                  key={emp.id}
                  onClick={() => openDetail(emp)}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar emp={emp} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {emp.firstName} {emp.lastName}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {tenure ? `อายุงาน ${tenure}` : emp.startDate ? `เริ่ม ${fmtDate(emp.startDate)}` : 'ไม่ระบุวันเริ่มงาน'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {dept ? (
                      <StatusBadge label={dept.label} variant={dept.variant} />
                    ) : (
                      <span className="text-muted-foreground/60">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{emp.phone ?? '-'}</td>
                  {variant === 'full_time' ? (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {fmtBaht(emp.baseSalaryPerCycle)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {fmtBaht(emp.incentivePerDay)}
                      </td>
                    </>
                  ) : (
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {fmtBaht(emp.hourlyRate)}
                    </td>
                  )}
                  <td className="px-4 py-3 text-center">
                    <StatusBadge
                      label={emp.ssfRegistered ? 'สมัครแล้ว' : 'ไม่ได้สมัคร'}
                      variant={emp.ssfRegistered ? 'success' : 'neutral'}
                      dot
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      aria-label={`เปลี่ยนสถานะ ${emp.firstName} ${emp.lastName}`}
                      title="กดเพื่อเปลี่ยนสถานะ"
                      disabled={statusUpdatingId !== null}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStatusToggle(emp);
                      }}
                      className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                    >
                      <StatusBadge
                        label={emp.status === 'active' ? 'ทำงาน' : 'พ้นสภาพ'}
                        variant={emp.status === 'active' ? 'success' : 'neutral'}
                        dot
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label="เมนูการดำเนินการ"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDetail(emp)}>ดูข้อมูล</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(emp)}>แก้ไข</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(emp)}>
                          ลบ
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const detailDept = detailEmp ? deptOf(detailEmp.department) : null;

  return (
    <AppShell>
      {confirmDialog}

      <PageHeader
        title="ข้อมูลพนักงาน"
        subtitle="แตะที่รายชื่อเพื่อดูข้อมูลพนักงานแต่ละคน"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="size-4" />
            เพิ่มพนักงาน
          </Button>
        }
      />

      {/* KPI summary */}
      <StatCardGrid cols={4}>
        <StatCard label="พนักงานทั้งหมด" value={employees.length} unit="คน" icon={<Users className="size-4" />} />
        <StatCard label="ทำงานอยู่" value={activeCount} unit="คน" icon={<ShieldCheck className="size-4" />} />
        <StatCard label="พนักงานประจำ" value={employees.filter((e) => e.type === 'full_time').length} unit="คน" icon={<Wallet className="size-4" />} />
        <StatCard label="พาร์ทไทม์" value={employees.filter((e) => e.type === 'part_time').length} unit="คน" icon={<Clock className="size-4" />} />
      </StatCardGrid>

      {/* Filter bar */}
      <div className="mt-5 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อหรือเบอร์โทร…"
            className="pl-9"
          />
        </div>
        <Select value={filterDept} onValueChange={(v) => { if (v) setFilterDept(v); }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกแผนก</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            <SelectItem value="inactive">พ้นสภาพ</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Full-time section */}
      <DataCard noPadding title="พนักงานประจำ" subtitle={`${fullTime.length} คน`}>
        {renderTable(fullTime, 'full_time')}
      </DataCard>

      {/* Part-time section */}
      <DataCard noPadding title="พาร์ทไทม์" subtitle={`${partTime.length} คน`}>
        {renderTable(partTime, 'part_time')}
      </DataCard>

      {/* ── Employee detail dialog (centered) ── */}
      <Dialog open={!!detailEmp} onOpenChange={(o) => { if (!o) setDetailEmp(null); }}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-3xl"
        >
          {detailEmp && (
            <>
              {/* Header */}
              <div className="border-b border-border bg-[var(--surface-1)] px-6 py-5">
                <div className="flex items-start gap-4">
                  <Avatar emp={detailEmp} size="lg" />
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="truncate text-xl font-bold text-foreground">
                      {detailEmp.firstName} {detailEmp.lastName}
                    </DialogTitle>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {detailDept && <StatusBadge label={detailDept.label} variant={detailDept.variant} />}
                      <StatusBadge
                        label={detailEmp.type === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'}
                        variant={detailEmp.type === 'full_time' ? 'info' : 'purple'}
                      />
                      <StatusBadge
                        label={detailEmp.status === 'active' ? 'ทำงานอยู่' : 'พ้นสภาพ'}
                        variant={detailEmp.status === 'active' ? 'success' : 'neutral'}
                        dot
                      />
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" aria-label="ปิด" onClick={() => setDetailEmp(null)}>
                    <X className="size-4" />
                  </Button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* Compensation + work-time cards */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {detailEmp.type === 'full_time' ? (
                    <>
                      <div className="rounded-xl border border-border bg-[var(--surface-1)] p-4">
                        <p className="text-xs text-muted-foreground">เงินเดือน/รอบ</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
                          {fmtBaht(detailEmp.baseSalaryPerCycle)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border bg-[var(--surface-1)] p-4">
                        <p className="text-xs text-muted-foreground">Incentive/วันทำงาน</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
                          {fmtBaht(detailEmp.incentivePerDay)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-border bg-[var(--surface-1)] p-4">
                      <p className="text-xs text-muted-foreground">เรทต่อชั่วโมง</p>
                      <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
                        {fmtBaht(detailEmp.hourlyRate)}
                      </p>
                    </div>
                  )}
                  <div className="rounded-xl border border-border bg-[var(--surface-1)] p-4">
                    <p className="text-xs text-muted-foreground">เวลางานเดือนนี้</p>
                    {monthWork === null ? (
                      <Skeleton className="mt-1.5 h-7 w-28" />
                    ) : (
                      <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
                        {monthWork.days} วัน
                        <span className="ml-1.5 text-sm font-medium text-muted-foreground">
                          ({monthWork.hours.toLocaleString('th-TH', { maximumFractionDigits: 1 })} ชม.)
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Info sections — 2 columns on tablet/desktop */}
                <div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-2">
                  <section>
                    <SectionHeading icon={<Landmark className="size-3.5" />}>ติดต่อ & บัญชีธนาคาร</SectionHeading>
                    <div className="divide-y divide-border">
                      <InfoRow label="เบอร์โทรศัพท์">
                        {detailEmp.phone ? (
                          <a href={`tel:${detailEmp.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                            <Phone className="size-3.5" />
                            {detailEmp.phone}
                          </a>
                        ) : '-'}
                      </InfoRow>
                      <InfoRow label="ธนาคาร">{detailEmp.bankName ?? '-'}</InfoRow>
                      <InfoRow label="เลขบัญชี">{detailEmp.bankAccountNumber ?? '-'}</InfoRow>
                    </div>
                  </section>

                  <section>
                    <SectionHeading icon={<ShieldCheck className="size-3.5" />}>เอกสารและประกันสังคม</SectionHeading>
                    <div className="divide-y divide-border">
                      <InfoRow label="เลขบัตรประชาชน">
                        {isOwner ? (detailEmp.nationalId ?? '-') : maskNationalId(detailEmp.nationalId)}
                      </InfoRow>
                      <InfoRow label="เลขผู้เสียภาษี">{detailEmp.taxId ?? '-'}</InfoRow>
                      <InfoRow label="เลขประกันสังคม">{detailEmp.socialSecurityNumber ?? '-'}</InfoRow>
                      <InfoRow label="ประกันสังคม (SSF)">
                        <StatusBadge
                          label={detailEmp.ssfRegistered ? 'สมัครแล้ว' : 'ไม่ได้สมัคร'}
                          variant={detailEmp.ssfRegistered ? 'success' : 'neutral'}
                          dot
                        />
                      </InfoRow>
                    </div>
                    {!isOwner && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">เลขบัตรประชาชนแสดงเต็มเฉพาะเจ้าของร้าน</p>
                    )}
                  </section>

                  <section>
                    <SectionHeading icon={<CalendarDays className="size-3.5" />}>การจ้างงาน</SectionHeading>
                    <div className="divide-y divide-border">
                      <InfoRow label="แผนก">{detailDept?.label ?? '-'}</InfoRow>
                      <InfoRow label="วันเริ่มงาน">{fmtDate(detailEmp.startDate)}</InfoRow>
                      <InfoRow label="อายุงาน">{tenureOf(detailEmp.startDate) ?? '-'}</InfoRow>
                      <InfoRow label="วันสิ้นสุดการจ้าง">{fmtDate(detailEmp.employmentEndDate)}</InfoRow>
                    </div>
                  </section>

                  {detailEmp.notes && (
                    <section>
                      <SectionHeading icon={<FileText className="size-3.5" />}>หมายเหตุ</SectionHeading>
                      <p className="mt-2 rounded-xl border border-border bg-[var(--surface-1)] p-3.5 text-sm leading-relaxed text-foreground">
                        {detailEmp.notes}
                      </p>
                    </section>
                  )}
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between gap-3 border-t border-border bg-[var(--surface-1)] px-6 py-4">
                <Button
                  variant="ghost"
                  className="text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
                  onClick={() => handleDelete(detailEmp)}
                  disabled={pending}
                >
                  <Trash2 className="size-4" />
                  ลบ
                </Button>
                <Button onClick={() => openEdit(detailEmp)}>
                  <Pencil className="size-4" />
                  แก้ไขข้อมูล
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create / edit dialog (centered, 2-column form) ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-3xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                {editingId ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {editingId ? 'แก้ไขข้อมูลพนักงาน' : 'กรอกข้อมูลพนักงานใหม่'}
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="ปิด" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              {/* ข้อมูลส่วนตัว */}
              <section className="space-y-3">
                <SectionHeading icon={<Users className="size-3.5" />}>ข้อมูลส่วนตัว</SectionHeading>
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
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>แผนก</Label>
                    <AddOptionPopover
                      kind="department"
                      title="เพิ่มแผนกใหม่"
                      placeholder="เช่น เครื่องดื่ม"
                      existingLabels={departments.map((d) => d.label)}
                      onAdded={(row) => {
                        setCustomOptions((prev) => [...prev, row]);
                        setField('department', row.label);
                      }}
                    />
                  </div>
                  <Select
                    value={form.department || 'none'}
                    onValueChange={(v) => setField('department', v === 'none' ? '' : (v ?? ''))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกแผนก" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">ไม่ระบุแผนก</SelectItem>
                      {(form.department && !departments.some((d) => d.value === form.department)
                        ? [...departments, { value: form.department, label: form.department, variant: 'neutral' as BadgeVariant }]
                        : departments
                      ).map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* ประเภทการจ้างและค่าตอบแทน */}
              <section className="space-y-3">
                <SectionHeading icon={<Wallet className="size-3.5" />}>ประเภทการจ้างและค่าตอบแทน</SectionHeading>
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
                      <Label>Incentive ต่อวัน (฿)</Label>
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
                <div className="space-y-1.5">
                  <Label>สถานะ</Label>
                  <Select value={form.status} onValueChange={(v) => { if (v) setField('status', v as 'active' | 'inactive'); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">ทำงานอยู่</SelectItem>
                      <SelectItem value="inactive">พ้นสภาพ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* ข้อมูลธนาคาร */}
              <section className="space-y-3">
                <SectionHeading icon={<Landmark className="size-3.5" />}>บัญชีธนาคาร</SectionHeading>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>ธนาคาร</Label>
                    <AddOptionPopover
                      kind="bank"
                      title="เพิ่มธนาคาร / ช่องทางใหม่"
                      placeholder="เช่น พร้อมเพย์"
                      existingLabels={banks}
                      onAdded={(row) => {
                        setCustomOptions((prev) => [...prev, row]);
                        setField('bankName', row.label);
                      }}
                    />
                  </div>
                  <Select value={form.bankName} onValueChange={(v) => setField('bankName', v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกธนาคาร" />
                    </SelectTrigger>
                    <SelectContent>
                      {(form.bankName && !banks.includes(form.bankName) ? [...banks, form.bankName] : banks).map((b) => (
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

              {/* เอกสารและกฎหมาย */}
              <section className="space-y-3">
                <SectionHeading icon={<ShieldCheck className="size-3.5" />}>เอกสารและกฎหมาย</SectionHeading>
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>เลขผู้เสียภาษี</Label>
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
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={form.ssfRegistered}
                    onChange={(e) => setField('ssfRegistered', e.target.checked)}
                  />
                  <span className="text-sm text-foreground">สมัครประกันสังคม (SSF 5% สูงสุด ฿750/เดือน)</span>
                </label>
              </section>

              {/* การจ้างงานและหมายเหตุ — full width */}
              <section className="space-y-3 md:col-span-2">
                <SectionHeading icon={<CalendarDays className="size-3.5" />}>การจ้างงานและหมายเหตุ</SectionHeading>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>วันเริ่มงาน</Label>
                    <ThaiDateInput value={form.startDate} onValueChange={(value) => setField('startDate', value)} ariaLabel="เลือกวันเริ่มงาน" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>วันสิ้นสุดการจ้างงาน</Label>
                    <ThaiDateInput
                      value={form.employmentEndDate}
                      onValueChange={(value) => setField('employmentEndDate', value)}
                      min={form.startDate || undefined}
                      ariaLabel="เลือกวันสิ้นสุดการจ้างงาน"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label>หมายเหตุ</Label>
                    <Input value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" />
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-border bg-[var(--surface-1)] px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {pending ? 'กำลังบันทึก...' : editingId ? 'บันทึก' : 'เพิ่มพนักงาน'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
