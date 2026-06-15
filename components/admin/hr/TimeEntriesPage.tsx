'use client';

import { useState, useTransition } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { getTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry } from '@/lib/actions/hr';
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
      <div className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">บันทึกเวลา</h2>
        <p className="text-muted-foreground">ไม่มีพนักงานพาร์ทไทม์ active ในระบบ</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">บันทึกเวลา (พาร์ทไทม์)</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4 mr-1.5" />
          เพิ่มบันทึก
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
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
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
        <span className="self-center text-muted-foreground text-sm">–</span>
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
        <Button variant="outline" onClick={loadEntries} disabled={pending}>
          แสดง
        </Button>
      </div>

      {/* Table */}
      {loaded && (
        <>
          <div className="rounded-lg border border-border overflow-hidden mb-3">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">วันที่</th>
                  <th className="px-4 py-3 text-center font-medium">เข้า</th>
                  <th className="px-4 py-3 text-center font-medium">ออก</th>
                  <th className="px-4 py-3 text-center font-medium">พัก (นาที)</th>
                  <th className="px-4 py-3 text-right font-medium tabular-nums">รวม (ชม.)</th>
                  <th className="px-4 py-3 w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">ไม่มีข้อมูล</td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 text-foreground">
                        {format(new Date(entry.workDate + 'T00:00'), 'd MMM yyyy', { locale: th })}
                      </td>
                      <td className="px-4 py-3 text-center">{entry.clockIn}</td>
                      <td className="px-4 py-3 text-center">{entry.clockOut}</td>
                      <td className="px-4 py-3 text-center">{entry.breakMinutes}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {Number(entry.totalHours).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="size-8" aria-label="แก้ไข" onClick={() => openEdit(entry)}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8 text-red-500" aria-label="ลบ" onClick={() => handleDelete(entry.id)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {entries.length > 0 && (
                <tfoot className="bg-muted/30">
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
              )}
            </table>
          </div>
        </>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? 'แก้ไขบันทึก' : 'เพิ่มบันทึกเวลา'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!editingId && (
              <div className="space-y-1.5">
                <Label>พนักงาน</Label>
                <Select value={form.employeeId} onValueChange={(v) => setForm((p) => ({ ...p, employeeId: v ?? '' }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกพนักงาน" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>วันที่</Label>
              <Input type="date" value={form.workDate} onChange={(e) => setForm((p) => ({ ...p, workDate: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>เวลาเข้า</Label>
                <Input type="time" value={form.clockIn} onChange={(e) => setForm((p) => ({ ...p, clockIn: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>เวลาออก</Label>
                <Input type="time" value={form.clockOut} onChange={(e) => setForm((p) => ({ ...p, clockOut: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>พักกลางวัน (นาที)</Label>
              <Input type="number" min="0" value={form.breakMinutes} onChange={(e) => setForm((p) => ({ ...p, breakMinutes: e.target.value }))} />
            </div>
            {previewHours > 0 && (
              <p className="text-xs text-muted-foreground">
                รวม: <strong>{previewHours.toFixed(2)} ชม.</strong>
              </p>
            )}
            <div className="space-y-1.5">
              <Label>หมายเหตุ</Label>
              <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="ถ้ามี" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSubmit} disabled={pending}>{editingId ? 'บันทึก' : 'เพิ่ม'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
