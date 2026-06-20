'use client';

import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/shared/ThemeProvider';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // resolvedTheme is undefined until ThemeProvider mounts after hydration.
  // Render the same disabled <button> on server, first hydration, and unmounted state
  // so the DOM element type never changes across the hydration boundary.
  if (!resolvedTheme) {
    return (
      <button
        type="button"
        disabled
        aria-label="กำลังโหลดธีม"
        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/40"
      >
        <Moon className="size-4" />
      </button>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  );
}
