'use client';

import dynamic from 'next/dynamic';
import type { Role } from '@/lib/auth/permissions';
import type { StoredNavLayout } from './nav-config';

// Re-export so existing importers (e.g. TableGrid) don't need to change.
export { CashierHeaderSlotContext } from './cashier-header-slot';

/**
 * Dynamic imports create separate JS chunks so that:
 *   - Touchscreen/cashier users download CashierLayout only (~no sidebar code)
 *   - Desktop/admin users download StandardSidebarLayout only (~no bottom-tab code)
 */
const CashierLayout = dynamic(() =>
  import('./CashierLayout').then((m) => ({ default: m.CashierLayout })),
);

const StandardSidebarLayout = dynamic(() =>
  import('./StandardSidebarLayout').then((m) => ({ default: m.StandardSidebarLayout })),
);

export interface SidebarLayoutProps {
  role: Role;
  userName: string;
  children: React.ReactNode;
  badgeCounts?: Record<string, number>;
  uiLayout?: 'touchscreen' | 'desktop' | 'tablet' | null;
  allowedModules?: string[] | null;
  navLayout?: StoredNavLayout;
  menuLabels?: Record<string, string>;
  showThemeToggle?: boolean;
}

export function SidebarLayout({
  role,
  userName,
  children,
  badgeCounts,
  uiLayout,
  allowedModules,
  navLayout,
  menuLabels,
  showThemeToggle = false,
}: SidebarLayoutProps) {
  const modules = allowedModules ?? [];

  // Explicit uiLayout overrides role-based fallback.
  const useTouchscreen =
    uiLayout === 'touchscreen' ||
    (uiLayout == null && (role === 'cashier' || role === 'kitchen'));
  const useTablet = uiLayout === 'tablet';

  if (useTouchscreen) {
    return (
      <CashierLayout role={role} userName={userName} allowedModules={modules} navLayout={navLayout} menuLabels={menuLabels}>
        {children}
      </CashierLayout>
    );
  }

  return (
    <StandardSidebarLayout
      role={role}
      userName={userName}
      badgeCounts={badgeCounts}
      allowedModules={modules}
      navLayout={navLayout}
      menuLabels={menuLabels}
      variant={useTablet ? 'tablet' : 'default'}
      showThemeToggle={showThemeToggle}
    >
      {children}
    </StandardSidebarLayout>
  );
}
