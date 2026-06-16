import { cn } from '@/lib/utils';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple' | 'orange' | 'cyan';

const VARIANT_CLS: Record<BadgeVariant, string> = {
  success: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] ring-[var(--status-success-border)]',
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ring-[var(--status-warning-border)]',
  danger:  'bg-[var(--status-danger-bg)]  text-[var(--status-danger-fg)]  ring-[var(--status-danger-border)]',
  info:    'bg-[var(--status-info-bg)]    text-[var(--status-info-fg)]    ring-[var(--status-info-border)]',
  neutral: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)] ring-[var(--status-neutral-border)]',
  purple:  'bg-[var(--status-purple-bg)]  text-[var(--status-purple-fg)]  ring-[var(--status-purple-border)]',
  orange:  'bg-[var(--status-orange-bg)]  text-[var(--status-orange-fg)]  ring-[var(--status-orange-border)]',
  cyan:    'bg-[var(--status-cyan-bg)]    text-[var(--status-cyan-fg)]    ring-[var(--status-cyan-border)]',
};

const DOT_CLS: Record<BadgeVariant, string> = {
  success: 'bg-[var(--status-success-fg)]',
  warning: 'bg-[var(--status-warning-fg)]',
  danger:  'bg-[var(--status-danger-fg)]',
  info:    'bg-[var(--status-info-fg)]',
  neutral: 'bg-[var(--status-neutral-fg)]',
  purple:  'bg-[var(--status-purple-fg)]',
  orange:  'bg-[var(--status-orange-fg)]',
  cyan:    'bg-[var(--status-cyan-fg)]',
};

/** sm — inline, table cells, compact lists. md — card headers, prominent placement. */
type BadgeSize = 'sm' | 'md';

const SIZE_CLS: Record<BadgeSize, { container: string; dot: string }> = {
  sm: { container: 'px-2 py-0.5 text-[10px] gap-1',   dot: 'size-1.5' },
  md: { container: 'px-3 py-1   text-xs     gap-1.5',  dot: 'size-2'   },
};

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  size?: BadgeSize;
  className?: string;
}

export function StatusBadge({
  label,
  variant = 'neutral',
  dot = false,
  size = 'sm',
  className,
}: StatusBadgeProps) {
  const s = SIZE_CLS[size];
  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-semibold ring-1 ring-inset leading-none',
      s.container,
      VARIANT_CLS[variant],
      className,
    )}>
      {dot && <span className={cn('rounded-full shrink-0', s.dot, DOT_CLS[variant])} />}
      {label}
    </span>
  );
}
