'use client';

import { useState, useRef, useCallback, useId } from 'react';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import {
  ImagePlus, X, ZoomIn, ZoomOut, GripVertical,
  Plus, MoreHorizontal, UtensilsCrossed,
} from 'lucide-react';
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
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

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

type SheetState =
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
  const [sheet, setSheet] = useState<SheetState | null>(null);
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

  const sheetIsWide = sheet?.type === 'addItem' || sheet?.type === 'editItem';

  return (
    <>
      <AppShell>
        {confirmDialog}
        <PageHeader
          title="จัดการเมนู"
          subtitle="หมวดหมู่ รายการอาหาร และรูปภาพ"
          actions={
            <Button onClick={() => setSheet({ type: 'addCat' })}>
              <Plus className="size-4" />
              เพิ่มหมวด
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Category sidebar */}
          <div className="lg:col-span-1 space-y-1">
            <DndContext id={dndCatId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
              <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {categories.map((cat) => (
                  <SortableCategoryItem
                    key={cat.id}
                    cat={cat}
                    selectedCatId={selectedCatId}
                    onSelect={setSelectedCatId}
                    onEdit={(c) => setSheet({ type: 'editCat', cat: c })}
                    onDelete={(id) => openConfirm(`ลบหมวด "${cat.name}"?`, () => deleteCat(id))}
                    isDeletingCat={isDeletingCat}
                    deleteCatVar={deleteCatVar ?? null}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {categories.length === 0 && (
              <EmptyState
                icon={<UtensilsCrossed className="size-5" />}
                title="ยังไม่มีหมวด"
                description="เพิ่มหมวดแรกเพื่อเริ่มจัดการเมนู"
                size="sm"
                action={
                  <Button size="sm" onClick={() => setSheet({ type: 'addCat' })}>
                    <Plus className="size-3.5" />
                    เพิ่มหมวด
                  </Button>
                }
              />
            )}
          </div>

          {/* Items panel */}
          <div className="lg:col-span-3">
            {!selectedCat ? (
              <EmptyState
                icon={<UtensilsCrossed className="size-6" />}
                title="เลือกหมวดเพื่อจัดการเมนู"
                description="เลือกหมวดจากรายการทางซ้ายเพื่อดูและจัดการเมนูในหมวดนั้น"
              />
            ) : (
              <DataCard
                noPadding
                title={selectedCat.name}
                subtitle={STATION_LABEL[selectedCat.station]}
                actions={
                  <div className="flex items-center gap-2">
                    {!selectedCat.isActive && (
                      <StatusBadge label="ปิดใช้งาน" variant="danger" />
                    )}
                    {selectedCat.maxPerSession != null && (
                      <span className="text-xs text-muted-foreground">
                        จำกัด {selectedCat.maxPerSession} จาน/ครั้ง
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label="ตัวเลือกหมวด"
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="bottom" align="end">
                        <DropdownMenuItem onClick={() => setSheet({ type: 'editCat', cat: selectedCat })}>
                          แก้ไขหมวด
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={isTogglingCat && toggleCatVar === selectedCat.id}
                          onClick={() => toggleCat(selectedCat.id)}
                        >
                          {selectedCat.isActive ? 'ปิดการแสดง' : 'เปิดการแสดง'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      size="sm"
                      onClick={() => setSheet({ type: 'addItem', categoryId: selectedCat.id })}
                    >
                      <Plus className="size-3.5" />
                      เพิ่มเมนู
                    </Button>
                  </div>
                }
              >
                {selectedCat.menuItems.length === 0 ? (
                  <div className="p-8">
                    <EmptyState
                      icon={<UtensilsCrossed className="size-5" />}
                      title="ยังไม่มีเมนูในหมวดนี้"
                      description="เพิ่มเมนูแรกในหมวดนี้"
                      size="sm"
                      action={
                        <Button size="sm" onClick={() => setSheet({ type: 'addItem', categoryId: selectedCat.id })}>
                          <Plus className="size-3.5" />
                          เพิ่มเมนู
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <DndContext id={dndItemId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-left">
                          <th className="w-8 px-2 py-2.5" />
                          <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">เมนู</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">ประเภท</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">ราคาเพิ่ม</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-center">สถานะ</th>
                          <th className="w-10 px-2 py-2.5" />
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
                              onEdit={(it) => setSheet({ type: 'editItem', item: it, categoryId: selectedCat.id })}
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
              </DataCard>
            )}
          </div>
        </div>
      </AppShell>

      <Sheet open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null); }}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className={cn('gap-0 p-0', sheetIsWide ? 'sm:max-w-[560px]' : 'sm:max-w-[480px]')}
        >
          {sheet?.type === 'addCat' && (
            <CategoryForm
              onClose={() => setSheet(null)}
              onSaved={() => { invalidate(); setSheet(null); }}
            />
          )}
          {sheet?.type === 'editCat' && (
            <CategoryForm
              key={sheet.cat.id}
              initial={sheet.cat}
              onClose={() => setSheet(null)}
              onSaved={() => { invalidate(); setSheet(null); }}
            />
          )}
          {sheet?.type === 'addItem' && (
            <MenuItemForm
              key="new"
              categoryId={sheet.categoryId}
              onClose={() => setSheet(null)}
              onSaved={() => { invalidate(); setSheet(null); }}
            />
          )}
          {sheet?.type === 'editItem' && (
            <MenuItemForm
              key={sheet.item.id}
              categoryId={sheet.categoryId}
              initial={sheet.item}
              onClose={() => setSheet(null)}
              onSaved={() => { invalidate(); setSheet(null); }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ─── Sortable category item ─────────────────────────────────────────────── */

function SortableCategoryItem({
  cat,
  selectedCatId,
  onSelect,
  onEdit,
  onDelete,
  isDeletingCat,
  deleteCatVar,
}: {
  cat: Category;
  selectedCatId: string | null;
  onSelect: (id: string) => void;
  onEdit: (cat: Category) => void;
  onDelete: (id: string) => void;
  isDeletingCat: boolean;
  deleteCatVar: string | null;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isSelected = selectedCatId === cat.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex items-center gap-1', isDragging && 'z-10 opacity-60')}
    >
      <button
        type="button"
        aria-label="ลากย้ายหมวด"
        {...attributes}
        {...listeners}
        className="flex items-center px-1 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 cursor-grab active:cursor-grabbing touch-none transition-colors shrink-0"
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onSelect(cat.id)}
        className={cn(
          'flex-1 min-w-0 rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-150',
          isSelected
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-card border border-border text-foreground hover:bg-muted/50 hover:border-primary/30',
          !cat.isActive && 'opacity-50',
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="font-medium truncate">{cat.name}</span>
          <span className={cn('text-xs shrink-0', isSelected ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
            {cat.menuItems.length}
          </span>
        </div>
        <div className={cn('text-xs mt-0.5', isSelected ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
          {STATION_LABEL[cat.station]}
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="ตัวเลือกหมวด"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-muted-foreground"
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem onClick={() => onEdit(cat)}>
            แก้ไขหมวด
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={isDeletingCat && deleteCatVar === cat.id}
            onClick={() => onDelete(cat.id)}
          >
            ลบหมวด
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
      className={cn(
        'hover:bg-muted/30 transition-colors',
        !item.isAvailable && 'opacity-60',
        isDragging && 'opacity-60 bg-muted/40',
      )}
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
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <UtensilsCrossed className="size-3.5 text-muted-foreground/40" />
            </div>
          )}
          <span className="font-medium text-foreground truncate">{item.name}</span>
        </div>
      </td>
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
          className="disabled:opacity-50"
        >
          <StatusBadge
            label={isTogglingItem && toggleItemVar === item.id ? '…' : item.isAvailable ? 'มีสินค้า' : 'หมด'}
            variant={item.isAvailable ? 'success' : 'neutral'}
          />
        </button>
      </td>
      <td className="px-2 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="ตัวเลือก"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            <DropdownMenuItem onClick={() => onEdit(item)}>
              แก้ไข
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isDeletingItem && deleteItemVar === item.id}
              onClick={() => onDelete(item)}
            >
              ลบเมนู
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <h2 className="text-sm font-semibold text-foreground">
          {initial ? 'แก้ไขหมวด' : 'เพิ่มหมวด'}
        </h2>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
      <form
        id="cat-form"
        onSubmit={handleSubmit(onSubmit)}
        className="flex-1 overflow-y-auto p-5 space-y-4"
      >
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
      </form>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" form="cat-form" disabled={isSubmitting}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </Button>
      </div>
    </div>
  );
}

/* ─── Image utilities ────────────────────────────────────────────────────── */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (e) => res(e.target!.result as string);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

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

/* ─── Menu item form ─────────────────────────────────────────────────────── */

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

  /* ── Crop screen takes over the Sheet body ── */
  if (cropSrc) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <h2 className="text-sm font-semibold text-foreground">ครอบรูป</h2>
          <button
            type="button"
            aria-label="ยกเลิกครอบรูป"
            onClick={() => setCropSrc(null)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="relative flex-1 min-h-[300px] bg-neutral-800">
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
        <div className="shrink-0 space-y-3 border-t border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setZoom(z => Math.max(1, z - 0.1))} className="text-muted-foreground hover:text-foreground transition-colors">
              <ZoomOut className="size-4" />
            </button>
            <input
              type="range" min={1} max={3} step={0.05} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-slate-800"
            />
            <button type="button" onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="text-muted-foreground hover:text-foreground transition-colors">
              <ZoomIn className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">สัดส่วน:</span>
            {ASPECT_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setAspect(opt.value)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  aspect === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border text-muted-foreground hover:bg-muted/30',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setCropSrc(null)}>
              ยกเลิก
            </Button>
            <Button type="button" className="flex-1" disabled={isUploading} onClick={handleCropConfirm}>
              {isUploading ? 'กำลังอัปโหลด…' : 'ยืนยัน'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Normal form ── */
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <h2 className="text-sm font-semibold text-foreground">
          {initial ? 'แก้ไขเมนู' : 'เพิ่มเมนู'}
        </h2>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
      <form
        id="item-form"
        onSubmit={handleSubmit(onSubmit)}
        className="flex-1 overflow-y-auto p-5 space-y-4"
      >
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
        <Field label="รูปเมนู">
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
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-6 text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
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
      </form>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" form="item-form" disabled={isSubmitting}>
          {isSubmitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </Button>
      </div>
    </div>
  );
}

/* ─── Shared helpers ─────────────────────────────────────────────────────── */

const INPUT = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
