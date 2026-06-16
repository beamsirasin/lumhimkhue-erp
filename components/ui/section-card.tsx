import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DataCardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove body padding — use for tables/maps that bleed to card edges. */
  noPadding?: boolean;
}

export function DataCard({ title, subtitle, actions, footer, children, className, noPadding }: DataCardProps) {
  return (
    <div className={cn(
      'rounded-xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)] overflow-hidden',
      className,
    )}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            {title && (
              <p className="text-[13px] font-semibold text-foreground leading-tight">{title}</p>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      <div className={noPadding ? '' : 'p-5'}>{children}</div>
      {footer && (
        <div className="border-t border-border bg-[var(--surface-2)] px-5 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}

/** @deprecated Use DataCard */
export const SectionCard = DataCard;

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function SectionHeader({ title, subtitle, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
