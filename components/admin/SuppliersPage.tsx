'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ExternalLink, MoreHorizontal, Plus, Search, SlidersHorizontal, Truck } from 'lucide-react';
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
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { DataCard } from '@/components/ui/section-card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
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
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type SheetState =
  | { type: 'add' }
  | { type: 'edit'; supplier: SupplierRow };

type StatusFilter = 'all' | 'active' | 'inactive';

interface Props {
  initialData: SupplierRow[];
}

export function SuppliersPage({ initialData }: Props) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const qc = useQueryClient();

  const { data: suppliers = initialData, isFetching } = useQuery({
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

  const filteredSuppliers = useMemo(() => {
    const q = search.toLowerCase().trim();
    return suppliers.filter((supplier) => {
      const matchSearch = !q || [
        supplier.name,
        supplier.contactName,
        supplier.phone,
        supplier.email,
        supplier.taxId,
      ].some((value) => value?.toLowerCase().includes(q));
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? supplier.isActive : !supplier.isActive);
      return matchSearch && matchStatus;
    });
  }, [suppliers, search, statusFilter]);

  const hasFilters = search.trim() !== '' || statusFilter !== 'all';
  const activeCount = suppliers.filter((supplier) => supplier.isActive).length;
  const inactiveCount = suppliers.length - activeCount;

  const columns = [
    {
      key: 'supplier',
      header: 'ผู้ขาย',
      render: (supplier: SupplierRow) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-foreground">{supplier.name}</p>
          {supplier.email && <p className="mt-0.5 text-[12px] text-muted-foreground">{supplier.email}</p>}
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'ผู้ติดต่อ',
      render: (supplier: SupplierRow) => (
        <span className="text-[12px] text-muted-foreground">{supplier.contactName ?? '—'}</span>
      ),
    },
    {
      key: 'phone',
      header: 'เบอร์โทร',
      render: (supplier: SupplierRow) => (
        <span className="text-[12px] text-muted-foreground">{supplier.phone ?? '—'}</span>
      ),
    },
    {
      key: 'taxId',
      header: 'เลขผู้เสียภาษี',
      render: (supplier: SupplierRow) => (
        <span className="font-mono text-[12px] text-muted-foreground">{supplier.taxId ?? '—'}</span>
      ),
    },
    {
      key: 'poCount',
      header: 'จำนวน PO',
      align: 'center' as const,
      render: (supplier: SupplierRow) => (
        <StatusBadge
          label={`${supplier.purchaseOrders.length.toLocaleString('th-TH')} ใบ`}
          variant={supplier.purchaseOrders.length > 0 ? 'info' : 'neutral'}
        />
      ),
    },
    {
      key: 'status',
      header: 'สถานะ',
      align: 'center' as const,
      render: (supplier: SupplierRow) => (
        <StatusBadge
          label={isToggling && toggleVar === supplier.id ? 'กำลังเปลี่ยน' : supplier.isActive ? 'เปิด' : 'ปิด'}
          variant={supplier.isActive ? 'success' : 'neutral'}
          dot
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      render: (supplier: SupplierRow) => (
        <div className="flex items-center justify-end gap-1.5">
          {supplier.purchaseOrders.length > 0 && (
            <Link
              href={`/inventory/orders?supplierId=${supplier.id}`}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={`ดู PO ของ ${supplier.name}`}
            >
              <ExternalLink className="size-4" />
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`ตัวเลือก ${supplier.name}`}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSheet({ type: 'edit', supplier })}>
                แก้ไข
              </DropdownMenuItem>
              {supplier.purchaseOrders.length > 0 && (
                <DropdownMenuItem>
                  <Link href={`/inventory/orders?supplierId=${supplier.id}`} className="flex w-full items-center gap-1.5">
                    ดู PO
                    <ExternalLink className="size-3.5" />
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isToggling && toggleVar === supplier.id}
                onClick={() => doToggle(supplier.id)}
              >
                {supplier.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="ผู้ขาย (Supplier)"
        subtitle={`${suppliers.length.toLocaleString('th-TH')} ราย · เปิดใช้งาน ${activeCount.toLocaleString('th-TH')} ราย`}
        actions={
          <Button onClick={() => setSheet({ type: 'add' })}>
            <Plus className="size-4" />
            เพิ่ม Supplier
          </Button>
        }
      />

      <DataCard title="ค้นหาและตัวกรอง" subtitle="ค้นหาจากชื่อผู้ขาย ผู้ติดต่อ เบอร์โทร อีเมล หรือเลขผู้เสียภาษี">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="ค้นหา Supplier..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-px rounded-lg bg-muted p-1">
              {([
                ['all', `ทั้งหมด ${suppliers.length}`],
                ['active', `เปิด ${activeCount}`],
                ['inactive', `ปิด ${inactiveCount}`],
              ] as [StatusFilter, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150',
                    statusFilter === key
                      ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {hasFilters && (
              <Button type="button" variant="outline" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
                ล้างตัวกรอง
              </Button>
            )}
          </div>
        </div>
      </DataCard>

      <DataCard
        noPadding
        title="รายการผู้ขาย"
        subtitle={`${filteredSuppliers.length.toLocaleString('th-TH')} รายที่แสดง`}
        actions={isFetching ? <StatusBadge label="กำลังอัปเดต" variant="info" dot size="md" /> : null}
      >
        <DataTable
          columns={columns}
          rows={filteredSuppliers}
          keyFn={(supplier) => supplier.id}
          loading={false}
          rowClassName={(supplier) => (!supplier.isActive ? 'opacity-60' : '')}
          emptyState={
            <EmptyState
              icon={<Truck className="size-5" />}
              title={hasFilters ? 'ไม่พบผู้ขายที่ตรงกัน' : 'ยังไม่มีผู้ขาย'}
              description={hasFilters ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ' : 'เพิ่มผู้ขายเพื่อเชื่อมโยงกับวัตถุดิบและใบสั่งซื้อ'}
              size="sm"
              action={
                hasFilters ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
                    <SlidersHorizontal className="size-3.5" />
                    ล้างตัวกรอง
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={() => setSheet({ type: 'add' })}>
                    <Plus className="size-3.5" />
                    เพิ่ม Supplier
                  </Button>
                )
              }
            />
          }
        />
      </DataCard>

      <p className="text-xs text-muted-foreground">
        คลิกไอคอนดู PO เพื่อดูประวัติการสั่งซื้อของแต่ละผู้ขาย
      </p>

      <Sheet open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null); }}>
        <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 sm:max-w-[500px]">
          {sheet && (
            <SupplierForm
              key={sheet.type === 'edit' ? sheet.supplier.id : 'new'}
              initial={sheet.type === 'edit' ? sheet.supplier : undefined}
              onClose={() => setSheet(null)}
              onSaved={() => { invalidate(); setSheet(null); }}
            />
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col">
      <SheetHeader className="border-b border-border px-5 py-4">
        <SheetTitle>{initial ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขาย'}</SheetTitle>
        <SheetDescription>ข้อมูลผู้ขายสำหรับเชื่อมโยงวัตถุดิบและใบสั่งซื้อ</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sup-contact" className="text-xs text-muted-foreground">ผู้ติดต่อ</Label>
            <Input id="sup-contact" {...register('contactName')} placeholder="ชื่อผู้ติดต่อ" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-phone" className="text-xs text-muted-foreground">เบอร์โทร</Label>
            <Input id="sup-phone" {...register('phone')} type="tel" placeholder="0xx-xxx-xxxx" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

      <SheetFooter className="border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'กำลังบันทึก...' : 'บันทึก'}
        </Button>
      </SheetFooter>
    </form>
  );
}
