'use client';

import { useState, useMemo, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  ShoppingBag,
  Printer,
  Loader2,
  PackageCheck,
  ClipboardList,
  X,
  Copy,
  PackagePlus,
  MoreHorizontal,
  Search,
  FileText,
  Send,
  Ban,
  Pencil,
  Eye,
  Siren,
} from 'lucide-react';
import type { Resolver } from 'react-hook-form';
import { cn } from '@/lib/utils';
import {
  getPurchaseOrderListData,
  createPurchaseOrder,
  updatePurchaseOrder,
  submitForApproval,
  approveOrder,
  receiveOrder,
  confirmReceiptPrice,
  voidGoodsReceipt,
  cancelOrder,
  getPurchaseOrderDetail,
  getStockCountReorderItems,
  type POListData,
  type PODetail,
  type StockCountReorderItem,
} from '@/lib/actions/inventory';
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  receivePurchaseOrderSchema,
  type CreatePurchaseOrderInput,
  type UpdatePurchaseOrderInput,
  type ReceivePurchaseOrderInput,
} from '@/lib/validations/inventory';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { EmptyState } from '@/components/ui/empty-state';
import { DataCard } from '@/components/ui/section-card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { formatThaiDate } from '@/lib/date-time';
import { EmergencyPurchaseDialog } from '@/components/admin/EmergencyPurchaseDialog';

// ── Helpers ───────────────────────────────────────────────────────────────────

const INPUT = 'w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';

const STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง',
  pending_approval: 'รออนุมัติ',
  ordered: 'ยืนยันแล้ว',
  partial_received: 'รับบางส่วน',
  received: 'รับของแล้ว',
  cancelled: 'ยกเลิก',
  delayed: 'ล่าช้า',
  pending_price: 'รอราคา',
  emergency: 'ซื้อฉุกเฉิน',
};


const DISCREPANCY_LABEL: Record<string, string> = {
  none: 'ปกติ',
  short: 'ขาด',
  wrong: 'ผิดรายการ',
  spoiled: 'เสียหาย',
};

const STATUS_FILTERS = ['all', 'draft', 'pending_approval', 'ordered', 'delayed', 'partial_received', 'pending_price', 'emergency', 'received', 'cancelled'] as const;

type StatusFilter = typeof STATUS_FILTERS[number];
type POListItem = POListData['orders'][number];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'neutral',
  pending_approval: 'warning',
  ordered: 'info',
  partial_received: 'orange',
  received: 'success',
  cancelled: 'danger',
};

function fmt(n: string | number | null | undefined) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  return formatThaiDate(d, d);
}

type Modal =
  | { type: 'new' }
  | { type: 'edit'; id: string }
  | { type: 'receive'; id: string }
  | { type: 'detail'; id: string };

interface Props {
  initialData: POListData;
  initialSupplierFilter?: string;
  userRole?: string;
}

// ── Main list ─────────────────────────────────────────────────────────────────

