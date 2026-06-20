'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MoreHorizontal, Package, Plus, Search, SlidersHorizontal, MapPin } from 'lucide-react';
import type { Resolver } from 'react-hook-form';
import { cn } from '@/lib/utils';
import {
  getIngredientPageData,
  createIngredient,
  updateIngredient,
  toggleIngredientActive,
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

const COMMON_UNITS = ['กก.', 'กรัม', 'ลิตร', 'มล.', 'ชิ้น', 'แพ็ค', 'ขวด', 'ลัง', 'ถุง'];

const SELECT_CLS = 'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

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

      <Sheet open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null); }}>
        <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 sm:max-w-[560px]">
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
        </SheetContent>
      </Sheet>
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col">
      <SheetHeader className="border-b border-border px-5 py-4">
        <SheetTitle>{initial ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'}</SheetTitle>
        <SheetDescription>ตั้งค่าหน่วยนับ จุดสั่งซื้อ Supplier และข้อมูลสำหรับนับสต็อก</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {initial && (
          <input type="hidden" {...register('id' as keyof FormValues)} />
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ing-name" className="text-xs text-muted-foreground">
            ชื่อวัตถุดิบ <span className="text-destructive">*</span>
          </Label>
          <Input id="ing-name" {...register('name')} placeholder="เช่น เนื้อวัวสไลซ์" />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ing-category" className="text-xs text-muted-foreground">
              หมวด <span className="text-destructive">*</span>
            </Label>
            <select id="ing-category" {...register('categoryId')} className={SELECT_CLS}>
              <option value="">เลือกหมวด</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ing-unit" className="text-xs text-muted-foreground">
              หน่วยนับ (สต็อก) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ing-unit"
              {...register('unit')}
              list="ing-unit-suggestions"
              placeholder="เช่น กก., ขวด"
            />
            <datalist id="ing-unit-suggestions">
              {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
            </datalist>
            {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ing-minstock" className="text-xs text-muted-foreground">จุดสั่งซื้อ</Label>
            <Input
              id="ing-minstock"
              {...register('minStock', { valueAsNumber: true })}
              type="number" step="0.01" min="0" placeholder="0"
            />
            {errors.minStock && <p className="text-xs text-destructive">{errors.minStock.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ing-parlevel" className="text-xs text-muted-foreground">ระดับที่ควรมี</Label>
            <Input
              id="ing-parlevel"
              {...register('parLevel', { valueAsNumber: true })}
              type="number" step="0.01" min="0" placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ing-lastcost" className="text-xs text-muted-foreground">ราคาล่าสุด (฿)</Label>
            <Input
              id="ing-lastcost"
              {...register('lastCost', { valueAsNumber: true })}
              type="number" step="0.01" min="0" placeholder="0.00"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground">การจัดการสต็อก</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ing-freq" className="text-xs text-muted-foreground">ความถี่การนับ</Label>
              <select id="ing-freq" {...register('countFrequency' as keyof FormValues)} className={SELECT_CLS}>
                <option value="daily">รายวัน (A/B — สด / ราคาสูง)</option>
                <option value="weekly">รายสัปดาห์ (C — ของแห้ง)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ing-yield" className="text-xs text-muted-foreground">
                Yield (%) <span className="font-normal text-muted-foreground/70">— สูญเสียจากการเตรียม</span>
              </Label>
              <Input
                id="ing-yield"
                {...register('yieldPercent', { valueAsNumber: true })}
                type="number" step="1" min="0" max="100" placeholder="100"
              />
              <p className="text-xs text-muted-foreground">100% = ไม่มีสูญเสีย, 80% = เตรียมแล้วเหลือ 80%</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground">
            หน่วยสั่งซื้อ <span className="font-normal text-muted-foreground">(ถ้าต่างจากหน่วยนับสต็อก)</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ing-orderunit" className="text-xs text-muted-foreground">หน่วยสั่งซื้อ</Label>
              <Input
                id="ing-orderunit"
                {...register('orderUnit' as keyof FormValues)}
                placeholder="เช่น ลัง, ถุง 5กก."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ing-orderconv" className="text-xs text-muted-foreground">
                จำนวน (หน่วยสต็อก) ต่อ 1 หน่วยสั่งซื้อ
              </Label>
              <Input
                id="ing-orderconv"
                {...register('orderUnitConversion', { valueAsNumber: true })}
                type="number" step="0.001" min="0.001" placeholder="1"
              />
              <p className="text-xs text-muted-foreground">เช่น 1 ลัง = 12 ขวด → ใส่ 12</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ing-storage" className="text-xs text-muted-foreground">
              ที่จัดเก็บ <span className="font-normal text-muted-foreground/70">(ถ้ามี)</span>
            </Label>
            <Input
              id="ing-storage"
              {...register('storageLocation' as keyof FormValues)}
              placeholder="เช่น ตู้เย็น A, ชั้น 2"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ing-supplier" className="text-xs text-muted-foreground">Supplier หลัก</Label>
            <select id="ing-supplier" {...register('defaultSupplierId')} className={SELECT_CLS}>
              <option value="">— ไม่ระบุ —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ing-notes" className="text-xs text-muted-foreground">หมายเหตุ</Label>
          <Textarea
            id="ing-notes"
            {...register('notes')}
            placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
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
