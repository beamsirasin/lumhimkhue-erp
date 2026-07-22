'use client';

import { useState, useEffect, useTransition, useMemo } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Loader2,
  Trash2,
  PackageCheck,
  PenLine,
  X,
  Eye,
  BadgeCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  getStockCountList,
  getStockCountDetail,
  deleteStockCount,
  reviewStockCount,
  unreviewStockCount,
  type StockCountListItem,
  type StockCountDetail,
} from '@/lib/actions/inventory';
import { usePrompt } from '@/components/shared/PromptDialog';
import { Button } from '@/components/ui/button';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DataCard } from '@/components/ui/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatThaiDate, formatThaiDateTime, formatThaiTime } from '@/lib/date-time';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number | string) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string) {
  return formatThaiDate(dateStr);
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
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>ผลการนับสต็อก {data ? fmtDate(data.countDate) : ''}</DialogTitle>
          {data && (
            <p className="text-xs text-muted-foreground mt-0.5">
              ผู้นับ: {data.countedByUser?.name ?? '—'}
              {data.submittedAt &&
                ` • ส่งเมื่อ ${formatThaiTime(data.submittedAt)} น.`}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {loading && (
            <div className="space-y-2 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data && (
            <>
              {/* Count table by category */}
              {grouped.map(({ catName, items }) => (
                <DataCard
                  key={catName}
                  noPadding
                  title={catName}
                  actions={<span className="text-xs text-muted-foreground">{items.length} รายการ</span>}
                >
                  <Table className="min-w-[600px]">
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="px-4 py-2 text-xs font-medium text-muted-foreground w-40">วัตถุดิบ</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">ยอดยกมา</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">รับเข้า</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-[var(--status-info-fg)] text-right bg-[var(--status-info-bg)]/40">รวมมี</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">ใช้ไป</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right bg-muted/50">คงเหลือ</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-[var(--status-orange-fg)] text-right">ต้องสั่งเพิ่ม</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const closing = Number(item.quantityOnHand);
                        const minStock = Number(item.ingredient.minStock);
                        const parLevel = Number(item.ingredient.parLevel ?? 0);
                        const isLow = closing < minStock && minStock > 0;
                        const reorderQty = isLow ? Math.max(0, (parLevel > 0 ? parLevel : minStock) - closing) : 0;
                        const total = Number(item.openingBalance) + Number(item.receivedQty);
                        return (
                          <TableRow key={item.id} className={cn('border-border', isLow && 'bg-red-50/20')}>
                            <TableCell className="px-4 py-2.5">
                              <p className="font-medium text-foreground text-xs">{item.ingredient.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.unit}
                                {minStock > 0 && (
                                  <span className="ml-1.5">• จุดสั่ง {minStock.toLocaleString('th-TH')} {item.unit}</span>
                                )}
                              </p>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                              {fmtNum(item.openingBalance)} {item.unit}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                              {fmtNum(item.receivedQty)} {item.unit}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums font-medium text-[var(--status-info-fg)] bg-[var(--status-info-bg)]/20">
                              {fmtNum(total)} {item.unit}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                              {fmtNum(item.usedQty)} {item.unit}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums font-semibold bg-muted/30">
                              <span className={isLow ? 'text-[var(--status-danger-fg)]' : 'text-foreground'}>
                                {fmtNum(closing)} {item.unit}
                              </span>
                              {isLow && <AlertTriangle className="inline ml-1 size-3 text-[var(--status-danger-fg)] -mt-0.5" />}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums">
                              {reorderQty > 0 ? (
                                <span className="font-semibold text-[var(--status-orange-fg)]">+{fmtNum(reorderQty)} {item.unit}</span>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </DataCard>
              ))}

              {/* Adjustments */}
              {data.adjustments.length > 0 && (
                <DataCard noPadding title={`รายการปรับปรุง (${data.adjustments.length})`}>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="px-4 py-2 text-xs font-medium text-muted-foreground">วัตถุดิบ</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">จำนวน</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground">เหตุผล</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground">โดย</TableHead>
                        <TableHead className="px-3 py-2 text-xs font-medium text-muted-foreground">เวลา</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.adjustments.map((adj) => {
                        const qty = Number(adj.adjustmentQty);
                        return (
                          <TableRow key={adj.id} className="border-border">
                            <TableCell className="px-4 py-2 text-xs font-medium text-foreground">{adj.ingredient.name}</TableCell>
                            <TableCell className={cn('px-3 py-2 text-right text-xs tabular-nums font-semibold', qty >= 0 ? 'text-[var(--status-success-fg)]' : 'text-[var(--status-danger-fg)]')}>
                              {qty >= 0 ? '+' : ''}{fmtNum(qty)} {adj.ingredient.unit}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-xs text-muted-foreground">{adj.reason}</TableCell>
                            <TableCell className="px-3 py-2 text-xs text-muted-foreground">{adj.createdByUser?.name ?? '—'}</TableCell>
                            <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                              {formatThaiTime(adj.createdAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </DataCard>
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
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>ลบการนับสต็อก</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-[var(--status-danger-bg)]">
              <Trash2 className="size-5 text-[var(--status-danger-fg)]" />
            </div>
            <p className="text-xs text-muted-foreground">{fmtDate(count.countDate)}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            ยืนยันการลบ? รายการนับสต็อกและการปรับปรุงทั้งหมดของวันนี้จะถูกลบออกถาวร
          </p>
          {count.status === 'submitted' && (
            <div className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning-fg)] flex items-center gap-2">
              <AlertTriangle className="size-3.5 shrink-0" />
              การนับที่ส่งแล้วถ้าลบจะกระทบยอดยกมาของวันถัดไป
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>ยกเลิก</Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? <><Loader2 className="size-4 animate-spin" /> กำลังลบ…</> : 'ลบ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── History List Skeleton ─────────────────────────────────────────────────────

function HistorySkeleton() {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-8 w-10" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32 ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StockCountHistoryTab({
  canManageCounts,
  canReview,
  canUnreview,
}: {
  canManageCounts: boolean;
  canReview: boolean;
  canUnreview: boolean;
}) {
  const router = useRouter();
  const { prompt, dialog: promptDialog } = usePrompt();
  const [counts, setCounts] = useState<StockCountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState('');
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deletingCount, setDeletingCount] = useState<StockCountListItem | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isReviewing, startReviewTransition] = useTransition();
  const [isUnreviewing, startUnreviewTransition] = useTransition();
  const [reviewedDone, setReviewedDone] = useState(false);

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

  async function handleReview(count: StockCountListItem) {
    const result = await prompt({
      title: 'ยืนยันยอดปิดร้าน',
      description: `วันที่ ${fmtDate(count.countDate)} — เมื่อยืนยันแล้ว ยอดนี้จะเป็นยอดยกมาของการนับครั้งถัดไป`,
      confirmLabel: 'ยืนยันยอดปิดร้าน',
      fields: [
        {
          name: 'reason',
          label: 'เหตุผล / หมายเหตุการยืนยัน',
          type: 'textarea',
          required: true,
          presets: ['ตรวจสอบยอดถูกต้องครบถ้วน', 'ยืนยันยอดปิดร้านประจำวัน'],
          placeholder: 'หรือพิมพ์หมายเหตุอื่น…',
        },
      ],
    });
    if (!result) return;
    startReviewTransition(async () => {
      const r = await reviewStockCount(count.id, result.reason.trim());
      if (!r.ok) { toast.error(r.error); return; }
      setReviewedDone(true);
      await loadCounts();
    });
  }

  async function handleUnreview(count: StockCountListItem) {
    const result = await prompt({
      title: 'ยกเลิกการตรวจรับ',
      description: `วันที่ ${fmtDate(count.countDate)}`,
      confirmLabel: 'ยกเลิกการตรวจรับ',
      variant: 'danger',
      fields: [
        {
          name: 'reason',
          label: 'เหตุผลที่ยกเลิกการตรวจรับ',
          type: 'textarea',
          required: true,
          hint: 'ระบบจะบันทึกประวัติ (audit) ไว้',
        },
      ],
    });
    if (!result) return;
    startUnreviewTransition(async () => {
      const r = await unreviewStockCount(count.id, result.reason.trim());
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ยกเลิกการตรวจรับแล้ว ระบบบันทึก audit ไว้แล้ว');
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
          <Label htmlFor="history-date" className="text-xs text-muted-foreground whitespace-nowrap">วันที่</Label>
          <ThaiDateInput
            value={filterDate}
            onValueChange={setFilterDate}
            className="w-40"
            ariaLabel="วันที่"
          />
        </div>
        {filterDate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setFilterDate('')}
            className="h-8 gap-1 text-xs"
          >
            <X className="size-3" /> ล้างตัวกรอง
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} รายการ</span>
      </div>

      {/* List */}
      {loading ? (
        <HistorySkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-5" />}
          title="ยังไม่มีผลการนับสต็อก"
          description="ผลการนับสต็อกที่ส่งแล้วจะปรากฏที่นี่"
          size="lg"
        />
      ) : (
        <DataCard noPadding>
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground">วันที่</TableHead>
                <TableHead className="px-3 py-3 text-xs font-medium text-muted-foreground text-center">สถานะ</TableHead>
                <TableHead className="px-3 py-3 text-xs font-medium text-muted-foreground text-center">รายการ</TableHead>
                <TableHead className="px-3 py-3 text-xs font-medium text-muted-foreground">ผู้นับ</TableHead>
                <TableHead className="px-3 py-3 text-xs font-medium text-muted-foreground">เวลาที่ส่ง</TableHead>
                <TableHead className="px-3 py-3 text-xs font-medium text-muted-foreground text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((count) => (
                <TableRow key={count.id} className="border-border hover:bg-muted/30 transition-colors">
                  <TableCell className="px-4 py-3">
                    <span className="font-medium text-foreground">{fmtDate(count.countDate)}</span>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-center">
                    {count.status === 'reviewed' ? (
                      <StatusBadge label="ตรวจแล้ว" variant="purple" />
                    ) : count.status === 'submitted' ? (
                      <StatusBadge label="ส่งแล้ว" variant="success" />
                    ) : (
                      <StatusBadge label="แบบร่าง" variant="warning" />
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-center tabular-nums text-muted-foreground">
                    {count.items.length}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {count.countedByUser?.name ?? '—'}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {count.submittedAt
                      ? `${formatThaiDateTime(count.submittedAt)} น.`
                      : '—'}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setViewingId(count.id)}
                        aria-label="ดูรายละเอียด"
                        className="h-7 gap-1 px-2 text-xs"
                      >
                        <Eye className="size-3.5" /> ดู
                      </Button>
                      {canManageCounts && count.status !== 'reviewed' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(count)}
                          aria-label="แก้ไข"
                          className="h-7 gap-1 px-2 text-xs"
                        >
                          <PenLine className="size-3.5" /> แก้ไข
                        </Button>
                      )}
                      {canReview && count.status === 'submitted' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isReviewing}
                          onClick={() => handleReview(count)}
                          aria-label="ยืนยัน"
                          className={cn(
                            'h-7 gap-1 px-2 text-xs',
                            'border-[var(--status-purple-border)] bg-[var(--status-purple-bg)] text-[var(--status-purple-fg)] hover:bg-[var(--status-purple-bg)] hover:text-[var(--status-purple-fg)]',
                          )}
                        >
                          <BadgeCheck className="size-3.5" /> ยืนยัน
                        </Button>
                      )}
                      {canUnreview && count.status === 'reviewed' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isUnreviewing}
                          onClick={() => handleUnreview(count)}
                          aria-label="ยกเลิกการยืนยัน"
                          className="h-7 px-2 text-xs"
                        >
                          ยกเลิกยืนยัน
                        </Button>
                      )}
                      {canManageCounts && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setDeletingCount(count)}
                          aria-label="ลบ"
                          className="h-7 gap-1 px-2 text-xs border-[var(--status-danger-border)] text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
                        >
                          <Trash2 className="size-3.5" /> ลบ
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataCard>
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

      <Dialog open={reviewedDone} onOpenChange={(open) => { if (!open) setReviewedDone(false); }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--status-success-bg)] text-[var(--status-success-fg)]">
              <PackageCheck className="size-6" />
            </div>
            <DialogTitle className="text-center">ยืนยันยอดปิดร้านแล้ว</DialogTitle>
            <DialogDescription className="text-center">
              ยอดนี้จะเป็นยอดยกมาของการนับครั้งถัดไป และระบบพร้อมคำนวณคำแนะนำสั่งซื้อให้แล้ว
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={() => setReviewedDone(false)}>ปิด</Button>
            <Button onClick={() => { setReviewedDone(false); router.push('/inventory/reorder'); }}>
              ดูคำแนะนำสั่งซื้อ <ArrowRight className="size-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {promptDialog}
    </div>
  );
}
