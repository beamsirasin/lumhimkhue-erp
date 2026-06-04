'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, ChevronRight } from 'lucide-react';
import { createPayrollCycle } from '@/lib/actions/hr';
import { useRouter } from 'next/navigation';

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
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  finalized: 'secondary',
  paid: 'default',
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900">เงินเดือน / รอบจ่าย</h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          สร้างรอบจ่ายใหม่
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
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
          <tbody className="divide-y divide-slate-100">
            {cycles.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">ยังไม่มีรอบจ่าย</td>
              </tr>
            ) : (
              cycles.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/hr/payroll/${c.id}`)}>
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {fmtDate(c.workStartDate)} – {fmtDate(c.workEndDate)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(c.payDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                    ฿{c.totalNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-center text-sm">
                    <span className={c.paidCount === c.totalCount && c.totalCount > 0 ? 'text-green-600 font-semibold' : 'text-slate-500'}>
                      {c.paidCount}/{c.totalCount}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="size-4 text-slate-400" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>สร้างรอบจ่ายใหม่</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>ชื่องวด *</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="เช่น งวด 1-14 มิ.ย. 69" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>วันเริ่มงาน *</Label>
                <Input type="date" value={form.workStartDate} onChange={(e) => setForm((p) => ({ ...p, workStartDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>วันสิ้นสุดงาน *</Label>
                <Input type="date" value={form.workEndDate} onChange={(e) => setForm((p) => ({ ...p, workEndDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>วันจ่ายเงิน *</Label>
              <Input type="date" value={form.payDate} onChange={(e) => setForm((p) => ({ ...p, payDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>หมายเหตุ</Label>
              <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="ถ้ามี" />
            </div>
            <p className="text-xs text-slate-500 bg-slate-50 rounded p-2">
              ระบบจะสร้าง payroll item ให้พนักงาน active ทุกคนอัตโนมัติ
              พร้อมคำนวณวันทำงานจากตารางงานและชั่วโมงจาก time entries
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? 'กำลังสร้าง...' : 'สร้างรอบ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
