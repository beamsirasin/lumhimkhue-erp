'use client';

import { useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isToday,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { th } from 'date-fns/locale';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { getHistoryCalendarDates } from '@/lib/actions/history';
import { cn } from '@/lib/utils';

interface HistoryCalendarProps {
  selectedDate: string; // 'yyyy-MM-dd'
  onSelectDate: (date: string) => void;
}

const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export function HistoryCalendar({ selectedDate, onSelectDate }: HistoryCalendarProps) {
  const [open, setOpen] = useState(false);
  const today = new Date();

  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(selectedDate);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;

  const { data: sessionCounts = {} } = useQuery({
    queryKey: ['history-calendar', year, month],
    queryFn: () =>
      getHistoryCalendarDates(year, month).then((r) => (r.ok ? r.data : {})),
    staleTime: 60_000,
  });

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  const isNextDisabled = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1) > today;
  const selectedLabel = format(new Date(selectedDate), 'd MMMM yyyy', { locale: th });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => setOpen(true)}
        className="h-9 min-w-40 justify-between bg-[var(--surface-1)] shadow-[var(--shadow-card)]"
      >
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span>{selectedLabel}</span>
        </span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-[var(--surface-raised)] shadow-[var(--shadow-dialog)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-foreground">เลือกวันที่</p>
                <p className="mt-0.5 text-xs text-muted-foreground">วันที่มีประวัติจะมีจุดกำกับ</p>
              </div>
              <Button
                type="button"
                aria-label="ปิด"
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="p-5">
              <div className="mb-5 flex items-center justify-between">
                <Button
                  type="button"
                  aria-label="เดือนก่อน"
                  variant="outline"
                  size="icon-lg"
                  onClick={() => setViewDate((d) => subMonths(d, 1))}
                >
                  <ChevronLeft className="size-5" />
                </Button>
                <p className="text-sm font-semibold text-foreground">
                  {format(viewDate, 'MMMM yyyy', { locale: th })}
                </p>
                <Button
                  type="button"
                  aria-label="เดือนถัดไป"
                  variant="outline"
                  size="icon-lg"
                  onClick={() => setViewDate((d) => addMonths(d, 1))}
                  disabled={isNextDisabled}
                >
                  <ChevronRight className="size-5" />
                </Button>
              </div>

              <div className="mb-2 grid grid-cols-7">
                {DAY_NAMES.map((d) => (
                  <div key={d} className="py-1 text-center text-xs font-semibold text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startPad }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {days.map((day) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const isSelected = dateStr === selectedDate;
                  const count = sessionCounts[dateStr] ?? 0;
                  const isFuture = day > today;

                  return (
                    <button
                      key={dateStr}
                      type="button"
                      disabled={isFuture}
                      onClick={() => {
                        onSelectDate(dateStr);
                        setOpen(false);
                      }}
                      className={cn(
                        'relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm font-medium transition-all active:scale-95',
                        isFuture ? 'cursor-not-allowed opacity-25' : 'cursor-pointer',
                        isSelected
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : isFuture
                            ? 'text-muted-foreground'
                            : 'text-foreground hover:bg-muted/60',
                        isToday(day) && !isSelected && 'ring-2 ring-primary/50 ring-offset-1',
                      )}
                    >
                      <span className="leading-none">{format(day, 'd')}</span>
                      {count > 0 && (
                        <span
                          className={cn(
                            'mt-1 size-1.5 rounded-full',
                            isSelected ? 'bg-primary-foreground/70' : 'bg-primary/70',
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <Button
                type="button"
                variant="outline"
                className="mt-5 w-full"
                onClick={() => {
                  const todayStr = format(today, 'yyyy-MM-dd');
                  onSelectDate(todayStr);
                  setOpen(false);
                }}
              >
                วันนี้
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
