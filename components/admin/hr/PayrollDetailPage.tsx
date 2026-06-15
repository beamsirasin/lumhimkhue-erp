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
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ChevronLeft, Plus, Trash2, Printer, CheckCircle2 } from 'lucide-react';
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
              <div key={d.id} className="flex justify-between text-red-600">
                <span>เบิก: {d.reason}</span><span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
              </div>
            ))}
            {item.deductions.filter((d) => d.type === 'damage').map((d) => (
              <div key={d.id} className="flex justify-between text-red-600">
                <span>เสียหาย: {d.reason}</span><span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
              </div>
            ))}
            {Number(item.absenceDeduction) > 0 && (
              <div className="flex justify-between text-red-600">
                <span>ขาด {item.absenceDays} วัน × ฿{fmtMoney(settings.absenceRatePerDay)}</span>
                <span className="tabular-nums">-฿{fmtMoney(item.absenceDeduction)}</span>
              </div>
            )}
            {Number(item.lateDeduction) > 0 && (
              <div className="flex justify-between text-red-600">
                <span>สาย {item.lateMinutes} นาที × ฿{fmtMoney(settings.lateRatePerMinute)}</span>
                <span className="tabular-nums">-฿{fmtMoney(item.lateDeduction)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t pt-1 text-red-600">
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
        <p className="text-xs text-green-600 text-center">
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
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
        <div className="font-semibold text-foreground flex items-center justify-between">
          <span>{emp?.firstName} {emp?.lastName}</span>
          <Badge variant={item.isPaid ? 'default' : 'outline'}>
            {item.isPaid ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}
          </Badge>
        </div>

        {/* รายได้ */}
        <div className="space-y-1 text-xs">
          <p className="font-semibold text-muted-foreground mt-2">รายได้</p>
          {item.employeeType === 'full_time' ? (
            <>
              <div className="flex justify-between"><span>เงินเดือนฐาน</span><span className="tabular-nums">฿{fmtMoney(item.baseSalary)}</span></div>
              <div className="flex justify-between">
                <span>Incentive ({item.workDays} วัน × ฿{fmtMoney(item.incentivePerDay)})</span>
                <span className="tabular-nums">฿{fmtMoney(item.incentiveTotal)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between">
              <span>ชั่วโมง ({Number(item.totalHours).toFixed(2)} ชม. × ฿{fmtMoney(item.hourlyRate)})</span>
              <span className="tabular-nums">฿{fmtMoney(item.hourlyTotal)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold border-t border-border pt-1">
            <span>รวมรายได้</span>
            <span className="tabular-nums">฿{fmtMoney(item.gross)}</span>
          </div>
        </div>

        {/* หัก */}
        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between mt-2">
            <p className="font-semibold text-muted-foreground">หักเงิน</p>
            {!locked && (
              <div className="flex gap-1">
                <button onClick={() => openAdd('advance')} className="text-xs text-blue-600 hover:underline">+เบิก</button>
                <span className="text-muted-foreground/60">|</span>
                <button onClick={() => openAdd('damage')} className="text-xs text-blue-600 hover:underline">+เสียหาย</button>
                <span className="text-muted-foreground/60">|</span>
                <button onClick={() => openAdd('absence')} className="text-xs text-blue-600 hover:underline">+ขาด</button>
                <span className="text-muted-foreground/60">|</span>
                <button onClick={() => openAdd('late')} className="text-xs text-blue-600 hover:underline">+สาย</button>
              </div>
            )}
          </div>

          {item.deductions.filter((d) => d.type === 'advance').map((d) => (
            <div key={d.id} className="flex justify-between text-red-600">
              <span className="flex items-center gap-1">
                เบิก: {d.reason}
                {!locked && <button onClick={() => deleteDeduction(d.id)} className="text-red-400 hover:text-red-600"><Trash2 className="size-3" /></button>}
              </span>
              <span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
            </div>
          ))}
          {item.deductions.filter((d) => d.type === 'damage').map((d) => (
            <div key={d.id} className="flex justify-between text-red-600">
              <span className="flex items-center gap-1">
                เสียหาย: {d.reason}
                {!locked && <button onClick={() => deleteDeduction(d.id)} className="text-red-400 hover:text-red-600"><Trash2 className="size-3" /></button>}
              </span>
              <span className="tabular-nums">-฿{fmtMoney(d.amount)}</span>
            </div>
          ))}
          {item.absences.filter((a) => a.type === 'absence').map((a) => (
            <div key={a.id} className="flex justify-between text-red-600">
              <span className="flex items-center gap-1">
                ขาด: {a.occurredDate}
                {!locked && <button onClick={() => deleteAbsence(a.id)} className="text-red-400 hover:text-red-600"><Trash2 className="size-3" /></button>}
              </span>
              <span className="tabular-nums">-฿{fmtMoney(settings?.absenceRatePerDay ?? 0)}</span>
            </div>
          ))}
          {item.absences.filter((a) => a.type === 'late').map((a) => (
            <div key={a.id} className="flex justify-between text-red-600">
              <span className="flex items-center gap-1">
                สาย {a.lateMinutes} นาที ({a.occurredDate})
                {!locked && <button onClick={() => deleteAbsence(a.id)} className="text-red-400 hover:text-red-600"><Trash2 className="size-3" /></button>}
              </span>
              <span className="tabular-nums">-฿{fmtMoney(Number(a.lateMinutes ?? 0) * Number(settings?.lateRatePerMinute ?? 0))}</span>
            </div>
          ))}

          {Number(item.totalDeduction) > 0 && (
            <div className="flex justify-between font-semibold text-red-600 border-t border-border pt-1">
              <span>รวมหัก</span>
              <span className="tabular-nums">-฿{fmtMoney(item.totalDeduction)}</span>
            </div>
          )}
        </div>

        <Separator />
        <div className="flex justify-between font-bold text-base">
          <span>เงินสุทธิ</span>
          <span className="tabular-nums text-foreground">฿{fmtMoney(item.netPay)}</span>
        </div>
      </div>

      {/* Payment status */}
      {item.isPaid ? (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-xs text-green-700 space-y-1">
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

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {addType === 'advance' ? 'เพิ่มรายการเบิก' : addType === 'damage' ? 'เพิ่มรายการเสียหาย' : addType === 'absence' ? 'บันทึกขาด' : 'บันทึกสาย'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitAdd} disabled={pending}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>บันทึกการจ่ายเงินเดือน</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm">
              {emp?.firstName} {emp?.lastName} — <strong>฿{fmtMoney(item.netPay)}</strong>
            </p>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitPay} disabled={pending}>ยืนยันจ่าย</Button>
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
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/hr/payroll" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-foreground">{detail.cycle.name}</h2>
          <p className="text-xs text-muted-foreground">
            ช่วงงาน {fmtDate(detail.cycle.workStartDate)} – {fmtDate(detail.cycle.workEndDate)} |
            วันจ่าย {fmtDate(detail.cycle.payDate)}
          </p>
        </div>
        <div className="flex gap-2">
          {detail.cycle.status === 'draft' && (
            <Button variant="outline" size="sm" onClick={handleFinalize} disabled={pending}>
              อนุมัติรอบนี้
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left: employee list */}
        <div className="w-64 shrink-0">
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground">พนักงาน ({detail.items.length} คน)</div>
            {detail.items.map((item) => {
              const emp = item.employee;
              const isSelected = item.id === selectedItemId;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedItemId(item.id)}
                  className={`w-full text-left px-3 py-2.5 border-t border-border transition-colors ${isSelected ? 'bg-primary text-white' : 'hover:bg-muted/30'}`}
                >
                  <div className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-foreground'}`}>
                    {emp?.firstName} {emp?.lastName}
                  </div>
                  <div className={`text-xs flex items-center justify-between mt-0.5 ${isSelected ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
                    <span>฿{fmtMoney(item.netPay)}</span>
                    {item.isPaid && <CheckCircle2 className="size-3 text-green-400" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Summary */}
          <div className="mt-3 rounded-lg border border-border p-3 text-xs space-y-1">
            <div className="flex justify-between font-semibold">
              <span>รวมสุทธิทั้งหมด</span>
              <span className="tabular-nums">
                ฿{detail.items.reduce((s, i) => s + Number(i.netPay), 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>จ่ายแล้ว</span>
              <span>{detail.items.filter((i) => i.isPaid).length}/{detail.items.length} คน</span>
            </div>
          </div>
        </div>

        {/* Right: item detail */}
        <div className="flex-1 min-w-0">
          {selectedItem ? (
            <ItemPanel
              item={selectedItem}
              cycle={detail.cycle}
              onRefresh={refresh}
              cycleStatus={detail.cycle.status}
              settings={settings}
            />
          ) : (
            <div className="text-center py-12 text-muted-foreground">เลือกพนักงานด้านซ้ายเพื่อดูรายละเอียด</div>
          )}
        </div>
      </div>
    </div>
  );
}
