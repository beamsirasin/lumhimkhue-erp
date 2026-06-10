'use client';

import type React from 'react';
import { Users, Package, Tag, Gift } from 'lucide-react';
import type { PricingTile as PricingTileType } from '@/lib/db/schema';

export type TileMode = 'select' | 'edit' | 'display' | 'tap';

interface PricingTileProps {
  tile: PricingTileType;
  mode?: TileMode;
  quantity?: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
  onEdit?: () => void;
}

const CATEGORY_ICON: Record<string, React.ElementType> = {
  guest: Users,
  addon: Package,
  discount: Tag,
  loyalty: Gift,
};

const DEFAULT_BG: Record<string, string> = {
  guest: '#f0f9ff',
  addon: '#f0fdf4',
  discount: '#fff7ed',
};

function formatPrice(tile: PricingTileType): string {
  if (tile.category === 'discount') {
    if (tile.discountType === 'percentage')
      return `-${tile.discountValue}%`;
    return `-฿${Number(tile.discountValue).toLocaleString('th-TH')}`;
  }
  return `฿${Number(tile.price).toLocaleString('th-TH')}`;
}

/**
 * Reusable pricing tile card — 120×120 px.
 *
 * Modes:
 *   display  — static card (default)
 *   select   — shows +/- counter and quantity badge; requires onIncrement/onDecrement
 *   edit     — shows hover overlay that calls onEdit on click
 */
export function PricingTile({
  tile,
  mode = 'display',
  quantity = 0,
  onIncrement,
  onDecrement,
  onEdit,
}: PricingTileProps) {
  const Icon = CATEGORY_ICON[tile.category];
  const bg = tile.color ?? DEFAULT_BG[tile.category] ?? '#f8fafc';
  const isSelected = (mode === 'select' || mode === 'tap') && quantity > 0;
  const priceText = formatPrice(tile);
  const isDiscount = tile.category === 'discount';
  const isTap = mode === 'tap';

  return (
    <div
      role={isTap ? 'button' : undefined}
      tabIndex={isTap ? 0 : undefined}
      onClick={isTap ? onIncrement : undefined}
      onKeyDown={isTap ? (e) => { if (e.key === 'Enter' || e.key === ' ') onIncrement?.(); } : undefined}
      className={`relative flex flex-col items-center rounded-xl border-2 transition-all select-none
        ${isSelected ? 'border-slate-800 shadow-md' : 'border-transparent'}
        ${isTap ? 'cursor-pointer hover:brightness-95 active:scale-95' : ''}
        ${!tile.isActive ? 'opacity-50' : ''}
      `}
      style={{ width: 120, height: 120, backgroundColor: bg }}
    >
      {/* Image or icon */}
      <div className="flex flex-1 items-center justify-center pt-2">
        {tile.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tile.imageUrl}
            alt={tile.name}
            className="h-9 w-9 rounded object-contain"
          />
        ) : (
          <Icon className={`size-8 ${isDiscount ? 'text-red-400' : 'text-slate-400'} opacity-70`} />
        )}
      </div>

      {/* Name */}
      <p className="line-clamp-1 px-1 text-center text-[11px] font-semibold leading-tight text-slate-800">
        {tile.name}
      </p>

      {/* Price OR counter (select mode) */}
      {mode === 'select' ? (
        <div className="flex items-center gap-1 pb-2 pt-1">
          <button
            type="button"
            aria-label="ลด"
            onClick={onDecrement}
            disabled={quantity === 0}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-base font-bold text-slate-700 shadow-sm hover:bg-white disabled:opacity-30"
          >
            −
          </button>
          <span className="w-5 text-center tabular-nums text-sm font-bold text-slate-900">
            {quantity}
          </span>
          <button
            type="button"
            aria-label="เพิ่ม"
            onClick={onIncrement}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-base font-bold text-white shadow-sm hover:bg-slate-700"
          >
            +
          </button>
        </div>
      ) : (
        <p
          className={`pb-2 pt-0.5 text-center text-xs font-bold ${
            isDiscount ? 'text-red-600' : 'text-slate-700'
          }`}
        >
          {priceText}
        </p>
      )}

      {/* Quantity badge (select mode, qty > 0) */}
      {mode === 'select' && quantity > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-800 px-1 text-[10px] font-bold text-white">
          {quantity}
        </span>
      )}

      {/* Edit overlay (edit mode) */}
      {mode === 'edit' && onEdit && (
        <button
          type="button"
          aria-label={`แก้ไข ${tile.name}`}
          onClick={onEdit}
          className="absolute inset-0 rounded-xl bg-black/0 transition-colors hover:bg-black/10"
        />
      )}
    </div>
  );
}
