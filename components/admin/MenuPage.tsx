'use client';

import { useState, useRef } from 'react';
import { Trash2, ImagePlus, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  getMenuCRUDData,
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryActive,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleMenuItemAvailable,
} from '@/lib/actions/menu';
import {
  createCategorySchema,
  updateCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
  type CreateMenuItemInput,
  type UpdateMenuItemInput,
} from '@/lib/validations/menu';
import type { MenuCRUDData } from '@/lib/actions/menu';

const STATION_LABEL: Record<string, string> = {
  meat: 'เนื้อสัตว์',
  seafood: 'อาหารทะเล',
  vegetable: 'ผัก',
  noodle: 'เส้น',
  dessert: 'ของหวาน',
  drink: 'เครื่องดื่ม',
  sauce: 'ซอส',
};

const STATIONS = Object.entries(STATION_LABEL) as [string, string][];

type Category = MenuCRUDData[number];
type Item = Category['menuItems'][number];

interface MenuPageProps {
  initialData: MenuCRUDData;
}

type Modal =
  | { type: 'addCat' }
  | { type: 'editCat'; cat: Category }
  | { type: 'addItem'; categoryId: string }
  | { type: 'editItem'; item: Item; categoryId: string };

export function MenuPage({ initialData }: MenuPageProps) {
  const [selectedCatId, setSelectedCatId] = useState<string | null>(
    initialData[0]?.id ?? null,
  );
  const [modal, setModal] = useState<Modal | null>(null);
  const queryClient = useQueryClient();

  const { data: categories = [] } = useQuery({
    queryKey: ['menu-crud'],
    queryFn: () => getMenuCRUDData().then((r) => (r.ok ? r.data : [])),
    initialData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['menu-crud'] });

  const { mutate: toggleCat } = useMutation({
    mutationFn: (id: string) => toggleCategoryActive(id),
    onSuccess: (r) => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  const { mutate: toggleItem } = useMutation({
    mutationFn: (id: string) => toggleMenuItemAvailable(id),
    onSuccess: (r) => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  const { mutate: deleteCat } = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: (r, id) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบหมวดแล้ว');
      if (selectedCatId === id) setSelectedCatId(null);
      invalidate();
    },
  });

  const { mutate: deleteItem } = useMutation({
    mutationFn: (id: string) => deleteMenuItem(id),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบเมนูแล้ว');
      invalidate();
    },
  });

  const selectedCat = categories.find((c) => c.id === selectedCatId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">จัดการเมนู</h1>
        <button
          type="button"
          onClick={() => setModal({ type: 'addCat' })}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          + เพิ่มหมวด
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Category list */}
        <div className="lg:col-span-1 space-y-1">
          {categories.map((cat) => (
            <div key={cat.id} className="group relative">
              <button
                type="button"
                onClick={() => setSelectedCatId(cat.id)}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  selectedCatId === cat.id
                    ? 'bg-slate-800 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                } ${!cat.isActive ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-1 pr-5">
                  <span className="font-medium truncate">{cat.name}</span>
                  <span className={`text-xs shrink-0 ${selectedCatId === cat.id ? 'text-slate-300' : 'text-slate-400'}`}>
                    {cat.menuItems.length}
                  </span>
                </div>
                <span className={`text-xs ${selectedCatId === cat.id ? 'text-slate-300' : 'text-slate-400'}`}>
                  {STATION_LABEL[cat.station]}
                </span>
              </button>
              <button
                type="button"
                aria-label="ลบหมวด"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`ลบหมวด "${cat.name}"?`)) deleteCat(cat.id);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center h-6 w-6 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">ยังไม่มีหมวด</p>
          )}
        </div>

        {/* Items panel */}
        <div className="lg:col-span-3">
          {selectedCat ? (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-900">{selectedCat.name}</span>
                  <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                    {STATION_LABEL[selectedCat.station]}
                  </span>
                  {!selectedCat.isActive && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">ปิดใช้งาน</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModal({ type: 'editCat', cat: selectedCat })}
                    className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-1"
                  >
                    แก้ไขหมวด
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCat(selectedCat.id)}
                    className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-1"
                  >
                    {selectedCat.isActive ? 'ปิด' : 'เปิด'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ type: 'addItem', categoryId: selectedCat.id })}
                    className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    + เพิ่มเมนู
                  </button>
                </div>
              </div>

              {selectedCat.menuItems.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">ยังไม่มีเมนูในหมวดนี้</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left">
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">ชื่อเมนู</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">ประเภท</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">ราคาเพิ่ม</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">สถานะ</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedCat.menuItems.map((item) => (
                      <tr key={item.id} className={`hover:bg-slate-50 ${!item.isAvailable ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {item.isBuffet ? 'บุฟเฟ่ต์' : 'พิเศษ'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {Number(item.extraPrice) > 0 ? `+฿${Number(item.extraPrice).toLocaleString('th-TH')}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleItem(item.id)}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              item.isAvailable
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            {item.isAvailable ? 'มี' : 'หมด'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'editItem', item, categoryId: selectedCat.id })}
                              className="text-xs text-slate-400 hover:text-slate-700"
                            >
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              aria-label="ลบเมนู"
                              onClick={() => { if (confirm(`ลบ "${item.name}"?`)) deleteItem(item.id); }}
                              className="text-slate-300 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-300">
              <p className="text-sm text-slate-400">เลือกหมวดเพื่อจัดการเมนู</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            {(modal.type === 'addCat') && (
              <CategoryForm
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {(modal.type === 'editCat') && (
              <CategoryForm
                initial={modal.cat}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {(modal.type === 'addItem') && (
              <MenuItemForm
                categoryId={modal.categoryId}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
            {(modal.type === 'editItem') && (
              <MenuItemForm
                categoryId={modal.categoryId}
                initial={modal.item}
                onClose={() => setModal(null)}
                onSaved={() => { invalidate(); setModal(null); }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Category;
  onClose: () => void;
  onSaved: () => void;
}) {
  const schema = initial ? updateCategorySchema : createCategorySchema;
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<
    CreateCategoryInput | UpdateCategoryInput
  >({
    resolver: zodResolver(schema) as Resolver<CreateCategoryInput | UpdateCategoryInput>,
    defaultValues: initial
      ? { id: initial.id, name: initial.name, sortOrder: initial.sortOrder, station: initial.station }
      : { sortOrder: 0 },
  });

  async function onSubmit(data: CreateCategoryInput | UpdateCategoryInput) {
    const result = initial ? await updateCategory(data) : await createCategory(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขหมวดแล้ว' : 'เพิ่มหมวดแล้ว');
    onSaved();
  }

  return (
    <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{initial ? 'แก้ไขหมวด' : 'เพิ่มหมวด'}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <Field label="ชื่อหมวด" error={errors.name?.message}>
          <input {...register('name')} className={INPUT} />
        </Field>
        <Field label="Station" error={(errors as Record<string, { message?: string }>).station?.message}>
          <select {...register('station')} className={INPUT}>
            <option value="">เลือก station</option>
            {STATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="ลำดับ">
          <input {...register('sortOrder', { valueAsNumber: true })} type="number" min={0} className={INPUT} />
        </Field>
        <button type="submit" disabled={isSubmitting} className={BTN}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}

/** Compress + resize an image File to a base64 data URL (max 480px wide, JPEG 80%). */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    img.onload = () => {
      const MAX = 480;
      const scale = img.width > MAX ? MAX / img.width : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function MenuItemForm({
  categoryId,
  initial,
  onClose,
  onSaved,
}: {
  categoryId: string;
  initial?: Item;
  onClose: () => void;
  onSaved: () => void;
}) {
  const schema = initial ? updateMenuItemSchema : createMenuItemSchema;
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<
    CreateMenuItemInput | UpdateMenuItemInput
  >({
    resolver: zodResolver(schema) as Resolver<CreateMenuItemInput | UpdateMenuItemInput>,
    defaultValues: initial
      ? {
          id: initial.id,
          categoryId,
          name: initial.name,
          description: initial.description ?? '',
          imageUrl: initial.imageUrl ?? null,
          isBuffet: initial.isBuffet,
          extraPrice: Number(initial.extraPrice),
          maxPerOrder: initial.maxPerOrder ?? undefined,
          cooldownSeconds: initial.cooldownSeconds,
        }
      : { categoryId, isBuffet: true, extraPrice: 0, cooldownSeconds: 0 },
  });

  const imageUrl = watch('imageUrl' as unknown as never) as unknown as string | null | undefined;
  const isBuffet = watch('isBuffet');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('ไฟล์ใหญ่เกิน 5MB'); return; }
    try {
      const dataUrl = await compressImage(file);
      setValue('imageUrl' as never, dataUrl as never);
    } catch {
      toast.error('อ่านไฟล์ไม่ได้');
    }
    e.target.value = '';
  }

  async function onSubmit(data: CreateMenuItemInput | UpdateMenuItemInput) {
    const result = initial ? await updateMenuItem(data) : await createMenuItem(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขเมนูแล้ว' : 'เพิ่มเมนูแล้ว');
    onSaved();
  }

  return (
    <div className="w-96 rounded-xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{initial ? 'แก้ไขเมนู' : 'เพิ่มเมนู'}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        {/* Image upload */}
        <Field label="รูปเมนู">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
          {imageUrl ? (
            <div className="relative w-full h-36 rounded-lg overflow-hidden border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="preview" className="w-full h-full object-cover" />
              <button
                type="button"
                aria-label="ลบรูป"
                onClick={() => setValue('imageUrl' as never, null as never)}
                className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <X className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-1.5 right-1.5 rounded-md bg-black/50 px-2 py-1 text-[11px] text-white hover:bg-black/70 transition-colors"
              >
                เปลี่ยนรูป
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-6 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors"
            >
              <ImagePlus className="size-6" />
              <span className="text-xs">คลิกเพื่ออัปโหลดรูป</span>
              <span className="text-[11px] text-slate-300">PNG, JPG ไม่เกิน 5MB</span>
            </button>
          )}
        </Field>

        <Field label="ชื่อเมนู" error={errors.name?.message}>
          <input {...register('name')} className={INPUT} />
        </Field>
        <Field label="คำอธิบาย">
          <input {...register('description')} className={INPUT} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input {...register('isBuffet')} type="checkbox" className="rounded" />
          รายการบุฟเฟ่ต์
        </label>
        {!isBuffet && (
          <Field label="ราคาพิเศษ (฿)" error={(errors as Record<string, { message?: string }>).extraPrice?.message}>
            <input {...register('extraPrice', { valueAsNumber: true })} type="number" min={0} step="0.01" className={INPUT} />
          </Field>
        )}
        <Field label="สั่งได้สูงสุด (ต่อรอบ)">
          <input {...register('maxPerOrder', { setValueAs: v => v === '' || v === null ? null : Number(v) })} type="number" min={1} placeholder="ไม่จำกัด" className={INPUT} />
        </Field>
        <Field label="Cooldown (วินาที)">
          <input {...register('cooldownSeconds', { valueAsNumber: true })} type="number" min={0} className={INPUT} />
        </Field>
        <button type="submit" disabled={isSubmitting} className={BTN}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}

const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500';
const BTN = 'w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
