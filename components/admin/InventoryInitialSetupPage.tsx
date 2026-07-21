'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, PackageCheck, Rocket, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  saveInitialSetup,
  reviewStockCount,
  type InitialSetupState,
} from '@/lib/actions/inventory';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import type { InventoryUiPermissions } from '@/lib/auth/inventory-access';

interface Props {
  initialData: InitialSetupState;
  today: string;
  permissions: InventoryUiPermissions;
}

type ItemState = { value: string; counted: boolean; notes: string };

function buildInitialItemState(data: InitialSetupState): Record<string, ItemState> {
  const existingItems = new Map(
    (data.existingSetup?.items ?? []).map((item) => [item.ingredientId, item]),
  );
  const state: Record<string, ItemState> = {};
  for (const ingredient of data.ingredients) {
    const existing = existingItems.get(ingredient.id);
    state[ingredient.id] = existing
      ? {
          value: existing.isCounted ? String(Number(existing.quantityOnHand)) : '',
          counted: existing.isCounted,
          notes: existing.notes ?? '',
        }
      : { value: '', counted: false, notes: '' };
  }
  return state;
}

export function InventoryInitialSetupPage({ initialData, today, permissions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<Record<string, ItemState>>(() => buildInitialItemState(initialData));

  const existingStatus = initialData.existingSetup?.status ?? null;
  const readonly = existingStatus === 'submitted' || existingStatus === 'reviewed';
  const setupId = initialData.existingSetup?.id ?? null;

  const ingredients = initialData.ingredients;
  const countedCount = useMemo(
    () => ingredients.filter((ing) => state[ing.id]?.counted).length,
    [ingredients, state],
  );
  const uncountedCount = ingredients.length - countedCount;

  const grouped = useMemo(() => {
    const byCategory = new Map<string, typeof ingredients>();
    for (const ingredient of ingredients) {
      const list = byCategory.get(ingredient.categoryId) ?? [];
      list.push(ingredient);
      byCategory.set(ingredient.categoryId, list);
    }
    return initialData.categories
      .map((category) => ({ category, items: byCategory.get(category.id) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [ingredients, initialData.categories]);

  function patch(id: string, next: Partial<ItemState>) {
    setState((current) => ({ ...current, [id]: { ...current[id], ...next } }));
  }

  function save(asDraft: boolean) {
    const items = ingredients.map((ingredient) => {
      const line = state[ingredient.id];
      const counted = line?.counted ?? false;
      return {
        ingredientId: ingredient.id,
        physicalCount: counted && line.value !== '' ? Number(line.value) : null,
        isCounted: counted,
        unit: ingredient.unit,
        notes: line?.notes || null,
      };
    });
    if (!asDraft && items.some((item) => !item.isCounted || item.physicalCount == null)) {
      toast.error('กรุณานับให้ครบทุกวัตถุดิบก่อนยืนยันยอดเริ่มต้น');
      return;
    }
    startTransition(async () => {
      const result = await saveInitialSetup({ countDate: today, asDraft, notes: null, items });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(asDraft ? 'บันทึกแบบร่างแล้ว' : 'ส่งยอดเริ่มต้นเพื่อตรวจรับแล้ว');
      router.refresh();
    });
  }

  function review() {
    if (!setupId) return;
    startTransition(async () => {
      const result = await reviewStockCount(setupId, 'ตรวจรับยอดสต็อกเริ่มต้น');
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('ยืนยันยอดเริ่มต้นแล้ว — ยอดนี้จะเป็นยอดเปิดของรอบถัดไป');
      router.push('/inventory');
      router.refresh();
    });
  }

  // Already initialized — never show onboarding again.
  if (!initialData.gate.allowed) {
    return (
      <AppShell>
        <PageHeader title="ตั้งยอดสต็อกเริ่มต้น" subtitle="เริ่มต้นใช้งานระบบสต็อก" />
        <DataCard>
          <EmptyState
            icon={<ShieldCheck className="size-6" />}
            title="ร้านนี้เริ่มใช้งานสต็อกแล้ว"
            description="มีผลนับที่ตรวจรับแล้วในระบบ จึงไม่จำเป็นต้องตั้งยอดเริ่มต้นอีก ระบบใช้ยอดคงเหลือของผลนับล่าสุดเป็นยอดเปิดของรอบถัดไปโดยอัตโนมัติ"
            action={<Button onClick={() => router.push('/inventory/count')}>ไปหน้านับสต็อกประจำวัน</Button>}
          />
        </DataCard>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="ตั้งยอดสต็อกเริ่มต้น"
        subtitle="นับของจริงครั้งแรกเพื่อกำหนดยอดเปิดของระบบ — ไม่ถือเป็นการรับของหรือการใช้วัตถุดิบ"
        actions={existingStatus ? <StatusBadge label={existingStatus === 'submitted' ? 'รอตรวจรับ' : existingStatus === 'reviewed' ? 'ตรวจรับแล้ว' : 'แบบร่าง'} variant={existingStatus === 'submitted' ? 'warning' : existingStatus === 'reviewed' ? 'success' : 'neutral'} dot /> : undefined}
      />

      <div className="rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-4 text-sm text-[var(--status-info-fg)]">
        <div className="flex items-start gap-2.5">
          <Rocket className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">วิธีตั้งยอดเริ่มต้น</p>
            <p>กรอกจำนวนที่มีอยู่จริงของแต่ละวัตถุดิบ — <strong>กรอก 0</strong> หมายถึงนับแล้วและของหมด, <strong>ปล่อยว่าง</strong> หมายถึงยังไม่ได้นับ เมื่อตรวจรับ (Reviewed) ยอดนี้จะกลายเป็นยอดเปิดของรอบนับถัดไป และจะไม่แสดงเป็นการใช้วัตถุดิบ</p>
          </div>
        </div>
      </div>

      {ingredients.length === 0 ? (
        <DataCard>
          <EmptyState
            icon={<PackageCheck className="size-6" />}
            title="ยังไม่มีวัตถุดิบที่เปิดใช้งาน"
            description="เพิ่มวัตถุดิบและกำหนดหน่วยนับก่อน จึงจะตั้งยอดเริ่มต้นได้"
            action={<Button onClick={() => router.push('/inventory/ingredients')}>ไปจัดการวัตถุดิบ</Button>}
          />
        </DataCard>
      ) : (
        <>
          <div className="sticky top-0 z-20 -mx-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border bg-background/95 px-6 py-3 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <span className="text-muted-foreground">ทั้งหมด <strong className="text-foreground">{ingredients.length}</strong> รายการ</span>
            <span className="inline-flex items-center gap-1.5 text-[var(--status-success-fg)]"><CheckCircle2 className="size-4" /> นับแล้ว <strong>{countedCount}</strong></span>
            <span className={cn('inline-flex items-center gap-1.5', uncountedCount > 0 ? 'text-[var(--status-warning-fg)]' : 'text-muted-foreground')}>
              ยังไม่ได้นับ <strong>{uncountedCount}</strong>
            </span>
          </div>

          {grouped.map(({ category, items }) => (
            <DataCard key={category.id} title={category.name} subtitle={`${items.length} รายการ`} noPadding>
              <ul className="divide-y divide-border">
                {items.map((ingredient) => {
                  const line = state[ingredient.id];
                  return (
                    <li key={ingredient.id} className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-[150px] flex-1">
                        <p className="font-medium text-foreground">{ingredient.name}</p>
                        <p className="text-xs text-muted-foreground">
                          หน่วย {ingredient.unit}
                          {line?.counted
                            ? <span className="ml-2 text-[var(--status-success-fg)]">• นับแล้ว</span>
                            : <span className="ml-2 text-[var(--status-warning-fg)]">• ยังไม่ได้นับ</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="จำนวนจริง"
                          aria-label={`จำนวนจริง ${ingredient.name}`}
                          value={line?.value ?? ''}
                          disabled={readonly}
                          onChange={(event) => patch(ingredient.id, { value: event.target.value, counted: event.target.value !== '' })}
                          className="h-10 w-24 text-right font-semibold tabular-nums"
                        />
                        <span className="w-10 text-xs text-muted-foreground">{ingredient.unit}</span>
                        {!readonly && (
                          <div className="flex flex-col gap-1">
                            <Button type="button" size="sm" variant="outline" className="h-[19px] px-1.5 text-[11px]" onClick={() => patch(ingredient.id, { value: '0', counted: true })}>หมด</Button>
                            <Button type="button" size="sm" variant="ghost" className="h-[19px] px-1.5 text-[11px]" onClick={() => patch(ingredient.id, { value: '', counted: false })}>ล้าง</Button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </DataCard>
          ))}

          {/* Action bar */}
          <div className="sticky bottom-0 z-20 -mx-6 border-t border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {readonly ? (
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {existingStatus === 'submitted'
                    ? 'ยอดเริ่มต้นถูกส่งแล้ว รอการตรวจรับเพื่อยืนยันเป็นยอดเปิด'
                    : 'ยอดเริ่มต้นได้รับการตรวจรับแล้ว'}
                </p>
                {existingStatus === 'submitted' && permissions.canReviewStockCount && (
                  <Button disabled={isPending} onClick={review}>
                    <ShieldCheck className="size-4" /> ตรวจรับยอดเริ่มต้น
                  </Button>
                )}
              </div>
            ) : permissions.canCreateStockCount ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="flex-1" disabled={isPending} onClick={() => save(true)}>
                  บันทึกแบบร่าง
                </Button>
                <Button className="flex-1" disabled={isPending || uncountedCount > 0} onClick={() => save(false)}>
                  ส่งยอดเริ่มต้น ({uncountedCount > 0 ? `เหลือ ${uncountedCount}` : 'ครบแล้ว'})
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">คุณไม่มีสิทธิ์บันทึกยอดเริ่มต้น</p>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
