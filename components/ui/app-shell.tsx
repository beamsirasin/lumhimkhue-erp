import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

export function AppShell({ children, className }: AppShellProps) {
  return (
    <div className={cn('mx-auto w-full px-6 py-5 max-w-[1400px] space-y-6', className)}>
      {children}
    </div>
  );
}
