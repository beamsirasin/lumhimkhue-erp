'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  PenLine,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createStockAdjustment,
  getLowStockItems,
  saveStockCount,
  type StockCountPageData,
} from '@/lib/actions/inventory';
import { StockCountHistoryTab } from '@/components/admin/StockCountHistoryTab';
import { AppShell } from '@/components/ui/app-shell';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatThaiDate } from '@/lib/date-time';
import { calculateReorderBreakdown } from '@/lib/inventory/procurement-integrity';
import { calculatePhysicalStockUsage } from '@/lib/inventory/procurement-math';
import { cn } from '@/lib/utils';
import type { InventoryUiPermissions } from '@/lib/auth/inventory-access';

type ItemState = {
  openingBalance: number;
  physicalCount: number | null;
  isCounted: boolean;
  openingOverrideReason: string;
  notes: string;
};

type Props = {
  initialData: StockCountPageData;
  today: string;
  defaultTab?: 'daily' | 'history';
  permissions: InventoryUiPermissions;
};

function formatNumber(value: number, digits = 2) {
  return value.toLocaleString('th-TH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function StockCountPage({ initialData, today, defaultTab = 'daily', permissions }: Props) {
  const router = useRouter();
  const existing = initialData.existingCount;
  const readonly = existing?.status === 'submitted' || existing?.status === 'reviewed';
  const [activeTab, setActiveTab] = useState<'daily' | 'history'>(defaultTab);
  const [showWeekly, setShowWeekly] = useState(false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [isPending, startTransition] = useTransition();
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [adjustmentIngredientId, setAdjustmentIngredientId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'adjustment' | 'waste'>('adjustment');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [isAdjusting, startAdjustment] = useTransition();

  const [itemState, setItemState] = useState<Record<string, ItemState>>(() => {
    const result: Record<string, ItemState> = {};
    for (const ingredient of initialData.ingredients) {
      const stored = existing?.items.find((item) => item.ingredientId === ingredient.id);
      result[ingredient.id] = {
        openingBalance: stored
          ? Number(stored.openingBalance)
          : Number(initialData.openingBalances[ingredient.id] ?? 0),
        physicalCount: stored
          ? (stored.isCounted ? Number(stored.quantityOnHand) : null)
          : null,
        isCounted: stored?.isCounted ?? false,
        openingOverrideReason: stored?.openingOverrideReason ?? '',
        notes: stored?.notes ?? '',
      };
    }
    return result;
  });

  const visibleIngredients = useMemo(
    () => initialData.ingredients.filter(
      (ingredient) => showWeekly || ingredient.countFrequency === 'daily',
    ),
    [initialData.ingredients, showWeekly],
  );

  const groups = useMemo(
    () => initialData.categories
      .map((category) => ({
        category,
        ingredients: visibleIngredients.filter((ingredient) => ingredient.categoryId === category.id),
      }))
      .filter((group) => group.ingredients.length > 0),
    [initialData.categories, visibleIngredients],
  );

  const countedCount = visibleIngredients.filter(
    (ingredient) => itemState[ingredient.id]?.isCounted,
  ).length;
  const uncountedCount = visibleIngredients.length - countedCount;
  const pendingPriceIds = new Set(initialData.pendingPriceIngredientIds);

  function setPhysicalCount(ingredientId: string, raw: string) {
    const parsed = raw === '' ? null : Number(raw);
    setItemState((current) => ({
      ...current,
      [ingredientId]: {
        ...current[ingredientId],
        physicalCount: parsed == null || Number.isNaN(parsed) ? null : Math.max(0, parsed),
        isCounted: parsed != null && !Number.isNaN(parsed),
      },
    }));
  }

  function markEmpty(ingredientId: string) {
    setItemState((current) => ({
      ...current,
      [ingredientId]: { ...current[ingredientId], physicalCount: 0, isCounted: true },
    }));
  }

  function markUncounted(ingredientId: string) {
    setItemState((current) => ({
      ...current,
      [ingredientId]: { ...current[ingredientId], physicalCount: null, isCounted: false },
    }));
  }

  function copyOpeningToPhysical() {
    if (!window.confirm('คัดลอกยอดยกมาเป็นยอดนับจริงให้ทุกรายการที่มองเห็นอยู่หรือไม่?')) return;
    setItemState((current) => {
      const next = { ...current };
      for (const ingredient of visibleIngredients) {
        next[ingredient.id] = {
          ...next[ingredient.id],
          physicalCount: next[ingredient.id].openingBalance,
          isCounted: true,
        };
      }
      return next;
    });
  }

  function changeOpening(ingredientId: string) {
    const current = itemState[ingredientId];
    const raw = window.prompt('ยอดยกมาใหม่', String(current.openingBalance));
    if (raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      toast.error('ยอดยกมาต้องเป็นเลขตั้งแต่ 0 ขึ้นไป');
      return;
    }
    const reason = window.prompt('เหตุผลที่แก้ยอดยกมา (บังคับ)');
    if (!reason?.trim()) {
      toast.error('ต้องระบุเหตุผลเพื่อบันทึก audit');
      return;
    }
    setItemState((state) => ({
      ...state,
      [ingredientId]: {
        ...state[ingredientId],
        openingBalance: value,
        openingOverrideReason: reason.trim(),
      },
    }));
  }

  function payload(asDraft: boolean) {
    return {
      countDate: today,
      asDraft,
      notes: notes || null,
      items: visibleIngredients.map((ingredient) => {
        const state = itemState[ingredient.id];
        const regular = initialData.regularReceivedQty[ingredient.id] ?? 0;
        const emergency = initialData.emergencyReceivedQty[ingredient.id] ?? 0;
        return {
          ingredientId: ingredient.id,
          openingBalance: state.openingBalance,
          receivedQty: regular + emergency,
          regularReceivedQty: regular,
          emergencyReceivedQty: emergency,
          physicalCount: state.physicalCount,
          isCounted: state.isCounted,
          openingOverrideReason: state.openingOverrideReason || null,
          unit: ingredient.unit,
          notes: state.notes || null,
        };
      }),
    };
  }

  function save(asDraft: boolean) {
    const missingManualOpeningReason = visibleIngredients.filter((ingredient) => (
      !initialData.openingSources[ingredient.id]
      && !itemState[ingredient.id]?.openingOverrideReason.trim()
    ));
    if (missingManualOpeningReason.length > 0) {
      toast.error(`มี ${missingManualOpeningReason.length} รายการที่ต้องระบุเหตุผลยอดยกมาเริ่มต้น`);
      return;
    }
    if (!asDraft && uncountedCount > 0) {
      toast.error(`ยังมี ${uncountedCount} รายการที่ยังไม่ได้นับ`);
      return;
    }
    startTransition(async () => {
      const result = await saveStockCount(payload(asDraft));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!asDraft && result.countId) {
        const low = await getLowStockItems(result.countId);
        if (low.ok && low.data.length > 0) {
          toast.warning(`มี ${low.data.length} รายการต่ำกว่าจุดสั่งซื้อ`, {
            action: {
              label: 'เปิดใบสั่งซื้อ',
              onClick: () => router.push('/inventory/orders'),
            },
          });
        } else {
          toast.success('ส่งผลนับแล้ว รอตรวจรับ');
        }
      } else {
        toast.success('บันทึกแบบร่างแล้ว');
      }
      router.refresh();
    });
  }

  function submitAdjustment() {
    const quantity = Number(adjustmentQuantity);
    if (!adjustmentIngredientId || !Number.isFinite(quantity) || quantity === 0) {
      toast.error('กรุณาระบุวัตถุดิบและจำนวนที่ไม่เท่ากับ 0');
      return;
    }
    if (adjustmentReason.trim().length < 1) {
      toast.error('กรุณาระบุเหตุผล');
      return;
    }
    if (!existing) return;
    startAdjustment(async () => {
      const result = await createStockAdjustment({
        stockCountId: existing.id,
        ingredientId: adjustmentIngredientId,
        adjustmentQty: quantity,
        adjustmentType,
        reason: adjustmentReason.trim(),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('บันทึกรายการปรับปรุงแล้ว');
      setShowAdjustment(false);
      setAdjustmentIngredientId('');
      setAdjustmentQuantity('');
      setAdjustmentReason('');
      router.refresh();
    });
  }

  return (
    <AppShell>
      <PageHeader
        title={activeTab === 'daily' ? 'นับสต็อกรายวัน' : 'ประวัติการนับสต็อก'}
        subtitle={activeTab === 'daily' ? formatThaiDate(today) : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'daily' && (
              <StatusBadge
                label={
                  existing?.status === 'reviewed'
                    ? 'ตรวจรับแล้ว'
                    : existing?.status === 'submitted'
                      ? 'ส่งแล้ว'
                      : existing?.status === 'draft'
                        ? 'แบบร่าง'
                        : 'รายการใหม่'
                }
                variant={
                  existing?.status === 'reviewed'
                    ? 'success'
                    : existing?.status === 'submitted'
                      ? 'info'
                      : 'warning'
                }
              />
            )}
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              <Button
                size="sm"
                variant={activeTab === 'daily' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('daily')}
              >
                นับรายวัน
              </Button>
              <Button
                size="sm"
                variant={activeTab === 'history' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('history')}
              >
                ประวัติ
              </Button>
            </div>
          </div>
        }
      />

      {activeTab === 'history' ? (
        <StockCountHistoryTab
          canManageCounts={permissions.canCreateStockCount}
          canReview={permissions.canReviewStockCount}
          canUnreview={permissions.canUnreviewStockCount}
        />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex flex-wrap gap-5 text-sm">
              <span>ในรอบ <strong>{visibleIngredients.length}</strong> รายการ</span>
              <span className="text-[var(--status-success-fg)]">นับแล้ว <strong>{countedCount}</strong></span>
              <span className={cn(uncountedCount > 0 && 'text-[var(--status-warning-fg)]')}>
                ยังไม่ได้นับ <strong>{uncountedCount}</strong>
              </span>
              {initialData.todayGuestCount > 0 && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Users className="size-4" />
                  {initialData.todayGuestCount.toLocaleString('th-TH')} หัว
                </span>
              )}
            </div>
            {!readonly && permissions.canCreateStockCount && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyOpeningToPhysical}>
                  <ClipboardCopy className="size-4" />
                  คัดลอกยอดยกมา
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowWeekly((value) => !value)}>
                  {showWeekly ? 'ซ่อนรายการรายสัปดาห์' : 'รวมรายการรายสัปดาห์'}
                </Button>
              </div>
            )}
          </div>

          {initialData.pendingPriceIngredientIds.length > 0 && (
            <div className="flex gap-2 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-sm text-[var(--status-warning-fg)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              ต้นทุนบางรายการยังไม่สมบูรณ์ เพราะมีใบรับของที่ยังรอราคาจริง
            </div>
          )}

          {groups.map(({ category, ingredients: categoryIngredients }) => (
            <DataCard
              key={category.id}
              noPadding
              title={category.name}
              actions={<span className="text-xs text-muted-foreground">{categoryIngredients.length} รายการ</span>}
            >
              <div className="overflow-x-auto">
                <Table className="min-w-[1500px]">
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-56">วัตถุดิบ</TableHead>
                      <TableHead className="text-right">ยอดยกมา</TableHead>
                      <TableHead className="text-right">รับปกติ</TableHead>
                      <TableHead className="text-right">ซื้อฉุกเฉิน</TableHead>
                      <TableHead className="text-center">ยอดนับจริง</TableHead>
                      <TableHead className="text-right">พร่องรวม</TableHead>
                      <TableHead className="text-right">ของเสีย</TableHead>
                      <TableHead className="text-right">ออกอื่น</TableHead>
                      <TableHead className="text-right">ใช้ดำเนินงาน</TableHead>
                      <TableHead className="text-right">ต้นทุนประมาณ</TableHead>
                      <TableHead className="text-right">แนะนำสั่ง</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryIngredients.map((ingredient) => {
                      const state = itemState[ingredient.id];
                      const stored = existing?.items.find((item) => item.ingredientId === ingredient.id);
                      const regular = stored
                        ? Number(stored.regularReceivedQty)
                        : (initialData.regularReceivedQty[ingredient.id] ?? 0);
                      const emergency = stored
                        ? Number(stored.emergencyReceivedQty)
                        : (initialData.emergencyReceivedQty[ingredient.id] ?? 0);
                      const positive = stored
                        ? Number(stored.positiveAdjustmentQty)
                        : (initialData.positiveAdjustmentQty[ingredient.id] ?? 0);
                      const waste = stored
                        ? Number(stored.recordedWasteQty)
                        : (initialData.recordedWasteQty[ingredient.id] ?? 0);
                      const outbound = stored
                        ? Number(stored.otherOutboundQty)
                        : (initialData.otherOutboundQty[ingredient.id] ?? 0);
                      const physical = state.physicalCount ?? 0;
                      const usage = state.isCounted
                        ? calculatePhysicalStockUsage({
                            openingQuantity: state.openingBalance,
                            regularReceived: regular,
                            emergencyReceived: emergency,
                            positiveAdjustment: positive,
                            physicalClosingQuantity: physical,
                            recordedWaste: waste,
                            otherOutboundAdjustment: outbound,
                          })
                        : null;
                      const depletion = usage?.totalStockDepletion ?? 0;
                      const operational = usage?.estimatedOperationalUsage ?? 0;
                      const unitCost = Number(stored?.usageUnitCost ?? ingredient.lastCost ?? 0);
                      const incompleteCost = pendingPriceIds.has(ingredient.id) ||
                        Boolean(stored && stored.usageCostStatus !== 'confirmed');
                      const min = Number(ingredient.minStock);
                      const par = Number(ingredient.parLevel);
                      const guaranteedIncoming = initialData.guaranteedIncomingQty[ingredient.id] ?? 0;
                      const delayedIncoming = initialData.delayedIncomingQty[ingredient.id] ?? 0;
                      const reorderInfo = calculateReorderBreakdown({
                        physicalStock: physical,
                        parLevel: par,
                        minimumStock: min,
                        onTimeIncoming: guaranteedIncoming,
                        delayedIncoming,
                      });
                      const reorder = state.isCounted ? reorderInfo.recommendedQuantity : 0;
                      const isLow = state.isCounted && physical < min;
                      return (
                        <TableRow key={ingredient.id} className={cn(isLow && 'bg-[var(--status-danger-bg)]')}>
                          <TableCell>
                            <div className="font-medium">{ingredient.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {ingredient.unit}
                              {ingredient.countFrequency === 'weekly' && ' · รายสัปดาห์'}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <button
                              type="button"
                              disabled={readonly}
                              onClick={() => changeOpening(ingredient.id)}
                              className="tabular-nums hover:underline disabled:no-underline"
                            >
                              {formatNumber(state.openingBalance)}
                            </button>
                            {initialData.openingSources[ingredient.id] ? (
                              <div className="text-[10px] text-muted-foreground">
                                ยกมาจาก {formatThaiDate(initialData.openingSources[ingredient.id].countDate)}
                                <br />รับเข้าหลังวันดังกล่าว–{formatThaiDate(today)}
                              </div>
                            ) : (
                              <div className="text-[10px] text-[var(--status-warning-fg)]">
                                ยอดเริ่มต้นแบบ manual · คลิกยอดเพื่อระบุเหตุผล
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(regular)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {emergency > 0 ? (
                              <span className="text-[var(--status-warning-fg)]">{formatNumber(emergency)}</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            {readonly ? (
                              state.isCounted ? (
                                <strong className="block text-center tabular-nums">{formatNumber(physical)}</strong>
                              ) : (
                                <span className="block text-center text-muted-foreground">ยังไม่ได้นับ</span>
                              )
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={state.physicalCount ?? ''}
                                  onChange={(event) => setPhysicalCount(ingredient.id, event.target.value)}
                                  placeholder="ยังไม่ได้นับ"
                                  className="h-9 w-28 text-right tabular-nums"
                                />
                                <Button type="button" size="sm" variant="outline" onClick={() => markEmpty(ingredient.id)}>
                                  หมด
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => markUncounted(ingredient.id)}>
                                  ยังไม่ได้นับ
                                </Button>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className={cn('text-right tabular-nums', depletion < 0 && 'text-[var(--status-danger-fg)]')}>
                            {state.isCounted ? formatNumber(depletion) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{waste ? formatNumber(waste) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{outbound ? formatNumber(outbound) : '—'}</TableCell>
                          <TableCell className={cn('text-right tabular-nums', operational < 0 && 'text-[var(--status-danger-fg)]')}>
                            {state.isCounted ? formatNumber(operational) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {state.isCounted && !incompleteCost ? (
                              <span className="tabular-nums">≈ ฿{formatNumber(Math.max(0, operational) * unitCost)}</span>
                            ) : incompleteCost ? (
                              <span className="text-xs text-[var(--status-warning-fg)]">ต้นทุนไม่สมบูรณ์</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {reorder > 0 ? (
                              <div>
                                <span className="font-semibold text-[var(--status-warning-fg)]">
                                  +{formatNumber(reorder)}
                                </span>
                                <div className="text-[10px] text-muted-foreground">
                                  PO ปกติ {formatNumber(guaranteedIncoming)}
                                </div>
                                {delayedIncoming > 0 && (
                                  <div className="text-[10px] text-[var(--status-danger-fg)]">
                                    PO ล่าช้า {formatNumber(delayedIncoming)} (ไม่หักจากคำแนะนำ)
                                  </div>
                                )}
                              </div>
                            ) : delayedIncoming > 0 ? (
                              <span className="text-[10px] text-[var(--status-danger-fg)]">PO ล่าช้า {formatNumber(delayedIncoming)}</span>
                            ) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </DataCard>
          ))}

          <div className="space-y-2">
            <Label htmlFor="stock-count-notes">หมายเหตุรวม</Label>
            <Textarea
              id="stock-count-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={readonly}
            />
          </div>

          {!readonly ? (
            permissions.canCreateStockCount ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="flex-1" disabled={isPending} onClick={() => save(true)}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  บันทึกแบบร่าง
                </Button>
                <Button className="flex-1" disabled={isPending || uncountedCount > 0} onClick={() => save(false)}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  ส่งผลนับ ({uncountedCount > 0 ? `เหลือ ${uncountedCount}` : 'ครบแล้ว'})
                </Button>
              </div>
            ) : null
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-4">
              <CheckCircle2 className="size-5 text-[var(--status-success-fg)]" />
              <div className="flex-1">
                <div className="font-medium">
                  {existing?.status === 'reviewed' ? 'ผลนับนี้ตรวจรับแล้ว' : 'ส่งผลนับแล้ว รอตรวจรับ'}
                </div>
                <div className="text-xs text-muted-foreground">
                  หลังส่งแล้ว การแก้ไขต้องทำผ่านรายการปรับปรุงเพื่อรักษาประวัติ
                </div>
              </div>
              {permissions.canCreateStockCount && (
                <Button variant="outline" size="sm" onClick={() => setShowAdjustment(true)}>
                  <PenLine className="size-4" />
                  เพิ่มรายการปรับปรุง
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => router.push('/inventory/orders')}>
                <ShoppingCart className="size-4" />
                เปิดใบสั่งซื้อ
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={showAdjustment} onOpenChange={setShowAdjustment}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มรายการปรับปรุงหลังส่งผลนับ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>วัตถุดิบ</Label>
              <select
                value={adjustmentIngredientId}
                onChange={(event) => setAdjustmentIngredientId(event.target.value)}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
              >
                <option value="">เลือกวัตถุดิบ</option>
                {initialData.ingredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>ประเภท</Label>
                <select
                  value={adjustmentType}
                  onChange={(event) => setAdjustmentType(event.target.value as 'adjustment' | 'waste')}
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                >
                  <option value="adjustment">ปรับเข้า/ออก</option>
                  <option value="waste">ของเสีย</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>จำนวน</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={adjustmentQuantity}
                  onChange={(event) => setAdjustmentQuantity(event.target.value)}
                  placeholder={adjustmentType === 'adjustment' ? '+ เข้า / - ออก' : 'จำนวนของเสีย'}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>เหตุผล</Label>
              <Textarea value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjustment(false)}>ยกเลิก</Button>
            <Button disabled={isAdjusting} onClick={submitAdjustment}>
              {isAdjusting && <Loader2 className="size-4 animate-spin" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
