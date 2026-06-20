'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Truck, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { Resolver } from 'react-hook-form';
import { cn } from '@/lib/utils';
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
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
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
      <PageHeader
        title="ผู้ขาย (Supplier)"
        subtitle={`${suppliers.length} ราย`}
        actions={
          <Button onClick={() => setModal({ type: 'add' })}>
            <Plus className="size-4" />
            เพิ่ม Supplier
          </Button>
        }
      />

      <DataCard noPadding>
        {suppliers.length === 0 ? (
          <EmptyState
            icon={<Truck className="size-5" />}
            title="ยังไม่มีผู้ขาย"
            description="เพิ่มผู้ขายเพื่อเชื่อมโยงกับวัตถุดิบและใบสั่งซื้อ"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ชื่อ</TableHead>
                <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ผู้ติดต่อ</TableHead>
                <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">เบอร์โทร</TableHead>
                <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">เลขผู้เสียภาษี</TableHead>
                <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-center">จำนวน PO</TableHead>
                <TableHead className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-center">สถานะ</TableHead>
                <TableHead className="px-4 py-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow
                  key={s.id}
                  className={cn('border-border hover:bg-muted/30', !s.isActive && 'opacity-50')}
                >
                  <TableCell className="px-4 py-3">
                    <div className="font-medium text-foreground">{s.name}</div>
                    {s.email && (
                      <div className="text-xs text-muted-foreground mt-0.5">{s.email}</div>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{s.contactName ?? '—'}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{s.phone ?? '—'}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {s.taxId ?? '—'}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center font-medium text-foreground">
                    {s.purchaseOrders.length}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center">
                    <button
                      type="button"
                      disabled={isToggling && toggleVar === s.id}
                      onClick={() => doToggle(s.id)}
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50',
                        s.isActive
                          ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] hover:bg-[var(--status-success-border)]'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {isToggling && toggleVar === s.id ? '…' : s.isActive ? 'เปิด' : 'ปิด'}
                    </button>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {s.purchaseOrders.length > 0 && (
                        <Link
                          href={`/inventory/orders?supplierId=${s.id}`}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="size-3" />
                          ดู PO
                        </Link>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setModal({ type: 'edit', supplier: s })}
                      >
                        แก้ไข
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataCard>

      <p className="text-xs text-muted-foreground">
        คลิก &ldquo;ดู PO&rdquo; เพื่อดูประวัติการสั่งซื้อของแต่ละผู้ขาย
      </p>

      <Dialog open={!!modal} onOpenChange={(next) => { if (!next) setModal(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {modal?.type === 'edit' ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขาย'}
            </DialogTitle>
          </DialogHeader>
          {modal && (
            <SupplierForm
              initial={modal.type === 'edit' ? modal.supplier : undefined}
              onClose={() => setModal(null)}
              onSaved={() => { invalidate(); setModal(null); }}
            />
          )}
        </DialogContent>
      </Dialog>
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
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขข้อมูลผู้ขายแล้ว' : 'เพิ่มผู้ขายแล้ว');
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {initial && (
        <input type="hidden" {...register('id' as keyof FormValues)} />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="sup-name" className="text-xs text-muted-foreground">
          ชื่อผู้ขาย / บริษัท <span className="text-destructive">*</span>
        </Label>
        <Input id="sup-name" {...register('name')} placeholder="เช่น บริษัทเนื้อสด ABC จำกัด" />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sup-contact" className="text-xs text-muted-foreground">ผู้ติดต่อ</Label>
          <Input id="sup-contact" {...register('contactName')} placeholder="ชื่อผู้ติดต่อ" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sup-phone" className="text-xs text-muted-foreground">เบอร์โทร</Label>
          <Input id="sup-phone" {...register('phone')} type="tel" placeholder="0xx-xxx-xxxx" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sup-email" className="text-xs text-muted-foreground">อีเมล</Label>
          <Input id="sup-email" {...register('email')} type="email" placeholder="email@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sup-taxid" className="text-xs text-muted-foreground">เลขผู้เสียภาษี</Label>
          <Input id="sup-taxid" {...register('taxId')} placeholder="0105512345678" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sup-address" className="text-xs text-muted-foreground">ที่อยู่</Label>
        <Textarea
          id="sup-address"
          {...register('address')}
          placeholder="ที่อยู่สำหรับออกใบกำกับภาษี"
          className="resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sup-notes" className="text-xs text-muted-foreground">หมายเหตุ</Label>
        <Textarea
          id="sup-notes"
          {...register('notes')}
          placeholder="เช่น ส่งทุกวันจันทร์-ศุกร์ ก่อน 08:00"
          className="resize-none"
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </Button>
      </DialogFooter>
    </form>
  );
}
