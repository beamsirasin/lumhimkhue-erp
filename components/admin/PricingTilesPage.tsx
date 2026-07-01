'use client';

import { useState, useRef, useId } from 'react';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Pencil, Trash2, GripVertical, MoreHorizontal, Upload, X, Tag, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import type { BadgeVariant } from '@/components/ui/status-badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  getPricingTiles,
  createPricingTile,
  updatePricingTile,
  togglePricingTileActive,
  deletePricingTile,
  reorderPricingTiles,
  type PricingTileRow,
} from '@/lib/actions/pricing';
import type { TileCategory, DiscountType } from '@/lib/validations/pricing';

/* ─── Types ──────────────────────────────────────────────────────────── */

interface TileFormState {
  code: string;
  name: string;
  category: TileCategory;
  imageUrl: string;
  price: string;
  vatIncluded: boolean;
  vatRate: string;
  discountType: DiscountType | '';
  discountValue: string;
  color: string;
  sortOrder: string;
  isActive: boolean;
  notes: string;
}

const EMPTY_FORM = (category: TileCategory): TileFormState => ({
  code: '',
  name: '',
  category,
  imageUrl: '',
  price: '0',
  vatIncluded: true,
  vatRate: '7',
  discountType: '',
  discountValue: '',
  color: '',
  sortOrder: '0',
  isActive: true,
  notes: '',
});

type SheetState =
  | { type: 'add' }
  | { type: 'edit'; tile: PricingTileRow }
  | null;

/* ─── Tab config ─────────────────────────────────────────────────────── */

const TABS: { key: TileCategory; label: string; desc: string }[] = [
  { key: 'guest',    label: 'ประเภทผู้เข้าใช้',  desc: 'ราคาบุฟเฟ่ต์ตามประเภทลูกค้า (ผู้ใหญ่ / เด็ก ฯลฯ)' },
  { key: 'addon',    label: 'ของเพิ่มเติม',       desc: 'รายการเสริมที่เก็บเพิ่ม เช่น แก้วชา ถ้วยพิเศษ' },
  { key: 'discount', label: 'ส่วนลด',             desc: 'ส่วนลดที่ใช้ตอนชำระเงิน เช่น ส่วนลด 10%' },
  { key: 'loyalty',  label: 'แลกแต้ม',            desc: 'ไทล์สำหรับแลกแต้มสะสม (หักเป็นส่วนลด)' },
  { key: 'penalty',  label: 'ค่าปรับ',            desc: 'ค่าปรับและค่าธรรมเนียมพิเศษ เช่น ค่าปรับกินเหลือ ค่าเสียหาย' },
];

const CATEGORY_VARIANT: Record<TileCategory, BadgeVariant> = {
  guest:    'info',
  addon:    'success',
  discount: 'danger',
  loyalty:  'purple',
  penalty:  'warning',
};

/* ─── Shared field input style ───────────────────────────────────────── */

const FIELD_INPUT =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/* ─── Sortable tile card ─────────────────────────────────────────────── */

interface SortableTileCardProps {
  tile: PricingTileRow;
  onEdit: (t: PricingTileRow) => void;
  onToggle: (t: PricingTileRow) => void;
  onDelete: (t: PricingTileRow) => void;
  isPending?: boolean;
}

function SortableTileCard({ tile, onEdit, onToggle, onDelete, isPending }: SortableTileCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const priceText =
    tile.category === 'discount'
      ? tile.discountType === 'percentage'
        ? `-${tile.discountValue}%`
        : `-฿${Number(tile.discountValue).toLocaleString('th-TH')}`
      : `฿${Number(tile.price).toLocaleString('th-TH')}`;

  const bg = tile.color ?? (
    tile.category === 'guest'    ? '#f0f9ff' :
    tile.category === 'addon'    ? '#f0fdf4' :
    tile.category === 'discount' ? '#fff7ed' :
    tile.category === 'penalty'  ? '#fefce8' :
    '#faf5ff'
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative flex flex-col rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] overflow-hidden transition-shadow hover:shadow-[var(--shadow-raised)]',
        !tile.isActive && 'opacity-60',
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label="ลากจัดเรียง"
        className="absolute left-1.5 top-1.5 z-10 cursor-grab rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground touch-none"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Row action menu */}
      <div className="absolute right-1.5 top-1.5 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-6 items-center justify-center rounded text-muted-foreground/40 hover:bg-black/10 hover:text-foreground transition-colors"
            aria-label="เมนูเพิ่มเติม"
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            <DropdownMenuItem onClick={() => onEdit(tile)}>
              <Pencil className="size-3.5" />
              แก้ไข
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(tile)}>
              <Trash2 className="size-3.5" />
              ลบ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Color / image preview header */}
      <div
        className="flex h-20 items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        {tile.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tile.imageUrl} alt={tile.name} className="h-14 w-14 object-contain" />
        ) : (
          <span className="text-2xl font-bold text-muted-foreground/30 select-none">
            {tile.name.charAt(0)}
          </span>
        )}
      </div>

      {/* Info body */}
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        <p className="truncate text-sm font-semibold text-foreground leading-tight">{tile.name}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{tile.code}</p>
        <p className={cn(
          'mt-0.5 text-sm font-bold',
          tile.category === 'discount'
            ? 'text-[var(--status-danger-fg)]'
            : tile.category === 'penalty'
              ? 'text-[var(--status-warning-fg)]'
              : 'text-foreground',
        )}>
          {priceText}
        </p>
        {tile.notes && (
          <p className="truncate text-[10px] text-muted-foreground">{tile.notes}</p>
        )}
      </div>

      {/* Status toggle footer */}
      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          aria-label={tile.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
          disabled={isPending}
          onClick={() => onToggle(tile)}
          className="transition-opacity disabled:opacity-50 hover:opacity-75"
        >
          <StatusBadge
            label={isPending ? '…' : tile.isActive ? 'เปิด' : 'ปิด'}
            variant={tile.isActive ? 'success' : 'neutral'}
            dot
          />
        </button>
      </div>
    </div>
  );
}

