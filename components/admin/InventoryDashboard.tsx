'use client';

import { useState, useTransition } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  Package,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { AppShell } from '@/components/ui/app-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getInventoryDashboard, type InventoryDashboardData } from '@/lib/actions/inventory';
import { getDailyVariance, type VarianceRow } from '@/lib/actions/inventory-variance';
import { checkReorderNeeded, createDraftPOFromReorder, type ReorderItem } from '@/lib/actions/reorder';
import { cn } from '@/lib/utils';
import { formatThaiDate, formatThaiLongDate } from '@/lib/date-time';

interface Props {
  initialData: InventoryDashboardData;
}

type DashTab = 'overview' | 'variance' | 'reorder';

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'ร่าง', variant: 'neutral' },
  pending_approval: { label: 'รออนุมัติ', variant: 'warning' },
  ordered: { label: 'ยืนยันแล้ว', variant: 'info' },
  partial_received: { label: 'รับบางส่วน', variant: 'orange' },
  received: { label: 'รับของแล้ว', variant: 'success' },
  cancelled: { label: 'ยกเลิก', variant: 'danger' },
  submitted: { label: 'ส่งแล้ว', variant: 'success' },
};

const TABS: { key: DashTab; label: string; description: string; Icon: typeof Package }[] = [
  { key: 'overview', label: 'ภาพรวม', description: 'สถานะสต็อกล่าสุด', Icon: Package },
  { key: 'variance', label: 'Variance', description: 'ตรวจความคลาดเคลื่อน', Icon: FlaskConical },
  { key: 'reorder', label: 'Auto-Reorder', description: 'สร้าง PO จากจุดสั่งซื้อ', Icon: RefreshCw },
];

function fmt(n: string | number) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(n: string | number) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: string) {
  return formatThaiDate(d, d);
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, variant: 'neutral' as BadgeVariant };
}

type ButtonVariantOptions = NonNullable<Parameters<typeof buttonVariants>[0]>;

function LinkButton({
  href,
  children,
  variant = 'outline',
  size = 'sm',
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariantOptions['variant'];
  size?: ButtonVariantOptions['size'];
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </Link>
  );
}

