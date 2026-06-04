'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { createEmployee, updateEmployee, deleteEmployee } from '@/lib/actions/hr';
import type { Employee } from '@/lib/db/schema';

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
}

export function EmployeesPage({ initialEmployees }: Props) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [filterType, setFilterType] = useState<'all' | 'full_time' | 'part_time'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [pending, startTransition] = useTransition();

  const displayed = employees.filter((e) => {
    if (filterType !== 'all' && e.type !== filterType) return false;
    if (filterStatus !== 'all' && e.status !== filterStatus) return false;
    return true;
  });

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
      bankName: emp.bankName ?? '',
      bankAccountNumber: emp.bankAccountNumber ?? '',
      type: emp.type,
      status: emp.status,
      baseSalaryPerCycle: emp.baseSalaryPerCycle ?? '',
      incentivePerDay: emp.incentivePerDay ?? '0',
      hourlyRate: emp.hourlyRate ?? '',
      startDate: emp.startDate ?? '',
      notes: emp.notes ?? '',
    });
    setOpen(true);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    const currentEditingId = editingId;
    const payload = {
      ...form,
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
      // Optimistic update
      if (!currentEditingId && 'data' in result && result.data) {
        setEmployees((prev) => [...prev, result.data as Employee]);
      } else if (currentEditingId) {
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === currentEditingId
              ? { ...e, ...payload, baseSalaryPerCycle: payload.baseSalaryPerCycle != null ? String(payload.baseSalaryPerCycle) : null, hourlyRate: payload.hourlyRate != null ? String(payload.hourlyRate) : null, incentivePerDay: String(payload.incentivePerDay) }
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

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900">ข้อมูลพนักงาน</h2>
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4 mr-1.5" />
          เพิ่มพนักงาน
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <Select value={filterType} onValueChange={(v) => { if (v) setFilterType(v as typeof filterType); }}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกประเภท</SelectItem>
            <SelectItem value="full_time">พนักงานประจำ</SelectItem>
            <SelectItem value="part_time">พาร์ทไทม์</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { if (v) setFilterStatus(v as typeof filterStatus); }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            <SelectItem value="active">ทำงานอยู่</SelectItem>
            <SelectItem value="inactive">ไม่ active</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">ชื่อ-สกุล</th>
              <th className="px-4 py-3 text-left font-medium">ประเภท</th>
              <th className="px-4 py-3 text-left font-medium">เบอร์</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">ค่าจ้าง</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  ไม่มีพนักงานในระบบ
                </td>
              </tr>
            ) : (
              displayed.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {emp.firstName} {emp.lastName}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={emp.type === 'full_time' ? 'default' : 'secondary'}>
                      {emp.type === 'full_time' ? 'ประจำ' : 'พาร์ทไทม์'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{emp.phone ?? '-'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {emp.type === 'full_time' ? (
                      <>
                        <span>฿{Number(emp.baseSalaryPerCycle ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}</span>
                        <span className="text-xs text-slate-400">/รอบ</span>
                      </>
                    ) : (
                      <>
                        <span>฿{Number(emp.hourlyRate ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}</span>
                        <span className="text-xs text-slate-400">/ชม.</span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={emp.status === 'active' ? 'default' : 'outline'}>
                      {emp.status === 'active' ? 'ทำงาน' : 'inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="แก้ไข"
                        onClick={() => openEdit(emp)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-red-500 hover:text-red-600"
                        aria-label="ลบ"
                        onClick={() => handleDelete(emp)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* ข้อมูลส่วนตัว */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">ข้อมูลส่วนตัว</p>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">ข้อมูลธนาคาร</p>
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

            {/* ประเภทการจ้าง */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">ประเภทการจ้าง</p>
              <Separator />
              <div className="flex gap-3">
                {(['full_time', 'part_time'] as const).map((t) => (
                  <label
                    key={t}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 cursor-pointer text-sm font-medium transition-colors ${
                      form.type === t
                        ? 'border-slate-800 bg-slate-800 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-400'
                    }`}
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
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">อื่นๆ</p>
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {pending ? 'กำลังบันทึก...' : editingId ? 'บันทึก' : 'เพิ่มพนักงาน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