/* ─── Tile Form (Sheet-aware layout) ────────────────────────────────── */

interface TileFormProps {
  editing: PricingTileRow | null;
  defaultCategory: TileCategory;
  onClose: () => void;
  onSaved: () => void;
}

function TileForm({ editing, defaultCategory, onClose, onSaved }: TileFormProps) {
  const [form, setForm] = useState<TileFormState>(() =>
    editing
      ? {
          code: editing.code,
          name: editing.name,
          category: editing.category,
          imageUrl: editing.imageUrl ?? '',
          price: String(editing.price),
          vatIncluded: editing.vatIncluded,
          vatRate: String(editing.vatRate),
          discountType: (editing.discountType ?? '') as DiscountType | '',
          discountValue: String(editing.discountValue ?? ''),
          color: editing.color ?? '',
          sortOrder: String(editing.sortOrder),
          isActive: editing.isActive,
          notes: editing.notes ?? '',
        }
      : EMPTY_FORM(defaultCategory),
  );
  const [submitting, setSubmitting] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const setField = <K extends keyof TileFormState>(k: K, v: TileFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      toast.error('รูปภาพต้องมีขนาดไม่เกิน 500 KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setField('imageUrl', (ev.target?.result as string) ?? '');
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const payload = {
      code: form.code,
      name: form.name,
      category: form.category,
      imageUrl: form.imageUrl || undefined,
      price: Number(form.price),
      vatIncluded: form.vatIncluded,
      vatRate: Number(form.vatRate),
      discountType: form.discountType || undefined,
      discountValue: form.discountValue ? Number(form.discountValue) : undefined,
      color: form.color || undefined,
      sortOrder: Number(form.sortOrder),
      isActive: form.isActive,
      notes: form.notes || undefined,
    };

    const result = editing
      ? await updatePricingTile({ ...payload, id: editing.id })
      : await createPricingTile(payload);

    setSubmitting(false);
    if (result.ok) {
      toast.success(editing ? 'แก้ไขสำเร็จ' : 'เพิ่มสำเร็จ');
      onSaved();
      onClose();
    } else {
      toast.error(result.error);
    }
  };

  const isDiscount = form.category === 'discount';
  const isPenalty  = form.category === 'penalty';
  const canSubmit =
    !!form.code &&
    !!form.name &&
    (!isDiscount || !!form.discountType) &&
    (!isPenalty  || Number(form.price) > 0);

  const categoryInfo = TABS.find((t) => t.key === form.category);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Pinned header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2">
          <StatusBadge
            label={categoryInfo?.label ?? form.category}
            variant={CATEGORY_VARIANT[form.category]}
          />
          <h2 className="text-sm font-semibold text-foreground">
            {editing ? `แก้ไข — ${editing.name}` : 'เพิ่ม Tile ใหม่'}
          </h2>
        </div>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5">

        {/* Code + sort order */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="f-code" className="block text-[11px] font-semibold text-foreground">
              รหัส (code) <span className="text-destructive">*</span>
            </label>
            <input
              id="f-code"
              className={FIELD_INPUT}
              value={form.code}
              disabled={!!editing}
              onChange={(e) => setField('code', e.target.value)}
              placeholder={isPenalty ? 'fine_leftover' : 'adult'}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-sort" className="block text-[11px] font-semibold text-foreground">
              ลำดับ
            </label>
            <input
              id="f-sort"
              type="number"
              min={0}
              className={FIELD_INPUT}
              value={form.sortOrder}
              onChange={(e) => setField('sortOrder', e.target.value)}
            />
          </div>
        </div>

        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="f-name" className="block text-[11px] font-semibold text-foreground">
            {isPenalty ? 'ชื่อค่าปรับ' : 'ชื่อแสดงผล'} <span className="text-destructive">*</span>
          </label>
          <input
            id="f-name"
            className={FIELD_INPUT}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder={isPenalty ? 'กินเหลือ' : 'ผู้ใหญ่'}
          />
        </div>

        {/* Image upload */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-foreground">
            รูปภาพ <span className="text-muted-foreground font-normal">(ไม่บังคับ, สูงสุด 500 KB)</span>
          </p>
          <div className="flex items-center gap-3">
            {form.imageUrl ? (
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.imageUrl}
                  alt="preview"
                  className="h-14 w-14 rounded-lg object-contain border border-border bg-[var(--surface-2)]"
                />
                <button
                  type="button"
                  aria-label="ลบรูป"
                  onClick={() => setField('imageUrl', '')}
                  className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-[var(--surface-1)] border border-border shadow-sm hover:bg-[var(--status-danger-bg)] hover:border-[var(--status-danger-border)]"
                >
                  <X className="size-3 text-[var(--status-danger-fg)]" />
                </button>
              </div>
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-border bg-[var(--surface-2)]">
                <Upload className="size-5 text-muted-foreground" />
              </div>
            )}
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
            <button
              type="button"
              onClick={() => imgInputRef.current?.click()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              เลือกรูป
            </button>
          </div>
        </div>

        {/* Category-specific price/discount/penalty fields */}
        {isPenalty ? (
          <div className="space-y-1.5">
            <label htmlFor="f-penalty-amt" className="block text-[11px] font-semibold text-foreground">
              จำนวนเงิน (฿) <span className="text-destructive">*</span>
            </label>
            <input
              id="f-penalty-amt"
              type="number"
              min={0.01}
              step={0.01}
              className={FIELD_INPUT}
              value={form.price}
              onChange={(e) => setField('price', e.target.value)}
              placeholder="50"
            />
          </div>
        ) : isDiscount ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="f-dtype" className="block text-[11px] font-semibold text-foreground">
                ประเภทส่วนลด <span className="text-destructive">*</span>
              </label>
              <select
                id="f-dtype"
                value={form.discountType}
                onChange={(e) => setField('discountType', e.target.value as DiscountType | '')}
                className={FIELD_INPUT}
                disabled={!!editing}
              >
                <option value="">— เลือก —</option>
                <option value="percentage">เปอร์เซ็นต์ (%)</option>
                <option value="fixed">จำนวนเงิน (฿)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="f-dval" className="block text-[11px] font-semibold text-foreground">
                {form.discountType === 'percentage' ? 'ส่วนลด (%)' : 'ส่วนลด (฿)'}
              </label>
              <input
                id="f-dval"
                type="number"
                min={0}
                className={FIELD_INPUT}
                value={form.discountValue}
                onChange={(e) => setField('discountValue', e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="f-price" className="block text-[11px] font-semibold text-foreground">ราคา (฿)</label>
              <input
                id="f-price"
                type="number"
                min={0}
                step={0.01}
                className={FIELD_INPUT}
                value={form.price}
                onChange={(e) => setField('price', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="f-vat" className="block text-[11px] font-semibold text-foreground">VAT (%)</label>
              <input
                id="f-vat"
                type="number"
                min={0}
                max={100}
                className={FIELD_INPUT}
                value={form.vatRate}
                onChange={(e) => setField('vatRate', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Background colour */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-foreground">
            สีพื้นหลัง <span className="text-muted-foreground font-normal">(ไม่บังคับ)</span>
          </p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color || '#f8fafc'}
              onChange={(e) => setField('color', e.target.value)}
              className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent"
              aria-label="เลือกสี"
            />
            <input
              id="f-color"
              className={cn(FIELD_INPUT, 'flex-1')}
              value={form.color}
              onChange={(e) => setField('color', e.target.value)}
              placeholder="#FEE2E2"
            />
            {form.color && (
              <button
                type="button"
                aria-label="ล้างสี"
                onClick={() => setField('color', '')}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-[var(--status-danger-fg)]"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label htmlFor="f-notes" className="block text-[11px] font-semibold text-foreground">หมายเหตุ</label>
          <input
            id="f-notes"
            className={FIELD_INPUT}
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </div>

        {/* Active toggle */}
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setField('isActive', e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className="text-sm text-foreground">เปิดใช้งาน</span>
        </label>

      </div>

      {/* Pinned footer */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? 'กำลังบันทึก…' : editing ? 'บันทึก' : 'เพิ่ม'}
        </button>
      </div>
    </div>
  );
}

/* ─── Tab panel ──────────────────────────────────────────────────────── */

interface TabPanelProps {
  category: TileCategory;
  tiles: PricingTileRow[];
  onRefetch: () => void;
  onEdit: (tile: PricingTileRow) => void;
}

function TabPanel({ category, tiles, onRefetch, onEdit }: TabPanelProps) {
  const dndId = useId();
  const [localTiles, setLocalTiles] = useState<PricingTileRow[]>(tiles);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  // Sync when server data updates
  if (tiles !== localTiles) {
    setLocalTiles(tiles);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localTiles.findIndex((t) => t.id === active.id);
    const newIndex = localTiles.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(localTiles, oldIndex, newIndex);
    setLocalTiles(reordered);

    const payload = reordered.map((t, i) => ({ id: t.id, sortOrder: i }));
    const result = await reorderPricingTiles(payload);
    if (!result.ok) {
      toast.error(result.error);
      setLocalTiles(tiles); // revert on failure
    } else {
      onRefetch();
    }
  };

  const handleToggle = async (tile: PricingTileRow) => {
    setPendingId(tile.id);
    const result = await togglePricingTileActive(tile.id);
    setPendingId(null);
    if (result.ok) {
      toast.success(tile.isActive ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว');
      onRefetch();
    } else {
      toast.error(result.error);
    }
  };

  const handleDelete = (tile: PricingTileRow) => {
    openConfirm(
      `ลบ "${tile.name}" ออก? ถ้ามีการใช้งานอยู่จะไม่สามารถลบได้`,
      async () => {
        setPendingId(tile.id);
        const result = await deletePricingTile(tile.id);
        setPendingId(null);
        if (result.ok) {
          toast.success('ลบแล้ว');
          onRefetch();
        } else {
          toast.error(result.error);
        }
      },
    );
  };

  const activeTabInfo = TABS.find((t) => t.key === category)!;

  return (
    <>
      {confirmDialog}

      {localTiles.length === 0 ? (
        <EmptyState
          icon={
            activeTabInfo.key === 'penalty'
              ? <SlidersHorizontal className="size-5" />
              : <Tag className="size-5" />
          }
          title="ยังไม่มีข้อมูล"
          description={`ยังไม่มี ${activeTabInfo.label} — กด "+ เพิ่ม" เพื่อสร้างรายการแรก`}
        />
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={localTiles.map((t) => t.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {localTiles.map((tile) => (
                <SortableTileCard
                  key={tile.id}
                  tile={tile}
                  onEdit={onEdit}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  isPending={pendingId === tile.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </>
  );
}

/* ─── Main export ────────────────────────────────────────────────────── */

interface PricingTilesPageProps {
  initialData: PricingTileRow[];
}

export function PricingTilesPage({ initialData }: PricingTilesPageProps) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TileCategory>('guest');
  const [sheet, setSheet] = useState<SheetState>(null);

  const { data: allTiles = initialData } = useQuery({
    queryKey: ['pricing-tiles-all'],
    queryFn: () => getPricingTiles().then((r) => (r.ok ? r.data : [])),
    initialData,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ['pricing-tiles-all'] });
  const tabTiles = allTiles.filter((t) => t.category === activeTab);
  const activeTabInfo = TABS.find((t) => t.key === activeTab)!;

  return (
    <>
      <AppShell>
        <PageHeader
          title="Pricing Tiles"
          subtitle="จัดการราคาบุฟเฟ่ต์ ของเพิ่มเติม ส่วนลด และแต้มสะสม"
          actions={
            <Button type="button" onClick={() => setSheet({ type: 'add' })}>
              <Plus className="size-4" />
              เพิ่ม
            </Button>
          }
        />

        {/* Category tab bar */}
        <div className="flex flex-wrap gap-px rounded-lg bg-muted p-1 w-fit">
          {TABS.map((tab) => {
            const count = allTiles.filter((t) => t.category === tab.key).length;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-150',
                  activeTab === tab.key
                    ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  activeTab === tab.key
                    ? 'bg-[var(--surface-primary-subtle)] text-[var(--status-info-fg)]'
                    : 'bg-muted/60 text-muted-foreground',
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tab content card */}
        <DataCard title={activeTabInfo.label} subtitle={activeTabInfo.desc}>
          <TabPanel
            key={activeTab}
            category={activeTab}
            tiles={tabTiles}
            onRefetch={refetch}
            onEdit={(tile) => setSheet({ type: 'edit', tile })}
          />
        </DataCard>

      </AppShell>

      {/* Sheet — create / edit */}
      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => { if (!open) setSheet(null); }}
      >
        <SheetContent
          side="right"
          className="sm:max-w-[520px] gap-0 p-0"
          showCloseButton={false}
        >
          <TileForm
            key={sheet?.type === 'edit' ? sheet.tile.id : 'new'}
            editing={sheet?.type === 'edit' ? sheet.tile : null}
            defaultCategory={activeTab}
            onClose={() => setSheet(null)}
            onSaved={refetch}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
