'use client';

import { useState, useMemo, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
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
  ChevronDown,
  ChevronRight,
  PackagePlus,
} from 'lucide-react';
import type { Resolver } from 'react-hook-form';
import {
  getPurchaseOrderListData,
  createPurchaseOrder,
  updatePurchaseOrder,
  submitForApproval,
  approveOrder,
  receiveOrder,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500';

const STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง',
  pending_approval: 'รออนุมัติ',
  ordered: 'ยืนยันแล้ว',
  partial_received: 'รับบางส่วน',
  received: 'รับของแล้ว',
  cancelled: 'ยกเลิก',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_approval: 'bg-amber-100 text-amber-700',
  ordered: 'bg-blue-100 text-blue-700',
  partial_received: 'bg-orange-100 text-orange-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const DISCREPANCY_LABEL: Record<string, string> = {
  none: 'ปกติ',
  short: 'ขาด',
  wrong: 'ผิดรายการ',
  spoiled: 'เสียหาย',
};

function fmt(n: string | number) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'd MMM yyyy', { locale: th }); }
  catch { return d; }
}

type Modal =
  | { type: 'new' }
  | { type: 'edit'; id: string }
  | { type: 'receive'; id: string }
  | { type: 'detail'; id: string };

interface Props {
  initialData: POListData;
  initialDataUpdatedAt: number;
  initialSupplierFilter?: string;
  userRole?: string;
}

// ── Main list ─────────────────────────────────────────────────────────────────

