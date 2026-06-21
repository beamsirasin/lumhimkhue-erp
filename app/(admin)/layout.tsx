import Script from 'next/script';
import { redirect } from 'next/navigation';
import { requireActiveSessionUser } from '@/lib/auth/require-active';
import { SidebarLayout } from '@/components/shared/SidebarLayout';
import { ThemeProvider } from '@/components/shared/ThemeProvider';
import { getInventoryAlertCount } from '@/lib/actions/inventory';
import { getMenuLabels } from '@/lib/actions/store';
import type { Role } from '@/lib/auth/permissions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { freshUser } = await requireActiveSessionUser();
  if (freshUser.role !== 'owner') redirect('/');

  const [{ lowStockCount, pendingApprovalCount }, menuLabels] = await Promise.all([
    getInventoryAlertCount(),
    getMenuLabels(),
  ]);

  const badgeCounts: Record<string, number> = {};
  if (lowStockCount > 0) badgeCounts['/inventory'] = lowStockCount;
  if (pendingApprovalCount > 0) badgeCounts['/inventory/orders'] = pendingApprovalCount;

  return (
    <>
      <Script
        id="admin-theme-init"
        dangerouslySetInnerHTML={{
          __html: `try{var t=localStorage.getItem('lumhimkhue-admin-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}`,
        }}
      />
      <ThemeProvider>
        <SidebarLayout
          role={freshUser.role as Role}
          userName={freshUser.name}
          badgeCounts={badgeCounts}
          uiLayout={freshUser.uiLayout ?? null}
          allowedModules={freshUser.allowedModules ?? []}
          navLayout={freshUser.navLayout ?? null}
          menuLabels={menuLabels}
          showThemeToggle
        >
          {children}
        </SidebarLayout>
      </ThemeProvider>
    </>
  );
}
