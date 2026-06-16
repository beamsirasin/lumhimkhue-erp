'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Truck, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { Resolver } from 'react-hook-form';
import {
  getSupplierPageData,
  createSupplier,
  updateSupplier,
  toggleSupplierActive,
  type SupplierRow,
} from '@/lib/actions/inventory';
import {
  createSupplierSchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from '@/lib/validations/inventory';

const INPUT = 'w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';
const BTN_PRIMARY = 'w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50';

type Modal =
  | { type: 'add' }
  | { type: 'edit'; supplier: SupplierRow };

interface Props {
  initialData: SupplierRow[];
}

export function SuppliersPage({ initialData }: Props) {
  const [modal, setModal] = useState<Modal | null>(null);
  const qc = useQueryClient();

  const { data: suppliers = initialData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const r = await getSupplierPageData();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['suppliers'] });

  const { mutate: doToggle, isPending: isToggling, variables: toggleVar } = useMutation({
    mutationFn: (id: string) => toggleSupplierActive(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else invalidate();
    },
  });

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">ผู้ขาย (Supplier)</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{suppliers.length} ราย</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ type: 'add' })}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          เพิ่ม Supplier
        </button>
      </div>

      {/* Table */}
      <div className="section-card overflow-hidden">
        {suppliers.length === 0 ? (
          <div className="py-16 text-center">
            <Truck className="mx-auto size-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">ยังไม่มีผู้ขาย</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ชื่อ</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ผู้ติดต่อ</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">เบอร์โทร</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">เลขผู้เสียภาษี</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-center">จำนวน PO</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-center">สถานะ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {suppliers.map((s) => (
                  <tr
                    key={s.id}
                    className={`transition-colors hover:bg-muted/30 ${!s.isActive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{s.name}</div>
                      {s.email && (
                        <div className="text-xs text-muted-foreground mt-0.5">{s.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.contactName ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {s.taxId ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-foreground font-medium">
                        {s.purchaseOrders.length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        disabled={isToggling && toggleVar === s.id}
                        onClick={() => doToggle(s.id)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                          s.isActive
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {isToggling && toggleVar === s.id ? '…' : s.isActive ? 'เปิด' : 'ปิด'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {s.purchaseOrders.length > 0 && (
                          <Link
                            href={`/inventory/orders?supplierId=${s.id}`}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="size-3" />
                            ดู PO
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => setModal({ type: 'edit', supplier: s })}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          แก้ไข
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes row */}
      <p className="text-xs text-muted-foreground">
        คลิก &ldquo;ดู PO&rdquo; เพื่อดูประวัติการสั่งซื้อของแต่ละผู้ขาย
      </p>

      {/* Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <SupplierForm
              initial={modal.type === 'edit' ? modal.supplier : undefined}
              onClose={() => setModal(null)}
              onSaved={() => {
                invalidate();
                setModal(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SupplierForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: SupplierRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  type FormValues = CreateSupplierInput | UpdateSupplierInput;
  const schema = initial ? updateSupplierSchema : createSupplierSchema;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: initial
      ? {
          id: initial.id,
          name: initial.name,
          contactName: initial.contactName ?? '',
          phone: initial.phone ?? '',
          email: initial.email ?? '',
          address: initial.address ?? '',
          taxId: initial.taxId ?? '',
          notes: initial.notes ?? '',
        }
      : {},
  });

  async function onSubmit(data: FormValues) {
    const result = initial ? await updateSupplier(data) : await createSupplier(data);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(initial ? 'แก้ไขข้อมูลผู้ขายแล้ว' : 'เพิ่มผู้ขายแล้ว');
    onSaved();
  }

  return (
    <div className="w-[480px] max-h-[90vh] overflow-y-auto rounded-xl bg-card p-6 shadow-xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {initial ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขาย'}
        </h2>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
        >
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {initial && (
          <input
            type="hidden"
            {...register('id' as keyof FormValues)}
          />
        )}

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            ชื่อผู้ขาย / บริษัท <span className="text-red-500">*</span>
          </label>
          <input
            {...register('name')}
            placeholder="เช่น บริษัทเนื้อสด ABC จำกัด"
            className={INPUT}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">ผู้ติดต่อ</label>
            <input
              {...register('contactName')}
              placeholder="ชื่อผู้ติดต่อ"
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">เบอร์โทร</label>
            <input
              {...register('phone')}
              type="tel"
              placeholder="0xx-xxx-xxxx"
              className={INPUT}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">อีเมล</label>
            <input
              {...register('email')}
              type="email"
              placeholder="email@example.com"
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">เลขผู้เสียภาษี</label>
            <input
              {...register('taxId')}
              placeholder="0105512345678"
              className={INPUT}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">ที่อยู่</label>
          <textarea
            {...register('address')}
            rows={2}
            placeholder="ที่อยู่สำหรับออกใบกำกับภาษี"
            className={`${INPUT} resize-none`}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">หมายเหตุ</label>
          <textarea
            {...register('notes')}
            rows={2}
            placeholder="เช่น ส่งทุกวันจันทร์-ศุกร์ ก่อน 08:00"
            className={`${INPUT} resize-none`}
          />
        </div>

        <button type="submit" disabled={isSubmitting} className={BTN_PRIMARY}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}