export function PurchaseOrdersPage({ initialData, initialDataUpdatedAt, initialSupplierFilter, userRole }: Props) {
  const [modal, setModal] = useState<Modal | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState(initialSupplierFilter ?? '');
  const [isPending, startTransition] = useTransition();
  const qc = useQueryClient();

  const { data = initialData } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const r = await getPurchaseOrderListData();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData,
    initialDataUpdatedAt,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['purchase-orders'] });

  const isOwner = userRole === 'owner';

  const filtered = useMemo(() => {
    return data.orders.filter((po) => {
      if (statusFilter !== 'all' && po.status !== statusFilter) return false;
      if (supplierFilter && po.supplier.id !== supplierFilter) return false;
      return true;
    });
  }, [data, statusFilter, supplierFilter]);

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
    if (!confirm('ยืนยันยกเลิกใบสั่งซื้อ?')) return;
    startTransition(async () => {
      const r = await cancelOrder(id);
      if (!r.ok) toast.error(r.error);
      else { toast.success('ยกเลิกแล้ว'); invalidate(); }
    });
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">ใบสั่งซื้อ (PO)</h1>
          <p className="text-sm text-slate-500 mt-0.5">{data.orders.length} รายการทั้งหมด</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ type: 'new' })}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <Plus className="size-4" />
          สร้างใบสั่งซื้อ
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 flex-wrap">
          {['all', 'draft', 'pending_approval', 'ordered', 'partial_received', 'received', 'cancelled'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s === 'all' ? 'ทั้งหมด' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-slate-500"
        >
          <option value="">ทุก Supplier</option>
          {data.suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <ShoppingBag className="mx-auto size-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">ไม่มีใบสั่งซื้อ</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">เลข PO</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Supplier</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">วันที่สั่ง</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-center">สถานะ</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">ยอดรวม</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-center">ใบกำกับ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setModal({ type: 'detail', id: po.id })}
                        className="font-mono text-sm font-medium text-slate-800 hover:text-slate-600 underline-offset-2 hover:underline"
                      >
                        {po.poNumber}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{po.supplier.name}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(po.orderDate)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[po.status]}`}>
                        {STATUS_LABEL[po.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800">
                      ฿{fmt(po.total)}
                    </td>
                    <td className="px-4 py-3 text-center text-base">
                      {po.hasTaxInvoice ? '✓' : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {po.status === 'draft' && (
                          <>
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'edit', id: po.id })}
                              className="text-xs text-slate-400 hover:text-slate-700"
                            >
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleSubmitForApproval(po.id)}
                              className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                            >
                              ส่งอนุมัติ
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleCancel(po.id)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              ยกเลิก
                            </button>
                          </>
                        )}
                        {po.status === 'pending_approval' && (
                          <>
                            {isOwner && (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleApprove(po.id)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                              >
                                อนุมัติ
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleCancel(po.id)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              ยกเลิก
                            </button>
                          </>
                        )}
                        {po.status === 'ordered' && (
                          <>
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'receive', id: po.id })}
                              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 font-medium"
                            >
                              <PackageCheck className="size-3.5" />
                              รับของ
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleCancel(po.id)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              ยกเลิก
                            </button>
                          </>
                        )}
                        {po.status === 'partial_received' && (
                          <>
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'receive', id: po.id })}
                              className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 font-medium"
                            >
                              <PackagePlus className="size-3.5" />
                              รับของเพิ่ม
                            </button>
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'detail', id: po.id })}
                              className="text-xs text-slate-400 hover:text-slate-700"
                            >
                              รายละเอียด
                            </button>
                          </>
                        )}
                        {(po.status === 'received' || po.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={() => setModal({ type: 'detail', id: po.id })}
                            className="text-xs text-slate-400 hover:text-slate-700"
                          >
                            ดูรายละเอียด
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 py-8 overflow-y-auto"
          onClick={() => setModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="my-auto">
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
          </div>
        </div>
      )}
    </div>
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

type POFormIngredient = { id: string; name: string; unit: string; lastCost: string };

function POFormInner({ schema: schemaType, suppliers, initialValues, onClose, onSaved }: POFormInnerProps) {
  type FormValues = CreatePurchaseOrderInput | UpdatePurchaseOrderInput;
  const zodSchema = schemaType === 'edit' ? updatePurchaseOrderSchema : createPurchaseOrderSchema;

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(zodSchema) as Resolver<FormValues>,
    defaultValues: initialValues
      ? { ...initialValues }
      : {
          orderDate: today,
          vatRate: 7,
          hasTaxInvoice: false,
          items: [{ ingredientId: '', quantity: 1, unit: '', unitCost: 0 }],
        },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' as never });

  const watchedItems = watch('items') as Array<{ ingredientId: string; quantity: number; unit: string; unitCost: number }>;
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
    () => (watchedItems ?? []).reduce((s, i) => s + (Number(i?.quantity) || 0) * (Number(i?.unitCost) || 0), 0),
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
        unitCost: i.lastCost,
      })) as never[],
    );
    setImportPanel(null);
    toast.success(`นำเข้า ${toImport.length} รายการแล้ว`);
  }

  return (
    <div className="w-[700px] max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {schemaType === 'edit' ? 'แก้ไขใบสั่งซื้อ' : 'สร้างใบสั่งซื้อ'}
        </h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {schemaType === 'edit' && (
          <input type="hidden" {...register('id' as keyof FormValues)} />
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-700 mb-1">Supplier <span className="text-red-500">*</span></label>
            <select {...register('supplierId')} className={INPUT}>
              <option value="">เลือก Supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {errors.supplierId && <p className="mt-1 text-xs text-red-600">{errors.supplierId.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">วันที่สั่ง</label>
            <input type="date" {...register('orderDate')} className={INPUT} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">วันที่คาดรับ</label>
            <input type="date" {...register('expectedDate')} className={INPUT} />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-700">รายการสั่งซื้อ</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openImportPanel}
                className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <ClipboardList className="size-3.5" /> นำเข้าจากผลนับสต็อก
              </button>
              <button
                type="button"
                onClick={() => append({ ingredientId: '', quantity: 1, unit: '', unitCost: 0 } as never)}
                className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
              >
                <Plus className="size-3.5" /> เพิ่มรายการ
              </button>
            </div>
          </div>

          {importPanel && (
            <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-blue-800">
                  นำเข้าจากผลนับสต็อก
                  {importPanel.countDate && (
                    <span className="ml-1.5 font-normal text-blue-600">
                      (วันที่ {format(new Date(importPanel.countDate + 'T00:00:00'), 'd MMM yyyy', { locale: th })})
                    </span>
                  )}
                </p>
                <button type="button" onClick={() => setImportPanel(null)} className="text-blue-400 hover:text-blue-600" aria-label="ปิด">
                  <X className="size-4" />
                </button>
              </div>

              {importPanel.loading ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="size-4 animate-spin text-blue-500" />
                  <span className="text-xs text-blue-600">กำลังโหลด…</span>
                </div>
              ) : importPanel.items.length === 0 ? (
                <p className="text-xs text-blue-600 py-3 text-center">
                  {importPanel.countDate
                    ? 'ไม่มีรายการที่ต้องสั่งเพิ่ม — สต็อกอยู่ในระดับปกติ'
                    : 'ยังไม่มีผลการนับที่ผ่านการยืนยัน — กรุณากดยืนยันในหน้าผลการนับสต็อกก่อน'}
                </p>
              ) : (
                <>
                  <div className="rounded-lg overflow-hidden border border-blue-200 bg-white">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-blue-100 bg-blue-50/60">
                          <th className="w-8 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={importPanel.selected.size === importPanel.items.length}
                              onChange={(e) => {
                                const all = new Set(e.target.checked ? importPanel.items.map((i) => i.ingredientId) : []);
                                setImportPanel((prev) => prev ? { ...prev, selected: all } : null);
                              }}
                              className="rounded border-slate-300"
                            />
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">วัตถุดิบ</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-500">คงเหลือ</th>
                          <th className="px-3 py-2 text-right font-medium text-orange-600">ต้องสั่ง</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-500">Supplier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {importPanel.items.map((item) => (
                          <tr key={item.ingredientId} className={importPanel.selected.has(item.ingredientId) ? '' : 'opacity-50'}>
                            <td className="px-3 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={importPanel.selected.has(item.ingredientId)}
                                onChange={(e) => {
                                  const s = new Set(importPanel.selected);
                                  e.target.checked ? s.add(item.ingredientId) : s.delete(item.ingredientId);
                                  setImportPanel((prev) => prev ? { ...prev, selected: s } : null);
                                }}
                                className="rounded border-slate-300"
                              />
                            </td>
                            <td className="px-3 py-1.5 font-medium text-slate-800">{item.ingredientName}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
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
                                className="w-20 rounded border border-orange-200 px-2 py-0.5 text-right text-orange-700 outline-none focus:border-orange-400"
                              />
                              <span className="ml-1 text-slate-400">{item.unit}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-400">
                              {item.defaultSupplierName ?? <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-blue-600">เลือก {importPanel.selected.size} / {importPanel.items.length} รายการ</p>
                    <button
                      type="button"
                      onClick={handleImportConfirm}
                      disabled={importPanel.selected.size === 0}
                      className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
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
              const lineTotal = (Number(watchedItems?.[idx]?.quantity) || 0) * (Number(watchedItems?.[idx]?.unitCost) || 0);
              return (
                <div key={field.id} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-4">
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
                        }
                      }}
                    >
                      <option value="">เลือกวัตถุดิบ</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      {...register(`items.${idx}.quantity` as never, { valueAsNumber: true })}
                      type="number" step="0.01" min="0.01" placeholder="จำนวน"
                      className={`${INPUT} text-right text-xs`}
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      {...register(`items.${idx}.unit` as never)}
                      placeholder="หน่วย" defaultValue={ing?.unit ?? ''}
                      className={`${INPUT} text-xs`}
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      {...register(`items.${idx}.unitCost` as never, { valueAsNumber: true })}
                      type="number" step="0.01" min="0" placeholder="ราคา/หน่วย"
                      defaultValue={ing ? Number(ing.lastCost) : 0}
                      className={`${INPUT} text-right text-xs`}
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-end pt-2">
                    <span className="text-xs tabular-nums text-slate-600">{fmt(lineTotal)}</span>
                  </div>
                  <div className="col-span-1 flex items-center justify-center pt-1.5">
                    {fields.length > 1 && (
                      <button type="button" onClick={() => remove(idx)} aria-label="ลบรายการ" className="text-slate-400 hover:text-red-500">
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
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">ยอดก่อน VAT</span>
            <span className="tabular-nums font-medium">฿{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">VAT</span>
              <input
                {...register('vatRate', { valueAsNumber: true })}
                type="number" step="0.01" min="0" max="100"
                className="w-16 rounded border border-slate-300 px-2 py-0.5 text-xs text-right outline-none"
              />
              <span className="text-slate-500 text-xs">%</span>
            </div>
            <span className="tabular-nums">฿{fmt(vatAmt)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
            <span>ยอดรวมทั้งสิ้น</span>
            <span className="tabular-nums text-slate-900">฿{fmt(total)}</span>
          </div>
        </div>

        {/* Tax invoice */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('hasTaxInvoice')} className="rounded border-slate-300" />
            <span className="text-sm text-slate-700">มีใบกำกับภาษีจาก Supplier</span>
          </label>
          {hasTaxInvoice && (
            <input {...register('taxInvoiceNumber')} placeholder="เลขที่ใบกำกับภาษี" className={INPUT} />
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">หมายเหตุ</label>
          <textarea {...register('notes')} rows={2} className={`${INPUT} resize-none`} />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="submit" disabled={isSubmitting} className="flex-1 rounded-lg bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
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
      <div className="w-[700px] rounded-xl bg-white p-10 shadow-xl flex items-center justify-center gap-2 text-slate-500">
        <Loader2 className="size-5 animate-spin" /> กำลังโหลด…
      </div>
    );
  }

  const initialValues: UpdatePurchaseOrderInput = {
    id: data.po.id,
    supplierId: data.po.supplierId,
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
      unitCost: Number(item.unitCost),
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
      <div className="w-[620px] rounded-xl bg-white p-10 shadow-xl flex items-center justify-center gap-2 text-slate-500">
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
    formState: { isSubmitting },
  } = useForm<ReceivePurchaseOrderInput>({
    resolver: zodResolver(receivePurchaseOrderSchema) as Resolver<ReceivePurchaseOrderInput>,
    defaultValues: {
      id: data.po.id,
      receivedDate: today,
      hasTaxInvoice: data.po.hasTaxInvoice,
      taxInvoiceNumber: data.po.taxInvoiceNumber ?? '',
      isPartial: false,
      items: data.po.items.map((item) => {
        const alreadyReceived = Number(item.receivedQuantity ?? 0);
        const remaining = Math.max(0, Number(item.quantity) - alreadyReceived);
        return {
          id: item.id,
          receivedQuantity: remaining,
          discrepancyType: 'none' as const,
          discrepancyNotes: '',
        };
      }),
    },
  });

  const hasTaxInvoice = watch('hasTaxInvoice');
  const isPartialChecked = watch('isPartial');

  async function onSubmit(formData: ReceivePurchaseOrderInput) {
    const result = await receiveOrder(formData);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(formData.isPartial ? 'บันทึกการรับบางส่วนแล้ว' : 'บันทึกการรับของครบแล้ว — อัปเดตราคาวัตถุดิบแล้ว');
    onSaved();
  }

  return (
    <div className="w-[620px] max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {isPartialStatus ? 'รับของเพิ่ม' : 'รับของ'} — {data.po.poNumber}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{data.po.supplier.name}</p>
        </div>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <input type="hidden" {...register('id')} />

        {/* Received date */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">วันที่รับของ</label>
          <input type="date" {...register('receivedDate')} className={INPUT} />
        </div>

        {/* Line items with discrepancy */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-700">รายการสินค้า</p>
          {data.po.items.map((item, idx) => {
            const alreadyReceived = Number(item.receivedQuantity ?? 0);
            const remaining = Math.max(0, Number(item.quantity) - alreadyReceived);
            const discrepancyVal = watch(`items.${idx}.discrepancyType`);
            return (
              <div key={item.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
                <input type="hidden" {...register(`items.${idx}.id`)} value={item.id} />

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.ingredient.name}</p>
                    <p className="text-xs text-slate-500">
                      สั่ง {fmt(item.quantity)} {item.unit}
                      {alreadyReceived > 0 && (
                        <span className="ml-2 text-green-600">• รับแล้ว {fmt(alreadyReceived)}</span>
                      )}
                      {remaining > 0 && alreadyReceived > 0 && (
                        <span className="ml-2 text-orange-600">• ค้าง {fmt(remaining)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      {...register(`items.${idx}.receivedQuantity`, { valueAsNumber: true })}
                      type="number" step="0.01" min="0"
                      className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-right outline-none focus:border-slate-500"
                    />
                    <span className="text-sm text-slate-500 w-8 shrink-0">{item.unit}</span>
                  </div>
                </div>

                {/* Discrepancy */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">สถานะสินค้า</label>
                    <select
                      {...register(`items.${idx}.discrepancyType`)}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-slate-500"
                    >
                      <option value="none">ปกติ</option>
                      <option value="short">ขาด</option>
                      <option value="wrong">ผิดรายการ</option>
                      <option value="spoiled">เสียหาย</option>
                    </select>
                  </div>
                  {discrepancyVal !== 'none' && (
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">หมายเหตุ (ความผิดปกติ)</label>
                      <input
                        {...register(`items.${idx}.discrepancyNotes`)}
                        type="text"
                        placeholder="ระบุรายละเอียด"
                        className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs outline-none focus:border-amber-400"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Partial receipt toggle */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 space-y-1">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" {...register('isPartial')} className="rounded border-slate-300" />
            <span className="text-sm text-slate-700 font-medium">รับของบางส่วน (ยังไม่ครบ)</span>
          </label>
          {isPartialChecked && (
            <p className="text-xs text-orange-600 pl-6">PO จะเปลี่ยนเป็นสถานะ "รับบางส่วน" — สามารถรับเพิ่มได้ในภายหลัง</p>
          )}
          {!isPartialChecked && (
            <p className="text-xs text-slate-400 pl-6">PO จะเปลี่ยนเป็นสถานะ "รับของแล้ว" และอัปเดตราคาวัตถุดิบ</p>
          )}
        </div>

        {/* Tax invoice */}
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('hasTaxInvoice')} className="rounded border-slate-300" />
            <span className="text-sm text-slate-700">มีใบกำกับภาษี</span>
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
          <label className="block text-xs font-medium text-slate-700 mb-1">หมายเหตุ (ถ้ามี)</label>
          <textarea {...register('notes')} rows={2} className={`${INPUT} resize-none`} placeholder="หมายเหตุสำหรับการรับของครั้งนี้" />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="submit" disabled={isSubmitting} className={`flex-1 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50 ${isPartialChecked ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-700 hover:bg-green-800'}`}>
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
      <div className="w-[600px] rounded-xl bg-white p-10 shadow-xl flex items-center justify-center gap-2 text-slate-500">
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
      <p><b>Supplier:</b> ${po.supplier.name}</p>
      ${po.supplier.taxId ? `<p><b>เลขภาษี:</b> ${po.supplier.taxId}</p>` : ''}
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
      `Supplier: ${po.supplier.name}`,
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

  const [showReceipts, setShowReceipts] = useState(false);
  const receipts = po.goodsReceipts ?? [];

  return (
    <div className="w-[600px] max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 font-mono">{po.poNumber}</h2>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[po.status]}`}>
            {STATUS_LABEL[po.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleLineCopy}
            className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
          >
            <Copy className="size-3.5" /> คัดลอกสำหรับ LINE
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Printer className="size-3.5" /> พิมพ์
          </button>
          <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
        </div>
      </div>

      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">Supplier</p>
            <p className="font-medium text-slate-900">{po.supplier.name}</p>
            {po.supplier.taxId && <p className="text-xs text-slate-500">เลขภาษี: {po.supplier.taxId}</p>}
            {po.supplier.phone && <p className="text-xs text-slate-500">{po.supplier.phone}</p>}
          </div>
          <div>
            <p className="text-xs text-slate-500">วันที่สั่ง</p>
            <p className="font-medium">{fmtDate(po.orderDate)}</p>
            {po.expectedDate && (
              <>
                <p className="text-xs text-slate-500 mt-1">คาดรับ</p>
                <p className="font-medium">{fmtDate(po.expectedDate)}</p>
              </>
            )}
            {po.receivedDate && (
              <>
                <p className="text-xs text-slate-500 mt-1">รับแล้ว</p>
                <p className="font-medium text-green-700">{fmtDate(po.receivedDate)}</p>
              </>
            )}
          </div>
        </div>

        {/* Items table */}
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-medium text-slate-500">รายการ</th>
                <th className="px-3 py-2 text-right font-medium text-slate-500">สั่ง</th>
                {showReceived && <th className="px-3 py-2 text-right font-medium text-green-600">รับรวม</th>}
                <th className="px-3 py-2 text-right font-medium text-slate-500">ราคา/หน่วย</th>
                <th className="px-3 py-2 text-right font-medium text-slate-500">รวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {po.items.map((item) => {
                const received = Number(item.receivedQuantity ?? 0);
                const ordered = Number(item.quantity);
                const isShort = showReceived && received < ordered;
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">{item.ingredient.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(item.quantity)} {item.unit}</td>
                    {showReceived && (
                      <td className={`px-3 py-2 text-right tabular-nums ${isShort ? 'text-orange-600' : 'text-green-700'}`}>
                        {fmt(received)} {item.unit}
                        {isShort && <span className="ml-1 text-orange-400">(ขาด {fmt(ordered - received)})</span>}
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
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>ยอดก่อน VAT</span>
            <span className="tabular-nums">฿{fmt(po.subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>VAT {fmt(po.vatRate)}%</span>
            <span className="tabular-nums">฿{fmt(po.vatAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold text-sm border-t border-slate-200 pt-1">
            <span>ยอดรวม</span>
            <span className="tabular-nums">฿{fmt(po.total)}</span>
          </div>
        </div>

        {/* Tax invoice */}
        {po.hasTaxInvoice && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-xs text-green-700">
            ✓ มีใบกำกับภาษี{po.taxInvoiceNumber ? ` — เลขที่: ${po.taxInvoiceNumber}` : ''}
          </div>
        )}

        {po.notes && <p className="text-xs text-slate-500">หมายเหตุ: {po.notes}</p>}

        {/* Goods receipts history */}
        {receipts.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowReceipts((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-700">
                ประวัติการรับของ ({receipts.length} ครั้ง)
              </span>
              {showReceipts ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
            </button>
            {showReceipts && (
              <div className="divide-y divide-slate-100">
                {receipts.map((receipt) => (
                  <div key={receipt.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-700">
                        {fmtDate(receipt.receivedDate)}
                      </p>
                      <p className="text-xs text-slate-400">
                        โดย {receipt.receivedByUser?.name ?? '—'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      {receipt.items.map((ri) => {
                        const poItem = po.items.find((pi) => pi.id === ri.purchaseOrderItemId);
                        return (
                          <div key={ri.id} className="flex items-center justify-between text-xs">
                            <span className="text-slate-600">{poItem?.ingredient.name ?? '—'}</span>
                            <div className="flex items-center gap-2">
                              <span className="tabular-nums text-slate-700">
                                {fmt(ri.receivedQuantity)} {poItem?.unit}
                              </span>
                              {ri.discrepancyType !== 'none' && (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 font-medium">
                                  {DISCREPANCY_LABEL[ri.discrepancyType]}
                                  {ri.discrepancyNotes && `: ${ri.discrepancyNotes}`}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {receipt.notes && (
                      <p className="text-xs text-slate-400 italic">{receipt.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Receive more button for partial */}
        {po.status === 'partial_received' && (
          <button
            type="button"
            onClick={() => { onClose(); onReceive(po.id); }}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-orange-600 py-2.5 text-sm font-medium text-white hover:bg-orange-700"
          >
            <PackagePlus className="size-4" /> รับของเพิ่ม
          </button>
        )}

        <p className="text-xs text-slate-400">สร้างโดย: {po.createdByUser.name}</p>
      </div>
    </div>
  );
}
