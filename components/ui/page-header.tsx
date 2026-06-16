import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  /** Remove the bottom border+margin separator (for pages with tight layout). */
  noBorder?: boolean;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
  noBorder = false,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn(
      !noBorder && 'border-b border-border pb-5',
      className,
    )}>
      {breadcrumb && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {breadcrumb}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground leading-none">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          )}
          {children}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
