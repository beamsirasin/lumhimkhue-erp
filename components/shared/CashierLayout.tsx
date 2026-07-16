'use client';

import { useState, useEffect, useContext } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShoppingCart,
  ChefHat,
  UsersRound,
  Grid3X3,
  History,
  CreditCard,
  Printer,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  LogOut,
  Clock,
} from 'lucide-react';
import { logoutAction } from '@/lib/actions/auth';
import type { Role } from '@/lib/auth/permissions';
import {
  MODULE_HREFS,
  TOUCHSCREEN_TAB_MODULE,
  isHrefAllowed,
  getPageTitle,
} from './nav-config';
import type { TabItem, MoreItem, StoredNavLayout } from './nav-config';
import { CashierHeaderSlotContext } from './cashier-header-slot';

/* ─── Default tab sets per role ───────────────────────────────── */

const ROLE_TABS: Record<'cashier' | 'kitchen', TabItem[]> = {
  cashier: [
    { href: '/pos',    label: 'POS',  Icon: ShoppingCart },
    { href: '/kds',    label: 'ครัว', Icon: ChefHat },
    { href: '/tables', label: 'โต๊ะ', Icon: Grid3X3 },
    { href: '/queue',  label: 'คิว',  Icon: UsersRound },
  ],
  kitchen: [
    { href: '/kds',    label: 'ครัว', Icon: ChefHat },
    { href: '/tables', label: 'โต๊ะ', Icon: Grid3X3 },
    { href: '/queue',  label: 'คิว',  Icon: UsersRound },
  ],
};

const ROLE_MORE: Record<'cashier' | 'kitchen', MoreItem[]> = {
  cashier: [
    { href: '/pos/shifts',     label: 'รอบแคชเชียร์',     Icon: Clock },
    { href: '/kds/history',    label: 'ประวัติครัว',     Icon: ChefHat },
    { href: '/tables/history', label: 'ประวัติโต๊ะ',    Icon: History },
    { href: '/queue/history',  label: 'ประวัติคิว',      Icon: UsersRound },
    { href: '/pos/history',    label: 'ประวัติชำระเงิน', Icon: CreditCard },
    { href: '/printers',       label: 'เครื่องพิมพ์',    Icon: Printer },
  ],
  kitchen: [
    { href: '/pos/shifts',     label: 'รอบแคชเชียร์',  Icon: Clock },
    { href: '/kds/history',    label: 'ประวัติครัว',   Icon: ChefHat },
    { href: '/tables/history', label: 'ประวัติโต๊ะ',  Icon: History },
    { href: '/queue/history',  label: 'ประวัติคิว',    Icon: UsersRound },
    { href: '/printers',       label: 'เครื่องพิมพ์', Icon: Printer },
  ],
};

const ALL_TABS: TabItem[] = [
  { href: '/pos',    label: 'POS',  Icon: ShoppingCart },
  { href: '/kds',    label: 'ครัว', Icon: ChefHat },
  { href: '/tables', label: 'โต๊ะ', Icon: Grid3X3 },
  { href: '/queue',  label: 'คิว',  Icon: UsersRound },
];

const ALL_MORE: MoreItem[] = [
  { href: '/pos/shifts',     label: 'รอบแคชเชียร์',     Icon: Clock },
  { href: '/kds/history',    label: 'ประวัติครัว',     Icon: ChefHat },
  { href: '/tables/history', label: 'ประวัติโต๊ะ',    Icon: History },
  { href: '/queue/history',  label: 'ประวัติคิว',      Icon: UsersRound },
  { href: '/pos/history',    label: 'ประวัติชำระเงิน', Icon: CreditCard },
  { href: '/printers',       label: 'เครื่องพิมพ์',    Icon: Printer },
];

/* ─── Tab computation (respects navLayout order + menuLabels) ─── */