export function PurchaseOrdersPage({ initialData, initialSupplierFilter, userRole }: Props) {
  const [modal, setModal] = useState<Modal | null>(null);
  const [showEmergency, setShowEmergency] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [supplierFilter, setSupplierFilter] = useState(initialSupplierFilter ?? '');
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const qc = useQueryClient();

  const { data = initialData, isFetching } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const r = await getPurchaseOrderListData();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['purchase-orders'] });

  const isOwner = userRole === 'owner';

  const statusCounts = useMemo(() => {
    return data.orders.reduce<Record<string, number>>(
      (acc, po) => {
        acc[po.status] = (acc[po.status] ?? 0) + 1;
        if (po.isDelayed) acc.delayed = (acc.delayed ?? 0) + 1;
        if (po.hasPendingPrices) acc.pending_price = (acc.pending_price ?? 0) + 1;
        if (po.purchaseType === 'emergency_direct') acc.emergency = (acc.emergency ?? 0) + 1;
        return acc;
      },
      { all: data.orders.length },
    );
  }, [data.orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.orders.filter((po) => {
      const matchesStatus = statusFilter === 'all' || po.status === statusFilter
        || (statusFilter === 'delayed' && po.isDelayed)
        || (statusFilter === 'pending_price' && po.hasPendingPrices)
        || (statusFilter === 'emergency' && po.purchaseType === 'emergency_direct');
      const matchesSupplier = !supplierFilter || po.supplierId === supplierFilter;
      const matchesSearch = !q || po.poNumber.toLowerCase().includes(q) || po.displaySupplierName.toLowerCase().includes(q);
      return matchesStatus && matchesSupplier && matchesSearch;
    });
  }, [data.orders, statusFilter, supplierFilter, search]);

  const hasFilters = search.trim() !== '' || statusFilter !== 'all' || supplierFilter !== '';
  const pendingApprovalCount = statusCounts.pending_approval ?? 0;
  const awaitingReceiptCount = (statusCounts.ordered ?? 0) + (statusCounts.partial_received ?? 0);
  const totalValue = data.orders
    .filter((po) => po.status !== 'cancelled')
    .reduce((sum, po) => sum + Number(po.confirmedTotal ?? 0), 0);

  function resetFilters() {
    setSearch('');
    setStatusFilter('all');
    setSupplierFilter('');
  }

  function handleSubmitForApproval(id: string) {
    startTransition(async () => {
      const r = await submitForApproval(id);
      if (!r.ok) toast.error(r.error);
      else { toast.success('ส่งขออนุมัติแล้ว'); invalidate(); }
    });
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      const r = await approveOrder(id);
      if (!r.ok) toast.error(r.error);
      else { toast.success('อนุมัติใบสั่งซื้อแล้ว'); invalidate(); }
    });
  }

  function handleCancel(id: string) {
    const reason = window.prompt('ระบุเหตุผลยกเลิกใบสั่งซื้อ/ยอดค้างรับ');
    if (!reason?.trim()) return;
    startTransition(async () => {
      const r = await cancelOrder({ id, reason: reason.trim() });
      if (!r.ok) toast.error(r.error);
      else { toast.success('ยกเลิกแล้ว'); invalidate(); }
    });
  }
  const columns = [
    {
      key: 'poNumber',
      header: 'เลข PO',
      render: (po: POListItem) => (
        <button
          type="button"
          onClick={() => setModal({ type: 'detail', id: po.id })}
          className="font-mono text-sm font-medium text-foreground underline-offset-2 hover:underline"
        >
          {po.poNumber}
        </button>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (po: POListItem) => (
        <div className="min-w-[180px]">
          <p className="font-medium text-foreground">{po.supplier?.name ?? po.vendorName ?? 'ไม่ระบุผู้ขาย'}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {po.items.length.toLocaleString('th-TH')} รายการ
          </p>
        </div>
      ),
    },
    {
      key: 'orderDate',
      header: 'วันที่สั่ง',
      render: (po: POListItem) => <span className="text-[12px] text-muted-foreground">{fmtDate(po.orderDate)}</span>,
    },
    {
      key: 'status',
      header: 'สถานะ',
      align: 'center' as const,
      render: (po: POListItem) => (
        <div className="space-y-1"><StatusBadge label={STATUS_LABEL[po.status] ?? po.status} variant={STATUS_VARIANT[po.status] ?? 'neutral'} dot />{po.isDelayed && <p className="text-[10px] text-[var(--status-danger-fg)]">ล่าช้า {po.delayedDays} วัน</p>}</div>
      ),
    },
    {
      key: 'total',
      header: 'ยอดรวม',
      align: 'right' as const,
      render: (po: POListItem) => po.priceStatus === 'pending' && Number(po.total) === 0 ? (
        <span className="text-[var(--status-warning-fg)]">รอราคา</span>
      ) : (
        <div><span className="tabular-nums font-medium text-foreground">{po.priceStatus === 'confirmed' ? '฿' : '≈ ฿'}{fmt(po.total)}</span>{po.hasPendingPrices && <p className="text-[10px] text-[var(--status-warning-fg)]">ยอดบางส่วน</p>}</div>
      ),
    },
    {
      key: 'taxInvoice',
      header: 'ใบกำกับ',
      align: 'center' as const,
      render: (po: POListItem) => (
        <StatusBadge
          label={po.hasTaxInvoice ? 'มี' : 'ไม่มี'}
          variant={po.hasTaxInvoice ? 'success' : 'neutral'}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      render: (po: POListItem) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`ตัวเลือก ${po.poNumber}`}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setModal({ type: 'detail', id: po.id })}>
              <Eye className="size-4" />
              ดูรายละเอียด
            </DropdownMenuItem>

            {po.status === 'draft' && (
              <>
                <DropdownMenuItem onClick={() => setModal({ type: 'edit', id: po.id })}>
                  <Pencil className="size-4" />
                  แก้ไข
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isPending} onClick={() => handleSubmitForApproval(po.id)}>
                  <Send className="size-4" />
                  ส่งอนุมัติ
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isPending} variant="destructive" onClick={() => handleCancel(po.id)}>
                  <Ban className="size-4" />
                  ยกเลิก
                </DropdownMenuItem>
              </>
            )}

            {po.status === 'pending_approval' && (
              <>
                {isOwner && (
                  <DropdownMenuItem disabled={isPending} onClick={() => handleApprove(po.id)}>
                    <PackageCheck className="size-4" />
                    อนุมัติ
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isPending} variant="destructive" onClick={() => handleCancel(po.id)}>
                  <Ban className="size-4" />
                  ยกเลิก
                </DropdownMenuItem>
              </>
            )}

            {po.status === 'ordered' && (
              <>
                <DropdownMenuItem onClick={() => setModal({ type: 'receive', id: po.id })}>
                  <PackageCheck className="size-4" />
                  รับของ
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isPending} variant="destructive" onClick={() => handleCancel(po.id)}>
                  <Ban className="size-4" />
                  ยกเลิก
                </DropdownMenuItem>
              </>
            )}

            {po.status === 'partial_received' && (
              <DropdownMenuItem onClick={() => setModal({ type: 'receive', id: po.id })}>
                <PackagePlus className="size-4" />
                รับของเพิ่ม
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="ใบสั่งซื้อ (PO)"
        subtitle={`${data.orders.length.toLocaleString('th-TH')} รายการทั้งหมด · ยอดจริงยืนยันแล้ว ฿${fmt(totalValue)}`}
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setShowEmergency(true)}>
              <Siren className="size-4" />
              ซื้อฉุกเฉิน
            </Button>
            <Button type="button" onClick={() => setModal({ type: 'new' })}>
              <Plus className="size-4" />
              สร้างใบสั่งซื้อ
            </Button>
          </div>
        }      />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">PO ทั้งหมด</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{data.orders.length.toLocaleString('th-TH')}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--surface-2)] text-muted-foreground">
              <FileText className="size-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">รออนุมัติ</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{pendingApprovalCount.toLocaleString('th-TH')}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ring-1 ring-[var(--status-warning-border)]">
              <Send className="size-5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">รอรับของ</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{awaitingReceiptCount.toLocaleString('th-TH')}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--status-info-bg)] text-[var(--status-info-fg)] ring-1 ring-[var(--status-info-border)]">
              <PackageCheck className="size-5" />
            </div>
          </div>
        </div>
      </div>

      <DataCard title="ค้นหาและตัวกรอง" subtitle="ค้นหาจากเลข PO หรือ Supplier และกรองตามสถานะ/ผู้ขาย">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="ค้นหาเลข PO หรือ Supplier..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-px rounded-lg bg-muted p-1">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150',
                    statusFilter === status
                      ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {status === 'all' ? `ทั้งหมด ${statusCounts.all}` : `${STATUS_LABEL[status]} ${statusCounts[status] ?? 0}`}
                </button>
              ))}
            </div>
            <select
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">ทุก Supplier</option>
              {data.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
            {hasFilters && (
              <Button type="button" variant="outline" onClick={resetFilters}>
                ล้างตัวกรอง
              </Button>
            )}
          </div>
        </div>
      </DataCard>

      <DataCard
        title="รายการใบสั่งซื้อ"
        subtitle={`${filtered.length.toLocaleString('th-TH')} รายการที่แสดง`}
        noPadding
      >
        <DataTable
          columns={columns}
          rows={filtered}
          keyFn={(po) => po.id}
          loading={isFetching && data.orders.length === 0}
          emptyState={
            <EmptyState
              icon={<ShoppingBag className="size-6" />}
              title={hasFilters ? 'ไม่พบใบสั่งซื้อที่ตรงกับตัวกรอง' : 'ยังไม่มีใบสั่งซื้อ'}
              description={hasFilters ? 'ลองล้างตัวกรองหรือค้นหาด้วยคำอื่น' : 'เริ่มสร้างใบสั่งซื้อแรกเพื่อส่งต่อไปยังขั้นตอนอนุมัติและรับของ'}
              action={hasFilters ? <Button type="button" variant="outline" onClick={resetFilters}>ล้างตัวกรอง</Button> : undefined}
            />
          }
          className="rounded-none border-0"
        />
      </DataCard>

      <Sheet open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
        {modal && (
          <SheetContent
            showCloseButton={false}
            className={cn(
              'w-full p-0 sm:max-w-[760px]',
              modal.type === 'receive' && 'sm:max-w-[680px]',
              modal.type === 'detail' && 'sm:max-w-[680px]',
            )}
          >
            {modal.type === 'new' && (
              <POForm
                suppliers={data.suppliers}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {modal.type === 'edit' && (
              <POFormEdit
                id={modal.id}
                suppliers={data.suppliers}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {modal.type === 'receive' && (
              <ReceiveForm
                id={modal.id}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {modal.type === 'detail' && (
              <PODetailModal
                id={modal.id}
                onClose={() => setModal(null)}
                onReceive={(id) => setModal({ type: 'receive', id })}
              />
            )}
          </SheetContent>
        )}
      </Sheet>
      <EmergencyPurchaseDialog
        open={showEmergency}
        onOpenChange={setShowEmergency}
        suppliers={data.suppliers}
        orders={data.orders}
        onSaved={invalidate}
      />
    </AppShell>
  );
}

// ── PO Form (new) ─────────────────────────────────────────────────────────────

interface POFormProps {
  suppliers: POListData['suppliers'];
  initialValues?: Partial<CreatePurchaseOrderInput>;
  onClose: () => void;
  onSaved: () => void;
}

function POForm({ suppliers, initialValues, onClose, onSaved }: POFormProps) {
  return (
    <POFormInner
      schema="create"
      suppliers={suppliers}
      initialValues={initialValues}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

interface POFormInnerProps {
  schema: 'create' | 'edit';
  suppliers: POListData['suppliers'];
  initialValues?: Partial<CreatePurchaseOrderInput & { id: string }>;
  onClose: () => void;
  onSaved: () => void;
}

type POFormIngredient = {
  id: string;
  name: string;
  unit: string;
  lastCost: string;
  orderUnit: string | null;
  orderUnitConversion: string;
};

function POFormInner({ schema: schemaType, suppliers, initialValues, onClose, onSaved }: POFormInnerProps) {
  type FormValues = CreatePurchaseOrderInput | UpdatePurchaseOrderInput;
  const zodSchema = schemaType === 'edit' ? updatePurchaseOrderSchema : createPurchaseOrderSchema;

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

  const {
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(zodSchema) as Resolver<FormValues>,
    defaultValues: initialValues
      ? { ...initialValues }
      : {
          orderDate: today,
          vatRate: 7,
          hasTaxInvoice: false,
          items: [{ ingredientId: '', quantity: 1, unit: '', purchaseQuantity: 1, purchaseUnit: '', conversionFactor: 1, priceStatus: 'estimated', unitCost: 0 }],
        },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' as never });

  const watchedItems = watch('items') as Array<{ ingredientId: string; quantity: number; unit: string; purchaseQuantity?: number; purchaseUnit?: string | null; conversionFactor: number; priceStatus: 'pending' | 'estimated' | 'confirmed'; unitCost: number | null }>;
  const watchedVatRate = watch('vatRate') as number;

  const [ingredients, setIngredients] = useState<POFormIngredient[]>([]);
  useState(() => {
    import('@/lib/actions/inventory').then(({ getPurchaseOrderFormData }) => {
      getPurchaseOrderFormData().then((r) => {
        if (r.ok) setIngredients(r.data.ingredients);
      });
    });
  });

  const subtotal = useMemo(
    () => (watchedItems ?? []).reduce((s, i) => {
      const normalized = (Number(i?.purchaseQuantity ?? i?.quantity) || 0) * (Number(i?.conversionFactor) || 1);
      return i?.priceStatus === 'pending' ? s : s + normalized * (Number(i?.unitCost) || 0);
    }, 0),
    [watchedItems],
  );
  const vatAmt = subtotal * ((Number(watchedVatRate) || 7) / 100);
  const total = subtotal + vatAmt;

  async function onSubmit(data: FormValues) {
    const result = schemaType === 'edit'
      ? await updatePurchaseOrder(data)
      : await createPurchaseOrder(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(schemaType === 'edit' ? 'แก้ไขใบสั่งซื้อแล้ว' : 'สร้างใบสั่งซื้อแล้ว');
    onSaved();
  }

  const hasTaxInvoice = watch('hasTaxInvoice') as boolean;

  // ── Import from stock count ──────────────────────────────────────────────────
  const [importPanel, setImportPanel] = useState<{
    loading: boolean;
    countDate: string | null;
    items: StockCountReorderItem[];
    qtys: Record<string, number>;
    selected: Set<string>;
  } | null>(null);

  async function openImportPanel() {
    setImportPanel({ loading: true, countDate: null, items: [], qtys: {}, selected: new Set() });
    const r = await getStockCountReorderItems();
    if (!r.ok) { toast.error(r.error); setImportPanel(null); return; }
    const qtys: Record<string, number> = {};
    const selected = new Set<string>();
    for (const item of r.data.items) {
      qtys[item.ingredientId] = item.reorderQty;
      selected.add(item.ingredientId);
    }
    setImportPanel({ loading: false, countDate: r.data.countDate, items: r.data.items, qtys, selected });
  }

  function handleImportConfirm() {
    if (!importPanel) return;
    const toImport = importPanel.items.filter((i) => importPanel.selected.has(i.ingredientId));
    if (toImport.length === 0) { toast.error('กรุณาเลือกอย่างน้อย 1 รายการ'); return; }
    replace(
      toImport.map((i) => ({
        ingredientId: i.ingredientId,
        quantity: importPanel.qtys[i.ingredientId] ?? i.reorderQty,
        unit: i.unit,
        purchaseQuantity: importPanel.qtys[i.ingredientId] ?? i.reorderQty,
        purchaseUnit: i.unit,
        conversionFactor: 1,
        priceStatus: 'estimated' as const,
        unitCost: i.lastCost,
      })) as never[],
    );
    setImportPanel(null);
    toast.success(`นำเข้า ${toImport.length} รายการแล้ว`);
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-1)] p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {schemaType === 'edit' ? 'แก้ไขใบสั่งซื้อ' : 'สร้างใบสั่งซื้อ'}
        </h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">×</button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {schemaType === 'edit' && (
          <input type="hidden" {...register('id' as keyof FormValues)} />
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier <span className="text-[var(--status-danger-fg)]">*</span></label>
            <select {...register('supplierId')} className={INPUT}>
              <option value="">เลือก Supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {errors.supplierId && <p className="mt-1 text-xs text-[var(--status-danger-fg)]">{errors.supplierId.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">วันที่สั่ง</label>
            <Controller
              control={control}
              name="orderDate"
              render={({ field }) => (
                <ThaiDateInput value={field.value} onValueChange={field.onChange} className="w-full" />
              )}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">วันที่คาดรับ</label>
            <Controller
              control={control}
              name="expectedDate"
              render={({ field }) => (
                <ThaiDateInput value={field.value ?? ''} onValueChange={field.onChange} className="w-full" />
              )}
            />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-foreground">รายการสั่งซื้อ</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openImportPanel}
                className="flex items-center gap-1 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-info-fg)] hover:opacity-90"
              >
                <ClipboardList className="size-3.5" /> นำเข้าจากผลนับสต็อก
              </button>
              <button
                type="button"
                onClick={() => append({ ingredientId: '', quantity: 1, unit: '', purchaseQuantity: 1, purchaseUnit: '', conversionFactor: 1, priceStatus: 'estimated', unitCost: 0 } as never)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" /> เพิ่มรายการ
              </button>
            </div>
          </div>

          {importPanel && (
            <div className="mb-3 rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--status-info-fg)]">
                  นำเข้าจากผลนับสต็อก
                  {importPanel.countDate && (
                    <span className="ml-1.5 font-normal text-[var(--status-info-fg)] opacity-80">
                      (วันที่ {formatThaiDate(importPanel.countDate)})
                    </span>
                  )}
                </p>
                <button type="button" onClick={() => setImportPanel(null)} className="text-[var(--status-info-fg)] opacity-60 hover:opacity-100" aria-label="ปิด">
                  <X className="size-4" />
                </button>
              </div>

              {importPanel.loading ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="size-4 animate-spin text-[var(--status-info-fg)]" />
                  <span className="text-xs text-[var(--status-info-fg)]">กำลังโหลด…</span>
                </div>
              ) : importPanel.items.length === 0 ? (
                <p className="text-xs text-[var(--status-info-fg)] py-3 text-center">
                  {importPanel.countDate
                    ? 'ไม่มีรายการที่ต้องสั่งเพิ่ม — สต็อกอยู่ในระดับปกติ'
                    : 'ยังไม่มีผลการนับที่ผ่านการยืนยัน — กรุณากดยืนยันในหน้าผลการนับสต็อกก่อน'}
                </p>
              ) : (
                <>
                  <div className="rounded-lg overflow-hidden border border-[var(--status-info-border)] bg-card">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--status-info-border)] bg-[var(--status-info-bg)]">
                          <th className="w-8 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={importPanel.selected.size === importPanel.items.length}
                              onChange={(e) => {
                                const all = new Set(e.target.checked ? importPanel.items.map((i) => i.ingredientId) : []);
                                setImportPanel((prev) => prev ? { ...prev, selected: all } : null);
                              }}
                              className="rounded border-border"
                            />
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">วัตถุดิบ</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">คงเหลือ</th>
                          <th className="px-3 py-2 text-right font-medium text-[var(--status-orange-fg)]">ต้องสั่ง</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Supplier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {importPanel.items.map((item) => (
                          <tr key={item.ingredientId} className={importPanel.selected.has(item.ingredientId) ? '' : 'opacity-50'}>
                            <td className="px-3 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={importPanel.selected.has(item.ingredientId)}
                                onChange={(e) => {
                                  const s = new Set(importPanel.selected);
                                  if (e.target.checked) {
                                    s.add(item.ingredientId);
                                  } else {
                                    s.delete(item.ingredientId);
                                  }
                                  setImportPanel((prev) => prev ? { ...prev, selected: s } : null);
                                }}
                                className="rounded border-border"
                              />
                            </td>
                            <td className="px-3 py-1.5 font-medium text-foreground">{item.ingredientName}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                              {item.quantityOnHand.toLocaleString('th-TH', { minimumFractionDigits: 2 })} {item.unit}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={importPanel.qtys[item.ingredientId] ?? item.reorderQty}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value) || item.reorderQty;
                                  setImportPanel((prev) => prev ? { ...prev, qtys: { ...prev.qtys, [item.ingredientId]: v } } : null);
                                }}
                                className="w-20 rounded border border-[var(--status-orange-border)] px-2 py-0.5 text-right text-[var(--status-orange-fg)] outline-none focus:border-[var(--status-orange-border)]"
                              />
                              <span className="ml-1 text-muted-foreground">{item.unit}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">
                              {item.defaultSupplierName ?? <span className="text-muted-foreground/60">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-[var(--status-info-fg)]">เลือก {importPanel.selected.size} / {importPanel.items.length} รายการ</p>
                    <button
                      type="button"
                      onClick={handleImportConfirm}
                      disabled={importPanel.selected.size === 0}
                      className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      นำเข้ารายการที่เลือก
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            {fields.map((field, idx) => {
              const ingId = watchedItems?.[idx]?.ingredientId;
              const ing = ingredients.find((i) => i.id === ingId);
              const priceStatus = watchedItems?.[idx]?.priceStatus ?? 'pending';
              const normalizedQuantity = (Number(watchedItems?.[idx]?.purchaseQuantity ?? watchedItems?.[idx]?.quantity) || 0) * (Number(watchedItems?.[idx]?.conversionFactor) || 1);
              const lineTotal = priceStatus === 'pending' ? null : normalizedQuantity * (Number(watchedItems?.[idx]?.unitCost) || 0);
              return (
                <div key={field.id} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-3">
                    <select
                      {...register(`items.${idx}.ingredientId` as never)}
                      className={`${INPUT} text-xs`}
                      onChange={(e) => {
                        const found = ingredients.find((i) => i.id === e.target.value);
                        if (found) {
                          const unitInput = document.querySelector<HTMLInputElement>(`[name="items.${idx}.unit"]`);
                          const costInput = document.querySelector<HTMLInputElement>(`[name="items.${idx}.unitCost"]`);
                          if (unitInput) unitInput.value = found.unit;
                          if (costInput) costInput.value = found.lastCost;
                          setValue(`items.${idx}.unit` as never, found.unit as never);
                          setValue(`items.${idx}.purchaseUnit` as never, (found.orderUnit ?? found.unit) as never);
                          setValue(`items.${idx}.conversionFactor` as never, Number(found.orderUnitConversion ?? 1) as never);
                          setValue(`items.${idx}.unitCost` as never, Number(found.lastCost) as never);
                          setValue(`items.${idx}.priceStatus` as never, 'estimated' as never);
                        }
                      }}
                    >
                      <option value="">เลือกวัตถุดิบ</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <input
                      {...register(`items.${idx}.quantity` as never, { valueAsNumber: true })}
                      type="number" step="0.01" min="0.01" placeholder="จำนวน"
                      className={`${INPUT} text-right text-xs`}
                    />
                  </div>
                  <div className="col-span-1">
                    <input
                      {...register(`items.${idx}.unit` as never)}
                      placeholder="หน่วย" defaultValue={ing?.unit ?? ''}
                      className={`${INPUT} text-xs`}
                    />
                  </div>
                  <div className="col-span-1">
                    <input {...register(`items.${idx}.purchaseQuantity` as never, { valueAsNumber: true })} type="number" min="0.01" step="0.01" placeholder="จำนวนซื้อ" className={`${INPUT} text-right text-xs`} />
                  </div>
                  <div className="col-span-1">
                    <input {...register(`items.${idx}.purchaseUnit` as never)} placeholder="หน่วยซื้อ" className={`${INPUT} text-xs`} />
                  </div>
                  <div className="col-span-1">
                    <input {...register(`items.${idx}.conversionFactor` as never, { valueAsNumber: true })} type="number" min="0.0001" step="0.0001" title="ตัวคูณเป็น stock unit" className={`${INPUT} text-right text-xs`} />
                  </div>
                  <div className="col-span-2">
                    <select {...register(`items.${idx}.priceStatus` as never)} className={`${INPUT} text-xs`}>
                      <option value="pending">รอราคา</option>
                      <option value="estimated">ประมาณการ</option>

                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      {...register(`items.${idx}.unitCost` as never, { valueAsNumber: true })}
                      type="number" step="0.01" min="0" placeholder={priceStatus === 'pending' ? 'รอราคา' : `ราคา/${ing?.unit ?? 'หน่วยสต็อก'}`} disabled={priceStatus === 'pending'}
                      defaultValue={ing ? Number(ing.lastCost) : 0}
                      className={`${INPUT} text-right text-xs`}
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-end pt-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{lineTotal == null ? 'รอราคา' : `${priceStatus === 'confirmed' ? '฿' : '≈ ฿'}${fmt(lineTotal)} · ${fmt(normalizedQuantity)} ${ing?.unit ?? ''}`}</span>
                  </div>
                  <div className="col-span-1 flex items-center justify-center pt-1.5">
                    {fields.length > 1 && (
                      <button type="button" onClick={() => remove(idx)} aria-label="ลบรายการ" className="text-muted-foreground hover:text-[var(--status-danger-fg)]">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">ยอดก่อน VAT</span>
            <span className="tabular-nums font-medium">฿{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">VAT</span>
              <input
                {...register('vatRate', { valueAsNumber: true })}
                type="number" step="0.01" min="0" max="100"
                className="w-16 rounded border border-border bg-background text-foreground px-2 py-0.5 text-xs text-right outline-none"
              />
              <span className="text-muted-foreground text-xs">%</span>
            </div>
            <span className="tabular-nums">฿{fmt(vatAmt)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
            <span>ยอดรวมทั้งสิ้น</span>
            <span className="tabular-nums text-foreground">฿{fmt(total)}</span>
          </div>
        </div>

        {/* Tax invoice */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('hasTaxInvoice')} className="rounded border-border" />
            <span className="text-sm text-foreground">มีใบกำกับภาษีจาก Supplier</span>
          </label>
          {hasTaxInvoice && (
            <input {...register('taxInvoiceNumber')} placeholder="เลขที่ใบกำกับภาษี" className={INPUT} />
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">หมายเหตุ</label>
          <textarea {...register('notes')} rows={2} className={`${INPUT} resize-none`} />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground hover:bg-muted/30">
            ยกเลิก
          </button>
          <button type="submit" disabled={isSubmitting} className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Edit PO wrapper ───────────────────────────────────────────────────────────

function POFormEdit({ id, suppliers, onClose, onSaved }: { id: string; suppliers: POListData['suppliers']; onClose: () => void; onSaved: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['po-detail', id],
    queryFn: async () => {
      const r = await getPurchaseOrderDetail(id);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> กำลังโหลด…
      </div>
    );
  }

  const initialValues: UpdatePurchaseOrderInput = {
    id: data.po.id,
    supplierId: data.po.supplierId ?? '',
    orderDate: data.po.orderDate,
    expectedDate: data.po.expectedDate ?? undefined,
    vatRate: Number(data.po.vatRate),
    hasTaxInvoice: data.po.hasTaxInvoice,
    taxInvoiceNumber: data.po.taxInvoiceNumber ?? undefined,
    notes: data.po.notes ?? undefined,
    items: data.po.items.map((item) => ({
      ingredientId: item.ingredientId,
      quantity: Number(item.quantity),
      unit: item.unit,
      purchaseQuantity: item.purchaseQuantity == null ? Number(item.quantity) : Number(item.purchaseQuantity),
      purchaseUnit: item.purchaseUnit ?? item.unit,
      conversionFactor: Number(item.purchaseUnitConversion ?? 1),
      priceStatus: item.priceStatus === 'pending' ? 'pending' as const : 'estimated' as const,
      unitCost: item.unitCost == null ? null : Number(item.unitCost),
      lastCostSnapshot: item.lastCostSnapshot == null ? null : Number(item.lastCostSnapshot),
    })),
  };

  return (
    <POFormInner
      schema="edit"
      suppliers={suppliers}
      initialValues={initialValues}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

// ── Receive form ──────────────────────────────────────────────────────────────

function ReceiveForm({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['po-detail', id],
    queryFn: async () => {
      const r = await getPurchaseOrderDetail(id);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    staleTime: 0,
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> กำลังโหลด…
      </div>
    );
  }

  return <ReceiveFormInner data={data} onClose={onClose} onSaved={onSaved} />;
}

function ReceiveFormInner({ data, onClose, onSaved }: { data: PODetail; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const isPartialStatus = data.po.status === 'partial_received';

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { isSubmitting },
  } = useForm<ReceivePurchaseOrderInput>({
    resolver: zodResolver(receivePurchaseOrderSchema) as Resolver<ReceivePurchaseOrderInput>,
    defaultValues: {
      id: data.po.id,
      receivedDate: today,
      hasTaxInvoice: data.po.hasTaxInvoice,
      taxInvoiceNumber: data.po.taxInvoiceNumber ?? '',
      isPartial: false,
      idempotencyKey: crypto.randomUUID(),
      overReceiveConfirmed: false,
      overReceiveReason: '',
      notes: '',
      items: data.po.items.map((item) => {
        const alreadyReceived = Number(item.receivedQuantity ?? 0);
        const remaining = Math.max(0, Number(item.quantity) - alreadyReceived);
        const conversionFactor = Number(item.purchaseUnitConversion ?? 1);
        return {
          id: item.id,
          receivedQuantity: remaining,
          receivedPurchaseQuantity: remaining / conversionFactor,
          purchaseUnit: item.purchaseUnit ?? item.unit,
          conversionFactor,
          stockUnit: item.unit,
          discrepancyType: 'none' as const,
          discrepancyNotes: '',
          priceStatus: item.priceStatus as 'pending' | 'estimated' | 'confirmed',
          actualUnitCost: item.priceStatus === 'confirmed' ? Number(item.confirmedUnitCost ?? item.unitCost ?? 0) : null,
        };
      }),
    },
  });

  const hasTaxInvoice = watch('hasTaxInvoice');
  const isPartialChecked = watch('isPartial');
  const receiveLines = watch('items');
  const hasOverReceive = data.po.items.some((item, index) => {
    const line = receiveLines?.[index];
    const normalized = line?.receivedPurchaseQuantity == null
      ? Number(line?.receivedQuantity ?? 0)
      : Number(line.receivedPurchaseQuantity) * Number(line.conversionFactor ?? 1);
    return Number(item.receivedQuantity ?? 0) + normalized > Number(item.quantity) + 0.005;
  });

  async function onSubmit(formData: ReceivePurchaseOrderInput) {
    const result = await receiveOrder(formData);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(result.duplicate ? 'รายการนี้ถูกบันทึกแล้ว ระบบไม่รับซ้ำ' : formData.isPartial ? 'บันทึกการรับบางส่วนแล้ว' : 'บันทึกการรับของครบแล้ว');
    onSaved();
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-1)] p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {isPartialStatus ? 'รับของเพิ่ม' : 'รับของ'} — {data.po.poNumber}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{data.po.supplier?.name ?? data.po.vendorName ?? 'ไม่ระบุผู้ขาย'}</p>
        </div>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">×</button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <input type="hidden" {...register('id')} />

        {/* Received date */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">วันที่รับของ</label>
          <Controller
            control={control}
            name="receivedDate"
            render={({ field }) => (
              <ThaiDateInput value={field.value} onValueChange={field.onChange} className="w-full" />
            )}
          />
        </div>

        {/* Line items with discrepancy */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">รายการสินค้า</p>
          {data.po.items.map((item, idx) => {
            const alreadyReceived = Number(item.receivedQuantity ?? 0);
            const remaining = Math.max(0, Number(item.quantity) - alreadyReceived);
            const discrepancyVal = watch(`items.${idx}.discrepancyType`);
            const priceStatusVal = watch(`items.${idx}.priceStatus`);
            return (
              <div key={item.id} className="rounded-xl border border-border p-4 space-y-3">
                <input type="hidden" {...register(`items.${idx}.id`)} value={item.id} />

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.ingredient.name}</p>
                    <p className="text-xs text-muted-foreground">
                      สั่ง {fmt(item.quantity)} {item.unit}
                      {alreadyReceived > 0 && (
                        <span className="ml-2 text-[var(--status-success-fg)]">• รับแล้ว {fmt(alreadyReceived)}</span>
                      )}
                      {remaining > 0 && alreadyReceived > 0 && (
                        <span className="ml-2 text-[var(--status-orange-fg)]">• ค้าง {fmt(remaining)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input type="hidden" {...register(`items.${idx}.receivedQuantity`, { valueAsNumber: true })} />
                    <input type="hidden" {...register(`items.${idx}.conversionFactor`, { valueAsNumber: true })} />
                    <input type="hidden" {...register(`items.${idx}.purchaseUnit`)} />
                    <input type="hidden" {...register(`items.${idx}.stockUnit`)} />
                    <input
                      {...register(`items.${idx}.receivedPurchaseQuantity`, { valueAsNumber: true })}
                      type="number" step="0.01" min="0"
                      className="w-24 rounded-lg border border-border bg-background text-foreground px-3 py-1.5 text-sm text-right outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                    />
                    <span className="text-sm text-muted-foreground shrink-0">{item.purchaseUnit ?? item.unit}</span>
                    <span className="text-[10px] text-muted-foreground">× {fmt(item.purchaseUnitConversion ?? 1)} = stock {item.unit}</span>
                  </div>
                </div>

                {/* Discrepancy */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">สถานะสินค้า</label>
                    <select
                      {...register(`items.${idx}.discrepancyType`)}
                      className="w-full rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                    >
                      <option value="none">ปกติ</option>
                      <option value="short">ขาด</option>
                      <option value="wrong">ผิดรายการ</option>
                      <option value="spoiled">เสียหาย</option>
                    </select>
                  </div>
                  {discrepancyVal !== 'none' && (
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">หมายเหตุ (ความผิดปกติ)</label>
                      <input
                        {...register(`items.${idx}.discrepancyNotes`)}
                        type="text"
                        placeholder="ระบุรายละเอียด"
                        className="w-full rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1.5 text-xs outline-none focus:border-[var(--status-warning-border)]"
                      />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">สถานะราคาเมื่อรับ</label>
                    <select {...register(`items.${idx}.priceStatus`)} className={INPUT}>
                      <option value="pending">รอราคา</option>
                      <option value="estimated">ประมาณการ</option>
                      <option value="confirmed">ราคาจริงยืนยันแล้ว</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">ราคาจริงต่อ {item.unit}</label>
                    <input
                      {...register(`items.${idx}.actualUnitCost`, { valueAsNumber: true })}
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={priceStatusVal !== 'confirmed'}
                      placeholder={priceStatusVal === 'confirmed' ? 'ราคาจริง' : 'ยืนยันภายหลัง'}
                      className={`${INPUT} text-right disabled:opacity-50`}
                    />
                  </div>
                </div>              </div>
            );
          })}
        </div>

        {hasOverReceive && (
          <div className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--status-warning-fg)]">
              <input type="checkbox" {...register('overReceiveConfirmed')} />
              ยืนยันจำนวนรับเกินใบสั่งซื้อ
            </label>
            <input {...register('overReceiveReason')} className={INPUT} placeholder="เหตุผลที่รับเกิน (บังคับ)" />
          </div>
        )}

        {/* Partial receipt toggle */}
        <div className="rounded-lg bg-muted/30 border border-border px-4 py-3 space-y-1">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" {...register('isPartial')} className="rounded border-border" />
            <span className="text-sm text-foreground font-medium">รับของบางส่วน (ยังไม่ครบ)</span>
          </label>
          {isPartialChecked && (
            <p className="text-xs text-[var(--status-orange-fg)] pl-6">PO จะเปลี่ยนเป็นสถานะ &ldquo;รับบางส่วน&rdquo; — สามารถรับเพิ่มได้ในภายหลัง</p>
          )}
          {!isPartialChecked && (
            <p className="text-xs text-muted-foreground pl-6">PO จะเปลี่ยนเป็นสถานะ &ldquo;รับของแล้ว&rdquo; และอัปเดตราคาวัตถุดิบ</p>
          )}
        </div>

        {/* Tax invoice */}
        <div className="border-t border-border pt-4 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('hasTaxInvoice')} className="rounded border-border" />
            <span className="text-sm text-foreground">มีใบกำกับภาษี</span>
          </label>
          {hasTaxInvoice && (
            <input
              {...register('taxInvoiceNumber')}
              placeholder="เลขที่ใบกำกับภาษี"
              className={INPUT}
            />
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">หมายเหตุ (ถ้ามี)</label>
          <textarea {...register('notes')} rows={2} className={`${INPUT} resize-none`} placeholder="หมายเหตุสำหรับการรับของครั้งนี้" />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground hover:bg-muted/30">
            ยกเลิก
          </button>
          <button type="submit" disabled={isSubmitting} className={`flex-1 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50 ${isPartialChecked ? 'bg-[var(--status-orange-fg)] hover:opacity-90' : 'bg-[var(--status-success-fg)] hover:opacity-90'}`}>
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> กำลังบันทึก…</span>
            ) : isPartialChecked ? 'บันทึกรับบางส่วน' : 'ยืนยันรับของครบ'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── PO Detail modal ───────────────────────────────────────────────────────────

function PODetailModal({ id, onClose, onReceive }: { id: string; onClose: () => void; onReceive: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['po-detail', id],
    queryFn: async () => {
      const r = await getPurchaseOrderDetail(id);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    staleTime: 30_000,
  });

  // Must be above the early return to satisfy Rules of Hooks
  const [isReceiptPending, startReceiptTransition] = useTransition();

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> กำลังโหลด…
      </div>
    );
  }

  const po = data.po;
  const showReceived = po.status === 'received' || po.status === 'partial_received';

  function handlePrint() {
    const win = window.open('', '_blank', 'width=400,height=600');
    if (!win) return;
    win.document.write(`
      <html><head><title>${po.poNumber}</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 12px; margin: 16px; }
        h1 { font-size: 16px; text-align: center; margin: 0 0 8px; }
        p { margin: 2px 0; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; font-size: 11px; }
        th { background: #f0f0f0; }
        .right { text-align: right; }
        .total { font-weight: bold; }
        hr { border: none; border-top: 1px dashed #ccc; margin: 8px 0; }
      </style>
      </head><body>
      <h1>ใบสั่งซื้อ</h1>
      <p><b>เลขที่:</b> ${po.poNumber}</p>
      <p><b>Supplier:</b> ${po.supplier?.name ?? po.vendorName ?? 'ไม่ระบุผู้ขาย'}</p>
      ${po.supplier?.taxId ? `<p><b>เลขภาษี:</b> ${po.supplier?.taxId}</p>` : ''}
      <p><b>วันที่สั่ง:</b> ${fmtDate(po.orderDate)}</p>
      ${po.expectedDate ? `<p><b>คาดรับ:</b> ${fmtDate(po.expectedDate)}</p>` : ''}
      <hr/>
      <table>
        <tr><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th class="right">ราคา/หน่วย</th><th class="right">รวม</th></tr>
        ${po.items.map((item) => `
          <tr>
            <td>${item.ingredient.name}</td>
            <td>${fmt(item.quantity)}</td>
            <td>${item.unit}</td>
            <td class="right">${fmt(item.unitCost)}</td>
            <td class="right">${fmt(item.lineTotal)}</td>
          </tr>
        `).join('')}
      </table>
      <p class="right">ยอดก่อน VAT: ฿${fmt(po.subtotal)}</p>
      <p class="right">VAT ${fmt(po.vatRate)}%: ฿${fmt(po.vatAmount)}</p>
      <p class="right total">ยอดรวม: ฿${fmt(po.total)}</p>
      ${po.hasTaxInvoice && po.taxInvoiceNumber ? `<p><b>เลขใบกำกับภาษี:</b> ${po.taxInvoiceNumber}</p>` : ''}
      ${po.notes ? `<p><b>หมายเหตุ:</b> ${po.notes}</p>` : ''}
      </body></html>
    `);
    win.document.close();
    win.print();
  }

  function handleLineCopy() {
    const lines: string[] = [
      `📦 ใบสั่งซื้อ ${po.poNumber}`,
      `Supplier: ${po.supplier?.name ?? po.vendorName ?? 'ไม่ระบุผู้ขาย'}`,
      `วันที่: ${fmtDate(po.orderDate)}`,
      po.expectedDate ? `คาดรับ: ${fmtDate(po.expectedDate)}` : '',
      '',
      'รายการสั่งซื้อ:',
      ...po.items.map(
        (item) =>
          `• ${item.ingredient.name}  ${fmt(item.quantity)} ${item.unit}  ฿${fmt(item.lineTotal)}`,
      ),
      '',
      `ยอดก่อน VAT: ฿${fmt(po.subtotal)}`,
      `VAT ${fmt(po.vatRate)}%: ฿${fmt(po.vatAmount)}`,
      `ยอดรวม: ฿${fmt(po.total)}`,
      po.notes ? `\nหมายเหตุ: ${po.notes}` : '',
    ].filter((l) => l !== undefined);

    navigator.clipboard.writeText(lines.filter(Boolean).join('\n')).then(() => {
      toast.success('คัดลอกข้อความ LINE แล้ว');
    }).catch(() => {
      toast.error('ไม่สามารถคัดลอกได้ — กรุณาลองใหม่');
    });
  }

  const receipts = po.goodsReceipts ?? [];

  function handleConfirmReceiptPrice(receiptItemId: string, estimated: string | null) {
    const rawPrice = window.prompt(`ราคาจริงต่อหน่วย${estimated ? ` (ประมาณไว้ ฿${fmt(estimated)})` : ''}`);
    if (!rawPrice) return;
    const actualUnitCost = Number(rawPrice);
    if (!Number.isFinite(actualUnitCost) || actualUnitCost <= 0) {
      toast.error('ราคาจริงต้องมากกว่า 0');
      return;
    }
    const reason = window.prompt('ระบุแหล่งที่มาหรือเหตุผลการยืนยันราคา');
    if (!reason?.trim()) return;
    startReceiptTransition(async () => {
      const result = await confirmReceiptPrice({ goodsReceiptItemId: receiptItemId, actualUnitCost, reason: reason.trim() });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('ยืนยันราคาจริงและบันทึกประวัติแล้ว');
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    });
  }

  function handleVoidReceipt(goodsReceiptId: string) {
    const reason = window.prompt('เหตุผลยกเลิกใบรับของ (ระบบจะย้อนยอดรับ)');
    if (!reason?.trim()) return;
    startReceiptTransition(async () => {
      const result = await voidGoodsReceipt({ goodsReceiptId, reason: reason.trim() });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('ยกเลิกใบรับของและย้อนยอดรับแล้ว');
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-1)] p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground font-mono">{po.poNumber}</h2>
          <div className="mt-1">
            <StatusBadge label={STATUS_LABEL[po.status] ?? po.status} variant={STATUS_VARIANT[po.status] ?? 'neutral'} dot />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleLineCopy}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1.5 text-xs font-medium text-[var(--status-success-fg)] hover:opacity-90"
          >
            <Copy className="size-3.5" /> คัดลอกสำหรับ LINE
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
          >
            <Printer className="size-3.5" /> พิมพ์
          </button>
          <button type="button" aria-label="ปิด" onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">×</button>
        </div>
      </div>

      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Supplier</p>
            <p className="font-medium text-foreground">{po.supplier?.name ?? po.vendorName ?? 'ไม่ระบุผู้ขาย'}</p>
            {po.supplier?.taxId && <p className="text-xs text-muted-foreground">เลขภาษี: {po.supplier?.taxId}</p>}
            {po.supplier?.phone && <p className="text-xs text-muted-foreground">{po.supplier?.phone}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">วันที่สั่ง</p>
            <p className="font-medium">{fmtDate(po.orderDate)}</p>
            {po.expectedDate && (
              <>
                <p className="text-xs text-muted-foreground mt-1">คาดรับ</p>
                <p className="font-medium">{fmtDate(po.expectedDate)}</p>
              </>
            )}
            {po.receivedDate && (
              <>
                <p className="text-xs text-muted-foreground mt-1">รับแล้ว</p>
                <p className="font-medium text-[var(--status-success-fg)]">{fmtDate(po.receivedDate)}</p>
              </>
            )}
          </div>
        </div>

        {/* Items table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">รายการ</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">สั่ง</th>
                {showReceived && <th className="px-3 py-2 text-right font-medium text-[var(--status-success-fg)]">รับรวม</th>}
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">ราคา/หน่วย</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">รวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {po.items.map((item) => {
                const received = Number(item.receivedQuantity ?? 0);
                const ordered = Number(item.quantity);
                const isShort = showReceived && received < ordered;
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2 font-medium text-foreground">{item.ingredient.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(item.quantity)} {item.unit}</td>
                    {showReceived && (
                      <td className={`px-3 py-2 text-right tabular-nums ${isShort ? 'text-[var(--status-orange-fg)]' : 'text-[var(--status-success-fg)]'}`}>
                        {fmt(received)} {item.unit}
                        {isShort && <span className="ml-1 text-[var(--status-orange-fg)] opacity-70">(ขาด {fmt(ordered - received)})</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">฿{fmt(item.unitCost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">฿{fmt(item.lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>ยอดก่อน VAT</span>
            <span className="tabular-nums">฿{fmt(po.subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>VAT {fmt(po.vatRate)}%</span>
            <span className="tabular-nums">฿{fmt(po.vatAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold text-sm border-t border-border pt-1">
            <span>ยอดรวม</span>
            <span className="tabular-nums">฿{fmt(po.total)}</span>
          </div>
        </div>

        {/* Tax invoice */}
        {po.hasTaxInvoice && (
          <div className="rounded-lg bg-[var(--status-success-bg)] border border-[var(--status-success-border)] px-4 py-2.5 text-xs text-[var(--status-success-fg)]">
            ✓ มีใบกำกับภาษี{po.taxInvoiceNumber ? ` — เลขที่: ${po.taxInvoiceNumber}` : ''}
          </div>
        )}

        {po.notes && <p className="text-xs text-muted-foreground">หมายเหตุ: {po.notes}</p>}

        {/* Goods receipts history */}
        {receipts.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-foreground">ประวัติการรับของ ({receipts.length} ครั้ง)</p>
            {receipts.map((receipt) => (
              <div key={receipt.id} className={cn('rounded-xl border border-border p-3 space-y-2', receipt.voidedAt && 'opacity-60')}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-foreground">{fmtDate(receipt.receivedDate)}</p>
                    <p className="text-xs text-muted-foreground">โดย {receipt.receivedByUser?.name ?? '—'}</p>
                  </div>
                  {receipt.voidedAt ? (
                    <StatusBadge label="Void แล้ว" variant="danger" />
                  ) : (
                    <Button type="button" size="sm" variant="outline" disabled={isReceiptPending} onClick={() => handleVoidReceipt(receipt.id)}>
                      <Ban className="size-3.5" /> Void receipt
                    </Button>
                  )}
                </div>
                {receipt.items.map((ri) => {
                  const poItem = po.items.find((candidate) => candidate.id === ri.purchaseOrderItemId);
                  return (
                    <div key={ri.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 p-2 text-xs">
                      <div>
                        <span className="font-medium text-foreground">{poItem?.ingredient.name ?? '—'}</span>
                        <span className="ml-2 text-muted-foreground">{fmt(ri.receivedQuantity)} {poItem?.unit}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {ri.discrepancyType !== 'none' && <StatusBadge label={DISCREPANCY_LABEL[ri.discrepancyType]} variant="warning" />}
                        {ri.priceStatus === 'confirmed' && ri.actualUnitCost != null ? (
                          <StatusBadge label={`ราคาจริง ฿${fmt(ri.actualUnitCost)}`} variant="success" />
                        ) : !receipt.voidedAt ? (
                          <Button type="button" size="sm" variant="outline" disabled={isReceiptPending} onClick={() => handleConfirmReceiptPrice(ri.id, ri.estimatedUnitCost)}>
                            ยืนยันราคาจริง
                          </Button>
                        ) : (
                          <StatusBadge label="รอราคา" variant="warning" />
                        )}
                      </div>
                    </div>
                  );
                })}
                {receipt.notes && <p className="text-xs text-muted-foreground italic">{receipt.notes}</p>}
                {receipt.voidReason && <p className="text-xs text-[var(--status-danger-fg)]">เหตุผล Void: {receipt.voidReason}</p>}
              </div>
            ))}
          </div>
        )}
        {/* Receive more button for partial */}
        {po.status === 'partial_received' && (
          <button
            type="button"
            onClick={() => { onClose(); onReceive(po.id); }}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--status-orange-fg)] py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            <PackagePlus className="size-4" /> รับของเพิ่ม
          </button>
        )}

        <p className="text-xs text-muted-foreground">สร้างโดย: {po.createdByUser.name}</p>
      </div>
    </div>
  );
}