function OverviewTab({ data, isRefreshing }: { data: InventoryDashboardData; isRefreshing: boolean }) {
  const latestCountLabel = data.latestCount ? fmtDate(data.latestCount.countDate) : 'ยังไม่มีข้อมูล';
  const latestCountStatus = data.latestCount ? getStatusConfig(data.latestCount.status) : null;

  return (
    <div className="space-y-6">
      <StatCardGrid cols={4}>
        <StatCard
          loading={isRefreshing}
          label="วัตถุดิบทั้งหมด"
          value={data.totalIngredients}
          unit="รายการ"
          subLabel="รายการที่เปิดใช้งาน"
          icon={<Package className="size-4" />}
          accent="default"
        />
        <StatCard
          loading={isRefreshing}
          label="ต่ำกว่าจุดสั่งซื้อ"
          value={data.lowStockCount}
          unit="รายการ"
          subLabel={data.lowStockCount > 0 ? 'ควรตรวจรายการและเปิด PO' : 'ไม่มีรายการวิกฤต'}
          icon={<AlertTriangle className="size-4" />}
          accent={data.lowStockCount > 0 ? 'danger' : 'success'}
          valueClassName={data.lowStockCount > 0 ? 'text-[var(--status-danger-fg)]' : undefined}
        />
        <StatCard
          loading={isRefreshing}
          label="PO รอรับของ"
          value={data.pendingOrders}
          unit="รายการ"
          subLabel="สถานะยืนยันแล้ว"
          icon={<ShoppingBag className="size-4" />}
          accent={data.pendingOrders > 0 ? 'info' : 'default'}
        />
        <StatCard
          loading={isRefreshing}
          label="ยอดสั่งซื้อเดือนนี้"
          value={`฿${fmtCompact(data.monthlySpend)}`}
          subLabel="ไม่รวม PO ที่ยกเลิก"
          icon={<TrendingUp className="size-4" />}
          accent="warning"
        />
      </StatCardGrid>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <DataCard
          title="สถานะนับสต็อกล่าสุด"
          subtitle="ใช้เป็นฐานในการเตือนสต็อกต่ำ"
          className="lg:col-span-2"
          actions={
            <LinkButton href="/inventory/count" variant="outline" size="sm">
              นับสต็อก
              <ArrowRight className="size-3.5" />
            </LinkButton>
          }
        >
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    ล่าสุด
                  </p>
                  <p className="mt-2 text-[28px] font-bold leading-none text-foreground">{latestCountLabel}</p>
                </div>
                {latestCountStatus ? (
                  <StatusBadge label={latestCountStatus.label} variant={latestCountStatus.variant} dot size="md" />
                ) : (
                  <StatusBadge label="ไม่มีข้อมูล" variant="neutral" dot size="md" />
                )}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-[var(--surface-1)] p-3">
                  <p className="text-label">ผู้บันทึก</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {data.latestCount?.countedByUser.name ?? 'ยังไม่มีผู้บันทึก'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-[var(--surface-1)] p-3">
                  <p className="text-label">จำนวนรายการ</p>
                  <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                    {data.latestCount ? `${data.latestCount.items.length.toLocaleString('th-TH')} รายการ` : '0 รายการ'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <Link
                href="/inventory/ingredients"
                className="group rounded-xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <Package className="size-4 text-muted-foreground" />
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">จัดการวัตถุดิบ</p>
                <p className="mt-1 text-xs text-muted-foreground">รายการวัตถุดิบ หน่วยนับ และจุดสั่งซื้อ</p>
              </Link>
              <Link
                href="/inventory/orders"
                className="group rounded-xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <ShoppingBag className="size-4 text-muted-foreground" />
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">ใบสั่งซื้อ</p>
                <p className="mt-1 text-xs text-muted-foreground">เปิด PO และติดตามการรับของ</p>
              </Link>
            </div>
          </div>
        </DataCard>

        <DataCard title="ทางลัดสต็อก" subtitle="งานที่ใช้บ่อยในรอบวัน">
          <div className="space-y-3">
            <LinkButton href="/inventory/count" variant="default" size="lg" className="w-full justify-between">
              <span className="inline-flex items-center gap-2">
                <ClipboardList className="size-4" />
                นับสต็อกวันนี้
              </span>
              <ArrowRight className="size-4" />
            </LinkButton>
            <LinkButton href="/inventory/orders" variant="outline" size="lg" className="w-full justify-between">
              <span className="inline-flex items-center gap-2">
                <ShoppingBag className="size-4" />
                สร้างใบสั่งซื้อ
              </span>
              <ArrowRight className="size-4" />
            </LinkButton>
            <LinkButton href="/inventory/suppliers" variant="outline" size="lg" className="w-full justify-between">
              <span className="inline-flex items-center gap-2">
                <Package className="size-4" />
                ผู้ขายวัตถุดิบ
              </span>
              <ArrowRight className="size-4" />
            </LinkButton>
          </div>
        </DataCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <DataCard
          title="รายการต้องสั่งซื้อ"
          subtitle="วัตถุดิบที่ต่ำกว่าจุดสั่งซื้อจากการนับล่าสุด"
          noPadding
          actions={
            data.lowStockItems.length > 0 ? (
              <StatusBadge label={`${data.lowStockItems.length} รายการ`} variant="danger" size="md" />
            ) : (
              <StatusBadge label="ปกติ" variant="success" dot size="md" />
            )
          }
        >
          {data.lowStockItems.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-5" />}
              title="สต็อกอยู่ในเกณฑ์ปกติ"
              description="ไม่มีวัตถุดิบที่ต่ำกว่าจุดสั่งซื้อจากข้อมูลล่าสุด"
              size="sm"
            />
          ) : (
            <div className="divide-y divide-border">
              {data.lowStockItems.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]">
                    <AlertTriangle className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.ingredient.name}</p>
                    <p className="text-xs text-muted-foreground">
                      มี {Number(item.quantityOnHand).toLocaleString('th-TH')} {item.unit} / ต้องมี{' '}
                      {Number(item.ingredient.minStock).toLocaleString('th-TH')} {item.unit}
                    </p>
                  </div>
                  {item.ingredient.defaultSupplier && (
                    <span className="max-w-[120px] shrink-0 truncate text-xs text-muted-foreground">
                      {item.ingredient.defaultSupplier.name}
                    </span>
                  )}
                </div>
              ))}
              {data.lowStockItems.length > 8 && (
                <div className="px-5 py-3 text-xs text-muted-foreground">
                  อีก {data.lowStockItems.length - 8} รายการ
                </div>
              )}
            </div>
          )}
        </DataCard>

        <div className="space-y-5">
          <DataCard
            title="ประวัตินับสต็อก 7 วัน"
            subtitle="รายการนับล่าสุดตามวันที่"
            noPadding
            actions={
              <LinkButton href="/inventory/count" variant="ghost" size="sm">
                ดูทั้งหมด
                <ChevronRight className="size-3.5" />
              </LinkButton>
            }
          >
            {data.countHistory.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="size-5" />}
                title="ยังไม่มีการนับสต็อก"
                description="เริ่มจากการนับสต็อกวันนี้เพื่อสร้างฐานข้อมูลล่าสุด"
                size="sm"
              />
            ) : (
              <div className="divide-y divide-border">
                {data.countHistory.map((count) => {
                  const status = getStatusConfig(count.status);
                  return (
                    <div key={count.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{fmtDate(count.countDate)}</p>
                        <p className="text-xs text-muted-foreground">
                          {count.countedByUser.name} · {count.items.length} รายการ
                        </p>
                      </div>
                      <StatusBadge label={status.label} variant={status.variant} dot />
                    </div>
                  );
                })}
              </div>
            )}
          </DataCard>

          <DataCard
            title="ใบสั่งซื้อล่าสุด"
            subtitle="PO ล่าสุด 5 รายการ"
            noPadding
            actions={
              <LinkButton href="/inventory/orders" variant="ghost" size="sm">
                ดูทั้งหมด
                <ChevronRight className="size-3.5" />
              </LinkButton>
            }
          >
            {data.recentOrders.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="size-5" />}
                title="ยังไม่มีใบสั่งซื้อ"
                description="สร้าง PO เมื่อต้องเติมวัตถุดิบเข้าสต็อก"
                size="sm"
              />
            ) : (
              <div className="divide-y divide-border">
                {data.recentOrders.map((po) => {
                  const status = getStatusConfig(po.status);
                  return (
                    <div key={po.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm font-medium text-foreground">{po.poNumber}</p>
                        <p className="truncate text-xs text-muted-foreground">{po.supplier.name}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium tabular-nums text-foreground">฿{fmt(po.total)}</p>
                        <StatusBadge label={status.label} variant={status.variant} dot />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DataCard>
        </div>
      </div>
    </div>
  );
}

function VarianceTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<VarianceRow[] | null>(null);

  async function handleQuery() {
    setLoading(true);
    const r = await getDailyVariance(date);
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setRows(r.data);
  }

  const flaggedCount = rows?.filter((r) => r.investigationNeeded).length ?? 0;

  return (
    <div className="space-y-5">
      <DataCard
        title="คำนวณ Variance รายวัน"
        subtitle="Variance = จริง - ทฤษฎี · บวก = ใช้เกิน · ลบ = ใช้น้อยกว่าคาด"
        actions={
          rows !== null ? (
            <StatusBadge
              label={flaggedCount > 0 ? `${flaggedCount} รายการต้องตรวจสอบ` : 'ปกติ'}
              variant={flaggedCount > 0 ? 'warning' : 'success'}
              dot
              size="md"
            />
          ) : null
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label htmlFor="variance-date" className="text-label">
              วันที่
            </label>
            <ThaiDateInput
              value={date}
              max={today}
              onValueChange={setDate}
              className="mt-1.5"
              ariaLabel="วันที่"
            />
          </div>
          <Button type="button" onClick={handleQuery} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            {loading ? 'กำลังคำนวณ...' : 'คำนวณ Variance'}
          </Button>
        </div>
      </DataCard>

      {loading && (
        <DataCard>
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </DataCard>
      )}

      {!loading && rows !== null && (
        rows.length === 0 ? (
          <DataCard>
            <EmptyState
              icon={<FlaskConical className="size-5" />}
              title="ไม่พบข้อมูลสำหรับคำนวณ"
              description="ยังไม่มีการนับสต็อกที่ส่งแล้วในวันนี้ หรือยังไม่มีสูตรอาหารที่กำหนดไว้"
              size="sm"
            />
          </DataCard>
        ) : (
          <DataCard
            title={`Variance รายวัน · ${fmtDate(date)}`}
            subtitle="รายการที่เกิน 10% จะแสดงสถานะตรวจสอบ"
            noPadding
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
                  <TableHead className="px-5 text-xs text-muted-foreground">วัตถุดิบ</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">ทฤษฎี</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">จริง</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">Variance</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">%</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">มูลค่า</TableHead>
                  <TableHead className="px-5 text-right text-xs text-muted-foreground">สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.ingredientId}
                    className={cn(row.investigationNeeded && 'bg-[var(--status-warning-bg)]/40')}
                  >
                    <TableCell className="px-5 font-medium text-foreground">{row.ingredientName}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.theoreticalUsage} {row.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.actualUsage} {row.unit}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        row.variance > 0
                          ? 'text-[var(--status-danger-fg)]'
                          : row.variance < 0
                            ? 'text-[var(--status-success-fg)]'
                            : 'text-muted-foreground',
                      )}
                    >
                      {row.variance > 0 ? '+' : ''}
                      {row.variance} {row.unit}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        Math.abs(row.variancePct) > 10
                          ? 'text-[var(--status-warning-fg)]'
                          : 'text-muted-foreground',
                      )}
                    >
                      {row.variancePct > 0 ? '+' : ''}
                      {row.variancePct}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">฿{fmt(row.varianceCost)}</TableCell>
                    <TableCell className="px-5 text-right">
                      <StatusBadge
                        label={row.investigationNeeded ? 'ตรวจสอบ' : 'ปกติ'}
                        variant={row.investigationNeeded ? 'warning' : 'success'}
                        dot
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataCard>
        )
      )}
    </div>
  );
}

