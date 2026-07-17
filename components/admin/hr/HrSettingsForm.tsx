'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Time24Select } from '@/components/ui/time-24-select';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { Plus, Trash2, PackageX } from 'lucide-react';
import { saveHrSettings } from '@/lib/actions/hr';
import { createDamageItem, deleteDamageItem } from '@/lib/actions/hr-incidents';
import type { HrSettings, DamageItem } from '@/lib/db/schema';

interface Props {
  initialData: HrSettings;
  initialDamageItems: DamageItem[];
}

export function HrSettingsForm({ initialData, initialDamageItems }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { openConfirm, dialog: confirmDialog } = useConfirm();
  const [newItem, setNewItem] = useState({ name: '', pricePerUnit: '' });
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

  function handleAddDamageItem() {
    if (!newItem.name.trim()) { toast.error('กรุณากรอกชื่อรายการ'); return; }
    if (newItem.pricePerUnit === '' || Number(newItem.pricePerUnit) < 0) {
      toast.error('กรุณากรอกราคาต่อชิ้น');
      return;
    }
    startTransition(async () => {
      const result = await createDamageItem({
        name: newItem.name.trim(),
        pricePerUnit: Number(newItem.pricePerUnit),
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('เพิ่มรายการแล้ว');
      setNewItem({ name: '', pricePerUnit: '' });
      router.refresh();
    });
  }

  function handleDeleteDamageItem(item: DamageItem) {
    openConfirm(
      `ลบ "${item.name}" ออกจากรายการของเสียหาย? รายงานที่เคยบันทึกไว้จะไม่ได้รับผลกระทบ`,
      () => {
        startTransition(async () => {
          const result = await deleteDamageItem(item.id);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success('ลบรายการแล้ว');
          router.refresh();
        });
      },
      { confirmLabel: 'ลบรายการ', variant: 'danger' },
    );
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
    <AppShell>
      {confirmDialog}
      <PageHeader
        title="ตั้งค่า HR"
        subtitle="กำหนดเรทหักเงิน เวลากะงาน และรายการของเสียหาย"
        actions={
          <Button type="submit" form="hr-settings-form" disabled={pending}>
            {pending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </Button>
        }
      />

      <div className="max-w-2xl">
        <form id="hr-settings-form" onSubmit={onSubmit} className="space-y-6">
          {/* เรทหักเงิน */}
          <DataCard title="เรทหักเงิน" subtitle="อัตราหักสำหรับการขาดงานและมาสาย">
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
          </DataCard>

          {/* เวลากะงาน */}
          <DataCard title="เวลากะงาน" subtitle="ตั้งค่าชั่วโมงเริ่มต้น-สิ้นสุดของแต่ละกะ">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>กะเช้า เริ่ม</Label>
                <Time24Select
                  label="กะเช้า เริ่ม"
                  value={form.morningShiftStart}
                  onValueChange={(value) => setField('morningShiftStart', value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>กะเช้า สิ้นสุด</Label>
                <Time24Select
                  label="กะเช้า สิ้นสุด"
                  value={form.morningShiftEnd}
                  onValueChange={(value) => setField('morningShiftEnd', value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>กะบ่าย เริ่ม</Label>
                <Time24Select
                  label="กะบ่าย เริ่ม"
                  value={form.afternoonShiftStart}
                  onValueChange={(value) => setField('afternoonShiftStart', value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>กะบ่าย สิ้นสุด</Label>
                <Time24Select
                  label="กะบ่าย สิ้นสุด"
                  value={form.afternoonShiftEnd}
                  onValueChange={(value) => setField('afternoonShiftEnd', value)}
                />
              </div>
            </div>
            <div className="mt-4 w-48 space-y-1.5">
              <Label htmlFor="defaultBreakMinutes">พักเริ่มต้น (นาที)</Label>
              <Input
                id="defaultBreakMinutes"
                type="number"
                min="0"
                value={form.defaultBreakMinutes}
                onChange={(e) => setField('defaultBreakMinutes', e.target.value)}
              />
            </div>
          </DataCard>
        </form>

        {/* ของเสียหาย — instant add/delete, not part of the settings form */}
        <div className="mt-6">
          <DataCard
            title="รายการของเสียหาย"
            subtitle="ของที่พนักงานทำเสียหายได้ พร้อมราคาต่อชิ้น — ใช้เลือกตอนแจ้งเสียหายในหน้ารายงานพนักงาน"
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-40 flex-1 space-y-1.5">
                  <Label htmlFor="damage-item-name">ชื่อรายการ</Label>
                  <Input
                    id="damage-item-name"
                    value={newItem.name}
                    onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
                    placeholder="เช่น แก้วน้ำ / ถาดคอนโด / ถ้วยไอศกรีม"
                  />
                </div>
                <div className="w-36 space-y-1.5">
                  <Label htmlFor="damage-item-price">ราคาต่อชิ้น (฿)</Label>
                  <Input
                    id="damage-item-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newItem.pricePerUnit}
                    onChange={(e) => setNewItem((p) => ({ ...p, pricePerUnit: e.target.value }))}
                  />
                </div>
                <Button type="button" onClick={handleAddDamageItem} disabled={pending}>
                  <Plus className="size-4" />
                  เพิ่ม
                </Button>
              </div>

              {initialDamageItems.length === 0 ? (
                <EmptyState
                  icon={<PackageX className="size-5" />}
                  title="ยังไม่มีรายการของเสียหาย"
                  description="เพิ่มรายการแรกด้านบน เช่น แก้วน้ำ พร้อมราคาต่อชิ้น"
                  size="sm"
                />
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {initialDamageItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        ฿{Number(item.pricePerUnit).toLocaleString('th-TH', { minimumFractionDigits: 2 })} / ชิ้น
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteDamageItem(item)}
                        disabled={pending}
                        aria-label={`ลบ ${item.name}`}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DataCard>
        </div>
      </div>
    </AppShell>
  );
}
