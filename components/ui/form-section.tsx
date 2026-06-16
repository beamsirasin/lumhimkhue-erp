import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {(title || description) && (
        <div>
          {title && <p className="text-[13px] font-semibold text-foreground">{title}</p>}
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

interface FormRowProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function FormRow({ label, hint, error, required, children, className, id }: FormRowProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-foreground"
      >
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

interface FormActionsProps {
  children: ReactNode;
  align?: 'left' | 'right';
}

export function FormActions({ children, align = 'right' }: FormActionsProps) {
  return (
    <div className={cn('flex items-center gap-2 pt-2', align === 'right' && 'justify-end')}>
      {children}
    </div>
  );
}
