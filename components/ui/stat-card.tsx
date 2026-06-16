import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value?: string | number;
  unit?: string;
  subLabel?: string;
  loading?: boolean;
  icon?: ReactNode;
  trend?: {
    pct: number;
    dir: 'up' | 'down' | 'flat';
    label?: string;
    invert?: boolean;
  };
  valueClassName?: string;
  className?: string;
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

const ACCENT_ICON_CLS: Record<NonNullable<StatCardProps['accent']>, string> = {
  default: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
  success: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  danger:  'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
  info:    'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
};

const ACCENT_BAR_CLS: Record<NonNullable<StatCardProps['accent']>, string> = {
  default: '',
  success: 'border-l-[3px] border-l-[var(--status-success-border)]',
  warning: 'border-l-[3px] border-l-[var(--status-warning-border)]',
  danger:  'border-l-[3px] border-l-[var(--status-danger-border)]',
  info:    'border-l-[3px] border-l-[var(--status-info-border)]',
};

export function StatCard({
  label, value, unit, subLabel, loading, icon, trend, valueClassName, className, accent = 'default',
}: StatCardProps) {
  const isGood = trend ? (trend.invert ? trend.dir === 'down' : trend.dir === 'up') : false;
  const trendColor = !trend ? '' :
    trend.dir === 'flat' ? 'text-muted-foreground' :
    isGood ? 'text-[var(--status-success-fg)]' : 'text-[var(--status-danger-fg)]';
  const TrendIcon = trend?.dir === 'up' ? TrendingUp : trend?.dir === 'down' ? TrendingDown : Minus;

  return (
    <div className={cn(
      'rounded-xl border border-border bg-[var(--surface-1)]',
      'p-5 shadow-[var(--shadow-card)] overflow-hidden',
      'transition-shadow duration-200 hover:shadow-[var(--shadow-raised)]',
      accent !== 'default' && ACCENT_BAR_CLS[accent],
      className,
    )}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground leading-none">
          {label}
        </p>
        {icon && (
          <span className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            ACCENT_ICON_CLS[accent],
          )}>
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-4">
          <Skeleton className="h-8 w-28" />
        </div>
      ) : (
        <p className={cn(
          'mt-3 text-[28px] font-bold tabular-nums leading-none text-foreground',
          valueClassName,
        )}>
          {value ?? '—'}
          {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        </p>
      )}
      {trend && !loading && trend.pct !== undefined && trend.dir !== 'flat' ? (
        <div className={cn('mt-2.5 flex items-center gap-1 text-xs', trendColor)}>
          <TrendIcon className="size-3 shrink-0" />
          <span className="font-semibold tabular-nums">{trend.pct > 0 ? '+' : ''}{trend.pct.toFixed(1)}%</span>
          {trend.label && <span className="text-muted-foreground">{trend.label}</span>}
        </div>
      ) : subLabel && !loading ? (
        <p className="mt-2 text-xs text-muted-foreground">{subLabel}</p>
      ) : null}
    </div>
  );
}

export function StatCardGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const gridCls = {
    2: 'grid grid-cols-1 gap-4 sm:grid-cols-2',
    3: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid grid-cols-2 gap-4 lg:grid-cols-4',
  }[cols];
  return <div className={gridCls}>{children}</div>;
}
