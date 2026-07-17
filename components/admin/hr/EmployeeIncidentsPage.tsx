'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { Users, Plus, Trash2, Clock, CalendarX, PackageX, MessageSquareWarning, ClipboardList, CheckCircle2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deptLabelOf, deptRank } from '@/lib/hr/departments';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date-time';
import {
  createEmployeeIncident,
  deleteEmployeeIncident,
  resolveEmployeeIncident,
  unresolveEmployeeIncident,
} from '@/lib/actions/hr-incidents';
import type { IncidentEmployee, IncidentRow } from '@/lib/actions/hr-incidents';
import type { IncidentType } from '@/lib/validations/hr';
import type { Role } from '@/lib/auth/permissions';
import type { DamageItem } from '@/lib/db/schema';

interface Props {
  employees: IncidentEmployee[];
  incidents: IncidentRow[];
  damageItems: DamageItem[];
  currentUserId: string;
  role: Role;
}

function fmtBaht(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

const TYPE_CONFIG: Record<IncidentType, { label: string; badge: BadgeVariant; Icon: typeof Clock }> = {
  late:     { label: 'สาย',      badge: 'warning', Icon: Clock },
  absence:  { label: 'ขาด',      badge: 'danger',  Icon: CalendarX },
  damage:   { label: 'เสียหาย',  badge: 'orange',  Icon: PackageX },
  behavior: { label: 'พฤติกรรม', badge: 'info',    Icon: MessageSquareWarning },
};

const INCIDENT_TYPE_ORDER: IncidentType[] = ['late', 'absence', 'damage', 'behavior'];

export function EmployeeIncidentsPage({ employees, incidents, damageItems, currentUserId, role }: Props) {
  const router = useRouter();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(employees[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<IncidentType>('late');
  const [form, setForm] = useState({ occurredDate: '', lateMinutes: '', damageItemId: '', damageQuantity: '', description: '' });

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  const incidentsByEmployee = useMemo(() => {
    const map = new Map<string, IncidentRow[]>();
    for (const inc of incidents) {
      if (!map.has(inc.employeeId)) map.set(inc.employeeId, []);
      map.get(inc.employeeId)!.push(inc);
    }
    return map;
  }, [incidents]);

  const selectedIncidents = useMemo(
    () => (selectedEmployeeId ? (incidentsByEmployee.get(selectedEmployeeId) ?? []) : []),
    [selectedEmployeeId, incidentsByEmployee],
  );

  const departmentGroups = useMemo(() => {
    const map = new Map<string, IncidentEmployee[]>();
    for (const emp of employees) {
      const key = emp.department ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(emp);
    }
    return [...map.entries()]
      .sort(
        (a, b) =>
          deptRank(a[0] || null) - deptRank(b[0] || null) || a[0].localeCompare(b[0], 'th'),
      )
      .map(([key, emps]) => ({ key: key || 'none', label: deptLabelOf(key || null), employees: emps }));
  }, [employees]);

  const summary = useMemo(() => {
    const late = selectedIncidents.filter((i) => i.type === 'late');
    const absence = selectedIncidents.filter((i) => i.type === 'absence');
    const damage = selectedIncidents.filter((i) => i.type === 'damage');
    const behavior = selectedIncidents.filter((i) => i.type === 'behavior');
    return {
      lateCount: late.length,
      lateMinutes: late.reduce((s, i) => s + (i.lateMinutes ?? 0), 0),
      absenceCount: absence.length,
      damageCount: damage.length,
      damageQuantity: damage.reduce((s, i) => s + (i.damageQuantity ?? 0), 0),
      damageTotal: damage.reduce(
        (s, i) => s + (i.damageQuantity ?? 0) * Number(i.damageUnitPrice ?? 0),
        0,
      ),
      behaviorCount: behavior.length,
    };
  }, [selectedIncidents]);

  const selectedDamageItem = damageItems.find((d) => d.id === form.damageItemId) ?? null;
  const damageTotalPreview = selectedDamageItem
    ? (Number(form.damageQuantity) || 0) * Number(selectedDamageItem.pricePerUnit)
    : 0;

  function openAdd(type: IncidentType) {
    setAddType(type);
    setForm({ occurredDate: '', lateMinutes: '', damageItemId: '', damageQuantity: '', description: '' });
    setAddOpen(true);
  }

  function submitAdd() {
    if (!selectedEmployeeId) return;
    startTransition(async () => {
      const result = await createEmployeeIncident({
        employeeId: selectedEmployeeId,
        type: addType,
        occurredDate: form.occurredDate,
        lateMinutes: addType === 'late' ? Number(form.lateMinutes) || null : null,
        damageItemId: addType === 'damage' ? form.damageItemId || null : null,
        damageQuantity: addType === 'damage' ? Number(form.damageQuantity) || null : null,
        description: form.description || null,
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('บันทึกรายงานแล้ว');
      setAddOpen(false);
      router.refresh();
    });
  }

  function handleResolve(incident: IncidentRow) {
    openConfirm(
      'ทำเครื่องหมายว่ารายการนี้จัดการแล้ว (จัดการเองนอกรอบเงินเดือน)?',
      () => {
        startTransition(async () => {
          const result = await resolveEmployeeIncident(incident.id);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('ทำเครื่องหมายจัดการแล้ว');
          router.refresh();
        });
      },
      { confirmLabel: 'จัดการแล้ว', variant: 'default' },
    );
  }

  function handleUnresolve(incident: IncidentRow) {
    openConfirm(
      'ยกเลิกการทำเครื่องหมายจัดการแล้ว? รายการจะกลับเป็นรอจัดการ',
      () => {
        startTransition(async () => {
          const result = await unresolveEmployeeIncident(incident.id);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('ยกเลิกแล้ว — รายการกลับเป็นรอจัดการ');
          router.refresh();
        });
      },
      { confirmLabel: 'ยกเลิกการจัดการ', variant: 'danger' },
    );
  }

  function handleDelete(incident: IncidentRow) {
    openConfirm(
      'ลบรายงานนี้? รายการจะถูกลบถาวร',
      () => {
        startTransition(async () => {
          const result = await deleteEmployeeIncident(incident.id);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('ลบรายงานแล้ว');
          router.refresh();
        });
      },
      { confirmLabel: 'ลบรายงาน', variant: 'danger' },
    );
  }

  const addCfg = TYPE_CONFIG[addType];

  return (
    <AppShell>
      {confirmDialog}

      <PageHeader
        title="รายงานพนักงาน"
        subtitle="แจ้งสาย ขาดงาน ของเสียหาย และพฤติกรรมของพนักงาน — เลือกพนักงานแล้วกดแจ้งรายการ"
      />

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Left: employee list */}
        <div className="w-full shrink-0 lg:w-80">
          <DataCard noPadding title="พนักงาน" subtitle={`${employees.length} คน · แตะเพื่อดูและแจ้งรายการ`}>
            {employees.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="ไม่มีพนักงาน"
                description="ยังไม่มีพนักงานที่ทำงานอยู่ในระบบ"
                size="sm"
              />
            ) : (
              departmentGroups.map((group) => (
                <div key={group.key}>
                  <div className="border-t border-border bg-[var(--surface-2)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label} · {group.employees.length} คน
                  </div>
                  {group.employees.map((emp) => {
                    const isSelected = emp.id === selectedEmployeeId;
                    const count = incidentsByEmployee.get(emp.id)?.length ?? 0;
                    return (
                      <button
                        key={emp.id}
                        onClick={() => setSelectedEmployeeId(emp.id)}
                        className={cn(
                          'w-full border-t border-border px-4 py-3 text-left transition-colors',
                          isSelected
                            ? 'border-l-2 border-l-primary bg-[var(--surface-primary-subtle)]'
                            : 'border-l-2 border-l-transparent hover:bg-muted/30',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('truncate text-sm font-semibold', isSelected ? 'text-primary' : 'text-foreground')}>
                            {emp.firstName} {emp.lastName}
                          </span>
                          {count > 0 && (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                              {count} รายการ
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {emp.type === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </DataCard>
        </div>

        {/* Right: selected employee panel */}
        <div className="flex-1 min-w-0">
          {selectedEmployee ? (
            <DataCard
              title={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
              subtitle={`${selectedEmployee.type === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์'} · ${deptLabelOf(selectedEmployee.department)}`}
            >
              <div className="space-y-5">
                {/* Report buttons */}
                <div className="flex flex-wrap gap-2">
                  {INCIDENT_TYPE_ORDER.map((type) => {
                    const cfg = TYPE_CONFIG[type];
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => openAdd(type)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-[var(--surface-primary-subtle)] hover:text-primary"
                      >
                        <Plus className="size-3.5" />
                        แจ้ง{cfg.label}
                      </button>
                    );
                  })}
                </div>

                {/* Summary */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">สาย</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {summary.lateCount} ครั้ง{summary.lateMinutes > 0 ? ` · ${summary.lateMinutes} นาที` : ''}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">ขาด</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{summary.absenceCount} วัน</p>
                  </div>
                  <div className="rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">เสียหาย</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {summary.damageCount} ครั้ง{summary.damageQuantity > 0 ? ` · ${summary.damageQuantity} ชิ้น` : ''}
                    </p>
                    {summary.damageTotal > 0 && (
                      <p className="text-[11px] tabular-nums text-[var(--status-danger-fg)]">
                        รวม ฿{fmtBaht(summary.damageTotal)}
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">พฤติกรรม</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{summary.behaviorCount} เรื่อง</p>
                  </div>
                </div>

                {/* History */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">ประวัติรายงาน</p>
                  {selectedIncidents.length === 0 ? (
                    <EmptyState
                      icon={<ClipboardList className="size-5" />}
                      title="ยังไม่มีรายงาน"
                      description="กดปุ่มแจ้งด้านบนเพื่อบันทึกรายการแรก"
                      size="sm"
                    />
                  ) : (
                    <div className="divide-y divide-border rounded-lg border border-border">
                      {selectedIncidents.map((inc) => {
                        const cfg = TYPE_CONFIG[inc.type as IncidentType] ?? TYPE_CONFIG.behavior;
                        const isPayrollResolved = inc.resolved;
                        const isManualResolved = !isPayrollResolved && inc.resolvedAt != null;
                        const isResolved = isPayrollResolved || isManualResolved;
                        // Pulled into a cycle but not yet paid + approved — intermediate state
                        const isInPayrollPending = inc.inPayroll && !isPayrollResolved;
                        const moneyType = inc.type !== 'behavior';
                        const canDelete =
                          (role === 'owner' || inc.reportedBy === currentUserId) && !isResolved && !isInPayrollPending;
                        return (
                          <div key={inc.id} className="flex items-start gap-3 px-4 py-3">
                            <div className="flex flex-col items-start gap-1 pt-0.5">
                              <StatusBadge label={cfg.label} variant={cfg.badge} dot />
                              {moneyType && (
                                <StatusBadge
                                  label={isResolved ? 'จัดการแล้ว' : isInPayrollPending ? 'อยู่ในรอบจ่าย' : 'รอจัดการ'}
                                  variant={isResolved ? 'success' : isInPayrollPending ? 'info' : 'warning'}
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 text-sm">
                              <p className="font-medium text-foreground">
                                {formatThaiDate(inc.occurredDate, inc.occurredDate)}
                                {inc.type === 'late' && inc.lateMinutes ? ` · สาย ${inc.lateMinutes} นาที` : ''}
                                {inc.type === 'damage' && inc.damageItemName
                                  ? ` · ${inc.damageItemName} × ${inc.damageQuantity ?? 0}${
                                      Number(inc.damageUnitPrice ?? 0) > 0
                                        ? ` = ฿${fmtBaht((inc.damageQuantity ?? 0) * Number(inc.damageUnitPrice ?? 0))}`
                                        : ''
                                    }`
                                  : inc.type === 'damage' && inc.damageQuantity
                                    ? ` · ${inc.damageQuantity} ชิ้น`
                                    : ''}
                              </p>
                              {inc.description && (
                                <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{inc.description}</p>
                              )}
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                แจ้งโดย {inc.reporterName ?? '-'} · {formatThaiDateTime(inc.createdAt)}
                              </p>
                              {isPayrollResolved && inc.payrollPayDate && (
                                <p className="mt-0.5 text-[11px] font-medium text-[var(--status-success-fg)]">
                                  จัดการในรอบจ่ายวันที่ {formatThaiDate(inc.payrollPayDate, inc.payrollPayDate)}
                                </p>
                              )}
                              {isInPayrollPending && (
                                <p className="mt-0.5 text-[11px] font-medium text-[var(--status-info-fg)]">
                                  ดึงเข้ารอบจ่ายวันที่ {inc.payrollPayDate ? formatThaiDate(inc.payrollPayDate, inc.payrollPayDate) : '-'} แล้ว — รอจ่ายเงินและอนุมัติรอบ
                                </p>
                              )}
                              {isManualResolved && (
                                <p className="mt-0.5 text-[11px] font-medium text-[var(--status-success-fg)]">
                                  จัดการเองโดย {inc.resolverName ?? '-'} · {formatThaiDateTime(inc.resolvedAt)}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {moneyType && !isResolved && !isInPayrollPending && (
                                <button
                                  type="button"
                                  onClick={() => handleResolve(inc)}
                                  disabled={pending}
                                  aria-label="ทำเครื่องหมายจัดการแล้ว"
                                  title="จัดการแล้ว (นอกรอบเงินเดือน)"
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[var(--status-success-bg)] hover:text-[var(--status-success-fg)]"
                                >
                                  <CheckCircle2 className="size-4" />
                                </button>
                              )}
                              {isManualResolved && (
                                <button
                                  type="button"
                                  onClick={() => handleUnresolve(inc)}
                                  disabled={pending}
                                  aria-label="ยกเลิกการจัดการ"
                                  title="ยกเลิก — กลับเป็นรอจัดการ"
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <Undo2 className="size-4" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(inc)}
                                  disabled={pending}
                                  aria-label="ลบรายงาน"
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </DataCard>
          ) : (
            <div className="rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] flex items-center justify-center min-h-[300px]">
              <EmptyState
                icon={<Users className="size-5" />}
                title="เลือกพนักงาน"
                description="เลือกพนักงานจากรายชื่อด้านซ้ายเพื่อดูและแจ้งรายการ"
              />
            </div>
          )}
        </div>
      </div>

      {/* Add incident — centered dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border bg-muted/30 px-6 py-4">
            <DialogTitle className="text-base font-semibold">แจ้ง{addCfg.label}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {selectedEmployee?.firstName} {selectedEmployee?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label>วันที่เกิดเหตุ *</Label>
              <ThaiDateInput
                value={form.occurredDate}
                onValueChange={(occurredDate) => setForm((p) => ({ ...p, occurredDate }))}
                ariaLabel="เลือกวันที่เกิดเหตุ"
              />
            </div>
            {addType === 'late' && (
              <div className="space-y-1.5">
                <Label>สายกี่นาที *</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.lateMinutes}
                  onChange={(e) => setForm((p) => ({ ...p, lateMinutes: e.target.value }))}
                />
              </div>
            )}
            {addType === 'damage' && (
              damageItems.length === 0 ? (
                <p className="rounded-lg bg-muted/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  ยังไม่มีรายการของเสียหายในระบบ — เจ้าของร้านเพิ่มได้ที่เมนู <strong>ตั้งค่า HR</strong> (ระบุชื่อของและราคาต่อชิ้น)
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>ของที่เสียหาย *</Label>
                    <Select
                      value={form.damageItemId}
                      onValueChange={(v) => { if (v) setForm((p) => ({ ...p, damageItemId: v })); }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="เลือกของที่เสียหาย">
                          {selectedDamageItem
                            ? `${selectedDamageItem.name} — ฿${fmtBaht(Number(selectedDamageItem.pricePerUnit))}/ชิ้น`
                            : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {damageItems.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name} — ฿{fmtBaht(Number(d.pricePerUnit))}/ชิ้น
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>จำนวนชิ้นที่เสียหาย *</Label>
                    <Input
                      type="number"
                      min="1"
                      value={form.damageQuantity}
                      onChange={(e) => setForm((p) => ({ ...p, damageQuantity: e.target.value }))}
                    />
                  </div>
                  {selectedDamageItem && Number(form.damageQuantity) > 0 && (
                    <p className="rounded-lg bg-[var(--surface-primary-subtle)] px-3.5 py-2.5 text-sm font-medium tabular-nums text-primary">
                      รวมค่าเสียหาย ฿{fmtBaht(damageTotalPreview)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({form.damageQuantity} × ฿{fmtBaht(Number(selectedDamageItem.pricePerUnit))})
                      </span>
                    </p>
                  )}
                </>
              )
            )}
            <div className="space-y-1.5">
              <Label>
                รายละเอียด {addType === 'behavior' ? '*' : <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>}
              </Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder={
                  addType === 'damage'
                    ? 'เช่น ทำแก้วแตก 3 ใบระหว่างเก็บโต๊ะ'
                    : addType === 'behavior'
                      ? 'เช่น พูดจาไม่สุภาพกับลูกค้า / ช่วยงานเพื่อนดีมาก'
                      : 'รายละเอียดเพิ่มเติม (ถ้ามี)'
                }
                className="min-h-20 resize-none"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-muted/30 px-6 py-4">
            <Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitAdd} disabled={pending || (addType === 'damage' && damageItems.length === 0)}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
