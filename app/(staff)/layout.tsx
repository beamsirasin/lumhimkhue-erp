import { requireActiveSessionUser } from '@/lib/auth/require-active';
import { SidebarLayout } from '@/components/shared/SidebarLayout';
import { getMenuLabels } from '@/lib/actions/store';
import type { Role } from '@/lib/auth/permissions';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { freshUser } = await requireActiveSessionUser();
  const menuLabels = await getMenuLabels();

  return (
    <SidebarLayout
      role={freshUser.role as Role}
      userName={freshUser.name}
      uiLayout={freshUser.uiLayout ?? null}
      allowedModules={freshUser.allowedModules ?? []}
      navLayout={freshUser.navLayout ?? null}
      menuLabels={menuLabels}
    >
      {children}
    </SidebarLayout>
  );
}
