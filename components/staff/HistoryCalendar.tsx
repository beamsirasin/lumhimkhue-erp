'use client';

import { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { th } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, CalendarDays, ChevronDown, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getHistoryCalendarDates } from '@/lib/actions/history';

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
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors shadow-sm"
      >
        <CalendarDays className="size-4 text-muted-foreground" />
        <span>{selectedLabel}</span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Full-screen modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <p className="text-base font-semibold text-foreground">เลือกวันที่</p>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 hover:bg-muted/50 transition-colors"
              >
                <X className="size-5 text-muted-foreground" />
              </button>
            </div>

            <div className="p-6">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-5">
                <button
                  type="button"
                  aria-label="เดือนก่อน"
                  onClick={() => setViewDate((d) => subMonths(d, 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted/50 active:bg-muted transition-colors"
                >
                  <ChevronLeft className="size-5 text-foreground" />
                </button>
                <p className="text-base font-semibold text-foreground">
                  {format(viewDate, 'MMMM yyyy', { locale: th })}
                </p>
                <button
                  type="button"
                  aria-label="เดือนถัดไป"
                  onClick={() => setViewDate((d) => addMonths(d, 1))}
                  disabled={isNextDisabled}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted/50 active:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="size-5 text-foreground" />
                </button>
              </div>

              {/* Day names header */}
              <div className="grid grid-cols-7 mb-2">
                {DAY_NAMES.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Days grid — large tap targets */}
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
                      className={`relative flex flex-col items-center justify-center rounded-xl aspect-square text-sm font-medium transition-all active:scale-95
                        ${isFuture ? 'opacity-25 cursor-not-allowed' : 'cursor-pointer'}
                        ${isSelected
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : isFuture
                            ? 'text-muted-foreground'
                            : 'text-foreground hover:bg-muted/60'
                        }
                        ${isToday(day) && !isSelected ? 'ring-2 ring-primary/50 ring-offset-1' : ''}
                      `}
                    >
                      <span className="leading-none">{format(day, 'd')}</span>
                      {count > 0 && (
                        <span className={`mt-1 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-primary-foreground/60' : 'bg-primary/60'}`} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Today shortcut */}
              <button
                type="button"
                onClick={() => {
                  const todayStr = format(today, 'yyyy-MM-dd');
                  onSelectDate(todayStr);
                  setOpen(false);
                }}
                className="mt-5 w-full rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors"
              >
                วันนี้
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
