'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { saveHrSettings } from '@/lib/actions/hr';
import type { HrSettings } from '@/lib/db/schema';

interface Props {
  initialData: HrSettings;
}

export function HrSettingsForm({ initialData }: Props) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    absenceRatePerDay: String(initialData.absenceRatePerDay),
    lateRatePerMinute: String(initialData.lateRatePerMinute),
    morningShiftStart: initialData.morningShiftStart,
    morningShiftEnd: initialData.morningShiftEnd,
    afternoonShiftStart: initialData.afternoonShiftStart,
    afternoonShiftEnd: initialData.afternoonShiftEnd,
    defaultBreakMinutes: String(initialData.defaultBreakMinutes),
  });

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveHrSettings({
        absenceRatePerDay: Number(form.absenceRatePerDay),
        lateRatePerMinute: Number(form.lateRatePerMinute),
        morningShiftStart: form.morningShiftStart,
        morningShiftEnd: form.morningShiftEnd,
        afternoonShiftStart: form.afternoonShiftStart,
        afternoonShiftEnd: form.afternoonShiftEnd,
        defaultBreakMinutes: Number(form.defaultBreakMinutes),
      });
      if (result.ok) {
        toast.success('บันทึกการตั้งค่าแล้ว');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* เรทหักเงิน */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">เรทหักเงิน</h3>
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="absenceRatePerDay">หักขาดต่อวัน (฿)</Label>
            <Input
              id="absenceRatePerDay"
              type="number"
              min="0"
              step="0.01"
              value={form.absenceRatePerDay}
              onChange={(e) => setField('absenceRatePerDay', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lateRatePerMinute">หักสายต่อนาที (฿)</Label>
            <Input
              id="lateRatePerMinute"
              type="number"
              min="0"
              step="0.01"
              value={form.lateRatePerMinute}
              onChange={(e) => setField('lateRatePerMinute', e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* เวลากะ */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">เวลากะงาน</h3>
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>กะเช้า เริ่ม</Label>
            <Input type="time" value={form.morningShiftStart} onChange={(e) => setField('morningShiftStart', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>กะเช้า สิ้นสุด</Label>
            <Input type="time" value={form.morningShiftEnd} onChange={(e) => setField('morningShiftEnd', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>กะบ่าย เริ่ม</Label>
            <Input type="time" value={form.afternoonShiftStart} onChange={(e) => setField('afternoonShiftStart', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>กะบ่าย สิ้นสุด</Label>
            <Input type="time" value={form.afternoonShiftEnd} onChange={(e) => setField('afternoonShiftEnd', e.target.value)} />
          </div>
        </div>
        <div className="w-48 space-y-1.5">
          <Label htmlFor="defaultBreakMinutes">พักเริ่มต้น (นาที)</Label>
          <Input
            id="defaultBreakMinutes"
            type="number"
            min="0"
            value={form.defaultBreakMinutes}
            onChange={(e) => setField('defaultBreakMinutes', e.target.value)}
          />
        </div>
      </section>

      <Button type="submit" disabled={pending}>
        {pending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
      </Button>
    </form>
  );
}
