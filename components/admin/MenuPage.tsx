'use client';

import { useState, useRef, useCallback, useId } from 'react';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { Trash2, ImagePlus, X, ZoomIn, ZoomOut, GripVertical } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  batchUpdateMenuItemsSortOrder,
  batchUpdateCategoriesSortOrder,
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
  const dndCatId = useId();
  const dndItemId = useId();
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

  const { mutate: toggleCat, isPending: isTogglingCat, variables: toggleCatVar } = useMutation({
    mutationFn: (id: string) => toggleCategoryActive(id),
    onSuccess: (r) => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  const { mutate: toggleItem, isPending: isTogglingItem, variables: toggleItemVar } = useMutation({
    mutationFn: (id: string) => toggleMenuItemAvailable(id),
    onSuccess: (r) => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  const { mutate: deleteCat, isPending: isDeletingCat, variables: deleteCatVar } = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: (r, id) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบหมวดแล้ว');
      if (selectedCatId === id) setSelectedCatId(null);
      invalidate();
    },
  });

  const { mutate: deleteItem, isPending: isDeletingItem, variables: deleteItemVar } = useMutation({
    mutationFn: (id: string) => deleteMenuItem(id),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบเมนูแล้ว');
      invalidate();
    },
  });

  const { mutate: batchReorderItems } = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) => batchUpdateMenuItemsSortOrder(items),
    onError: () => { toast.error('เกิดข้อผิดพลาดในการจัดเรียง'); invalidate(); },
  });

  const { mutate: batchReorderCats } = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) => batchUpdateCategoriesSortOrder(items),
    onError: () => { toast.error('เกิดข้อผิดพลาดในการจัดเรียง'); invalidate(); },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleCatDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = categories.findIndex((c) => c.id === active.id);
    const newIdx = categories.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(categories, oldIdx, newIdx);
    queryClient.setQueryData(['menu-crud'], reordered);
    batchReorderCats(reordered.map((c, i) => ({ id: c.id, sortOrder: i })));
  }

  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedCat) return;
    const items = selectedCat.menuItems;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    queryClient.setQueryData(['menu-crud'], (prev: typeof categories | undefined) =>
      prev?.map((c) => c.id === selectedCat.id ? { ...c, menuItems: reordered } : c),
    );
    batchReorderItems(reordered.map((item, i) => ({ id: item.id, sortOrder: i })));
  }

  const { openConfirm, dialog: confirmDialog } = useConfirm();

  const selectedCat = categories.find((c) => c.id === selectedCatId);

  return (
    <div className="page-shell">
      {confirmDialog}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">จัดการเมนู</h1>
        <button
          type="button"
          onClick={() => setModal({ type: 'addCat' })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <span className="text-base leading-none">+</span> เพิ่มหมวด
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Category list */}
        <div className="lg:col-span-1 space-y-1">
          <DndContext id={dndCatId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
            <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {categories.map((cat) => (
                <SortableCategoryItem
                  key={cat.id}
                  cat={cat}
                  selectedCatId={selectedCatId}
                  onSelect={setSelectedCatId}
                  onDelete={(id) => openConfirm(`ลบหมวด "${cat.name}"?`, () => deleteCat(id))}
                  isDeletingCat={isDeletingCat}
                  deleteCatVar={deleteCatVar ?? null}
                />
              ))}
            </SortableContext>
          </DndContext>
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">ยังไม่มีหมวด</p>
          )}
        </div>

        {/* Items panel */}
        <div className="lg:col-span-3">
          {selectedCat ? (
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{selectedCat.name}</span>
                  <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                    {STATION_LABEL[selectedCat.station]}
                  </span>
                  {selectedCat.maxPerSession !== null && selectedCat.maxPerSession !== undefined && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-0.5 rounded-full">
                      จำกัด {selectedCat.maxPerSession} จาน/ครั้ง
                    </span>
                  )}
                  {!selectedCat.isActive && (
                    <span className="text-xs bg-red-100 text-red-600 px-2.5 py-0.5 rounded-full">ปิดใช้งาน</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModal({ type: 'editCat', cat: selectedCat })}
                    className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
                  >
                    แก้ไขหมวด
                  </button>
                  <button
                    type="button"
                    disabled={isTogglingCat && toggleCatVar === selectedCat.id}
                    onClick={() => toggleCat(selectedCat.id)}
                    className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 disabled:opacity-50 transition-colors"
                  >
                    {isTogglingCat && toggleCatVar === selectedCat.id ? '...' : selectedCat.isActive ? 'ปิด' : 'เปิด'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ type: 'addItem', categoryId: selectedCat.id })}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    + เพิ่มเมนู
                  </button>
                </div>
              </div>

              {selectedCat.menuItems.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีเมนูในหมวดนี้</p>
              ) : (
                <DndContext id={dndItemId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left">
                        <th className="w-8 px-2 py-2.5" />
                        <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">ชื่อเมนู</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">ประเภท</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">ราคาเพิ่ม</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-center">สถานะ</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <SortableContext items={selectedCat.menuItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      <tbody className="divide-y divide-border">
                        {selectedCat.menuItems.map((item) => (
                          <SortableMenuRow
                            key={item.id}
                            item={item}
                            onToggle={toggleItem}
                            isTogglingItem={isTogglingItem}
                            toggleItemVar={toggleItemVar ?? null}
                            onEdit={(it) => setModal({ type: 'editItem', item: it, categoryId: selectedCat.id })}
                            onDelete={(it) => openConfirm(`ลบ "${it.name}"?`, () => deleteItem(it.id))}
                            isDeletingItem={isDeletingItem}
                            deleteItemVar={deleteItemVar ?? null}
                          />
                        ))}
                      </tbody>
                    </SortableContext>
                  </table>
                </DndContext>
              )}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-border">
              <p className="text-sm text-muted-foreground">เลือกหมวดเพื่อจัดการเมนู</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
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

/* ─── Sortable category item ─────────────────────────────────────────────── */

function SortableCategoryItem({
  cat,
  selectedCatId,
  onSelect,
  onDelete,
  isDeletingCat,
  deleteCatVar,
}: {
  cat: Category;
  selectedCatId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isDeletingCat: boolean;
  deleteCatVar: string | null;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isSelected = selectedCatId === cat.id;

  return (
    <div ref={setNodeRef} style={style} className={`group relative flex items-stretch gap-1 ${isDragging ? 'z-10 opacity-60' : ''}`}>
      <button
        type="button"
        aria-label="ลากย้ายหมวด"
        {...attributes}
        {...listeners}
        className="flex items-center px-1 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 cursor-grab active:cursor-grabbing touch-none transition-colors"
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onSelect(cat.id)}
        className={`flex-1 min-w-0 rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-150 ${
          isSelected
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-card border border-border text-foreground hover:bg-muted/50 hover:border-primary/30'
        } ${!cat.isActive ? 'opacity-50' : ''}`}
      >
        <div className="flex items-center justify-between gap-1 pr-4">
          <span className="font-medium truncate">{cat.name}</span>
          <span className={`text-xs shrink-0 ${isSelected ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
            {cat.menuItems.length}
          </span>
        </div>
        <div className={`flex items-center gap-2 text-xs mt-0.5 ${isSelected ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
          <span>{STATION_LABEL[cat.station]}</span>
          {cat.maxPerSession != null && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              จำกัด {cat.maxPerSession} จาน/ครั้ง
            </span>
          )}
        </div>
      </button>
      <button
        type="button"
        aria-label="ลบหมวด"
        disabled={isDeletingCat && deleteCatVar === cat.id}
        onClick={(e) => { e.stopPropagation(); onDelete(cat.id); }}
        className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

/* ─── Sortable menu item row ─────────────────────────────────────────────── */

function SortableMenuRow({
  item,
  onToggle,
  isTogglingItem,
  toggleItemVar,
  onEdit,
  onDelete,
  isDeletingItem,
  deleteItemVar,
}: {
  item: Item;
  onToggle: (id: string) => void;
  isTogglingItem: boolean;
  toggleItemVar: string | null;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  isDeletingItem: boolean;
  deleteItemVar: string | null;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`hover:bg-muted/30 transition-colors ${!item.isAvailable ? 'opacity-50' : ''} ${isDragging ? 'opacity-60 bg-muted/40' : ''}`}
    >
      <td className="w-8 px-2 py-3">
        <button
          type="button"
          aria-label="ลากย้ายเมนู"
          {...attributes}
          {...listeners}
          className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none transition-colors"
        >
          <GripVertical className="size-4" />
        </button>
      </td>
      <td className="px-4 py-3 font-medium text-foreground">{item.name}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {item.isBuffet ? 'บุฟเฟ่ต์' : 'พิเศษ'}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-foreground">
        {Number(item.extraPrice) > 0 ? `+฿${Number(item.extraPrice).toLocaleString('th-TH')}` : '—'}
      </td>
      <td className="px-4 py-3 text-center">
        <button
          type="button"
          disabled={isTogglingItem && toggleItemVar === item.id}
          onClick={() => onToggle(item.id)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-50 transition-colors ${
            item.isAvailable
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {isTogglingItem && toggleItemVar === item.id ? '...' : item.isAvailable ? 'มี' : 'หมด'}
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            แก้ไข
          </button>
          <button
            type="button"
            aria-label="ลบเมนู"
            disabled={isDeletingItem && deleteItemVar === item.id}
            onClick={() => onDelete(item)}
            className="text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ─── Category form ──────────────────────────────────────────────────────── */

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
      ? { id: initial.id, name: initial.name, sortOrder: initial.sortOrder, station: initial.station, maxPerSession: initial.maxPerSession ?? null }
      : { sortOrder: 0, maxPerSession: null },
  });

  async function onSubmit(data: CreateCategoryInput | UpdateCategoryInput) {
    const result = initial ? await updateCategory(data) : await createCategory(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขหมวดแล้ว' : 'เพิ่มหมวดแล้ว');
    onSaved();
  }

  return (
    <div className="w-80 rounded-xl bg-card border border-border p-5 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{initial ? 'แก้ไขหมวด' : 'เพิ่มหมวด'}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
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
        <Field label="จำกัดต่อครั้งที่สั่ง (จาน)" error={(errors as Record<string, { message?: string }>).maxPerSession?.message}>
          <input
            {...register('maxPerSession', { setValueAs: (v) => (v === '' || v === null || v === undefined ? null : Number(v)) })}
            type="number" min={1} placeholder="ไม่จำกัด" className={INPUT}
          />
        </Field>
        <button type="submit" disabled={isSubmitting} className={BTN}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}

/** Load an image from a data URL into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/** Read a File as a base64 data URL. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (e) => res(e.target!.result as string);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

/** Crop + compress an image given croppedAreaPixels from react-easy-crop. */
async function applyCrop(imageSrc: string, crop: Area): Promise<string> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  const MAX = 480;
  const scale = crop.width > MAX ? MAX / crop.width : 1;
  canvas.width  = Math.round(crop.width  * scale);
  canvas.height = Math.round(crop.height * scale);
  canvas.getContext('2d')!.drawImage(
    img,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, canvas.width, canvas.height,
  );
  return canvas.toDataURL('image/jpeg', 0.82);
}

const ASPECT_OPTIONS = [
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: 'อิสระ', value: undefined },
] as const;

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
          id: initial.id, categoryId,
          name: initial.name,
          nameEn: (initial as Item & { nameEn?: string }).nameEn ?? '',
          description: initial.description ?? '',
          descriptionEn: (initial as Item & { descriptionEn?: string }).descriptionEn ?? '',
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

  // Crop state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<number | undefined>(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedArea(pixels);
  }, []);

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('ไฟล์ใหญ่เกิน 5MB'); return; }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCropSrc(dataUrl);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch { toast.error('อ่านไฟล์ไม่ได้'); }
    e.target.value = '';
  }

  async function handleCropConfirm() {
    if (!cropSrc || !croppedArea) return;
    setIsUploading(true);
    try {
      const base64 = await applyCrop(cropSrc, croppedArea);
      const fetchRes = await fetch(base64);
      const blob = await fetchRes.blob();
      const form = new FormData();
      form.append('file', blob, 'image.jpg');
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: form });
      if (!uploadRes.ok) throw new Error('upload failed');
      const { url } = await uploadRes.json() as { url: string };
      setValue('imageUrl' as never, url as never);
    } catch { toast.error('อัปโหลดรูปไม่ได้'); }
    finally { setIsUploading(false); }
    setCropSrc(null);
  }

  async function onSubmit(data: CreateMenuItemInput | UpdateMenuItemInput) {
    const result = initial ? await updateMenuItem(data) : await createMenuItem(data);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(initial ? 'แก้ไขเมนูแล้ว' : 'เพิ่มเมนูแล้ว');
    onSaved();
  }

  /* ── Crop screen ── */
  if (cropSrc) {
    return (
      <div className="w-[520px] rounded-xl bg-card shadow-xl overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">ครอบรูป</h2>
          <button type="button" onClick={() => setCropSrc(null)} className="text-muted-foreground hover:text-muted-foreground">×</button>
        </div>

        {/* Crop area */}
        <div className="relative bg-primary" style={{ height: 320 }}>
          <Cropper
            image={cropSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Controls */}
        <div className="px-5 py-3 space-y-3 border-t border-border">
          {/* Zoom */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setZoom(z => Math.max(1, z - 0.1))} className="text-muted-foreground hover:text-foreground">
              <ZoomOut className="size-4" />
            </button>
            <input
              type="range" min={1} max={3} step={0.05} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-slate-800"
            />
            <button type="button" onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="text-muted-foreground hover:text-foreground">
              <ZoomIn className="size-4" />
            </button>
          </div>

          {/* Aspect ratio */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">สัดส่วน:</span>
            {ASPECT_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setAspect(opt.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  aspect === opt.value
                    ? 'bg-primary text-white'
                    : 'border border-border text-muted-foreground hover:bg-muted/30'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setCropSrc(null)} className="flex-1 rounded-lg border border-border py-2 text-sm text-foreground hover:bg-muted/30">
              ยกเลิก
            </button>
            <button type="button" onClick={handleCropConfirm} disabled={isUploading} className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">
              {isUploading ? 'กำลังอัปโหลด…' : 'ยืนยัน'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Normal form ── */
  return (
    <div className="w-[420px] rounded-xl bg-card p-5 shadow-xl max-h-[90vh] overflow-y-auto">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{initial ? 'แก้ไขเมนู' : 'เพิ่มเมนู'}</h2>
        <button type="button" aria-label="ปิด" onClick={onClose} className="text-muted-foreground hover:text-muted-foreground">×</button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        {/* Image upload */}
        <Field label="รูปเมนู">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
          {imageUrl ? (
            <div className="relative w-full h-36 rounded-lg overflow-hidden border border-border bg-muted/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="preview" className="w-full h-full object-cover" />
              <button
                type="button" aria-label="ลบรูป"
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
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-6 text-muted-foreground hover:border-border hover:text-muted-foreground transition-colors"
            >
              <ImagePlus className="size-6" />
              <span className="text-xs">คลิกเพื่ออัปโหลดรูป</span>
              <span className="text-[11px] text-muted-foreground/60">PNG, JPG ไม่เกิน 5MB</span>
            </button>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ชื่อเมนู (ไทย)" error={errors.name?.message}>
            <input {...register('name')} className={INPUT} placeholder="เช่น สันคอหมู" />
          </Field>
          <Field label="ชื่อเมนู (อังกฤษ)">
            <input {...register('nameEn' as never)} className={INPUT} placeholder="e.g. Pork Neck" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="คำอธิบาย (ไทย)">
            <input {...register('description')} className={INPUT} placeholder="เช่น 4-6 ชิ้น / จาน" />
          </Field>
          <Field label="คำอธิบาย (อังกฤษ)">
            <input {...register('descriptionEn' as never)} className={INPUT} placeholder="e.g. 4-6 slices / plate" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input {...register('isBuffet')} type="checkbox" className="rounded" />
          รายการบุฟเฟ่ต์
        </label>
        {!isBuffet && (
          <Field label="ราคาพิเศษ (฿)" error={(errors as Record<string, { message?: string }>).extraPrice?.message}>
            <input {...register('extraPrice', { valueAsNumber: true })} type="number" min={0} step="0.01" className={INPUT} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="สั่งได้สูงสุด (ต่อรอบ)">
            <input {...register('maxPerOrder', { setValueAs: v => v === '' || v === null ? null : Number(v) })} type="number" min={1} placeholder="ไม่จำกัด" className={INPUT} />
          </Field>
          <Field label="Cooldown (วินาที)">
            <input {...register('cooldownSeconds', { valueAsNumber: true })} type="number" min={0} className={INPUT} />
          </Field>
        </div>
        <button type="submit" disabled={isSubmitting} className={BTN}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </div>
  );
}

const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors';
const BTN = 'w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
