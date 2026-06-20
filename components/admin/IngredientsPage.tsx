'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Search, Plus, Package, MapPin } from 'lucide-react';
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
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
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

const COMMON_UNITS = ['กก.', 'กรัม', 'ลิตร', 'มล.', 'ชิ้น', 'แพ็ค', 'ขวด', 'ลัง', 'ถุง'];

// Native select consistent with Input component styling
const SELECT_CLS = 'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

type Modal =
  | { type: 'add' }
  | { type: 'edit'; ingredient: IngredientRow };

interface Props {
  initialData: IngredientPageData;
}

export function IngredientsPage({ initialData }: Props) {
  const [modal, setModal] = useState<Modal | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data = initialData } = useQuery({
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

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    return data.categories
      .filter((cat) => !catFilter || cat.id === catFilter)
      .map((cat) => ({
        category: cat,
        items: data.ingredients.filter((ing) => {
          if (ing.categoryId !== cat.id) return false;
          if (q && !ing.name.toLowerCase().includes(q)) return false;
          return true;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [data, search, catFilter]);

  const fmt = (n: string | number, digits = 2) =>
    Number(n).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  return (
    <div className="page-shell">
      <PageHeader
        title="วัตถุดิบ"
        subtitle={`${data.ingredients.length} รายการ`}
        actions={
          <Button onClick={() => setModal({ type: 'add' })}>
            <Plus className="size-4" />
            เพิ่มวัตถุดิบ
          </Button>
        }
      />

      {/* Filters */}
      <div className="space-y-2.5">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="ค้นหาวัตถุดิบ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCatFilter(null)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              !catFilter ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted',
            )}
          >
            ทั้งหมด ({data.ingredients.length})
          </button>
          {data.categories.map((cat) => {
            const count = data.ingredients.filter((i) => i.categoryId === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCatFilter(cat.id === catFilter ? null : cat.id)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  catFilter === cat.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                )}
              >
                {cat.name} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Grouped tables */}
      <div className="space-y-4">
        {grouped.length === 0 ? (
          <EmptyState
            icon={<Package className="size-5" />}
            title="ไม่พบวัตถุดิบที่ตรงกัน"
            description="ลองเปลี่ยนคำค้นหาหรือตัวกรองหมวด"
          />
        ) : (
          grouped.map(({ category, items }) => (
            <DataCard
              key={category.id}
              noPadding
              title={category.name}
              actions={<span className="text-xs text-muted-foreground">{items.length} รายการ</span>}
            >
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="px-4 py-2.5 text-xs font-medium text-muted-foreground">ชื่อ / ความถี่</TableHead>
                    <TableHead className="px-4 py-2.5 text-xs font-medium text-muted-foreground">หน่วย</TableHead>
                    <TableHead className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">ราคาล่าสุด</TableHead>
                    <TableHead className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">จุดสั่งซื้อ</TableHead>
                    <TableHead className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">ระดับเป้าหมาย</TableHead>
                    <TableHead className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Supplier หลัก</TableHead>
                    <TableHead className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-center">สถานะ</TableHead>
                    <TableHead className="px-4 py-2.5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((ing) => {
                    const yieldPct = Number(ing.yieldPercent ?? 100);
                    const isWeekly = ing.countFrequency === 'weekly';
                    return (
                      <TableRow
                        key={ing.id}
                        className={cn('border-border hover:bg-muted/30', !ing.isActive && 'opacity-50')}
                      >
                        <TableCell className="px-4 py-3">
                          <p className="font-medium text-foreground">{ing.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusBadge
                              label={isWeekly ? 'รายสัปดาห์' : 'รายวัน'}
                              variant={isWeekly ? 'purple' : 'info'}
                            />
                            {yieldPct < 100 && (
                              <StatusBadge label={`yield ${yieldPct}%`} variant="warning" />
                            )}
                            {ing.storageLocation && (
                              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                                <MapPin className="size-3" />{ing.storageLocation}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground">
                          {ing.unit}
                          {ing.orderUnit && ing.orderUnit !== ing.unit && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              สั่ง: {ing.orderUnit} (×{ing.orderUnitConversion})
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums text-foreground">
                          {Number(ing.lastCost) > 0 ? `฿${fmt(ing.lastCost)}` : '—'}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {Number(ing.minStock) > 0 ? `${fmt(ing.minStock, 0)} ${ing.unit}` : '—'}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {Number(ing.parLevel) > 0 ? `${fmt(ing.parLevel, 0)} ${ing.unit}` : '—'}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                          {ing.defaultSupplier?.name ?? '—'}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          <button
                            type="button"
                            disabled={isToggling && toggleVar === ing.id}
                            onClick={() => doToggle(ing.id)}
                            className={cn(
                              'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50',
                              ing.isActive
                                ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] hover:bg-[var(--status-success-border)]'
                                : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                            )}
                          >
                            {isToggling && toggleVar === ing.id ? '…' : ing.isActive ? 'เปิด' : 'ปิด'}
                          </button>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setModal({ type: 'edit', ingredient: ing })}
                          >
                            แก้ไข
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DataCard>
          ))
        )}
      </div>

      {/* Ingredient dialog */}
      <Dialog open={!!modal} onOpenChange={(next) => { if (!next) setModal(null); }}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {modal?.type === 'edit' ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'}
            </DialogTitle>
          </DialogHeader>
          {modal && (
            <IngredientForm
              initial={modal.type === 'edit' ? modal.ingredient : undefined}
              categories={data.categories}
              suppliers={data.suppliers}
              onClose={() => setModal(null)}
              onSaved={() => { invalidate(); setModal(null); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
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
    watch,
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

  const watchedOrderUnit = watch('orderUnit' as keyof FormValues) as string;

  async function onSubmit(data: FormValues) {
    const result = initial ? await updateIngredient(data) : await createIngredient(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขวัตถุดิบแล้ว' : 'เพิ่มวัตถุดิบแล้ว');
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {initial && (
        <input type="hidden" {...register('id' as keyof (CreateIngredientInput | UpdateIngredientInput))} />
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="ing-name" className="text-xs text-muted-foreground">
          ชื่อวัตถุดิบ <span className="text-destructive">*</span>
        </Label>
        <Input id="ing-name" {...register('name')} placeholder="เช่น เนื้อวัวสไลซ์" />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      {/* Category + Unit */}
      <div className="grid grid-cols-2 gap-3">
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

      {/* Stock levels + cost */}
      <div className="grid grid-cols-3 gap-3">
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

      {/* Stock management */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground">การจัดการสต็อก</p>
        <div className="grid grid-cols-2 gap-3">
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

      {/* Order unit */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground">
          หน่วยสั่งซื้อ <span className="font-normal text-muted-foreground">(ถ้าต่างจากหน่วยนับสต็อก)</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ing-orderunit" className="text-xs text-muted-foreground">หน่วยสั่งซื้อ</Label>
            <Input
              id="ing-orderunit"
              {...register('orderUnit' as keyof FormValues)}
              placeholder="เช่น ลัง, ถุง 5กก."
            />
          </div>
          {watchedOrderUnit && (
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
          )}
        </div>
      </div>

      {/* Storage location */}
      <div className="space-y-1.5">
        <Label htmlFor="ing-storage" className="text-xs text-muted-foreground">
          ที่จัดเก็บ <span className="font-normal text-muted-foreground/70">(ถ้ามี)</span>
        </Label>
        <Input
          id="ing-storage"
          {...register('storageLocation' as keyof FormValues)}
          placeholder="เช่น ตู้เย็น A, ชั้น 2, คลังแห้ง"
        />
      </div>

      {/* Default supplier */}
      <div className="space-y-1.5">
        <Label htmlFor="ing-supplier" className="text-xs text-muted-foreground">Supplier หลัก</Label>
        <select id="ing-supplier" {...register('defaultSupplierId')} className={SELECT_CLS}>
          <option value="">— ไม่ระบุ —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="ing-notes" className="text-xs text-muted-foreground">หมายเหตุ</Label>
        <Textarea
          id="ing-notes"
          {...register('notes')}
          placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
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
