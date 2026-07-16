'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'));

interface Time24SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}

export function Time24Select({
  value,
  onValueChange,
  label,
  className,
  disabled = false,
}: Time24SelectProps) {
  const [hour = '00', minute = '00'] = value.split(':');

  return (
    <div className={cn('flex items-center gap-1', className)} role="group" aria-label={`${label} แบบ 24 ชั่วโมง`}>
      <Select
        value={hour}
        disabled={disabled}
        onValueChange={(nextHour) => {
          if (nextHour) onValueChange(`${nextHour}:${minute}`);
        }}
      >
        <SelectTrigger className="min-w-0 flex-1 tabular-nums" aria-label={`${label} ชั่วโมง`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="w-20 min-w-20">
          {HOURS.map((option) => (
            <SelectItem key={option} value={option} className="tabular-nums">{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground" aria-hidden="true">:</span>
      <Select
        value={minute}
        disabled={disabled}
        onValueChange={(nextMinute) => {
          if (nextMinute) onValueChange(`${hour}:${nextMinute}`);
        }}
      >
        <SelectTrigger className="min-w-0 flex-1 tabular-nums" aria-label={`${label} นาที`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="w-20 min-w-20">
          {MINUTES.map((option) => (
            <SelectItem key={option} value={option} className="tabular-nums">{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
