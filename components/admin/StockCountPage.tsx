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
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { usePrompt } from '@/components/shared/PromptDialog';
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
  const { openConfirm, dialog: confirmDialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
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
    openConfirm(
      'คัดลอกยอดยกมาเป็นยอดนับจริงให้ทุกรายการที่มองเห็นอยู่หรือไม่?',
      () => {
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
      },
      { confirmLabel: 'คัดลอกทั้งหมด', variant: 'default' },
    );
  }

  async function changeOpening(ingredientId: string, ingredientName: string) {
    const current = itemState[ingredientId];
    const result = await prompt({
      title: 'แก้ยอดยกมา',
      description: ingredientName,
      confirmLabel: 'บันทึกยอดยกมา',
      fields: [
        {
          name: 'opening',
          label: 'ยอดยกมาใหม่',
          type: 'number',
          required: true,
          min: 0,
          step: '0.01',
          defaultValue: String(current.openingBalance),
          validate: (value) => {
            const num = Number(value);
            return Number.isFinite(num) && num >= 0
              ? null
              : 'ยอดยกมาต้องเป็นเลขตั้งแต่ 0 ขึ้นไป';
          },
        },
        {
          name: 'reason',
          label: 'เหตุผลที่แก้ยอดยกมา',
          type: 'textarea',
          required: true,
          hint: 'บังคับระบุเพื่อบันทึกประวัติ (audit)',
          placeholder: 'เช่น ปรับตามยอดจริงหลังตรวจนับซ้ำ',
        },
      ],
    });
    if (!result) return;
    setItemState((state) => ({
      ...state,
      [ingredientId]: {
        ...state[ingredientId],
        openingBalance: Number(result.opening),
        openingOverrideReason: result.reason.trim(),
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
        <div className="space-y-4 pb-24">
          {/* Sticky progress + toolbar */}
          <div className="sticky top-0 z-20 -mx-6 border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">
                  ในรอบ <strong className="text-foreground">{visibleIngredients.length}</strong> รายการ
                </span>
                <span className="inline-flex items-center gap-1.5 text-[var(--status-success-fg)]">
                  <CheckCircle2 className="size-4" /> นับแล้ว <strong>{countedCount}</strong>
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5',
                    uncountedCount > 0 ? 'text-[var(--status-warning-fg)]' : 'text-muted-foreground',
                  )}
                >
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
                    {showWeekly ? 'ซ่อนรายสัปดาห์' : 'รวมรายสัปดาห์'}
                  </Button>
                </div>
              )}
            </div>
            {/* Progress bar */}
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--status-success-fg)] transition-all"
                style={{
                  width: `${visibleIngredients.length === 0 ? 0 : Math.round((countedCount / visibleIngredients.length) * 100)}%`,
                }}
              />
            </div>
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
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="min-w-[150px]">วัตถุดิบ</TableHead>
                      <TableHead className="text-right">ยอดยกมา</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">รับปกติ</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">ซื้อฉุกเฉิน</TableHead>
                      <TableHead className="text-center">ยอดนับจริง</TableHead>
                      <TableHead className="hidden text-right xl:table-cell">พร่องรวม</TableHead>
                      <TableHead className="hidden text-right 2xl:table-cell">ของเสีย</TableHead>
                      <TableHead className="hidden text-right 2xl:table-cell">ออกอื่น</TableHead>
                      <TableHead className="hidden text-right md:table-cell">ใช้ดำเนินงาน</TableHead>
                      <TableHead className="hidden text-right xl:table-cell">ต้นทุนประมาณ</TableHead>
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
                      const openingSource = initialData.openingSources[ingredient.id];
                      return (
                        <TableRow
                          key={ingredient.id}
                          className={cn(
                            'border-l-4',
                            isLow
                              ? 'border-l-[var(--status-danger-fg)] bg-[var(--status-danger-bg)]/50'
                              : state.isCounted
                                ? 'border-l-[var(--status-success-fg)]'
                                : 'border-l-transparent',
                          )}
                        >
                          <TableCell>
                            <div className="font-medium">{ingredient.name}</div>
                            <div className="text-xs text-muted-foreground">
                              หน่วย {ingredient.unit}
                              {ingredient.countFrequency === 'weekly' && ' · รายสัปดาห์'}
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <button
                              type="button"
                              disabled={readonly}
                              onClick={() => changeOpening(ingredient.id, ingredient.name)}
                              className="tabular-nums underline-offset-2 hover:underline disabled:no-underline"
                            >
                              {formatNumber(state.openingBalance)}
                            </button>
                            {openingSource ? (
                              <div className="text-[10px] text-muted-foreground">
                                ยกมาจาก {formatThaiDate(openingSource.countDate)}
                              </div>
                            ) : (
                              <div className="text-[10px] text-[var(--status-warning-fg)]">
                                manual · แตะเพื่อระบุเหตุผล
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums lg:table-cell">
                            {formatNumber(regular)}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums lg:table-cell">
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
                                  placeholder="นับจริง"
                                  aria-label={`ยอดนับจริง ${ingredient.name}`}
                                  className="h-10 w-20 text-right font-semibold tabular-nums"
                                />
                                <div className="flex flex-col gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-[19px] px-1.5 text-[11px]"
                                    onClick={() => markEmpty(ingredient.id)}
                                  >
                                    หมด
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-[19px] px-1.5 text-[11px]"
                                    onClick={() => markUncounted(ingredient.id)}
                                  >
                                    ล้าง
                                  </Button>
                                </div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className={cn('hidden text-right tabular-nums xl:table-cell', depletion < 0 && 'text-[var(--status-danger-fg)]')}>
                            {state.isCounted ? formatNumber(depletion) : '—'}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
                            {waste ? formatNumber(waste) : '—'}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
                            {outbound ? formatNumber(outbound) : '—'}
                          </TableCell>
                          <TableCell className={cn('hidden text-right tabular-nums md:table-cell', operational < 0 && 'text-[var(--status-danger-fg)]')}>
                            {state.isCounted ? formatNumber(operational) : '—'}
                          </TableCell>
                          <TableCell className="hidden text-right xl:table-cell">
                            {state.isCounted && !incompleteCost ? (
                              <span className="tabular-nums">≈ ฿{formatNumber(Math.max(0, operational) * unitCost)}</span>
                            ) : incompleteCost && state.isCounted ? (
                              <span className="text-xs text-[var(--status-warning-fg)]">ไม่สมบูรณ์</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {reorder > 0 ? (
                              <div>
                                <span className="font-semibold text-[var(--status-warning-fg)]">
                                  +{formatNumber(reorder)}
                                </span>
                                {guaranteedIncoming > 0 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    PO ปกติ {formatNumber(guaranteedIncoming)}
                                  </div>
                                )}
                                {delayedIncoming > 0 && (
                                  <div className="text-[10px] text-[var(--status-danger-fg)]">
                                    PO ล่าช้า {formatNumber(delayedIncoming)}
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

          {readonly && (
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

          {/* Sticky action bar */}
          {!readonly && permissions.canCreateStockCount && (
            <div className="sticky bottom-0 z-20 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
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

      {confirmDialog}
      {promptDialog}
    </AppShell>
  );
}
