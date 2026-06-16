'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TableMapStatus = 'available' | 'occupied' | 'cleaning' | 'reserved' | 'closed';

const STATUS_STYLES: Record<TableMapStatus, { bg: string; border: string; text: string; dot: string; label: string }> = {
  available: {
    bg:     'bg-[var(--status-success-bg)]',
    border: 'border-[var(--status-success-border)]',
    text:   'text-[var(--status-success-fg)]',
    dot:    'bg-[var(--status-success-fg)]',
    label:  'ว่าง',
  },
  occupied: {
    bg:     'bg-[var(--status-danger-bg)]',
    border: 'border-[var(--status-danger-border)]',
    text:   'text-[var(--status-danger-fg)]',
    dot:    'bg-[var(--status-danger-fg)]',
    label:  'มีลูกค้า',
  },
  cleaning: {
    bg:     'bg-[var(--status-warning-bg)]',
    border: 'border-[var(--status-warning-border)]',
    text:   'text-[var(--status-warning-fg)]',
    dot:    'bg-[var(--status-warning-fg)]',
    label:  'ทำความสะอาด',
  },
  reserved: {
    bg:     'bg-[var(--status-info-bg)]',
    border: 'border-[var(--status-info-border)]',
    text:   'text-[var(--status-info-fg)]',
    dot:    'bg-[var(--status-info-fg)]',
    label:  'จอง',
  },
  closed: {
    bg:     'bg-[var(--surface-2)]',
    border: 'border-border border-dashed',
    text:   'text-muted-foreground',
    dot:    'bg-muted-foreground/40',
    label:  'ปิด',
  },
};

export interface TableMapItem {
  id: string;
  label: string;
  /** x position as percentage of canvas width (0–100) */
  xPct: number;
  /** y position as percentage of canvas height (0–100) */
  yPct: number;
  /** w as percentage of canvas width (0–100), default 10 */
  wPct?: number;
  /** h as percentage of canvas height (0–100), default 16 */
  hPct?: number;
  status: TableMapStatus;
  sublabel?: string;
  shape?: 'square' | 'round';
}

interface TableMapProps {
  tables: TableMapItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Show the legend overlay */
  showLegend?: boolean;
  className?: string;
  /** Content to show when no tables are placed */
  emptyState?: ReactNode;
}

export function TableMap({
  tables,
  selectedId,
  onSelect,
  showLegend = true,
  className,
  emptyState,
}: TableMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: width || 800, h: height || 500 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const statusesInUse = Array.from(new Set(tables.map((t) => t.status)));

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full rounded-xl border border-border bg-[var(--surface-2)] overflow-hidden',
        className,
      )}
      style={{ minHeight: 320 }}
    >
      {/* Dot-grid background */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full pointer-events-none"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern id="tm-dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" className="text-border" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tm-dot-grid)" />
      </svg>

      {/* Tables */}
      {tables.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center">
          {emptyState ?? (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">ยังไม่มีโต๊ะ</p>
              <p className="mt-1 text-xs text-muted-foreground">เพิ่มโต๊ะเพื่อแสดงบนแผนผัง</p>
            </div>
          )}
        </div>
      ) : (
        tables.map((table) => {
          const wPct = table.wPct ?? 10;
          const hPct = table.hPct ?? 16;
          const s = STATUS_STYLES[table.status];
          const isSelected = selectedId === table.id;
          const isRound = table.shape === 'round';

          return (
            <button
              key={table.id}
              type="button"
              aria-label={`โต๊ะ ${table.label} — ${s.label}`}
              onClick={() => onSelect?.(table.id)}
              style={{
                position: 'absolute',
                left: `${table.xPct}%`,
                top: `${table.yPct}%`,
                width: `${wPct}%`,
                height: `${hPct}%`,
              }}
              className={cn(
                'flex flex-col items-center justify-center border-2 transition-all duration-150',
                isRound ? 'rounded-full' : 'rounded-xl',
                s.bg, s.border, s.text,
                onSelect && 'cursor-pointer active:scale-[0.95]',
                isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface-2)]',
                !onSelect && 'cursor-default',
              )}
            >
              <span className="text-sm font-bold leading-none tabular-nums">{table.label}</span>
              {/* Status dot */}
              <span className={cn('mt-1 size-1.5 rounded-full', s.dot)} />
              {table.sublabel && (
                <span className="mt-0.5 text-[9px] leading-none opacity-70">{table.sublabel}</span>
              )}
            </button>
          );
        })
      )}

      {/* Legend overlay */}
      {showLegend && tables.length > 0 && statusesInUse.length > 0 && (
        <div className="absolute bottom-3 right-3 rounded-lg border border-border bg-[var(--surface-raised)]/90 backdrop-blur-sm px-3 py-2 space-y-1">
          {statusesInUse.map((status) => {
            const s = STATUS_STYLES[status];
            return (
              <div key={status} className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full shrink-0', s.dot)} />
                <span className="text-[10px] font-medium text-foreground">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
