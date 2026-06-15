'use client';

import { useState, useRef, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from 'date-fns';
import { th } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, CalendarDays, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getHistoryCalendarDates } from '@/lib/actions/history';

interface HistoryCalendarProps {
  selectedDate: string; // 'yyyy-MM-dd'
  onSelectDate: (date: string) => void;
}

const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export function HistoryCalendar({ selectedDate, onSelectDate }: HistoryCalendarProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  function prevMonth() {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    if (next <= today) setViewDate(next);
  }

  const isNextDisabled = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1) > today;

  const selectedLabel = format(new Date(selectedDate), 'd MMMM yyyy', { locale: th });

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors shadow-sm"
      >
        <CalendarDays className="size-4 text-muted-foreground" />
        <span>{selectedLabel}</span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 rounded-xl border border-border bg-card p-4 shadow-lg w-72">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              aria-label="เดือนก่อน"
              onClick={prevMonth}
              className="rounded p-1 hover:bg-muted/50"
            >
              <ChevronLeft className="size-4 text-muted-foreground" />
            </button>
            <p className="text-sm font-semibold text-foreground">
              {format(viewDate, 'MMMM yyyy', { locale: th })}
            </p>
            <button
              type="button"
              aria-label="เดือนถัดไป"
              onClick={nextMonth}
              disabled={isNextDisabled}
              className="rounded p-1 hover:bg-muted/50 disabled:opacity-30"
            >
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-0.5">
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
                  className={`relative flex flex-col items-center justify-center rounded-lg p-1.5 text-xs transition-colors
                    ${isFuture ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/50'}
                    ${isSelected ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground'}
                    ${isToday(day) && !isSelected ? 'ring-1 ring-primary/50' : ''}
                  `}
                >
                  <span className="font-medium leading-none">{format(day, 'd')}</span>
                  {count > 0 && (
                    <span className={`mt-0.5 h-1 w-1 rounded-full ${isSelected ? 'bg-card' : 'bg-muted'}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
