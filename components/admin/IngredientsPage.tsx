'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MoreHorizontal, Package, Plus, Search, SlidersHorizontal, MapPin, Layers, Ruler, Boxes, Truck, X } from 'lucide-react';
import type { Resolver, Control, FieldPath } from 'react-hook-form';
import { cn } from '@/lib/utils';
import {
  getIngredientPageData,
  createIngredient,
  updateIngredient,
  toggleIngredientActive,
  deleteIngredient,
  type IngredientPageData,
  type IngredientRow,
} from '@/lib/actions/inventory';
import {
  createIngredientSchema,
  updateIngredientSchema,
  type CreateIngredientInput,
  type UpdateIngredientInput,
} from '@/lib/validations/inventory';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DataCard } from '@/components/ui/section-card';
import { DataTable } from '@/components/ui/data-table';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const COMMON_UNITS = ['กก.', 'กรัม', 'ลิตร', 'มล.', 'ชิ้น', 'แพ็ค', 'ขวด', 'ลัง', 'ถุง'];

type SheetState =
  | { type: 'add' }
  | { type: 'edit'; ingredient: IngredientRow };

type StatusFilter = 'all' | 'active' | 'inactive';

interface Props {
  initialData: IngredientPageData;
}

function fmt(n: string | number, digits = 2) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function getCategoryName(data: IngredientPageData, categoryId: string) {
  return data.categories.find((cat) => cat.id === categoryId)?.name ?? 'ไม่ระบุหมวด';
}

