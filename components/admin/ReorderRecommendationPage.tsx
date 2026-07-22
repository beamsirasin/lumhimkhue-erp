'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, ChevronDown, ClipboardList, Info, PackagePlus, PackageCheck, RefreshCw, ShoppingBag, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  generateReorderDraft,
  type ReorderRecommendationPageData,
  type StockCountReorderItem,
} from '@/lib/actions/inventory';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatThaiDate } from '@/lib/date-time';
import type { InventoryUiPermissions } from '@/lib/auth/inventory-access';

interface Props {
  initialData: ReorderRecommendationPageData;
  permissions: InventoryUiPermissions;
}

type LineState = {
  selected: boolean;
  purchaseQty: number;
  supplierId: string;
};

function fmt(n: number, digits = 2) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function ReorderRecommendationPage({ initialData, permissions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ created: number; duplicated: number; supplierCount: number } | null>(null);
  const [detailsFor, setDetailsFor] = useState<Set<string>>(() => new Set());

  const [state, setState] = useState<Record<string, LineState>>(() => {
    const initial: Record<string, LineState> = {};
    for (const item of initialData.items) {
      initial[item.ingredientId] = {
        selected: item.canRecommend,
        purchaseQty: item.recommendedPurchaseQty,
        supplierId: item.defaultSupplierId ?? '',
      };
    }
    return initial;
  });

  const items = initialData.items;
  const canManage = permissions.canManagePurchaseOrders;

  const selectedItems = useMemo(
    () => items.filter((item) => state[item.ingredientId]?.selected),
    [items, state],
  );

  const suppliersInSelection = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selectedItems) {
      const supplierId = state[item.ingredientId]?.supplierId;
      if (supplierId) ids.add(supplierId);
    }
    return ids.size;
  }, [selectedItems, state]);

  function patch(ingredientId: string, next: Partial<LineState>) {
    setState((current) => ({ ...current, [ingredientId]: { ...current[ingredientId], ...next } }));
  }

  function toggleAll(selected: boolean) {
    setState((current) => {
      const next = { ...current };
      for (const item of items) {
        if (item.canRecommend) next[item.ingredientId] = { ...next[item.ingredientId], selected };
      }
      return next;
    });
  }

  function handleGenerate() {
    const lines = selectedItems.map((item) => ({
      ingredientId: item.ingredientId,
      supplierId: state[item.ingredientId]?.supplierId || null,
      purchaseQuantity: state[item.ingredientId]?.purchaseQty ?? 0,
    }));
    if (lines.length === 0) { toast.error('กรุณาเลือกอย่างน้อย 1 รายการ'); return; }
    const missingSupplier = selectedItems.filter((item) => !state[item.ingredientId]?.supplierId);
    if (missingSupplier.length > 0) {
      toast.error(`มี ${missingSupplier.length} รายการที่ยังไม่ได้เลือก Supplier`);
      return;
    }
    const blockedConversion = selectedItems.filter((item) => !item.canRecommend);
    if (blockedConversion.length > 0) {
      toast.error('มีรายการที่ยังไม่ได้ตั้งค่าหน่วยสั่งซื้อ');
      return;
    }
    startTransition(async () => {
      const response = await generateReorderDraft({ idempotencyKey, lines });
      if (!response.ok) { toast.error(response.error); return; }
      setIdempotencyKey(crypto.randomUUID());
      setResult(response.data);
    });
  }

  if (!initialData.countDate) {
    return (
      <AppShell>
        <PageHeader title="คำแนะนำสั่งซื้อ" subtitle="สร้างใบสั่งซื้อร่างจากผลนับที่ตรวจรับแล้ว" />
        <DataCard>
          <EmptyState
            icon={<ClipboardList className="size-6" />}
            title="ยังไม่มีผลนับที่ตรวจรับแล้ว"
            description="ระบบจะคำนวณคำแนะนำสั่งซื้อจากยอดคงเหลือของผลนับสต็อกที่ตรวจรับ (Reviewed) ล่าสุด กรุณานับสต็อกและตรวจรับก่อน"
            action={<Button onClick={() => router.push('/inventory/count')}>ไปหน้านับสต็อก</Button>}
          />
        </DataCard>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="แนะนำให้ซื้อ"
        subtitle={`อ้างอิงผลนับที่ยืนยันล่าสุด ${formatThaiDate(initialData.countDate)} · ${items.length.toLocaleString('th-TH')} รายการที่ต่ำกว่าเป้า`}
        actions={
          <Button variant="outline" onClick={() => router.refresh()}>
            <RefreshCw className="size-4" /> รีเฟรช
          </Button>
        }
      />

      <div className="flex items-start gap-2.5 rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-3 text-sm text-[var(--status-info-fg)]">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>ระบบคำนวณจากยอดนับล่าสุด เป้าหมายสต็อก (Par) และของที่สั่งแล้วซึ่งจะมาตรงเวลา — เป็นเพียงคำแนะนำ ตรวจและแก้จำนวนก่อนสร้างใบสั่งซื้อได้เสมอ</span>
      </div>

      {items.length === 0 ? (
        <DataCard>
          <EmptyState
            icon={<ShoppingBag className="size-6" />}
            title="สต็อกอยู่ในระดับปกติ"
            description="ไม่มีวัตถุดิบที่ต่ำกว่าระดับที่ควรมี (Par) หลังหักของที่กำลังจะเข้าตรงเวลา"
          />
        </DataCard>
      ) : (
        <>
          <DataCard
            title="รายการแนะนำให้สั่งซื้อ"
            subtitle="ระบบเสนอจำนวน — ตรวจและแก้ก่อนสร้างใบสั่งซื้อร่าง ราคาประมาณไม่ใช่ราคาจริง"
            actions={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>เลือกทั้งหมด</Button>
                <Button size="sm" variant="outline" onClick={() => toggleAll(false)}>ล้างการเลือก</Button>
              </div>
            }
            noPadding
          >
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <ReorderRow
                  key={item.ingredientId}
                  item={item}
                  state={state[item.ingredientId]}
                  suppliers={initialData.suppliers}
                  disabled={!canManage}
                  showDetails={detailsFor.has(item.ingredientId)}
                  onToggleDetails={() => setDetailsFor((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.ingredientId)) next.delete(item.ingredientId); else next.add(item.ingredientId);
                    return next;
                  })}
                  onPatch={(next) => patch(item.ingredientId, next)}
                />
              ))}
            </ul>
          </DataCard>

          {canManage && (
            <div className="sticky bottom-0 z-20 -mx-6 border-t border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  เลือก <strong className="text-foreground">{selectedItems.length}</strong> รายการ
                  {suppliersInSelection > 0 && (
                    <> · จะแยกเป็น <strong className="text-foreground">{suppliersInSelection}</strong> ใบตาม Supplier</>
                  )}
                </p>
                <Button
                  disabled={isPending || selectedItems.length === 0}
                  onClick={handleGenerate}
                >
                  <PackagePlus className="size-4" />
                  {isPending ? 'กำลังสร้าง…' : 'สร้างใบสั่งซื้อฉบับร่าง'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={result !== null} onOpenChange={(open) => { if (!open) { setResult(null); router.refresh(); } }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--status-success-bg)] text-[var(--status-success-fg)]">
              <PackageCheck className="size-6" />
            </div>
            <DialogTitle className="text-center">
              {result && result.created > 0 ? 'สร้างใบสั่งซื้อฉบับร่างแล้ว' : 'ใบสั่งซื้อร่างนี้มีอยู่แล้ว'}
            </DialogTitle>
            <DialogDescription className="text-center">
              {result && result.created > 0 ? (
                <>สร้าง {result.created} ใบ แยกตาม Supplier {result.supplierCount} ราย
                {result.duplicated > 0 && <> · มี {result.duplicated} ใบที่สร้างไว้ก่อนแล้ว</>}
                <br />ยังเป็น “ฉบับร่าง” — ตรวจและแก้จำนวนก่อนส่งให้ผู้ขาย</>
              ) : (
                'ระบบไม่สร้างซ้ำ กดตรวจใบสั่งซื้อเพื่อดูฉบับร่างที่มีอยู่'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={() => { setResult(null); router.push('/inventory'); }}>
              กลับหน้าภาพรวม
            </Button>
            <Button onClick={() => { setResult(null); router.push('/inventory/orders'); }}>
              ตรวจใบสั่งซื้อ <ArrowRight className="size-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ReorderRow({
  item,
  state,
  suppliers,
  disabled,
  showDetails,
  onToggleDetails,
  onPatch,
}: {
  item: StockCountReorderItem;
  state: LineState | undefined;
  suppliers: ReorderRecommendationPageData['suppliers'];
  disabled: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
  onPatch: (next: Partial<LineState>) => void;
}) {
  const selected = state?.selected ?? false;
  const purchaseQty = state?.purchaseQty ?? 0;
  const supplierId = state?.supplierId ?? '';
  const normalized = item.conversion ? purchaseQty * item.conversion : 0;
  const projected = item.quantityOnHand + item.inTransitQty + normalized;

  return (
    <li className={cn('p-4 transition-colors', selected && 'bg-[var(--surface-primary-subtle)]')}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled || !item.canRecommend}
          onChange={(event) => onPatch({ selected: event.target.checked })}
          aria-label={`เลือก ${item.ingredientName}`}
          className="mt-1 size-5 shrink-0 rounded border-border"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{item.ingredientName}</p>
            {!item.canRecommend && (
              <StatusBadge label="ต้องตั้งค่าหน่วยสั่งซื้อก่อน" variant="warning" />
            )}
            {item.hasDelayedOrder && (
              <StatusBadge label={`PO ล่าช้า ${fmt(item.delayedIncomingQty)} ${item.unit}`} variant="danger" />
            )}
          </div>

          {/* Essential figures — always visible */}
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <Figure label="ของเหลือล่าสุด" value={`${fmt(item.quantityOnHand)} ${item.unit}`} />
            <Figure label="เป้าหมายที่ควรมี" value={`${fmt(item.parLevel)} ${item.unit}`} />
            <Figure label="ขาดอยู่" value={`${fmt(item.reorderQty)} ${item.unit}`} highlight />
            <Figure
              label="ระบบแนะนำ"
              value={item.canRecommend ? `${fmt(item.recommendedPurchaseQty, 0)} ${item.purchaseUnit ?? item.unit}` : '—'}
            />
          </div>

          <button
            type="button"
            onClick={onToggleDetails}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', showDetails && 'rotate-180')} />
            {showDetails ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
          </button>
          {showDetails && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-muted/40 p-2.5 text-xs sm:grid-cols-3">
              <Figure label="ขั้นต่ำ (Minimum)" value={`${fmt(item.minStock)} ${item.unit}`} />
              <Figure label="กำลังมา (ตรงเวลา)" value={`${fmt(item.inTransitQty)} ${item.unit}`} />
              <Figure label="กำลังมา (ล่าช้า)" value={item.delayedIncomingQty > 0 ? `${fmt(item.delayedIncomingQty)} ${item.unit}` : '—'} />
              <Figure
                label="หน่วยสั่งซื้อ"
                value={item.conversion ? `1 ${item.purchaseUnit ?? item.unit} = ${fmt(item.conversion)} ${item.unit}` : 'ยังไม่ตั้งค่า'}
              />
              <Figure
                label="เมื่อรับครบจะมี"
                value={item.canRecommend ? `${fmt(item.projectedStock)} ${item.unit}` : '—'}
              />
            </div>
          )}

          {/* Editable controls */}
          {item.canRecommend ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr] sm:items-end">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  จำนวนสั่ง ({item.purchaseUnit ?? item.unit})
                </label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={Number.isFinite(purchaseQty) ? purchaseQty : ''}
                  disabled={disabled}
                  onChange={(event) => onPatch({ purchaseQty: parseFloat(event.target.value) || 0 })}
                  className="h-10 text-right tabular-nums"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  = {fmt(normalized)} {item.unit} · รวมเป็น {fmt(projected)} {item.unit}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Supplier</label>
                <Select
                  value={supplierId || 'none'}
                  onValueChange={(v) => onPatch({ supplierId: v === 'none' || v == null ? '' : v })}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue>
                      {(v) => (!v || v === 'none'
                        ? 'เลือก Supplier'
                        : (suppliers.find((s) => s.id === v)?.name ?? 'เลือก Supplier'))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— เลือก Supplier —</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning-fg)]">
              <TriangleAlert className="size-4 shrink-0" />
              ตั้งค่าหน่วยสั่งซื้อและ conversion ของวัตถุดิบนี้ก่อน จึงจะแนะนำจำนวนสั่งซื้อได้
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Figure({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums', highlight ? 'font-semibold text-[var(--status-warning-fg)]' : 'text-foreground')}>
        {value}
      </p>
    </div>
  );
}
