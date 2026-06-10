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
} from 'lucide-react';
import Link from 'next/link';
import {
  saveStockCount,
  getLowStockItems,
  createStockAdjustment,
  type StockCountPageData,
  type LowStockItem,
} from '@/lib/actions/inventory';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ItemState {
  openingBalance: number;
  receivedQty: number;
  usedQty: number;
  notes: string;
}

type ItemMap = Record<string, ItemState>;

interface Props {
  initialData: StockCountPageData;
  initialDataUpdatedAt: number;
  today: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function inputCls(highlight = false) {
  return `w-24 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none transition-colors disabled:bg-slate-50 disabled:text-slate-400 ${
    highlight
      ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-400'
      : 'border-slate-300 focus:border-slate-500'
  }`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function StockCountPage({ initialData, today }: Props) {
  const existing = initialData.existingCount;
  const isSubmitted = existing?.status === 'submitted';

  // Build initial item states from existing draft OR from openingBalances
  function buildInitialMap(): ItemMap {
    const map: ItemMap = {};
    for (const ing of initialData.ingredients) {
      if (existing?.items.length) {
        const stored = existing.items.find((it) => it.ingredientId === ing.id);
        if (stored) {
          map[ing.id] = {
            openingBalance: Number(stored.openingBalance),
            receivedQty: Number(stored.receivedQty),
            usedQty: Number(stored.usedQty),
            notes: stored.notes ?? '',
          };
          continue;
        }
      }
      map[ing.id] = {
        openingBalance: Number(initialData.openingBalances[ing.id] ?? '0'),
        receivedQty: 0,
        usedQty: 0,
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

  // Adjustment dialog state
  const [showAdjDialog, setShowAdjDialog] = useState(false);
  const [adjIngredientId, setAdjIngredientId] = useState('');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [isAdjPending, startAdjTransition] = useTransition();

  function updateItem(id: string, field: keyof Omit<ItemState, 'notes'>, raw: string) {
    const val = parseFloat(raw);
    setItemMap((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: isNaN(val) || val < 0 ? 0 : val },
    }));
  }

  function updateNotes(id: string, val: string) {
    setItemMap((prev) => ({ ...prev, [id]: { ...prev[id], notes: val } }));
  }

  // Grouped by category
  const grouped = useMemo(
    () =>
      initialData.categories
        .map((cat) => ({
          category: cat,
          items: initialData.ingredients.filter((i) => i.categoryId === cat.id),
        }))
        .filter((g) => g.items.length > 0),
    [initialData],
  );

  // Summary stats
  const stats = useMemo(() => {
    let filledCount = 0;
    let lowCount = 0;
    let reorderCount = 0;
    for (const ing of initialData.ingredients) {
      const state = itemMap[ing.id];
      if (!state) continue;
      const closing = state.openingBalance + state.receivedQty - state.usedQty;
      const minStock = Number(ing.minStock);
      if (state.receivedQty > 0 || state.usedQty > 0 || state.openingBalance > 0) filledCount++;
      if (closing < minStock) lowCount++;
      const parLevel = Number(ing.category ? 0 : 0);
      if (closing < minStock) reorderCount++;
    }
    return { filledCount, lowCount, reorderCount };
  }, [itemMap, initialData.ingredients]);

  function buildPayload(asDraft: boolean) {
    return {
      countDate: today,
      asDraft,
      notes: countNotes || null,
      items: initialData.ingredients.map((ing) => {
        const state = itemMap[ing.id] ?? { openingBalance: 0, receivedQty: 0, usedQty: 0, notes: '' };
        return {
          ingredientId: ing.id,
          openingBalance: state.openingBalance,
          receivedQty: state.receivedQty,
          usedQty: state.usedQty,
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
        reason: adjReason.trim(),
      });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('บันทึกรายการปรับปรุงแล้ว');
      setShowAdjDialog(false);
      setAdjIngredientId('');
      setAdjQty('');
      setAdjReason('');
    });
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">นับสต็อกรายวัน</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {format(new Date(today + 'T00:00:00'), 'd MMMM yyyy', { locale: th })}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">ใหม่</span>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 flex flex-wrap gap-6">
        <div className="text-sm">
          <span className="text-slate-500">รายการทั้งหมด </span>
          <span className="font-semibold text-slate-900">{initialData.ingredients.length}</span>
        </div>
        <div className="text-sm">
          <span className="text-slate-500">ต่ำกว่าจุดสั่งซื้อ </span>
          <span className={`font-semibold ${stats.lowCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {stats.lowCount}
          </span>
        </div>
        {Object.keys(initialData.openingBalances).length === 0 && (
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <AlertTriangle className="size-3.5" />
            ไม่มีข้อมูลวันก่อนหน้า — ยอดยกมาเป็น 0
          </div>
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
          <div key={category.id} className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
            {/* Category header */}
            <div className="flex items-center gap-2 bg-slate-50 border-b border-slate-200 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-700">{category.name}</span>
              <span className="text-xs text-slate-400">{items.length} รายการ</span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[780px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 w-48">วัตถุดิบ</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 w-28">
                      ยอดยกมา
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-28">
                      รับเข้า
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-600 w-28 bg-blue-50/40">
                      รวมมี
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-28">
                      ใช้ไป
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-600 w-28 bg-slate-100/60">
                      คงเหลือ
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-orange-600 w-32">
                      ต้องสั่งเพิ่ม
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((ing) => {
                    const state = itemMap[ing.id] ?? { openingBalance: 0, receivedQty: 0, usedQty: 0, notes: '' };
                    const total = state.openingBalance + state.receivedQty;
                    const closing = Math.max(0, total - state.usedQty);
                    const minStock = Number(ing.minStock);
                    const parLevel = Number(ing.parLevel ?? 0);
                    const isLow = closing < minStock && minStock > 0;
                    const reorderQty = isLow
                      ? Math.max(0, (parLevel > 0 ? parLevel : minStock) - closing)
                      : 0;

                    return (
                      <tr key={ing.id} className={`transition-colors hover:bg-slate-50/50 ${isLow ? 'bg-red-50/20' : ''}`}>
                        {/* ชื่อ */}
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{ing.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {ing.unit}
                            {minStock > 0 && (
                              <span className="ml-1.5">• จุดสั่ง {minStock.toLocaleString('th-TH')} {ing.unit}</span>
                            )}
                          </p>
                        </td>

                        {/* ยอดยกมา */}
                        <td className="px-3 py-3 text-right">
                          <span className="tabular-nums text-slate-500">{fmtNum(state.openingBalance)}</span>
                          <span className="text-xs text-slate-400 ml-1">{ing.unit}</span>
                        </td>

                        {/* รับเข้า (input) */}
                        <td className="px-3 py-3 text-center">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            disabled={readonly}
                            value={state.receivedQty === 0 ? '' : state.receivedQty}
                            onChange={(e) => updateItem(ing.id, 'receivedQty', e.target.value)}
                            onBlur={(e) => { if (e.target.value === '') updateItem(ing.id, 'receivedQty', '0'); }}
                            placeholder="0"
                            className={inputCls(false)}
                          />
                        </td>

                        {/* รวมมี (auto) */}
                        <td className="px-3 py-3 text-right bg-blue-50/30">
                          <span className="tabular-nums font-medium text-blue-700">{fmtNum(total)}</span>
                          <span className="text-xs text-slate-400 ml-1">{ing.unit}</span>
                        </td>

                        {/* ใช้ไป (input) */}
                        <td className="px-3 py-3 text-center">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            disabled={readonly}
                            value={state.usedQty === 0 ? '' : state.usedQty}
                            onChange={(e) => updateItem(ing.id, 'usedQty', e.target.value)}
                            onBlur={(e) => { if (e.target.value === '') updateItem(ing.id, 'usedQty', '0'); }}
                            placeholder="0"
                            className={inputCls(false)}
                          />
                        </td>

                        {/* คงเหลือ (auto) */}
                        <td className="px-3 py-3 text-right bg-slate-50/60">
                          <span className={`tabular-nums font-semibold ${isLow ? 'text-red-600' : 'text-slate-800'}`}>
                            {fmtNum(closing)}
                          </span>
                          <span className="text-xs text-slate-400 ml-1">{ing.unit}</span>
                          {isLow && <AlertTriangle className="inline ml-1 size-3.5 text-red-500 -mt-0.5" />}
                        </td>

                        {/* ต้องสั่งเพิ่ม (auto) */}
                        <td className="px-3 py-3 text-right">
                          {reorderQty > 0 ? (
                            <span className="tabular-nums font-semibold text-orange-600">
                              +{fmtNum(reorderQty)} {ing.unit}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
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
        <label className="block text-xs font-medium text-slate-700 mb-1">หมายเหตุรวม (ถ้ามี)</label>
        <textarea
          value={countNotes}
          onChange={(e) => setCountNotes(e.target.value)}
          disabled={readonly}
          rows={2}
          placeholder="หมายเหตุสำหรับการนับครั้งนี้"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 resize-none disabled:bg-slate-50 disabled:text-slate-400"
        />
      </div>

      {/* Action buttons (draft mode only) */}
      {!readonly && (
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isPending}
            className="flex-1 rounded-lg border border-slate-300 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
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
            className="flex-1 rounded-lg bg-slate-800 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
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
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdjDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              <PenLine className="size-3.5" />
              บันทึกปรับปรุง
            </button>
            <Link
              href="/inventory/orders"
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              สร้าง PO
            </Link>
          </div>
        </div>
      )}

      {/* Stock Adjustment Dialog */}
      {showAdjDialog && existing?.id && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">บันทึกปรับปรุงสต็อก</h2>
              <button
                type="button"
                onClick={() => setShowAdjDialog(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="ปิด"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-slate-500">
                ใช้สำหรับแก้ไขข้อผิดพลาดหลังส่งผลการนับแล้ว ระบบจะบันทึกรายการปรับปรุงไว้แยกต่างหาก
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  วัตถุดิบ <span className="text-red-500">*</span>
                </label>
                <select
                  value={adjIngredientId}
                  onChange={(e) => setAdjIngredientId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
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
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  จำนวนปรับปรุง <span className="text-red-500">*</span>
                  <span className="ml-1 font-normal text-slate-400">(บวก = เพิ่ม, ลบ = ลด)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                  placeholder="เช่น 5 หรือ -3"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  เหตุผล <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  rows={2}
                  placeholder="ระบุเหตุผลในการปรับปรุง"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowAdjDialog(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleAdjustmentSubmit}
                disabled={isAdjPending}
                className="flex-1 rounded-lg bg-amber-600 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
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
    </div>
  );
}
