'use client';

import { useState, useTransition } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Time24Select } from '@/components/ui/time-24-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
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
import { Plus, MoreHorizontal, Clock, X } from 'lucide-react';
import { getTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry } from '@/lib/actions/hr';
import { formatThaiDate } from '@/lib/date-time';
import type { Employee, TimeEntry } from '@/lib/db/schema';

interface Props {
  initialEmployees: Employee[];
}

type FormState = {
  employeeId: string;
  workDate: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: string;
  notes: string;
};

const defaultForm: FormState = {
  employeeId: '',
  workDate: format(new Date(), 'yyyy-MM-dd'),
  clockIn: '09:00',
  clockOut: '17:00',
  breakMinutes: '0',
  notes: '',
};

function calcHours(clockIn: string, clockOut: string, breakMin: number): number {
  const [ih, im] = clockIn.split(':').map(Number);
  const [oh, om] = clockOut.split(':').map(Number);
  const mins = (oh * 60 + om) - (ih * 60 + im) - breakMin;
  return Math.round((mins / 60) * 100) / 100;
}

export function TimeEntriesPage({ initialEmployees }: Props) {
  const [employees] = useState(initialEmployees);
  const [selectedEmpId, setSelectedEmpId] = useState(employees[0]?.id ?? '');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return format(d, 'yyyy-MM-dd');
  });
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [pending, startTransition] = useTransition();

  function loadEntries() {
    if (!selectedEmpId) return;
    startTransition(async () => {
      const rows = await getTimeEntries(selectedEmpId, startDate, endDate);
      setEntries(rows);
      setLoaded(true);
    });
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...defaultForm, employeeId: selectedEmpId });
    setOpen(true);
  }

  function openEdit(entry: TimeEntry) {
    setEditingId(entry.id);
    setForm({
      employeeId: entry.employeeId,
      workDate: entry.workDate,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      breakMinutes: String(entry.breakMinutes),
      notes: entry.notes ?? '',
    });
    setOpen(true);
  }

  function handleSubmit() {
    const payload = {
      ...form,
      breakMinutes: Number(form.breakMinutes || 0),
    };
    startTransition(async () => {
      const result = editingId
        ? await updateTimeEntry(editingId, payload)
        : await createTimeEntry(payload);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(editingId ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว');
      setOpen(false);
      loadEntries();
    });
  }

  function handleDelete(id: string) {
    if (!confirm('ลบบันทึกนี้?')) return;
    startTransition(async () => {
      const result = await deleteTimeEntry(id);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('ลบแล้ว');
      setEntries((prev) => prev.filter((e) => e.id !== id));
    });
  }

  const totalHours = entries.reduce((s, e) => s + Number(e.totalHours), 0);
  const selectedEmp = employees.find((e) => e.id === selectedEmpId);
  const previewHours = calcHours(form.clockIn, form.clockOut, Number(form.breakMinutes || 0));

  if (employees.length === 0) {
    return (
      <AppShell>
        <PageHeader title="บันทึกเวลา (พาร์ทไทม์)" />
        <EmptyState
          icon={<Clock className="size-5" />}
          title="ไม่มีพนักงานพาร์ทไทม์"
          description="ไม่มีพนักงานพาร์ทไทม์ active ในระบบ"
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="บันทึกเวลา (พาร์ทไทม์)"
        subtitle={selectedEmp ? `${selectedEmp.firstName} ${selectedEmp.lastName}` : undefined}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            เพิ่มบันทึก
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={selectedEmpId} onValueChange={(v) => { if (v) setSelectedEmpId(v); }}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="เลือกพนักงาน" />
          </SelectTrigger>
          <SelectContent>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.firstName} {e.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ThaiDateInput
          value={startDate}
          onValueChange={setStartDate}
          className="w-40"
          ariaLabel="เลือกวันเริ่มต้น"
        />
        <span className="self-center text-muted-foreground text-sm">–</span>
        <ThaiDateInput
          value={endDate}
          onValueChange={setEndDate}
          className="w-40"
          min={startDate}
          ariaLabel="เลือกวันสิ้นสุด"
        />
        <Button variant="outline" onClick={loadEntries} disabled={pending}>
          แสดง
        </Button>
      </div>

      {/* Table */}
      {loaded && (
        <DataCard noPadding>
          {entries.length === 0 ? (
            <EmptyState
              icon={<Clock className="size-5" />}
              title="ไม่มีบันทึกเวลา"
              description="ไม่พบข้อมูลในช่วงวันที่เลือก"
              size="sm"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-2)] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">วันที่</th>
                    <th className="px-4 py-3 text-center font-medium">เข้า</th>
                    <th className="px-4 py-3 text-center font-medium">ออก</th>
                    <th className="px-4 py-3 text-center font-medium">พัก (นาที)</th>
                    <th className="px-4 py-3 text-right font-medium tabular-nums">รวม (ชม.)</th>
                    <th className="px-4 py-3 w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-foreground">
                        {formatThaiDate(entry.workDate)}
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{entry.clockIn}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{entry.clockOut}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{entry.breakMinutes}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                        {Number(entry.totalHours).toFixed(2)}
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
                            <DropdownMenuItem onClick={() => openEdit(entry)}>
                              แก้ไข
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDelete(entry.id)}
                            >
                              ลบ
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[var(--surface-2)]">
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-foreground">
                      รวม {entries.length} วัน
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sm font-bold text-foreground">
                      {totalHours.toFixed(2)} ชม.
                    </td>
                    <td />
                  </tr>
                  {selectedEmp?.hourlyRate && (
                    <tr>
                      <td colSpan={4} className="px-4 py-1 text-xs text-muted-foreground">
                        ประมาณรายได้ ({totalHours.toFixed(2)} × ฿{Number(selectedEmp.hourlyRate).toLocaleString()}/ชม.)
                      </td>
                      <td className="px-4 py-1 text-right tabular-nums text-xs font-semibold text-foreground">
                        ฿{(totalHours * Number(selectedEmp.hourlyRate)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}
        </DataCard>
      )}

      {/* Add/Edit Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex flex-col gap-0 p-0 sm:max-w-[400px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-base font-semibold text-foreground">
                {editingId ? 'แก้ไขบันทึก' : 'เพิ่มบันทึกเวลา'}
              </p>
              {previewHours > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  รวม <strong>{previewHours.toFixed(2)} ชม.</strong>
                </p>
              )}
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
            {!editingId && (
              <div className="space-y-1.5">
                <Label>พนักงาน</Label>
                <Select
                  value={form.employeeId}
                  onValueChange={(v) => setForm((p) => ({ ...p, employeeId: v ?? '' }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกพนักงาน" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>วันที่</Label>
              <ThaiDateInput
                value={form.workDate}
                onValueChange={(workDate) => setForm((p) => ({ ...p, workDate }))}
                ariaLabel="เลือกวันที่ลงเวลา"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>เวลาเข้า</Label>
                <Time24Select
                  label="เวลาเข้า"
                  value={form.clockIn}
                  onValueChange={(clockIn) => setForm((p) => ({ ...p, clockIn }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>เวลาออก</Label>
                <Time24Select
                  label="เวลาออก"
                  value={form.clockOut}
                  onValueChange={(clockOut) => setForm((p) => ({ ...p, clockOut }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>พักกลางวัน (นาที)</Label>
              <Input
                type="number"
                min="0"
                value={form.breakMinutes}
                onChange={(e) => setForm((p) => ({ ...p, breakMinutes: e.target.value }))}
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
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {editingId ? 'บันทึก' : 'เพิ่ม'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
