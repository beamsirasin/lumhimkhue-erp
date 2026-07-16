'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { getHistoryCalendarDates } from '@/lib/actions/history';
import { formatThaiDate } from '@/lib/date-time';
import { cn } from '@/lib/utils';

interface HistoryCalendarProps {
  selectedDate: string; // 'yyyy-MM-dd'
  onSelectDate: (date: string) => void;
}

export function HistoryCalendar({ selectedDate, onSelectDate }: HistoryCalendarProps) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const selected = new Date(selectedDate);

  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth() + 1;

  const { data: sessionCounts = {} } = useQuery({
    queryKey: ['history-calendar', year, month],
    queryFn: () =>
      getHistoryCalendarDates(year, month).then((r) => (r.ok ? r.data : {})),
    staleTime: 60_000,
  });

  const selectedLabel = formatThaiDate(selectedDate);

  function handleOpen() {
    const d = new Date(selectedDate);
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setOpen(true);
  }

  function handleSelect(date: Date | undefined) {
    if (!date) return;
    onSelectDate(format(date, 'yyyy-MM-dd'));
    setOpen(false);
  }

  function handleToday() {
    onSelectDate(format(today, 'yyyy-MM-dd'));
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        aria-expanded={open}
        onClick={handleOpen}
        className="min-w-[160px] justify-between bg-[var(--surface-1)] shadow-[var(--shadow-card)]"
      >
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span>{selectedLabel}</span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[340px] overflow-hidden rounded-2xl border border-border bg-[var(--surface-raised)] shadow-[var(--shadow-dialog)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header strip */}
            <div className="flex items-center justify-between border-b border-border bg-[var(--surface-2)] px-5 py-3.5">
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

            {/* Calendar */}
            <div className="p-4">
              <Calendar
                mode="single"
                locale={th}
                selected={selected}
                onSelect={handleSelect}
                month={viewMonth}
                onMonthChange={setViewMonth}
                disabled={{ after: today }}
                showOutsideDays={false}
                className="w-full bg-transparent p-0"
                formatters={{
                  formatCaption: (date) => new Intl.DateTimeFormat('th-TH-u-ca-buddhist-nu-latn', {
                    month: 'long',
                    year: 'numeric',
                  }).format(date),
                }}
                components={{
                  DayButton: ({ day, modifiers, children, ...props }) => {
                    const dateStr = format(day.date, 'yyyy-MM-dd');
                    const count = sessionCounts[dateStr] ?? 0;
                    const isSelected = !!(
                      modifiers.selected &&
                      !modifiers.range_start &&
                      !modifiers.range_end &&
                      !modifiers.range_middle
                    );
                    return (
                      <CalendarDayButton
                        day={day}
                        modifiers={modifiers}
                        locale={th}
                        {...props}
                      >
                        {children}
                        {count > 0 && (
                          <div
                            aria-hidden="true"
                            className={cn(
                              'size-1.5 rounded-full',
                              isSelected
                                ? 'bg-primary-foreground/80'
                                : 'bg-primary/60',
                            )}
                          />
                        )}
                      </CalendarDayButton>
                    );
                  },
                }}
              />

              <Button
                type="button"
                variant="default"
                className="mt-2 w-full"
                onClick={handleToday}
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
