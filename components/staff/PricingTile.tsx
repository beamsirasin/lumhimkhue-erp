'use client';

import type React from 'react';
import { Users, Package, Tag, Gift } from 'lucide-react';
import type { PricingTile as PricingTileType } from '@/lib/db/schema';

export type TileMode = 'select' | 'edit' | 'display' | 'tap';

interface PricingTileProps {
  tile: PricingTileType;
  mode?: TileMode;
  quantity?: number;
  size?: 'sm' | 'lg';
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
  size = 'sm',
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
  const isLg = size === 'lg';

  const dim = isLg ? 160 : 120;

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
      style={{ width: dim, height: dim, backgroundColor: bg }}
    >
      {/* Image or icon */}
      <div className="flex flex-1 items-center justify-center pt-2">
        {tile.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tile.imageUrl}
            alt={tile.name}
            className={`rounded object-contain ${isLg ? 'h-14 w-14' : 'h-9 w-9'}`}
          />
        ) : (
          <Icon className={`${isLg ? 'size-12' : 'size-8'} ${isDiscount ? 'text-red-400' : 'text-slate-400'} opacity-70`} />
        )}
      </div>

      {/* Name */}
      <p className={`line-clamp-1 px-1 text-center font-semibold leading-tight text-slate-800 ${isLg ? 'text-sm' : 'text-[11px]'}`}>
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
            className={`flex items-center justify-center rounded-full bg-white/80 font-bold text-slate-700 shadow-sm hover:bg-white disabled:opacity-30 ${isLg ? 'h-8 w-8 text-lg' : 'h-6 w-6 text-base'}`}
          >
            −
          </button>
          <span className={`text-center tabular-nums font-bold text-slate-900 ${isLg ? 'w-7 text-base' : 'w-5 text-sm'}`}>
            {quantity}
          </span>
          <button
            type="button"
            aria-label="เพิ่ม"
            onClick={onIncrement}
            className={`flex items-center justify-center rounded-full bg-slate-800 font-bold text-white shadow-sm hover:bg-slate-700 ${isLg ? 'h-8 w-8 text-lg' : 'h-6 w-6 text-base'}`}
          >
            +
          </button>
        </div>
      ) : (
        <p
          className={`pb-2 pt-0.5 text-center font-bold ${isLg ? 'text-sm' : 'text-xs'} ${
            isDiscount ? 'text-red-600' : 'text-slate-700'
          }`}
        >
          {priceText}
        </p>
      )}

      {/* Quantity badge (select/tap mode, qty > 0) */}
      {(mode === 'select' || (isTap && isLg)) && quantity > 0 && (
        <span className={`absolute -right-1.5 -top-1.5 flex min-w-[20px] items-center justify-center rounded-full bg-slate-800 px-1 font-bold text-white ${isLg ? 'h-6 text-xs' : 'h-5 text-[10px]'}`}>
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
