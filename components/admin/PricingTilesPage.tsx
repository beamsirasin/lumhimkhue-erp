'use client';

import { useState, useRef } from 'react';
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
import { Plus, Pencil, Trash2, GripVertical, ToggleLeft, ToggleRight, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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

/* ─── Tab config ─────────────────────────────────────────────────────── */

const TABS: { key: TileCategory; label: string; desc: string }[] = [
  { key: 'guest',    label: 'ประเภทผู้เข้าใช้',  desc: 'ราคาบุฟเฟ่ต์ตามประเภทลูกค้า (ผู้ใหญ่ / เด็ก ฯลฯ)' },
  { key: 'addon',    label: 'ของเพิ่มเติม',       desc: 'รายการเสริมที่เก็บเพิ่ม เช่น แก้วชา ถ้วยพิเศษ' },
  { key: 'discount', label: 'ส่วนลด',             desc: 'ส่วนลดที่ใช้ตอนชำระเงิน เช่น ส่วนลด 10%' },
];

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
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const priceText =
    tile.category === 'discount'
      ? tile.discountType === 'percentage'
        ? `-${tile.discountValue}%`
        : `-฿${Number(tile.discountValue).toLocaleString('th-TH')}`
      : `฿${Number(tile.price).toLocaleString('th-TH')}`;

  const bg = tile.color ?? (
    tile.category === 'guest' ? '#f0f9ff' :
    tile.category === 'addon' ? '#f0fdf4' :
    '#fff7ed'
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden
        ${!tile.isActive ? 'opacity-50' : ''}
      `}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label="ลาก"
        className="absolute left-1.5 top-1.5 cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-500 touch-none"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Image / colour preview */}
      <div
        className="flex h-20 items-center justify-center rounded-t-xl"
        style={{ backgroundColor: bg }}
      >
        {tile.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tile.imageUrl} alt={tile.name} className="h-14 w-14 object-contain" />
        ) : (
          <span className="text-2xl font-bold text-slate-300 select-none">
            {tile.name.charAt(0)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        <p className="truncate text-sm font-semibold text-slate-900">{tile.name}</p>
        <p className="font-mono text-xs text-slate-400">{tile.code}</p>
        <p className={`mt-0.5 text-sm font-bold ${tile.category === 'discount' ? 'text-red-600' : 'text-slate-800'}`}>
          {priceText}
        </p>
        {tile.notes && (
          <p className="truncate text-[11px] text-slate-400">{tile.notes}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5">
        <button
          type="button"
          aria-label={tile.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
          disabled={isPending}
          onClick={() => onToggle(tile)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          {tile.isActive ? (
            <><ToggleRight className="size-4 text-green-500" /><span className="text-green-600">{isPending ? '...' : 'เปิด'}</span></>
          ) : (
            <><ToggleLeft className="size-4" /><span>{isPending ? '...' : 'ปิด'}</span></>
          )}
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label={`แก้ไข ${tile.name}`}
            onClick={() => onEdit(tile)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`ลบ ${tile.name}`}
            disabled={isPending}
            onClick={() => onDelete(tile)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Tile Form Dialog ───────────────────────────────────────────────── */

interface TileFormDialogProps {
  open: boolean;
  editing: PricingTileRow | null;
  defaultCategory: TileCategory;
  onClose: () => void;
  onSaved: () => void;
}

function TileFormDialog({ open, editing, defaultCategory, onClose, onSaved }: TileFormDialogProps) {
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
  const canSubmit = !!form.code && !!form.name && (!isDiscount || !!form.discountType);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'แก้ไข Tile' : 'เพิ่ม Tile'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Code + category (immutable when editing) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="f-code">รหัส (code) *</Label>
              <Input
                id="f-code"
                value={form.code}
                disabled={!!editing}
                onChange={(e) => setField('code', e.target.value)}
                placeholder="adult"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-sort">ลำดับ</Label>
              <Input
                id="f-sort"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setField('sortOrder', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="f-name">ชื่อแสดงผล *</Label>
            <Input
              id="f-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="ผู้ใหญ่"
            />
          </div>

          {/* Image upload */}
          <div className="space-y-1.5">
            <Label>รูปภาพ (ไม่บังคับ, สูงสุด 500 KB)</Label>
            <div className="flex items-center gap-3">
              {form.imageUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.imageUrl} alt="preview" className="h-14 w-14 rounded-lg object-contain border border-slate-200" />
                  <button
                    type="button"
                    aria-label="ลบรูป"
                    onClick={() => setField('imageUrl', '')}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white border border-slate-300 shadow hover:bg-red-50"
                  >
                    <X className="size-2.5 text-red-500" />
                  </button>
                </div>
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50">
                  <Upload className="size-5 text-slate-400" />
                </div>
              )}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => imgInputRef.current?.click()}
              >
                เลือกรูป
              </Button>
            </div>
          </div>

          {/* Category-specific fields */}
          {isDiscount ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-dtype">ประเภทส่วนลด *</Label>
                <select
                  id="f-dtype"
                  value={form.discountType}
                  onChange={(e) => setField('discountType', e.target.value as DiscountType | '')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  disabled={!!editing}
                >
                  <option value="">— เลือก —</option>
                  <option value="percentage">เปอร์เซ็นต์ (%)</option>
                  <option value="fixed">จำนวนเงิน (฿)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-dval">
                  {form.discountType === 'percentage' ? 'ส่วนลด (%)' : 'ส่วนลด (฿)'}
                </Label>
                <Input
                  id="f-dval"
                  type="number"
                  min={0}
                  value={form.discountValue}
                  onChange={(e) => setField('discountValue', e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-price">ราคา (฿)</Label>
                <Input
                  id="f-price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.price}
                  onChange={(e) => setField('price', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-vat">VAT (%)</Label>
                <Input
                  id="f-vat"
                  type="number"
                  min={0}
                  max={100}
                  value={form.vatRate}
                  onChange={(e) => setField('vatRate', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Colour */}
          <div className="space-y-1.5">
            <Label htmlFor="f-color">สีพื้นหลัง (ไม่บังคับ, #hex)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.color || '#f8fafc'}
                onChange={(e) => setField('color', e.target.value)}
                className="h-9 w-9 cursor-pointer rounded border border-slate-300"
                aria-label="เลือกสี"
              />
              <Input
                id="f-color"
                value={form.color}
                onChange={(e) => setField('color', e.target.value)}
                placeholder="#FEE2E2"
                className="flex-1"
              />
              {form.color && (
                <button
                  type="button"
                  aria-label="ล้างสี"
                  onClick={() => setField('color', '')}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="f-notes">หมายเหตุ</Label>
            <Input
              id="f-notes"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setField('isActive', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            เปิดใช้งาน
          </label>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            ยกเลิก
          </button>
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit}>
            {submitting ? 'กำลังบันทึก...' : editing ? 'บันทึก' : 'เพิ่ม'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Tab panel ──────────────────────────────────────────────────────── */

interface TabPanelProps {
  category: TileCategory;
  tiles: PricingTileRow[];
  onRefetch: () => void;
}

function TabPanel({ category, tiles, onRefetch }: TabPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PricingTileRow | null>(null);
  const [localTiles, setLocalTiles] = useState<PricingTileRow[]>(tiles);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Sync when server data updates
  if (tiles !== localTiles && !dialogOpen) {
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
      setLocalTiles(tiles); // revert
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

  const handleDelete = async (tile: PricingTileRow) => {
    if (!confirm(`ลบ "${tile.name}" ออก? ถ้ามีการใช้งานอยู่จะไม่สามารถลบได้`)) return;
    setPendingId(tile.id);
    const result = await deletePricingTile(tile.id);
    setPendingId(null);
    if (result.ok) {
      toast.success('ลบแล้ว');
      onRefetch();
    } else {
      toast.error(result.error);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (tile: PricingTileRow) => {
    setEditing(tile);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" />
          เพิ่ม
        </Button>
      </div>

      {localTiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-400">
          ยังไม่มีข้อมูล — กด &ldquo;เพิ่ม&rdquo; เพื่อสร้าง
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={localTiles.map((t) => t.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {localTiles.map((tile) => (
                <SortableTileCard
                  key={tile.id}
                  tile={tile}
                  onEdit={openEdit}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  isPending={pendingId === tile.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <TileFormDialog
        open={dialogOpen}
        editing={editing}
        defaultCategory={category}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={onRefetch}
      />
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

  const { data: allTiles = initialData } = useQuery({
    queryKey: ['pricing-tiles-all'],
    queryFn: () => getPricingTiles().then((r) => (r.ok ? r.data : [])),
    initialData,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ['pricing-tiles-all'] });

  const tabTiles = allTiles.filter((t) => t.category === activeTab);
  const activeTabInfo = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-medium text-slate-900">Pricing Tiles</h1>
        <p className="mt-0.5 text-sm text-slate-500">จัดการราคาและส่วนลดทุกประเภท</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        {TABS.map((tab) => {
          const count = allTiles.filter((t) => t.category === tab.key).length;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                activeTab === tab.key ? 'bg-slate-100 text-slate-700' : 'bg-slate-200 text-slate-500'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab description */}
      <p className="mb-4 text-sm text-slate-500">{activeTabInfo.desc}</p>

      {/* Tab panel — remount when tab changes so state resets */}
      <TabPanel
        key={activeTab}
        category={activeTab}
        tiles={tabTiles}
        onRefetch={refetch}
      />
    </div>
  );
}