export function IngredientsPage({ initialData }: Props) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const qc = useQueryClient();
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  const { data = initialData, isFetching } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => {
      const r = await getIngredientPageData();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ingredients'] });

  const { mutate: doToggle, isPending: isToggling, variables: toggleVar } = useMutation({
    mutationFn: (id: string) => toggleIngredientActive(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else invalidate();
    },
  });

  const { mutate: doDelete } = useMutation({
    mutationFn: (id: string) => deleteIngredient(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else { toast.success('ลบวัตถุดิบแล้ว'); invalidate(); }
    },
  });

  function confirmDelete(ing: IngredientRow) {
    openConfirm(
      `ลบวัตถุดิบ “${ing.name}” ? หากวัตถุดิบเคยถูกใช้ในการนับสต็อก ใบสั่งซื้อ หรือสูตรอาหาร จะลบไม่ได้ — ให้ปิดใช้งานแทน`,
      () => doDelete(ing.id),
      { confirmLabel: 'ลบวัตถุดิบ', variant: 'danger' },
    );
  }

  const filteredIngredients = useMemo(() => {
    const q = search.toLowerCase().trim();
    return data.ingredients.filter((ing) => {
      const supplierName = ing.defaultSupplier?.name?.toLowerCase() ?? '';
      const matchSearch = !q || ing.name.toLowerCase().includes(q) || supplierName.includes(q);
      const matchCategory = catFilter === 'all' || ing.categoryId === catFilter;
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? ing.isActive : !ing.isActive);
      return matchSearch && matchCategory && matchStatus;
    });
  }, [data.ingredients, search, catFilter, statusFilter]);

  const hasFilters = search.trim() !== '' || catFilter !== 'all' || statusFilter !== 'all';
  const activeCount = data.ingredients.filter((ing) => ing.isActive).length;
  const inactiveCount = data.ingredients.length - activeCount;

  const columns = [
    {
      key: 'ingredient',
      header: 'วัตถุดิบ',
      render: (ing: IngredientRow) => {
        const yieldPct = Number(ing.yieldPercent ?? 100);
        const isWeekly = ing.countFrequency === 'weekly';
        return (
          <div className="min-w-[220px]">
            <p className="font-medium text-foreground">{ing.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge
                label={isWeekly ? 'รายสัปดาห์' : 'รายวัน'}
                variant={isWeekly ? 'purple' : 'info'}
              />
              {yieldPct < 100 && <StatusBadge label={`yield ${yieldPct}%`} variant="warning" />}
              {ing.storageLocation && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <MapPin className="size-3" />
                  {ing.storageLocation}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'category',
      header: 'หมวด',
      render: (ing: IngredientRow) => (
        <span className="text-[12px] text-muted-foreground">{getCategoryName(data, ing.categoryId)}</span>
      ),
    },
    {
      key: 'unit',
      header: 'หน่วย',
      render: (ing: IngredientRow) => (
        <div>
          <p className="text-[13px] font-medium text-foreground">{ing.unit}</p>
          {ing.orderUnit && ing.orderUnit !== ing.unit && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              สั่ง: {ing.orderUnit} (x{ing.orderUnitConversion})
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'lastCost',
      header: 'ราคาล่าสุด',
      align: 'right' as const,
      render: (ing: IngredientRow) => (
        <span className="tabular-nums text-foreground">
          {Number(ing.lastCost) > 0 ? `฿${fmt(ing.lastCost)}` : '—'}
        </span>
      ),
    },
    {
      key: 'levels',
      header: 'จุดสั่งซื้อ / Par',
      align: 'right' as const,
      render: (ing: IngredientRow) => (
        <div className="text-right tabular-nums">
          <p className="text-[13px] text-foreground">
            {Number(ing.minStock) > 0 ? `${fmt(ing.minStock, 0)} ${ing.unit}` : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Par {Number(ing.parLevel) > 0 ? `${fmt(ing.parLevel, 0)} ${ing.unit}` : '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier หลัก',
      render: (ing: IngredientRow) => (
        <span className="text-[12px] text-muted-foreground">{ing.defaultSupplier?.name ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'สถานะ',
      align: 'center' as const,
      render: (ing: IngredientRow) => (
        <StatusBadge
          label={isToggling && toggleVar === ing.id ? 'กำลังเปลี่ยน' : ing.isActive ? 'เปิด' : 'ปิด'}
          variant={ing.isActive ? 'success' : 'neutral'}
          dot
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      render: (ing: IngredientRow) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`ตัวเลือก ${ing.name}`}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSheet({ type: 'edit', ingredient: ing })}>
              แก้ไข
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isToggling && toggleVar === ing.id}
              onClick={() => doToggle(ing.id)}
            >
              {ing.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => confirmDelete(ing)}>
              ลบ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="วัตถุดิบ"
        subtitle={`${data.ingredients.length.toLocaleString('th-TH')} รายการ · เปิดใช้งาน ${activeCount.toLocaleString('th-TH')} รายการ`}
        actions={
          <Button onClick={() => setSheet({ type: 'add' })}>
            <Plus className="size-4" />
            เพิ่มวัตถุดิบ
          </Button>
        }
      />

      <DataCard title="ค้นหาและตัวกรอง" subtitle="กรองตามชื่อวัตถุดิบ หมวดหมู่ และสถานะ">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="ค้นหาวัตถุดิบหรือ Supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-px rounded-lg bg-muted p-1">
              {([
                ['all', `ทั้งหมด ${data.ingredients.length}`],
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
              <Button
                type="button"
                variant="outline"
                onClick={() => { setSearch(''); setCatFilter('all'); setStatusFilter('all'); }}
              >
                ล้างตัวกรอง
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCatFilter('all')}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              catFilter === 'all'
                ? 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]'
                : 'border-border bg-[var(--surface-1)] text-muted-foreground hover:text-foreground',
            )}
          >
            ทั้งหมด ({data.ingredients.length})
          </button>
          {data.categories.map((cat) => {
            const count = data.ingredients.filter((ing) => ing.categoryId === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCatFilter(cat.id === catFilter ? 'all' : cat.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  catFilter === cat.id
                    ? 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]'
                    : 'border-border bg-[var(--surface-1)] text-muted-foreground hover:text-foreground',
                )}
              >
                {cat.name} ({count})
              </button>
            );
          })}
        </div>
      </DataCard>

      <DataCard
        noPadding
        title="รายการวัตถุดิบ"
        subtitle={`${filteredIngredients.length.toLocaleString('th-TH')} รายการที่แสดง`}
        actions={isFetching ? <StatusBadge label="กำลังอัปเดต" variant="info" dot size="md" /> : null}
      >
        <DataTable
          columns={columns}
          rows={filteredIngredients}
          keyFn={(ing) => ing.id}
          loading={false}
          rowClassName={(ing) => (!ing.isActive ? 'opacity-60' : '')}
          emptyState={
            <EmptyState
              icon={<Package className="size-5" />}
              title={hasFilters ? 'ไม่พบวัตถุดิบที่ตรงกัน' : 'ยังไม่มีวัตถุดิบ'}
              description={hasFilters ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรองหมวดหมู่' : 'เพิ่มวัตถุดิบแรกเพื่อเริ่มจัดการสต็อก'}
              size="sm"
              action={
                hasFilters ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setSearch(''); setCatFilter('all'); setStatusFilter('all'); }}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    ล้างตัวกรอง
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={() => setSheet({ type: 'add' })}>
                    <Plus className="size-3.5" />
                    เพิ่มวัตถุดิบ
                  </Button>
                )
              }
            />
          }
        />
      </DataCard>

      <Dialog open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null); }}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl"
        >
          {sheet && (
            <IngredientForm
              key={sheet.type === 'edit' ? sheet.ingredient.id : 'new'}
              initial={sheet.type === 'edit' ? sheet.ingredient : undefined}
              categories={data.categories}
              suppliers={data.suppliers}
              onClose={() => setSheet(null)}
              onSaved={() => { invalidate(); setSheet(null); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </AppShell>
  );
}

function IngredientForm({
  initial,
  categories,
  suppliers,
  onClose,
  onSaved,
}: {
  initial?: IngredientRow;
  categories: IngredientPageData['categories'];
  suppliers: IngredientPageData['suppliers'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const schema = initial ? updateIngredientSchema : createIngredientSchema;
  type FormValues = CreateIngredientInput | UpdateIngredientInput;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: initial
      ? {
          id: initial.id,
          categoryId: initial.categoryId,
          name: initial.name,
          unit: initial.unit,
          minStock: Number(initial.minStock),
          parLevel: Number(initial.parLevel),
          lastCost: Number(initial.lastCost),
          defaultSupplierId: initial.defaultSupplierId ?? '',
          countFrequency: (initial.countFrequency ?? 'daily') as 'daily' | 'weekly',
          yieldPercent: Number(initial.yieldPercent ?? 100),
          orderUnit: initial.orderUnit ?? '',
          orderUnitConversion: Number(initial.orderUnitConversion ?? 1),
          storageLocation: initial.storageLocation ?? '',
          notes: initial.notes ?? '',
        }
      : {
          minStock: 0,
          parLevel: 0,
          lastCost: 0,
          defaultSupplierId: '',
          countFrequency: 'daily' as const,
          yieldPercent: 100,
          orderUnitConversion: 1,
          orderUnit: '',
          storageLocation: '',
        },
  });

  async function onSubmit(data: FormValues) {
    const result = initial ? await updateIngredient(data) : await createIngredient(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขวัตถุดิบแล้ว' : 'เพิ่มวัตถุดิบแล้ว');
    onSaved();
  }

  const ctrl = control as Control<FormValues>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Package className="size-5" />
          </div>
          <div className="space-y-0.5">
            <DialogTitle>{initial ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'}</DialogTitle>
            <DialogDescription>ตั้งค่าหน่วยนับ จุดสั่งซื้อ Supplier และข้อมูลสำหรับนับสต็อก</DialogDescription>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] px-6 py-5">
        {initial && (
          <input type="hidden" {...register('id' as keyof FormValues)} />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Basic info — spans full width */}
          <SectionBox icon={<Layers className="size-3.5" />} title="ข้อมูลพื้นฐาน" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ชื่อวัตถุดิบ" htmlFor="ing-name" required error={errors.name?.message} className="sm:col-span-2">
                <Input id="ing-name" {...register('name')} placeholder="เช่น เนื้อวัวสไลซ์" />
              </Field>

              <Field label="หมวด" htmlFor="ing-category" required error={errors.categoryId?.message}>
                <Controller
                  control={ctrl}
                  name={'categoryId' as FieldPath<FormValues>}
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : null}
                      onValueChange={(v) => field.onChange(v ?? '')}
                    >
                      <SelectTrigger id="ing-category" className="h-9 w-full">
                        <SelectValue placeholder="เลือกหมวด">
                          {(v) => categories.find((c) => c.id === v)?.name ?? 'เลือกหมวด'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="หน่วยนับ (สต็อก)" htmlFor="ing-unit" required error={errors.unit?.message}>
                <Controller
                  control={ctrl}
                  name={'unit' as FieldPath<FormValues>}
                  render={({ field }) => {
                    const current = field.value ? String(field.value) : '';
                    const options = COMMON_UNITS.includes(current) || !current
                      ? COMMON_UNITS
                      : [current, ...COMMON_UNITS];
                    return (
                      <Select
                        value={current || null}
                        onValueChange={(v) => field.onChange(v ?? '')}
                      >
                        <SelectTrigger id="ing-unit" className="h-9 w-full">
                          <SelectValue placeholder="เลือกหน่วยนับ" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  }}
                />
              </Field>
            </div>
          </SectionBox>

          {/* Levels & price — spans full width */}
          <SectionBox icon={<Ruler className="size-3.5" />} title="ระดับสต็อกและราคา" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="จุดสั่งซื้อ" htmlFor="ing-minstock" error={errors.minStock?.message} hint="แจ้งเตือนเมื่อต่ำกว่า">
                <Input
                  id="ing-minstock"
                  {...register('minStock', { valueAsNumber: true })}
                  type="number" step="0.01" min="0" placeholder="0"
                />
              </Field>
              <Field label="ระดับที่ควรมี" htmlFor="ing-parlevel" hint="Par level ที่ต้องเติมถึง">
                <Input
                  id="ing-parlevel"
                  {...register('parLevel', { valueAsNumber: true })}
                  type="number" step="0.01" min="0" placeholder="0"
                />
              </Field>
              <Field label="ราคาล่าสุด (฿)" htmlFor="ing-lastcost" hint="ต่อ 1 หน่วยนับสต็อก">
                <Input
                  id="ing-lastcost"
                  {...register('lastCost', { valueAsNumber: true })}
                  type="number" step="0.01" min="0" placeholder="0.00"
                />
              </Field>
            </div>
          </SectionBox>

          {/* Stock management */}
          <SectionBox icon={<Boxes className="size-3.5" />} title="การจัดการสต็อก">
            <div className="space-y-4">
              <Field label="ความถี่การนับ" htmlFor="ing-freq">
                <Controller
                  control={ctrl}
                  name={'countFrequency' as FieldPath<FormValues>}
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : 'daily'}
                      onValueChange={(v) => field.onChange(v ?? 'daily')}
                    >
                      <SelectTrigger id="ing-freq" className="h-9 w-full">
                        <SelectValue>
                          {(v) => (v === 'weekly' ? 'รายสัปดาห์ (C — ของแห้ง)' : 'รายวัน (A/B — สด / ราคาสูง)')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">รายวัน (A/B — สด / ราคาสูง)</SelectItem>
                        <SelectItem value="weekly">รายสัปดาห์ (C — ของแห้ง)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field
                label="Yield (%)"
                htmlFor="ing-yield"
                labelSuffix="— สูญเสียจากการเตรียม"
                hint="100% = ไม่มีสูญเสีย, 80% = เตรียมแล้วเหลือ 80%"
              >
                <Input
                  id="ing-yield"
                  {...register('yieldPercent', { valueAsNumber: true })}
                  type="number" step="1" min="0" max="100" placeholder="100"
                />
              </Field>
            </div>
          </SectionBox>

          {/* Order unit */}
          <SectionBox
            icon={<Truck className="size-3.5" />}
            title="หน่วยสั่งซื้อ"
            titleSuffix="(ถ้าต่างจากหน่วยนับสต็อก)"
          >
            <div className="space-y-4">
              <Field label="หน่วยสั่งซื้อ" htmlFor="ing-orderunit">
                <Input
                  id="ing-orderunit"
                  {...register('orderUnit' as keyof FormValues)}
                  placeholder="เช่น ลัง, ถุง 5กก."
                />
              </Field>
              <Field
                label="จำนวน (หน่วยสต็อก) ต่อ 1 หน่วยสั่งซื้อ"
                htmlFor="ing-orderconv"
                hint="เช่น 1 ลัง = 12 ขวด → ใส่ 12"
              >
                <Input
                  id="ing-orderconv"
                  {...register('orderUnitConversion', { valueAsNumber: true })}
                  type="number" step="0.001" min="0.001" placeholder="1"
                />
              </Field>
            </div>
          </SectionBox>

          {/* Storage & supplier — spans full width */}
          <SectionBox icon={<MapPin className="size-3.5" />} title="ที่จัดเก็บและ Supplier" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ที่จัดเก็บ" htmlFor="ing-storage" labelSuffix="(ถ้ามี)">
                <Input
                  id="ing-storage"
                  {...register('storageLocation' as keyof FormValues)}
                  placeholder="เช่น ตู้เย็น A, ชั้น 2"
                />
              </Field>
              <Field label="Supplier หลัก" htmlFor="ing-supplier">
                <Controller
                  control={ctrl}
                  name={'defaultSupplierId' as FieldPath<FormValues>}
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : 'none'}
                      onValueChange={(v) => field.onChange(v === 'none' || v == null ? '' : v)}
                    >
                      <SelectTrigger id="ing-supplier" className="h-9 w-full">
                        <SelectValue>
                          {(v) => (v && v !== 'none' ? (suppliers.find((s) => s.id === v)?.name ?? '— ไม่ระบุ —') : '— ไม่ระบุ —')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— ไม่ระบุ —</SelectItem>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          </SectionBox>

          {/* Notes — spans full width */}
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="ing-notes" className="text-xs text-muted-foreground">หมายเหตุ</Label>
            <Textarea
              id="ing-notes"
              {...register('notes')}
              placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
              className="resize-none"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-[var(--surface-1)] px-6 py-4">
        <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'กำลังบันทึก...' : 'บันทึก'}
        </Button>
      </div>
    </form>
  );
}

function SectionBox({
  icon,
  title,
  titleSuffix,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  titleSuffix?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-[var(--surface-0)] p-4 shadow-[var(--shadow-card)]', className)}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>
        <p className="text-sm font-semibold text-foreground">
          {title}
          {titleSuffix && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{titleSuffix}</span>}
        </p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  labelSuffix,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  labelSuffix?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {labelSuffix && <span className="ml-1 font-normal text-muted-foreground/70">{labelSuffix}</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
