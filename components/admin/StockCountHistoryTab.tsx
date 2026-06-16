'use client';

import { useState, useEffect, useTransition, useMemo } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Trash2,
  PenLine,
  X,
  Eye,
  BadgeCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  getStockCountList,
  getStockCountDetail,
  deleteStockCount,
  reviewStockCount,
  unreviewStockCount,
  type StockCountListItem,
  type StockCountDetail,
} from '@/lib/actions/inventory';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number | string) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string) {
  return format(new Date(dateStr + 'T00:00:00'), 'd MMM yyyy', { locale: th });
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function DetailModal({
  countId,
  onClose,
}: {
  countId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<StockCountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getStockCountDetail(countId).then((r) => {
      if (r.ok) setData(r.data);
      else setError(r.error);
      setLoading(false);
    });
  }, [countId]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const catMap = new Map<string, { catName: string; sortOrder: number; items: typeof data.items }>();
    for (const item of data.items) {
      const cat = item.ingredient.category;
      if (!catMap.has(cat.id)) {
        catMap.set(cat.id, { catName: cat.name, sortOrder: cat.sortOrder, items: [] });
      }
      catMap.get(cat.id)!.items.push(item);
    }
    return [...catMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl my-8 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              ผลการนับสต็อก {data ? fmtDate(data.countDate) : ''}
            </h2>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                ผู้นับ: {data.countedByUser?.name ?? '—'}
                {data.submittedAt &&
                  ` • ส่งเมื่อ ${format(new Date(data.submittedAt), 'HH:mm น.', { locale: th })}`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted/50 hover:text-muted-foreground"
            aria-label="ปิด"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {data && (
            <>
              {/* Count table by category */}
              {grouped.map(({ catName, items }) => (
                <div key={catName} className="rounded-xl overflow-hidden ring-1 ring-border/40">
                  <div className="bg-muted/30 border-b border-border px-4 py-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{catName}</span>
                    <span className="text-xs text-muted-foreground">{items.length} รายการ</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/30/50">
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-40">วัตถุดิบ</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">ยอดยกมา</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">รับเข้า</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-blue-600 bg-blue-50/40">รวมมี</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">ใช้ไป</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground bg-muted/50/60">คงเหลือ</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-orange-600">ต้องสั่งเพิ่ม</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {items.map((item) => {
                          const closing = Number(item.quantityOnHand);
                          const minStock = Number(item.ingredient.minStock);
                          const parLevel = Number(item.ingredient.parLevel ?? 0);
                          const isLow = closing < minStock && minStock > 0;
                          const reorderQty = isLow ? Math.max(0, (parLevel > 0 ? parLevel : minStock) - closing) : 0;
                          const total = Number(item.openingBalance) + Number(item.receivedQty);
                          return (
                            <tr key={item.id} className={isLow ? 'bg-red-50/20' : ''}>
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-foreground text-xs">{item.ingredient.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.unit}
                                  {minStock > 0 && (
                                    <span className="ml-1.5">• จุดสั่ง {minStock.toLocaleString('th-TH')} {item.unit}</span>
                                  )}
                                </p>
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {fmtNum(item.openingBalance)} {item.unit}
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {fmtNum(item.receivedQty)} {item.unit}
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums font-medium text-blue-700 bg-blue-50/30">
                                {fmtNum(total)} {item.unit}
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {fmtNum(item.usedQty)} {item.unit}
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums font-semibold bg-muted/30/60">
                                <span className={isLow ? 'text-red-600' : 'text-foreground'}>
                                  {fmtNum(closing)} {item.unit}
                                </span>
                                {isLow && <AlertTriangle className="inline ml-1 size-3 text-red-500 -mt-0.5" />}
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                                {reorderQty > 0 ? (
                                  <span className="font-semibold text-orange-600">+{fmtNum(reorderQty)} {item.unit}</span>
                                ) : (
                                  <span className="text-muted-foreground/60">—</span>
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

              {/* Adjustments */}
              {data.adjustments.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-2">รายการปรับปรุง ({data.adjustments.length})</p>
                  <div className="rounded-xl ring-1 ring-border/40 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="px-4 py-2 text-left font-medium text-muted-foreground">วัตถุดิบ</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">จำนวน</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">เหตุผล</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">โดย</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">เวลา</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {data.adjustments.map((adj) => {
                          const qty = Number(adj.adjustmentQty);
                          return (
                            <tr key={adj.id}>
                              <td className="px-4 py-2 font-medium text-foreground">{adj.ingredient.name}</td>
                              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${qty >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {qty >= 0 ? '+' : ''}{fmtNum(qty)} {adj.ingredient.unit}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{adj.reason}</td>
                              <td className="px-3 py-2 text-muted-foreground">{adj.createdByUser?.name ?? '—'}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {format(new Date(adj.createdAt), 'HH:mm', { locale: th })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Notes */}
              {data.notes && (
                <div className="rounded-lg bg-muted/30 border border-border px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">หมายเหตุ</p>
                  <p className="text-sm text-foreground">{data.notes}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────

function DeleteConfirmDialog({
  count,
  onConfirm,
  onCancel,
  isPending,
}: {
  count: StockCountListItem;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card shadow-xl">
        <div className="px-5 py-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-red-100">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">ลบการนับสต็อก</p>
              <p className="text-xs text-muted-foreground">{fmtDate(count.countDate)}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            ยืนยันการลบ? รายการนับสต็อกและการปรับปรุงทั้งหมดของวันนี้จะถูกลบออกถาวร
          </p>
          {count.status === 'submitted' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
              <AlertTriangle className="size-3.5 shrink-0" />
              การนับที่ส่งแล้วถ้าลบจะกระทบยอดยกมาของวันถัดไป
            </div>
          )}
        </div>
        <div className="flex gap-3 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" /> กำลังลบ…
              </span>
            ) : 'ลบ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StockCountHistoryTab() {
  const router = useRouter();
  const [counts, setCounts] = useState<StockCountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState('');
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deletingCount, setDeletingCount] = useState<StockCountListItem | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isReviewing, startReviewTransition] = useTransition();
  const [isUnreviewing, startUnreviewTransition] = useTransition();

  async function loadCounts() {
    setLoading(true);
    const r = await getStockCountList();
    if (r.ok) setCounts(r.data);
    else toast.error(r.error);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadCounts(); }, []);

  const filtered = useMemo(() => {
    if (!filterDate) return counts;
    return counts.filter((c) => c.countDate === filterDate);
  }, [counts, filterDate]);

  function handleEdit(count: StockCountListItem) {
    router.push(`/inventory/count?date=${count.countDate}`);
  }

  function handleReview(count: StockCountListItem) {
    if (!confirm(`ยืนยันการตรวจสอบผลนับสต็อกวันที่ ${fmtDate(count.countDate)}?`)) return;
    startReviewTransition(async () => {
      const r = await reviewStockCount(count.id);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ยืนยันการตรวจสอบแล้ว');
      await loadCounts();
    });
  }

  function handleUnreview(count: StockCountListItem) {
    if (!confirm(`ยกเลิกการยืนยัน และเปิดให้แก้ไขผลนับสต็อกวันที่ ${fmtDate(count.countDate)}?`)) return;
    startUnreviewTransition(async () => {
      const r = await unreviewStockCount(count.id);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ยกเลิกการยืนยันแล้ว');
      await loadCounts();
    });
  }

  function handleDeleteConfirm() {
    if (!deletingCount) return;
    const id = deletingCount.id;
    startDeleteTransition(async () => {
      const r = await deleteStockCount(id);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบการนับสต็อกแล้ว');
      setDeletingCount(null);
      await loadCounts();
    });
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">วันที่</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
        {filterDate && (
          <button
            type="button"
            onClick={() => setFilterDate('')}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/30"
          >
            <X className="size-3" /> ล้างตัวกรอง
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} รายการ</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/30 py-16 text-center">
          <ClipboardList className="mx-auto size-8 text-muted-foreground/60 mb-3" />
          <p className="text-sm text-muted-foreground">ยังไม่มีผลการนับสต็อก</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden ring-1 ring-border/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">วันที่</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-muted-foreground">สถานะ</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-muted-foreground">รายการ</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">ผู้นับ</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">เวลาที่ส่ง</th>
                <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {filtered.map((count) => (
                <tr key={count.id} className="hover:bg-muted/30/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">{fmtDate(count.countDate)}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {count.status === 'reviewed' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                        <BadgeCheck className="size-3" /> ตรวจแล้ว
                      </span>
                    ) : count.status === 'submitted' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        <CheckCircle2 className="size-3" /> ส่งแล้ว
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        <ClipboardList className="size-3" /> แบบร่าง
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center tabular-nums text-muted-foreground">
                    {count.items.length}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs">
                    {count.countedByUser?.name ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs">
                    {count.submittedAt
                      ? format(new Date(count.submittedAt), 'HH:mm น. d MMM', { locale: th })
                      : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setViewingId(count.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
                        aria-label="ดูรายละเอียด"
                      >
                        <Eye className="size-3.5" /> ดู
                      </button>
                      {count.status !== 'reviewed' && (
                        <button
                          type="button"
                          onClick={() => handleEdit(count)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
                          aria-label="แก้ไข"
                        >
                          <PenLine className="size-3.5" /> แก้ไข
                        </button>
                      )}
                      {count.status === 'submitted' && (
                        <button
                          type="button"
                          disabled={isReviewing}
                          onClick={() => handleReview(count)}
                          className="inline-flex items-center gap-1 rounded-lg border border-purple-300 bg-purple-50 px-2.5 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                          aria-label="ยืนยัน"
                        >
                          <BadgeCheck className="size-3.5" /> ยืนยัน
                        </button>
                      )}
                      {count.status === 'reviewed' && (
                        <button
                          type="button"
                          disabled={isUnreviewing}
                          onClick={() => handleUnreview(count)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
                          aria-label="ยกเลิกการยืนยัน"
                        >
                          ยกเลิกยืนยัน
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeletingCount(count)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                        aria-label="ลบ"
                      >
                        <Trash2 className="size-3.5" /> ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      {viewingId && (
        <DetailModal countId={viewingId} onClose={() => setViewingId(null)} />
      )}

      {/* Delete confirm */}
      {deletingCount && (
        <DeleteConfirmDialog
          count={deletingCount}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingCount(null)}
          isPending={isDeleting}
        />
      )}
    </div>
  );
}
