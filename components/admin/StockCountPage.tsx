'use client';

import { useState, useMemo, useTransition } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  ShoppingCart,
  PenLine,
  X,
  Flame,
  Calendar,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import {
  saveStockCount,
  getLowStockItems,
  createStockAdjustment,
  type StockCountPageData,
  type LowStockItem,
} from '@/lib/actions/inventory';
import { StockCountHistoryTab } from '@/components/admin/StockCountHistoryTab';

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
  initialDataUpdatedAt: number;
  today: string;
  defaultTab?: 'daily' | 'history';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function inputCls(highlight = false) {
  return `w-24 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none transition-colors disabled:bg-muted/30 disabled:text-muted-foreground ${
    highlight
      ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-400'
      : 'border-border bg-card focus:border-primary'
  }`;
}

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

  function updateNotes(id: string, val: string) {
    setItemMap((prev) => ({ ...prev, [id]: { ...prev[id], notes: val } }));
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
    <div className="p-6 space-y-5">
      {/* Tab navigation */}
      <div className="border-b border-border -mx-6 px-6">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('daily')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'daily'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            นับสต็อกรายวัน
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            ผลการนับสต็อก
          </button>
        </div>
      </div>

      {activeTab === 'history' && <StockCountHistoryTab />}

      {activeTab === 'daily' && (
      <>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">นับสต็อกรายวัน</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(today + 'T00:00:00'), 'd MMMM yyyy', { locale: th })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {guestCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-medium text-blue-700">
              <Users className="size-3.5" />
              {guestCount.toLocaleString('th-TH')} หัว
            </span>
          )}
          {existing ? (
            <span
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                existing.status === 'submitted'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {existing.status === 'submitted' ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <ClipboardList className="size-3.5" />
              )}
              {existing.status === 'submitted' ? 'ส่งแล้ว' : 'แบบร่าง'}
            </span>
          ) : (
            <span className="rounded-full bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">ใหม่</span>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="rounded-xl border border-border bg-muted/30 px-5 py-3 flex flex-wrap gap-6 items-center">
        <div className="text-sm">
          <span className="text-muted-foreground">รายการทั้งหมด </span>
          <span className="font-semibold text-foreground">{initialData.ingredients.length}</span>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">ต่ำกว่าจุดสั่งซื้อ </span>
          <span className={`font-semibold ${stats.lowCount > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
            {stats.lowCount}
          </span>
        </div>
        {Object.keys(initialData.todayReceivedQty).length > 0 && (
          <div className="text-xs text-blue-600 flex items-center gap-1">
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
          <button
            type="button"
            onClick={() => setShowWeekly((v) => !v)}
            className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              showWeekly
                ? 'border-purple-300 bg-purple-50 text-purple-700'
                : 'border-border bg-card text-muted-foreground hover:bg-muted/30'
            }`}
          >
            <Calendar className="size-3.5" />
            {showWeekly ? 'ซ่อนรายสัปดาห์' : `แสดงรายสัปดาห์ (${weeklyCount})`}
          </button>
        )}
      </div>

      {/* Low stock alert panel */}
      {showLowPanel && lowItems.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-medium text-red-700">
              <AlertTriangle className="size-4" />
              {lowItems.length} รายการต่ำกว่าจุดสั่งซื้อ
            </p>
            <button type="button" onClick={() => setShowLowPanel(false)} className="text-red-400 hover:text-red-600" aria-label="ปิด">×</button>
          </div>
          <ul className="space-y-1">
            {lowItems.slice(0, 6).map((item) => (
              <li key={item.id} className="text-sm text-red-800 flex items-center gap-2">
                <AlertTriangle className="size-3.5 text-red-400 shrink-0" />
                <span className="font-medium">{item.ingredient.name}</span>
                <span className="text-red-600 text-xs">
                  คงเหลือ {Number(item.quantityOnHand).toLocaleString('th-TH')} / ต้องมี {Number(item.ingredient.minStock).toLocaleString('th-TH')} {item.unit}
                </span>
              </li>
            ))}
            {lowItems.length > 6 && <li className="text-xs text-red-500">…อีก {lowItems.length - 6} รายการ</li>}
          </ul>
          <Link
            href="/inventory/orders"
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <ShoppingCart className="size-4" />
            สร้างใบสั่งซื้อ
          </Link>
        </div>
      )}

      {/* Stock count table grouped by category */}
      <div className="space-y-4">
        {grouped.map(({ category, items }) => (
          <div key={category.id} className="rounded-xl bg-card overflow-hidden shadow-sm ring-1 ring-border/40">
            <div className="flex items-center gap-2 bg-muted/30 border-b border-border px-4 py-2.5">
              <span className="text-xs font-semibold text-foreground">{category.name}</span>
              <span className="text-xs text-muted-foreground">{items.length} รายการ</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30/50">
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-48">วัตถุดิบ</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-28">ยอดยกมา</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-blue-600 w-28 bg-blue-50/40">รับเข้า (auto)</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-28 bg-muted/50/60">รวมมี</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-emerald-700 w-28 bg-emerald-50/50">
                      ↑ นับได้จริง
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-28">ใช้ไป</th>
                    {guestCount > 0 && (
                      <th className="px-3 py-2 text-right text-xs font-medium text-blue-600 w-24">
                        /หัว
                      </th>
                    )}
                    <th className="px-3 py-2 text-right text-xs font-medium text-orange-600 w-28">ต้องสั่ง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
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
                      <tr key={ing.id} className={`transition-colors hover:bg-muted/30/50 ${isLow ? 'bg-red-50/20' : ''}`}>
                        {/* ชื่อ */}
                        <td className="px-4 py-3">
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
                              <span className="shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-600">
                                สัปดาห์
                              </span>
                            )}
                          </div>
                        </td>

                        {/* ยอดยกมา */}
                        <td className="px-3 py-3 text-right">
                          <span className="tabular-nums text-muted-foreground">{fmtNum(state.openingBalance)}</span>
                          <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                        </td>

                        {/* รับเข้า (auto-filled, read-only) */}
                        <td className="px-3 py-3 text-right bg-blue-50/20">
                          <span className={`tabular-nums ${state.receivedQty > 0 ? 'font-medium text-blue-700' : 'text-muted-foreground/60'}`}>
                            {fmtNum(state.receivedQty)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                        </td>

                        {/* รวมมี (computed) */}
                        <td className="px-3 py-3 text-right bg-muted/30/40">
                          <span className="tabular-nums text-muted-foreground">{fmtNum(total)}</span>
                          <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                        </td>

                        {/* นับได้จริง (USER INPUT) */}
                        <td className="px-3 py-3 text-center bg-emerald-50/30">
                          {readonly ? (
                            <span className={`tabular-nums font-semibold ${isLow ? 'text-red-600' : 'text-foreground'}`}>
                              {fmtNum(closing)}
                              {isLow && <AlertTriangle className="inline ml-1 size-3.5 text-red-500 -mt-0.5" />}
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
                              className={`w-24 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none transition-colors ${
                                isLow
                                  ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-400'
                                  : 'border-emerald-300 bg-card text-emerald-800 focus:border-emerald-500'
                              }`}
                            />
                          )}
                          {!readonly && isLow && (
                            <AlertTriangle className="inline ml-1 size-3.5 text-red-500 -mt-0.5" />
                          )}
                        </td>

                        {/* ใช้ไป (computed) */}
                        <td className="px-3 py-3 text-right">
                          <span className="tabular-nums text-muted-foreground">{fmtNum(usedQty)}</span>
                          <span className="text-xs text-muted-foreground ml-1">{ing.unit}</span>
                        </td>

                        {/* ใช้/หัว (when submitted + guest count known) */}
                        {guestCount > 0 && (
                          <td className="px-3 py-3 text-right">
                            {perHead !== null && usedQty > 0 ? (
                              <span className="tabular-nums text-xs font-medium text-blue-700">
                                {perHead.toFixed(3)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60 text-xs">—</span>
                            )}
                          </td>
                        )}

                        {/* ต้องสั่ง */}
                        <td className="px-3 py-3 text-right">
                          {reorderQty > 0 ? (
                            <span className="tabular-nums font-semibold text-orange-600">
                              +{fmtNum(reorderQty)} {ing.unit}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Overall notes */}
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">หมายเหตุรวม (ถ้ามี)</label>
        <textarea
          value={countNotes}
          onChange={(e) => setCountNotes(e.target.value)}
          disabled={readonly}
          rows={2}
          placeholder="หมายเหตุสำหรับการนับครั้งนี้"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary resize-none disabled:bg-muted/30 disabled:text-muted-foreground"
        />
      </div>

      {/* Action buttons (draft mode only) */}
      {!readonly && (
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isPending}
            className="flex-1 rounded-lg border border-border py-3 text-sm font-medium text-foreground hover:bg-muted/30 disabled:opacity-50 transition-colors"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" /> กำลังบันทึก…
              </span>
            ) : 'บันทึกแบบร่าง'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 rounded-lg bg-primary py-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" /> กำลังส่ง…
              </span>
            ) : 'ส่งผลการนับ'}
          </button>
        </div>
      )}

      {/* Submitted confirmation */}
      {readonly && existing?.status === 'submitted' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-3">
          <CheckCircle2 className="size-5 text-green-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">ส่งผลการนับเรียบร้อย</p>
            {existing.submittedAt && (
              <p className="text-xs text-green-600 mt-0.5">
                เมื่อ {format(new Date(existing.submittedAt), 'HH:mm น. d MMM yyyy', { locale: th })}
              </p>
            )}
            {guestCount > 0 && (
              <p className="text-xs text-blue-600 mt-0.5">
                <Users className="inline size-3 mr-0.5" />
                {guestCount.toLocaleString('th-TH')} หัว — ดูยอดใช้/หัวในตารางด้านบน
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdjDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              <PenLine className="size-3.5" />
              ปรับปรุง
            </button>
            <Link
              href="/inventory/orders"
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
            >
              สร้าง PO
            </Link>
          </div>
        </div>
      )}

      {/* Stock Adjustment Dialog */}
      {showAdjDialog && existing?.id && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">บันทึกปรับปรุงสต็อก</h2>
              <button
                type="button"
                onClick={() => setShowAdjDialog(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted/50 hover:text-muted-foreground"
                aria-label="ปิด"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Type selector */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ประเภท</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjType('adjustment')}
                    className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                      adjType === 'adjustment'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/30'
                    }`}
                  >
                    แก้ไขความผิดพลาด
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjType('waste')}
                    className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                      adjType === 'waste'
                        ? 'border-orange-600 bg-orange-600 text-white'
                        : 'border-border text-muted-foreground hover:bg-muted/30'
                    }`}
                  >
                    <Flame className="inline size-3 mr-1" />
                    ของเสีย/สูญหาย
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {adjType === 'waste'
                    ? 'บันทึกแยกจากยอดใช้ปกติ เพื่อคำนวณต้นทุนแม่นยำขึ้น'
                    : 'แก้ไขตัวเลขที่กรอกผิดในขั้นตอนก่อนหน้า'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  วัตถุดิบ <span className="text-red-500">*</span>
                </label>
                <select
                  value={adjIngredientId}
                  onChange={(e) => setAdjIngredientId(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="">— เลือกวัตถุดิบ —</option>
                  {initialData.ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} ({ing.unit})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  จำนวนปรับปรุง <span className="text-red-500">*</span>
                  <span className="ml-1 font-normal text-muted-foreground">(บวก = เพิ่ม, ลบ = ลด)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                  placeholder="เช่น 5 หรือ -3"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  เหตุผล <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  rows={2}
                  placeholder="ระบุเหตุผลในการปรับปรุง"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setShowAdjDialog(false)}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/30"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleAdjustmentSubmit}
                disabled={isAdjPending}
                className={`flex-1 rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50 ${
                  adjType === 'waste' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {isAdjPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> กำลังบันทึก…
                  </span>
                ) : 'บันทึกปรับปรุง'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
