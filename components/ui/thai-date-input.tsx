'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatThaiDate } from '@/lib/date-time';
import { cn } from '@/lib/utils';

interface ThaiDateInputProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function ThaiDateInput({
  value,
  onValueChange,
  className,
  min,
  max,
  disabled = false,
  placeholder = 'วว/ดด/พ.ศ.',
  ariaLabel = 'เลือกวันที่',
}: ThaiDateInputProps) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  const minDate = min ? parseIsoDate(min) : undefined;
  const maxDate = max ? parseIsoDate(max) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'flex h-8 w-full min-w-0 items-center justify-between rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
          !selected && 'text-muted-foreground',
          className,
        )}
      >
        <span className="tabular-nums">{selected ? formatThaiDate(value) : placeholder}</span>
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div>
          <Calendar
            mode="single"
            locale={th}
            selected={selected}
            defaultMonth={selected}
            captionLayout="dropdown"
            startMonth={new Date(1900, 0)}
            endMonth={new Date(new Date().getFullYear() + 10, 11)}
            disabled={(date) => Boolean(
              (minDate && date < minDate) ||
              (maxDate && date > maxDate)
            )}
            formatters={{
              formatCaption: (date) => new Intl.DateTimeFormat('th-TH-u-ca-buddhist-nu-latn', {
                month: 'long',
                year: 'numeric',
              }).format(date),
              formatMonthDropdown: (date) => new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(date),
              formatYearDropdown: (date) => String(date.getFullYear() + 543),
            }}
            onSelect={(date) => {
              if (!date) return;
              onValueChange(format(date, 'yyyy-MM-dd'));
              setOpen(false);
            }}
          />
          {selected && (
            <div className="border-t border-border p-2">
              <button
                type="button"
                className="h-8 w-full rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => {
                  onValueChange('');
                  setOpen(false);
                }}
              >
                ล้างวันที่
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
