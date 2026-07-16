'use client';

import { useState, useMemo, useTransition } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShoppingCart,
  PenLine,
  X,
  Flame,
  Calendar,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  saveStockCount,
  getLowStockItems,
  createStockAdjustment,
  type StockCountPageData,
  type LowStockItem,
} from '@/lib/actions/inventory';
import { StockCountHistoryTab } from '@/components/admin/StockCountHistoryTab';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataCard } from '@/components/ui/section-card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date-time';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ItemState {
  openingBalance: number;
  receivedQty: number;    // auto-filled from today's PO receipts
  physicalCount: number;  // user enters this (what's on the shelf)
  notes: string;
}

type ItemMap = Record<string, ItemState>;

interface Props {
  initialData: StockCountPageData;
  today: string;
  defaultTab?: 'daily' | 'history';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SELECT_CLS = 'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

// ── Main component ────────────────────────────────────────────────────────────

export function StockCountPage({ initialData, today, defaultTab = 'daily' }: Props) {
  const [activeTab, setActiveTab] = useState<'daily' | 'history'>(defaultTab);
  const existing = initialData.existingCount;
  const isSubmitted = existing?.status === 'submitted';

  // Build initial item states
  function buildInitialMap(): ItemMap {
    const map: ItemMap = {};
    for (const ing of initialData.ingredients) {
      const opening = Number(initialData.openingBalances[ing.id] ?? '0');
      const received = initialData.todayReceivedQty[ing.id] ?? 0;

      if (existing?.items.length) {
        const stored = existing.items.find((it) => it.ingredientId === ing.id);
        if (stored) {
          // quantityOnHand IS the physicalCount in the new model
          map[ing.id] = {
            openingBalance: Number(stored.openingBalance),
            receivedQty: Number(stored.receivedQty),
            physicalCount: Number(stored.quantityOnHand),
            notes: stored.notes ?? '',
          };
          continue;
        }
      }
      map[ing.id] = {
        openingBalance: opening,
        receivedQty: received,
        physicalCount: 0,
        notes: '',
      };
    }
    return map;
  }

  const [itemMap, setItemMap] = useState<ItemMap>(buildInitialMap);
  const [countNotes, setCountNotes] = useState(existing?.notes ?? '');
  const [lowItems, setLowItems] = useState<LowStockItem[]>([]);
  const [showLowPanel, setShowLowPanel] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [readonly, setReadonly] = useState(isSubmitted);
  const [showWeekly, setShowWeekly] = useState(false);

  // Adjustment dialog state
  const [showAdjDialog, setShowAdjDialog] = useState(false);
  const [adjIngredientId, setAdjIngredientId] = useState('');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjType, setAdjType] = useState<'adjustment' | 'waste'>('adjustment');
  const [isAdjPending, startAdjTransition] = useTransition();

  function updatePhysicalCount(id: string, raw: string) {
    const val = parseFloat(raw);
    setItemMap((prev) => ({
      ...prev,
      [id]: { ...prev[id], physicalCount: isNaN(val) || val < 0 ? 0 : val },
    }));
  }

  // Grouped by category, filtered by countFrequency
  const grouped = useMemo(
    () =>
      initialData.categories
        .map((cat) => ({
          category: cat,
          items: initialData.ingredients.filter(
            (i) =>
              i.categoryId === cat.id &&
              (showWeekly || i.countFrequency === 'daily'),
          ),
        }))
        .filter((g) => g.items.length > 0),
    [initialData, showWeekly],
  );

  const weeklyCount = useMemo(
    () => initialData.ingredients.filter((i) => i.countFrequency === 'weekly').length,
    [initialData.ingredients],
  );

  // Summary stats
  const stats = useMemo(() => {
    let filledCount = 0;
    let lowCount = 0;
    for (const ing of initialData.ingredients) {
      const state = itemMap[ing.id];
      if (!state) continue;
      const closing = state.physicalCount;
      const minStock = Number(ing.minStock);
      if (state.physicalCount > 0) filledCount++;
      if (closing < minStock && minStock > 0) lowCount++;
    }
    return { filledCount, lowCount };
  }, [itemMap, initialData.ingredients]);

