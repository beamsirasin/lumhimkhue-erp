'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Search, Plus, Package, MapPin } from 'lucide-react';
import type { Resolver } from 'react-hook-form';
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

const COMMON_UNITS = ['กก.', 'กรัม', 'ลิตร', 'มล.', 'ชิ้น', 'แพ็ค', 'ขวด', 'ลัง', 'ถุง'];

const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500';
const BTN_PRIMARY = 'w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';

type Modal =
  | { type: 'add' }
  | { type: 'edit'; ingredient: IngredientRow };

interface Props {
  initialData: IngredientPageData;
  initialDataUpdatedAt: number;
}

export function IngredientsPage({ initialData, initialDataUpdatedAt }: Props) {
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
    initialDataUpdatedAt,
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
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">วัตถุดิบ</h1>
          <p className="text-sm text-slate-500 mt-0.5">{data.ingredients.length} รายการ</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ type: 'add' })}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <Plus className="size-4" />
          เพิ่มวัตถุดิบ
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาวัตถุดิบ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-500 max-w-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCatFilter(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !catFilter ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
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
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  catFilter === cat.id
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
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
          <div className="rounded-xl bg-white py-16 text-center shadow-sm ring-1 ring-slate-900/5">
            <Package className="mx-auto size-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">ไม่พบวัตถุดิบที่ตรงกัน</p>
          </div>
        ) : (
          grouped.map(({ category, items }) => (
            <div key={category.id} className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
              <div className="flex items-center gap-2 bg-slate-50 border-b border-slate-200 px-4 py-2.5">
                <span className="text-xs font-semibold text-slate-700">{category.name}</span>
                <span className="text-xs text-slate-400">{items.length} รายการ</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[800px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-left">
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500">ชื่อ / ความถี่</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500">หน่วย</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 text-right">ราคาล่าสุด</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 text-right">จุดสั่งซื้อ</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 text-right">ระดับเป้าหมาย</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500">Supplier หลัก</th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 text-center">สถานะ</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items.map((ing) => {
                      const yieldPct = Number(ing.yieldPercent ?? 100);
                      const isWeekly = ing.countFrequency === 'weekly';
                      return (
                        <tr
                          key={ing.id}
                          className={`transition-colors hover:bg-slate-50 ${!ing.isActive ? 'opacity-50' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{ing.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                                  isWeekly
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-blue-100 text-blue-700'
                                }`}
                              >
                                {isWeekly ? 'รายสัปดาห์' : 'รายวัน'}
                              </span>
                              {yieldPct < 100 && (
                                <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-xs text-amber-700">
                                  yield {yieldPct}%
                                </span>
                              )}
                              {ing.storageLocation && (
                                <span className="flex items-center gap-0.5 text-xs text-slate-400">
                                  <MapPin className="size-3" />{ing.storageLocation}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {ing.unit}
                            {ing.orderUnit && ing.orderUnit !== ing.unit && (
                              <p className="text-xs text-slate-400 mt-0.5">
                                สั่ง: {ing.orderUnit} (×{ing.orderUnitConversion})
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                            {Number(ing.lastCost) > 0 ? `฿${fmt(ing.lastCost)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                            {Number(ing.minStock) > 0 ? `${fmt(ing.minStock, 0)} ${ing.unit}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                            {Number(ing.parLevel) > 0 ? `${fmt(ing.parLevel, 0)} ${ing.unit}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {ing.defaultSupplier?.name ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              disabled={isToggling && toggleVar === ing.id}
                              onClick={() => doToggle(ing.id)}
                              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                ing.isActive
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                            >
                              {isToggling && toggleVar === ing.id ? '…' : ing.isActive ? 'เปิด' : 'ปิด'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'edit', ingredient: ing })}
                              className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
                            >
                              แก้ไข
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto"
          onClick={() => setModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="my-auto">
            <IngredientForm
              initial={modal.type === 'edit' ? modal.ingredient : undefined}
              categories={data.categories}
              suppliers={data.suppliers}
              onClose={() => setModal(null)}
              onSaved={() => { invalidate(); setModal(null); }}
            />
          </div>
        </div>
      )}
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
    <div className="w-[540px] max-h-[92vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {initial ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'}
        </h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {initial && (
          <input type="hidden" {...register('id' as keyof (CreateIngredientInput | UpdateIngredientInput))} />
        )}

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            ชื่อวัตถุดิบ <span className="text-red-500">*</span>
          </label>
          <input {...register('name')} placeholder="เช่น เนื้อวัวสไลซ์" className={INPUT} />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
        </div>

        {/* Category + Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              หมวด <span className="text-red-500">*</span>
            </label>
            <select {...register('categoryId')} className={INPUT}>
              <option value="">เลือกหมวด</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            {errors.categoryId && <p className="mt-1 text-xs text-red-600">{errors.categoryId.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              หน่วยนับ (สต็อก) <span className="text-red-500">*</span>
            </label>
            <input
              {...register('unit')}
              list="unit-suggestions"
              placeholder="เช่น กก., ขวด"
              className={INPUT}
            />
            <datalist id="unit-suggestions">
              {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
            </datalist>
            {errors.unit && <p className="mt-1 text-xs text-red-600">{errors.unit.message}</p>}
          </div>
        </div>

        {/* Stock levels + cost */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">จุดสั่งซื้อ</label>
            <input
              {...register('minStock', { valueAsNumber: true })}
              type="number" step="0.01" min="0" placeholder="0"
              className={INPUT}
            />
            {errors.minStock && <p className="mt-1 text-xs text-red-600">{errors.minStock.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">ระดับที่ควรมี</label>
            <input
              {...register('parLevel', { valueAsNumber: true })}
              type="number" step="0.01" min="0" placeholder="0"
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">ราคาล่าสุด (฿)</label>
            <input
              {...register('lastCost', { valueAsNumber: true })}
              type="number" step="0.01" min="0" placeholder="0.00"
              className={INPUT}
            />
          </div>
        </div>

        {/* ABC classification + yield */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-700">การจัดการสต็อก</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ความถี่การนับ</label>
              <select {...register('countFrequency' as keyof FormValues)} className={INPUT}>
                <option value="daily">รายวัน (A/B — สด / ราคาสูง)</option>
                <option value="weekly">รายสัปดาห์ (C — ของแห้ง)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Yield (%) <span className="text-slate-400 font-normal">— สูญเสียจากการเตรียม</span>
              </label>
              <input
                {...register('yieldPercent', { valueAsNumber: true })}
                type="number" step="1" min="0" max="100" placeholder="100"
                className={INPUT}
              />
              <p className="mt-1 text-xs text-slate-400">100% = ไม่มีสูญเสีย, 80% = เตรียมแล้วเหลือ 80%</p>
            </div>
          </div>
        </div>

        {/* Order unit */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-700">หน่วยสั่งซื้อ <span className="font-normal text-slate-400">(ถ้าต่างจากหน่วยนับสต็อก)</span></p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">หน่วยสั่งซื้อ</label>
              <input
                {...register('orderUnit' as keyof FormValues)}
                placeholder="เช่น ลัง, ถุง 5กก."
                className={INPUT}
              />
            </div>
            {watchedOrderUnit && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  จำนวน (หน่วยสต็อก) ต่อ 1 หน่วยสั่งซื้อ
                </label>
                <input
                  {...register('orderUnitConversion', { valueAsNumber: true })}
                  type="number" step="0.001" min="0.001" placeholder="1"
                  className={INPUT}
                />
                <p className="mt-1 text-xs text-slate-400">
                  เช่น 1 ลัง = 12 ขวด → ใส่ 12
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Storage location */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            ที่จัดเก็บ <span className="text-slate-400 font-normal">(ถ้ามี)</span>
          </label>
          <input
            {...register('storageLocation' as keyof FormValues)}
            placeholder="เช่น ตู้เย็น A, ชั้น 2, คลังแห้ง"
            className={INPUT}
          />
        </div>

        {/* Supplier */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Supplier หลัก</label>
          <select {...register('defaultSupplierId')} className={INPUT}>
            <option value="">— ไม่ระบุ —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">หมายเหตุ</label>
          <textarea
            {...register('notes')}
            rows={2}
            placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
            className={`${INPUT} resize-none`}
          />
        </div>

        <div className="flex gap-3 pt-1">
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