function ReorderTab() {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ReorderItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function handleCheck() {
    setLoading(true);
    const r = await checkReorderNeeded();
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setItems(r.data);
    setSelected(new Set(r.data.map((i) => i.ingredientId)));
  }

  function toggleAll() {
    if (!items) return;
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.ingredientId)));
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreatePO() {
    if (!selected.size) {
      toast.error('กรุณาเลือกรายการ');
      return;
    }
    startTransition(async () => {
      const r = await createDraftPOFromReorder([...selected]);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`สร้าง ${r.data.count} ใบสั่งซื้อแล้ว`);
      setItems(null);
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-5">
      <DataCard
        title="Auto-Reorder"
        subtitle="ตรวจรายการที่สต็อกต่ำกว่า Par Level แล้วสร้าง PO แยกตามผู้ขาย"
        actions={
          items ? (
            <StatusBadge
              label={`${selected.size}/${items.length} รายการที่เลือก`}
              variant={selected.size > 0 ? 'info' : 'neutral'}
              dot
              size="md"
            />
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleCheck} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            {loading ? 'กำลังตรวจสอบ...' : 'ตรวจสอบรายการ Auto-Reorder'}
          </Button>
          <p className="text-xs text-muted-foreground">
            ระบบจะแสดงเฉพาะรายการที่ควรเติมสต็อกจากข้อมูลปัจจุบัน
          </p>
        </div>
      </DataCard>

      {loading && (
        <DataCard>
          <div className="space-y-3">
            <Skeleton className="h-4 w-52" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </DataCard>
      )}

      {!loading && items !== null && (
        items.length === 0 ? (
          <DataCard>
            <EmptyState
              icon={<CheckCircle2 className="size-5" />}
              title="สต็อกทุกอย่างยังสูงกว่า Par Level"
              description="ยังไม่มีรายการที่ต้องสร้าง PO อัตโนมัติในตอนนี้"
              size="sm"
            />
          </DataCard>
        ) : (
          <DataCard
            title={`รายการต่ำกว่า Par Level (${items.length} รายการ)`}
            subtitle="รายการที่ไม่มี Supplier จะไม่ถูกรวมในการสร้าง PO"
            noPadding
            actions={
              <Button type="button" onClick={handleCreatePO} disabled={isPending || !selected.size} size="sm">
                <ShoppingBag className="size-3.5" />
                สร้าง PO ({selected.size})
              </Button>
            }
            footer={
              <p className="text-xs text-muted-foreground">
                PO จะถูกจัดกลุ่มตาม Supplier ที่กำหนดไว้ในวัตถุดิบ
              </p>
            }
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
                  <TableHead className="w-10 px-5">
                    <input
                      type="checkbox"
                      checked={selected.size === items.length}
                      onChange={toggleAll}
                      className="rounded border-border"
                      aria-label="เลือกทั้งหมด"
                    />
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground">วัตถุดิบ</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">สต็อกปัจจุบัน</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">Par Level</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">ต้องสั่ง</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">ราคาต่อหน่วย</TableHead>
                  <TableHead className="px-5 text-xs text-muted-foreground">Supplier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const isSelected = selected.has(item.ingredientId);
                  return (
                    <TableRow key={item.ingredientId} className={cn(!isSelected && 'opacity-55')}>
                      <TableCell className="px-5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item.ingredientId)}
                          className="rounded border-border"
                          aria-label={item.ingredientName}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{item.ingredientName}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-[var(--status-danger-fg)]">
                        {item.currentStock.toFixed(2)} {item.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {item.parLevel.toFixed(2)} {item.unit}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-foreground">
                        {item.reorderQty.toFixed(2)} {item.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">฿{fmt(item.lastCost)}</TableCell>
                      <TableCell className="px-5 text-xs">
                        {item.supplierName ? (
                          <span className="text-muted-foreground">{item.supplierName}</span>
                        ) : (
                          <StatusBadge label="ไม่มี Supplier" variant="warning" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataCard>
        )
      )}
    </div>
  );
}

export function InventoryDashboard({ initialData }: Props) {
  const [tab, setTab] = useState<DashTab>('overview');

  const { data = initialData, isFetching } = useQuery({
    queryKey: ['inventory-dashboard'],
    queryFn: async () => {
      const r = await getInventoryDashboard();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return (
    <AppShell>
      <PageHeader
        title="ภาพรวมสต็อก"
        subtitle={formatThaiLongDate(new Date())}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isFetching && (
              <StatusBadge label="กำลังอัปเดต" variant="info" dot size="md" />
            )}
            <div className="flex gap-px rounded-lg bg-muted p-1">
              {TABS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-150',
                    tab === key
                      ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap gap-2">
          {TABS.map(({ key, description }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                tab === key
                  ? 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]'
                  : 'border-border bg-[var(--surface-1)] text-muted-foreground hover:text-foreground',
              )}
            >
              {description}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === 'overview' && <OverviewTab data={data} isRefreshing={isFetching} />}
      {tab === 'variance' && <VarianceTab />}
      {tab === 'reorder' && <ReorderTab />}
    </AppShell>
  );
}