  function buildPayload(asDraft: boolean) {
    // Only send ingredients that are visible to staff right now.
    // Hidden weekly items are NOT included — their existing DB rows
    // stay intact and serve as opening balance for future days.
    const visibleIngredients = initialData.ingredients.filter(
      (ing) => showWeekly || ing.countFrequency === 'daily',
    );
    return {
      countDate: today,
      asDraft,
      notes: countNotes || null,
      items: visibleIngredients.map((ing) => {
        const state = itemMap[ing.id] ?? { openingBalance: 0, receivedQty: 0, physicalCount: 0, notes: '' };
        return {
          ingredientId: ing.id,
          openingBalance: state.openingBalance,
          receivedQty: state.receivedQty,
          physicalCount: state.physicalCount,
          unit: ing.unit,
          notes: state.notes || null,
        };
      }),
    };
  }

  function handleSaveDraft() {
    startTransition(async () => {
      const r = await saveStockCount(buildPayload(true));
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('บันทึกแบบร่างแล้ว');
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const r = await saveStockCount(buildPayload(false));
      if (!r.ok) { toast.error(r.error); return; }
      if (r.countId) {
        const low = await getLowStockItems(r.countId);
        if (low.ok && low.data.length > 0) {
          setLowItems(low.data);
          setShowLowPanel(true);
        }
      }
      setReadonly(true);
      toast.success('ส่งผลการนับแล้ว');
    });
  }

  function handleAdjustmentSubmit() {
    if (!existing?.id) return;
    const qty = parseFloat(adjQty);
    if (!adjIngredientId) { toast.error('กรุณาเลือกวัตถุดิบ'); return; }
    if (!adjQty || isNaN(qty) || qty === 0) { toast.error('กรุณาระบุจำนวน (ไม่เป็น 0)'); return; }
    if (!adjReason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }

    startAdjTransition(async () => {
      const r = await createStockAdjustment({
        stockCountId: existing.id,
        ingredientId: adjIngredientId,
        adjustmentQty: qty,
        adjustmentType: adjType,
        reason: adjReason.trim(),
      });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('บันทึกรายการปรับปรุงแล้ว');
      setShowAdjDialog(false);
      setAdjIngredientId('');
      setAdjQty('');
      setAdjReason('');
      setAdjType('adjustment');
    });
  }

  const guestCount = initialData.todayGuestCount;