function computeTabs(
  role: Role,
  allowedModules: string[],
  navLayout: StoredNavLayout | null,
  menuLabels: Record<string, string>,
): { tabs: TabItem[]; moreTabs: MoreItem[] } {
  // Determine module order: navLayout takes priority over allowedModules
  const moduleOrder: string[] = navLayout?.sections
    ? navLayout.sections.flatMap((s) => s.modules)
    : allowedModules;

  let tabs: TabItem[];
  let moreTabs: MoreItem[];

  if (allowedModules.length > 0) {
    const filtered = ALL_TABS.filter((t) => isHrefAllowed(t.href, allowedModules));
    tabs = [...filtered].sort((a, b) => {
      const ma = Object.entries(TOUCHSCREEN_TAB_MODULE).find(([, href]) => href === a.href)?.[0];
      const mb = Object.entries(TOUCHSCREEN_TAB_MODULE).find(([, href]) => href === b.href)?.[0];
      const ia = ma !== undefined ? moduleOrder.indexOf(ma) : -1;
      const ib = mb !== undefined ? moduleOrder.indexOf(mb) : -1;
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    moreTabs = ALL_MORE.filter((t) => isHrefAllowed(t.href, allowedModules));
  } else {
    const r = role === 'cashier' || role === 'kitchen' ? role : 'cashier';
    tabs = [...ROLE_TABS[r]];
    moreTabs = [...ROLE_MORE[r]];
  }

  // Apply menuLabels overrides
  if (Object.keys(menuLabels).length > 0) {
    tabs = tabs.map((t) => {
      const modId = Object.entries(TOUCHSCREEN_TAB_MODULE).find(([, href]) => href === t.href)?.[0];
      return modId && menuLabels[modId] ? { ...t, label: menuLabels[modId] } : t;
    });
    moreTabs = moreTabs.map((t) => {
      const modId = Object.entries(MODULE_HREFS).find(([, hrefs]) => hrefs.includes(t.href))?.[0];
      return modId && menuLabels[modId] ? { ...t, label: menuLabels[modId] } : t;
    });
  }

  return { tabs, moreTabs };
}

/* ─── CashierLayout ───────────────────────────────────────────── */

export interface CashierLayoutProps {
  role: Role;
  userName: string;
  children: React.ReactNode;
  allowedModules: string[];
  navLayout?: StoredNavLayout;
  menuLabels?: Record<string, string>;
}

export function CashierLayout({ role, userName, children, allowedModules, navLayout, menuLabels }: CashierLayoutProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [headerSlotContent, setHeaderSlotContent] = useState<React.ReactNode>(null);

  const setCashierSlot = useContext(CashierHeaderSlotContext);
  void setCashierSlot; // context is provided by this component — keep reference stable

  const { tabs, moreTabs } = computeTabs(role, allowedModules, navLayout ?? null, menuLabels ?? {});
  const pageTitle = getPageTitle(pathname);

  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <CashierHeaderSlotContext.Provider value={setHeaderSlotContent}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
        {/* Thin top header */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <Image
            src="/images/logo.png"
            alt="ERP"
            width={22}
            height={22}
            className="rounded object-contain shrink-0"
          />
          <h1 className="truncate text-sm font-semibold text-foreground">
            {pageTitle || 'ร้านชาบู ERP'}
          </h1>
          {headerSlotContent && (
            <div className="flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
              {headerSlotContent}
            </div>
          )}
          {!headerSlotContent && <span className="flex-1" />}
          <span className="shrink-0 text-xs text-muted-foreground">{userName}</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>

        {/* Bottom tab bar */}
        <nav className="relative flex h-[62px] shrink-0 items-stretch border-t border-border bg-card">
          {tabs.map(({ href, label, Icon: TabIcon }) => {
            const isActive =
              href === '/tables'
                ? pathname === '/tables' || pathname.startsWith('/tables/')
                : pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150 ${
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {isActive && (
                  <span className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-primary" />
                )}
                <TabIcon className="size-[22px]" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </Link>
            );
          })}

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'ออกจากเต็มจอ' : 'เปิดเต็มจอ'}
            className="relative flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            {isFullscreen ? (
              <Minimize2 className="size-[22px]" />
            ) : (
              <Maximize2 className="size-[22px]" />
            )}
            <span className="text-[10px] font-medium leading-none">
              {isFullscreen ? 'ย่อจอ' : 'เต็มจอ'}
            </span>
          </button>

          {/* More button */}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-label="เมนูเพิ่มเติม"
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150 ${
              moreOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {moreOpen && (
              <span className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-primary" />
            )}
            <MoreHorizontal className="size-[22px]" />
            <span className="text-[10px] font-medium leading-none">เพิ่มเติม</span>
          </button>

          {/* More popover */}
          {moreOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMoreOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute bottom-[calc(100%+8px)] right-2 z-50 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                {moreTabs.map(({ href, label, Icon: ItemIcon }) => {
                  const isActive = pathname === href || pathname.startsWith(href + '/');
                  return (
                    <Link
                      key={href}
                      href={href}
                      prefetch={false}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors duration-100 ${
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-popover-foreground hover:bg-accent'
                      }`}
                    >
                      <ItemIcon className="size-4 shrink-0 text-muted-foreground" />
                      {label}
                    </Link>
                  );
                })}
                <div className="border-t border-border" />
                <form action={logoutAction} onSubmit={() => setMoreOpen(false)}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <LogOut className="size-4 shrink-0" />
                    ออกจากระบบ
                  </button>
                </form>
              </div>
            </>
          )}
        </nav>
      </div>
    </CashierHeaderSlotContext.Provider>
  );
}
