'use client';

import { RotateCcw, Users } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type GuestTypeOption = { key: string; label: string };

interface GuestCountFilterProps {
  types: GuestTypeOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** True when per-type breakdown is unavailable; total is used as fallback */
  noBreakdown?: boolean;
  className?: string;
}

export function GuestCountFilter({
  types,
  selected,
  onChange,
  noBreakdown = false,
  className,
}: GuestCountFilterProps) {
  const allSelected = types.length > 0 && types.every((t) => selected.has(t.key));
  const isFiltering = types.length > 0 && !allSelected && !noBreakdown;
  const selectedLabels = types.filter((t) => selected.has(t.key)).map((t) => t.label);
  const excludedLabels = types.filter((t) => !selected.has(t.key)).map((t) => t.label);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  }

  function resetToAll() {
    onChange(new Set(types.map((t) => t.key)));
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="ตั้งค่าการนับลูกค้า"
        className={cn(
          'flex h-10 items-center gap-2 rounded-lg border border-border bg-[var(--surface-1)] px-3 text-sm transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isFiltering && 'border-primary/40 bg-[var(--surface-primary-subtle)]',
          className,
        )}
      >
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <span className="whitespace-nowrap font-medium text-foreground">
          ตั้งค่าการนับลูกค้า
        </span>
        {isFiltering && (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
            {selected.size}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">ตั้งค่าการนับลูกค้า</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            เลือกประเภทที่นับใน KPI เช่น จำนวนลูกค้า เฉลี่ยต่อหัว
          </p>
        </div>

        <div className="px-2 py-2">
          {types.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              ยังไม่มีประเภทผู้เข้าใช้ใน Pricing Tiles
            </p>
          ) : (
            <>
              {noBreakdown && (
                <div className="mx-1 mb-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2">
                  <p className="text-xs text-[var(--status-warning-fg)] leading-relaxed">
                    ข้อมูลในช่วงนี้ยังไม่แยกประเภท ระบบจะนับรวมลูกค้าทั้งหมดแทน
                  </p>
                </div>
              )}
            <div className="space-y-0.5">
              {types.map((t) => {
                const checked = selected.has(t.key);
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => toggle(t.key)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border-2 transition-colors',
                        checked
                          ? 'border-primary bg-primary'
                          : 'border-border bg-background',
                      )}
                    >
                      {checked && (
                        <svg
                          className="size-2.5 text-white"
                          viewBox="0 0 12 12"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M2 6L5 9L10 3"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span
                      className={cn(
                        'text-sm',
                        checked
                          ? 'font-medium text-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
            </>
          )}
        </div>

        {!noBreakdown && types.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            {selectedLabels.length > 0 && (
              <p className="text-xs">
                <span className="font-medium text-foreground">นับ:</span>{' '}
                <span className="text-muted-foreground">{selectedLabels.join(', ')}</span>
              </p>
            )}
            {excludedLabels.length > 0 && (
              <p className="mt-0.5 text-xs">
                <span className="font-medium text-muted-foreground">ไม่รวม:</span>{' '}
                <span className="text-muted-foreground">{excludedLabels.join(', ')}</span>
              </p>
            )}
            {isFiltering && (
              <button
                type="button"
                onClick={resetToAll}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                <RotateCcw className="size-3" />
                รวมทั้งหมด
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