  return (
    <AppShell>
      {/* Page header with V2 tab switcher */}
      <PageHeader
        title={activeTab === 'daily' ? 'นับสต็อกรายวัน' : 'ผลการนับสต็อก'}
        subtitle={activeTab === 'daily' ? formatThaiDate(today) : undefined}
        actions={
          <div className="flex items-center gap-3">
            {activeTab === 'daily' && guestCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-1 text-xs font-medium text-[var(--status-info-fg)]">
                <Users className="size-3.5" />
                {guestCount.toLocaleString('th-TH')} หัว
              </span>
            )}
            {activeTab === 'daily' && (existing ? (
              <StatusBadge
                label={existing.status === 'submitted' ? 'ส่งแล้ว' : 'แบบร่าง'}
                variant={existing.status === 'submitted' ? 'success' : 'warning'}
                size="md"
              />
            ) : (
              <StatusBadge label="ใหม่" variant="neutral" size="md" />
            ))}
            <div className="flex gap-px rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setActiveTab('daily')}
                className={cn(
                  'rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-150',
                  activeTab === 'daily'
                    ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                นับรายวัน
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={cn(
                  'rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-150',
                  activeTab === 'history'
                    ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                ประวัติ
              </button>
            </div>
          </div>
        }
      />

      {activeTab === 'history' && <StockCountHistoryTab />}

      {activeTab === 'daily' && (
      <>

      {/* Summary bar */}
      <div className="rounded-xl border border-border bg-muted/30 px-5 py-3 flex flex-wrap gap-6 items-center">
        <div className="text-sm">
          <span className="text-muted-foreground">รายการทั้งหมด </span>
          <span className="font-semibold text-foreground">{initialData.ingredients.length}</span>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">ต่ำกว่าจุดสั่งซื้อ </span>
          <span className={cn('font-semibold', stats.lowCount > 0 ? 'text-[var(--status-danger-fg)]' : 'text-muted-foreground')}>
            {stats.lowCount}
          </span>
        </div>
        {Object.keys(initialData.todayReceivedQty).length > 0 && (
          <div className="text-xs text-[var(--status-info-fg)] flex items-center gap-1">
            <CheckCircle2 className="size-3.5" />
            รับของวันนี้ {Object.keys(initialData.todayReceivedQty).length} รายการ (auto-filled)
          </div>
        )}
        {Object.keys(initialData.openingBalances).length === 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="size-3.5" />
            ไม่มีข้อมูลวันก่อนหน้า — ยอดยกมาเป็น 0
          </div>
        )}

        {/* ABC toggle */}
        {weeklyCount > 0 && !readonly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowWeekly((v) => !v)}
            className={cn(
              'ml-auto rounded-full h-7 gap-1.5 px-3 text-xs',
              showWeekly && 'border-[var(--status-purple-border)] bg-[var(--status-purple-bg)] text-[var(--status-purple-fg)] hover:bg-[var(--status-purple-bg)] hover:text-[var(--status-purple-fg)]',
            )}
          >
            <Calendar className="size-3.5" />
            {showWeekly ? 'ซ่อนรายสัปดาห์' : `แสดงรายสัปดาห์ (${weeklyCount})`}
          </Button>
        )}
      </div>

      {/* Low stock alert panel */}
      {showLowPanel && lowItems.length > 0 && (
        <div className="rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-medium text-[var(--status-danger-fg)]">
              <AlertTriangle className="size-4" />
              {lowItems.length} รายการต่ำกว่าจุดสั่งซื้อ
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="ปิด"
              className="-mr-2 h-7 w-7 p-0 text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-border)]/40 hover:text-[var(--status-danger-fg)]"
              onClick={() => setShowLowPanel(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <ul className="space-y-1">
            {lowItems.slice(0, 6).map((item) => (
              <li key={item.id} className="text-sm text-[var(--status-danger-fg)] flex items-center gap-2">
                <AlertTriangle className="size-3.5 text-[var(--status-danger-border)] shrink-0" />
                <span className="font-medium">{item.ingredient.name}</span>
                <span className="text-xs opacity-80">
                  คงเหลือ {Number(item.quantityOnHand).toLocaleString('th-TH')} / ต้องมี {Number(item.ingredient.minStock).toLocaleString('th-TH')} {item.unit}
                </span>
              </li>
            ))}
            {lowItems.length > 6 && <li className="text-xs opacity-60">…อีก {lowItems.length - 6} รายการ</li>}
          </ul>
          <Link
            href="/inventory/orders"
            className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            <ShoppingCart className="size-4" />
            สร้างใบสั่งซื้อ
          </Link>
        </div>
      )}

      {/* Stock count table grouped by category */}
      <div className="space-y-4">
        {grouped.map(({ category, items }) => (
          <DataCard
            key={category.id}
            noPadding
            title={category.name}
            actions={<span className="text-xs text-muted-foreground">{items.length} รายการ</span>}
          >
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="border-border bg-muted/30">
                  <TableHead className="px-4 py-2 text-xs font-medium text-muted-foreground w-48">วัตถุดิบ</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right w-28">ยอดยกมา</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium text-[var(--status-info-fg)] text-right w-28 bg-[var(--status-info-bg)]/40">รับเข้า (auto)</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right w-28 bg-muted/50">รวมมี</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium text-[var(--status-success-fg)] text-center w-28 bg-[var(--status-success-bg)]/50">↑ นับได้จริง</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right w-28">ใช้ไป</TableHead>
                  {guestCount > 0 && (
                    <TableHead className="px-3 py-2 text-xs font-medium text-[var(--status-info-fg)] text-right w-24">/หัว</TableHead>
                  )}
                  <TableHead className="px-3 py-2 text-xs font-medium text-[var(--status-orange-fg)] text-right w-28">ต้องสั่ง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((ing) => {
                  const state = itemMap[ing.id] ?? { openingBalance: 0, receivedQty: 0, physicalCount: 0, notes: '' };
                  const total = state.openingBalance + state.receivedQty;
                  const usedQty = Math.max(0, total - state.physicalCount);
                  const closing = state.physicalCount;
                  const minStock = Number(ing.minStock);
                  const parLevel = Number(ing.parLevel ?? 0);
                  const isLow = closing < minStock && minStock > 0;
                  const reorderQty = isLow
                    ? Math.max(0, (parLevel > 0 ? parLevel : minStock) - closing)
                    : 0;
                  const perHead = guestCount > 0 && readonly ? usedQty / guestCount : null;
                  const isWeekly = ing.countFrequency === 'weekly';

                  return (
                    <TableRow
                      key={ing.id}
                      className={cn(
                        'transition-colors hover:bg-muted/20',
                        isLow && 'bg-[var(--status-danger-bg)]',
                      )}
                    >
                      {/* ชื่อ */}
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-medium text-foreground">{ing.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {ing.unit}
                              {minStock > 0 && (
                                <span className="ml-1.5">• จุดสั่ง {minStock.toLocaleString('th-TH')}</span>
                              )}
                            </p>
                          </div>
                          {isWeekly && (
                            <StatusBadge label="สัปดาห์" variant="purple" />
                          )}
                        </div>
                      </TableCell>

                      {/* ยอดยกมา */}
                      <TableCell className="px-3 py-3 text-right">
                        <span className="tabular-nums text-muted-foreground">{fmtNum(state.openingBalance)}</span>
                        <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                      </TableCell>

                      {/* รับเข้า (auto-filled, read-only) */}
                      <TableCell className="px-3 py-3 text-right bg-[var(--status-info-bg)]/20">
                        <span className={cn('tabular-nums', state.receivedQty > 0 ? 'font-medium text-[var(--status-info-fg)]' : 'text-muted-foreground/60')}>
                          {fmtNum(state.receivedQty)}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                      </TableCell>

                      {/* รวมมี (computed) */}
                      <TableCell className="px-3 py-3 text-right bg-muted/30">
                        <span className="tabular-nums text-muted-foreground">{fmtNum(total)}</span>
                        <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                      </TableCell>

                      {/* นับได้จริง (USER INPUT) */}
                      <TableCell className="px-3 py-3 text-center bg-[var(--status-success-bg)]/20">
                        {readonly ? (
                          <span className={cn('tabular-nums font-semibold', isLow ? 'text-[var(--status-danger-fg)]' : 'text-foreground')}>
                            {fmtNum(closing)}
                            {isLow && <AlertTriangle className="inline ml-1 size-3.5 text-[var(--status-danger-fg)] -mt-0.5" />}
                          </span>
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={state.physicalCount === 0 ? '' : state.physicalCount}
                            onChange={(e) => updatePhysicalCount(ing.id, e.target.value)}
                            onBlur={(e) => { if (e.target.value === '') updatePhysicalCount(ing.id, '0'); }}
                            placeholder="นับได้..."
                            className={cn(
                              'w-24 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none transition-colors',
                              isLow
                                ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] focus:border-[var(--status-danger-border)]'
                                : 'border-[var(--status-success-border)] bg-card text-[var(--status-success-fg)] focus:border-[var(--status-success-border)]',
                            )}
                          />
                        )}
                        {!readonly && isLow && (
                          <AlertTriangle className="inline ml-1 size-3.5 text-[var(--status-danger-fg)] -mt-0.5" />
                        )}
                      </TableCell>

                      {/* ใช้ไป (computed) */}
                      <TableCell className="px-3 py-3 text-right">
                        <span className="tabular-nums text-muted-foreground">{fmtNum(usedQty)}</span>
                        <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                      </TableCell>

                      {/* ใช้/หัว (when submitted + guest count known) */}
                      {guestCount > 0 && (
                        <TableCell className="px-3 py-3 text-right">
                          {perHead !== null && usedQty > 0 ? (
                            <span className="tabular-nums text-xs font-medium text-[var(--status-info-fg)]">
                              {perHead.toFixed(3)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60 text-xs">—</span>
                          )}
                        </TableCell>
                      )}

                      {/* ต้องสั่ง */}
                      <TableCell className="px-3 py-3 text-right">
                        {reorderQty > 0 ? (
                          <span className="tabular-nums font-semibold text-[var(--status-orange-fg)]">
                            +{fmtNum(reorderQty)} {ing.unit}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60 text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataCard>
        ))}
      </div>

      {/* Overall notes */}
      <div className="space-y-1.5">
        <Label htmlFor="count-notes" className="text-xs text-muted-foreground">หมายเหตุรวม (ถ้ามี)</Label>
        <Textarea
          id="count-notes"
          value={countNotes}
          onChange={(e) => setCountNotes(e.target.value)}
          disabled={readonly}
          placeholder="หมายเหตุสำหรับการนับครั้งนี้"
          className="resize-none"
        />
      </div>

      {/* Action buttons (draft mode only) */}
      {!readonly && (
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isPending}
            className="flex-1 py-3 h-auto"
          >
            {isPending ? (
              <><Loader2 className="size-4 animate-spin" /> กำลังบันทึก…</>
            ) : 'บันทึกแบบร่าง'}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-3 h-auto"
          >
            {isPending ? (
              <><Loader2 className="size-4 animate-spin" /> กำลังส่ง…</>
            ) : 'ส่งผลการนับ'}
          </Button>
        </div>
      )}

      {/* Submitted confirmation */}
      {readonly && existing?.status === 'submitted' && (
        <div className="rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-4 flex items-center gap-3">
          <CheckCircle2 className="size-5 text-[var(--status-success-fg)] shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--status-success-fg)]">ส่งผลการนับเรียบร้อย</p>
            {existing.submittedAt && (
              <p className="text-xs text-[var(--status-success-fg)] opacity-80 mt-0.5">
                เมื่อ {formatThaiDateTime(existing.submittedAt)} น.
              </p>
            )}
            {guestCount > 0 && (
              <p className="text-xs text-[var(--status-info-fg)] mt-0.5">
                <Users className="inline size-3 mr-0.5" />
                {guestCount.toLocaleString('th-TH')} หัว — ดูยอดใช้/หัวในตารางด้านบน
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] hover:bg-[var(--status-warning-bg)] hover:text-[var(--status-warning-fg)]"
              onClick={() => setShowAdjDialog(true)}
            >
              <PenLine className="size-3.5" />
              ปรับปรุง
            </Button>
            <Link
              href="/inventory/orders"
              className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              สร้าง PO
            </Link>
          </div>
        </div>
      )}

      {/* Stock Adjustment Dialog */}
      {existing && (
        <Dialog open={showAdjDialog} onOpenChange={(next) => { if (!next) setShowAdjDialog(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>บันทึกปรับปรุงสต็อก</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Type selector */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">ประเภท</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjType('adjustment')}
                    className={cn(
                      'flex-1 rounded-lg border py-2 text-xs font-medium transition-colors',
                      adjType === 'adjustment'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    แก้ไขความผิดพลาด
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjType('waste')}
                    className={cn(
                      'flex-1 rounded-lg border py-2 text-xs font-medium transition-colors',
                      adjType === 'waste'
                        ? 'border-[var(--status-orange-fg)] bg-[var(--status-orange-fg)] text-white'
                        : 'border-border text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    <Flame className="inline size-3 mr-1" />
                    ของเสีย/สูญหาย
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {adjType === 'waste'
                    ? 'บันทึกแยกจากยอดใช้ปกติ เพื่อคำนวณต้นทุนแม่นยำขึ้น'
                    : 'แก้ไขตัวเลขที่กรอกผิดในขั้นตอนก่อนหน้า'}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="adj-ingredient" className="text-xs text-muted-foreground">
                  วัตถุดิบ <span className="text-destructive">*</span>
                </Label>
                <select
                  id="adj-ingredient"
                  value={adjIngredientId}
                  onChange={(e) => setAdjIngredientId(e.target.value)}
                  className={SELECT_CLS}
                >
                  <option value="">— เลือกวัตถุดิบ —</option>
                  {initialData.ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} ({ing.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="adj-qty" className="text-xs text-muted-foreground">
                  จำนวนปรับปรุง <span className="text-destructive">*</span>{' '}
                  <span className="font-normal text-muted-foreground/70">(บวก = เพิ่ม, ลบ = ลด)</span>
                </Label>
                <Input
                  id="adj-qty"
                  type="number"
                  step="0.01"
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                  placeholder="เช่น 5 หรือ -3"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="adj-reason" className="text-xs text-muted-foreground">
                  เหตุผล <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="adj-reason"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="ระบุเหตุผลในการปรับปรุง"
                  className="resize-none"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdjDialog(false)}>ยกเลิก</Button>
              <Button
                type="button"
                disabled={isAdjPending}
                className={cn(adjType === 'waste' ? 'bg-[var(--status-orange-fg)] hover:opacity-90' : 'bg-[var(--status-warning-fg)] hover:opacity-90')}
                onClick={handleAdjustmentSubmit}
              >
                {isAdjPending ? <><Loader2 className="size-4 animate-spin" /> กำลังบันทึก…</> : 'บันทึกปรับปรุง'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      </>
      )}
    </AppShell>
  );
}
