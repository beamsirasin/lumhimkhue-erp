import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function EmptyState({ icon, title, description, action, className, size = 'md' }: EmptyStateProps) {
  const sizeCls = {
    sm: 'py-8',
    md: 'py-12',
    lg: 'py-20',
  }[size];

  return (
    <div className={cn('flex flex-col items-center justify-center text-center', sizeCls, className)}>
      {icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1.5 text-xs text-muted-foreground max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
