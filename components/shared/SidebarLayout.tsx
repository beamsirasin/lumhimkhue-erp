'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  UsersRound,
  Grid3X3,
  UtensilsCrossed,
  Tag,
  Users,
  BarChart3,
  Settings,
  Menu,
  LogOut,
  Printer,
  History,
  ChevronDown,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  CreditCard,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { logoutAction } from '@/lib/actions/auth';
import type { Role } from '@/lib/auth/permissions';

/* ─── Types ─────────────────────────────────────────────────── */

type NavItem = { href: string; label: string; Icon: LucideIcon };
type NavSection = {
  heading?: string;
  items: (NavItem | NavGroup)[];
};
type NavGroup = {
  label: string;
  Icon: LucideIcon;
  matchPrefix: string;
  children: NavItem[];
};

function isNavGroup(item: NavItem | NavGroup): item is NavGroup {
  return 'children' in item;
}

/* ─── Nav config per role ────────────────────────────────────── */

const tableGroup: NavGroup = {
  label: 'จัดการโต๊ะ',
  Icon: Grid3X3,
  matchPrefix: '/tables',
  children: [
    { href: '/tables',         label: 'ดูโต๊ะ',     Icon: Grid3X3 },
    { href: '/tables/history', label: 'ประวัติโต๊ะ', Icon: History },
  ],
};

const NAV: Record<Role, NavSection[]> = {
  owner: [
    {
      items: [
        { href: '/dashboard', label: 'แดชบอร์ด', Icon: LayoutDashboard },
        { href: '/pos',       label: 'POS',       Icon: ShoppingCart },
        { href: '/kds',       label: 'ครัว',       Icon: ChefHat },
        { href: '/queue',     label: 'คิว',        Icon: UsersRound },
        tableGroup,
      ],
    },
    {
      heading: 'จัดการ',
      items: [
        { href: '/menu',                label: 'เมนูอาหาร',     Icon: UtensilsCrossed },
        { href: '/pricing-tiles', label: 'Pricing Tiles', Icon: Tag },
        { href: '/users',               label: 'พนักงาน',        Icon: Users },
        { href: '/reports',             label: 'รายงาน',         Icon: BarChart3 },
        { href: '/settings',            label: 'ตั้งค่า',         Icon: Settings },
        { href: '/printers',            label: 'เครื่องพิมพ์',   Icon: Printer },
      ],
    },
  ],
  manager: [
    {
      items: [
        { href: '/pos',   label: 'POS',  Icon: ShoppingCart },
        { href: '/kds',   label: 'ครัว',  Icon: ChefHat },
        { href: '/queue', label: 'คิว',   Icon: UsersRound },
        tableGroup,
      ],
    },
    {
      heading: 'จัดการ',
      items: [
        { href: '/pricing-tiles', label: 'Pricing Tiles', Icon: Tag },
        { href: '/printers',            label: 'เครื่องพิมพ์',   Icon: Printer },
      ],
    },
  ],
  cashier: [
    {
      items: [
        { href: '/pos',      label: 'POS',          Icon: ShoppingCart },
        { href: '/kds',      label: 'ครัว',          Icon: ChefHat },
        tableGroup,
        { href: '/queue',    label: 'คิว',            Icon: UsersRound },
        { href: '/printers', label: 'เครื่องพิมพ์',   Icon: Printer },
      ],
    },
  ],
  kitchen: [
    {
      items: [
        { href: '/kds',      label: 'ครัว',          Icon: ChefHat },
        tableGroup,
        { href: '/queue',    label: 'คิว',            Icon: UsersRound },
        { href: '/printers', label: 'เครื่องพิมพ์',   Icon: Printer },
      ],
    },
  ],
};

/* ─── Page title map ─────────────────────────────────────────── */

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':             'แดชบอร์ด',
  '/pos':                   'POS / แคชเชียร์',
  '/pos/history':           'ประวัติชำระเงิน',
  '/kds':                   'ครัว (KDS)',
  '/queue':                 'จัดการคิว',
  '/tables':                'จัดการโต๊ะ',
  '/tables/history':        'ประวัติ session',
  '/menu':                  'เมนูอาหาร',
  '/pricing-tiles':   'Pricing Tiles',
  '/users':                 'พนักงาน',
  '/reports':               'รายงาน',
  '/settings':              'ตั้งค่า',
  '/printers':              'เครื่องพิมพ์',
};

const ROLE_LABEL: Record<Role, string> = {
  owner:   'เจ้าของร้าน',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const key = Object.keys(PAGE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find((k) => k.length > 1 && pathname.startsWith(k + '/'));
  return key ? PAGE_TITLES[key] : '';
}

/* ─── NavGroup component (collapsible) ──────────────────────── */

function NavGroupItem({
  group,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate?: () => void;
}) {
  const isGroupActive = pathname === group.matchPrefix || pathname.startsWith(group.matchPrefix + '/');
  const [open, setOpen] = useState(isGroupActive);
  const { Icon } = group;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        isGroupActive
          ? 'bg-slate-800 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}>
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-0.5 ml-4 border-l border-slate-200 pl-3 space-y-0.5">
          {group.children.map(({ href, label, Icon: ChildIcon }) => {
            const isActive = href === '/tables'
              ? pathname === '/tables'
              : pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <ChildIcon className="size-3.5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─── NavItems ───────────────────────────────────────────────── */

function NavItems({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {sections.map((section, i) => (
        <div key={i}>
          {section.heading && (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section.heading}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              if (isNavGroup(item)) {
                return (
                  <NavGroupItem
                    key={item.matchPrefix}
                    group={item}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                );
              }

              const { href, label, Icon } = item;
              const isActive = pathname === href || (href.length > 1 && pathname.startsWith(href + '/'));
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarInner({
  role,
  userName,
  sections,
  pathname,
  onNavigate,
}: {
  role: Role;
  userName: string;
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-white">
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
        <Image
          src="/images/logo.png"
          alt="ร้านชาบู ERP"
          width={32}
          height={32}
          className="rounded object-contain"
        />
        <span className="text-sm font-semibold text-slate-900">ร้านชาบู ERP</span>
      </div>

      {/* Navigation */}
      <NavItems sections={sections} pathname={pathname} onNavigate={onNavigate} />

      {/* User info + logout */}
      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
            <p className="truncate text-xs text-slate-500">{ROLE_LABEL[role]}</p>
          </div>
        </div>
        <form action={logoutAction} className="mt-1">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <LogOut className="size-4 shrink-0" />
            ออกจากระบบ
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Standard sidebar layout (owner / manager / kitchen) ───── */

function StandardSidebarLayout({
  role,
  userName,
  children,
  pathname,
}: {
  role: Role;
  userName: string;
  children: React.ReactNode;
  pathname: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = NAV[role] ?? [];
  const pageTitle = getPageTitle(pathname);
  const innerProps = { role, userName, sections, pathname };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-20 w-64 border-r border-slate-200">
        <SidebarInner {...innerProps} />
      </aside>

      {/* Right content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden lg:pl-64">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <Sheet open={mobileOpen} onOpenChange={(open) => setMobileOpen(open)}>
            <SheetTrigger
              aria-label="เปิดเมนู"
              className="flex lg:hidden items-center justify-center rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
              <SidebarInner
                {...innerProps}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          {pageTitle && (
            <h1 className="text-sm font-semibold text-slate-900">{pageTitle}</h1>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

/* ─── Bottom-tab layout (cashier + kitchen) ───────────────────── */

type TabItem     = { href: string; label: string; Icon: LucideIcon };
type MoreItem    = { href: string; label: string; Icon: LucideIcon };

const BOTTOM_TABS: Record<'cashier' | 'kitchen', TabItem[]> = {
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

const BOTTOM_MORE_ITEMS: Record<'cashier' | 'kitchen', MoreItem[]> = {
  cashier: [
    { href: '/tables/history', label: 'ประวัติโต๊ะ',    Icon: History },
    { href: '/pos/history',    label: 'ประวัติชำระเงิน', Icon: CreditCard },
    { href: '/printers',       label: 'เครื่องพิมพ์',    Icon: Printer },
  ],
  kitchen: [
    { href: '/tables/history', label: 'ประวัติโต๊ะ',  Icon: History },
    { href: '/printers',       label: 'เครื่องพิมพ์', Icon: Printer },
  ],
};

function CashierLayout({
  role,
  userName,
  children,
  pathname,
}: {
  role: 'cashier' | 'kitchen';
  userName: string;
  children: React.ReactNode;
  pathname: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const pageTitle = getPageTitle(pathname);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      {/* Thin top header */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4">
        <Image
          src="/images/logo.png"
          alt="ERP"
          width={22}
          height={22}
          className="rounded object-contain shrink-0"
        />
        <h1 className="flex-1 truncate text-sm font-semibold text-slate-900">
          {pageTitle || 'ร้านชาบู ERP'}
        </h1>
        <span className="shrink-0 text-xs text-slate-400">{userName}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="ออกจากระบบ"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* Bottom tab bar */}
      <nav className="relative flex h-[60px] shrink-0 items-stretch border-t border-slate-200 bg-white">
        {/* Nav tabs */}
        {BOTTOM_TABS[role].map(({ href, label, Icon: TabIcon }) => {
          const isActive =
            href === '/tables'
              ? pathname === '/tables' || pathname.startsWith('/tables/')
              : pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {isActive && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-slate-800" />
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
          className="relative flex flex-1 flex-col items-center justify-center gap-0.5 text-slate-400 hover:text-slate-600 transition-colors"
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
          className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
            moreOpen ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {moreOpen && (
            <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-slate-800" />
          )}
          <MoreHorizontal className="size-[22px]" />
          <span className="text-[10px] font-medium leading-none">เพิ่มเติม</span>
        </button>

        {/* More popover — floats above the tab bar */}
        {moreOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMoreOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute bottom-[calc(100%+6px)] right-0 z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
              {BOTTOM_MORE_ITEMS[role].map(({ href, label, Icon: ItemIcon }) => {
                const isActive = pathname === href || pathname.startsWith(href + '/');
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-50 text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <ItemIcon className="size-4 shrink-0 text-slate-500" />
                    {label}
                  </Link>
                );
              })}
              <div className="border-t border-slate-100" />
              <form action={logoutAction} onSubmit={() => setMoreOpen(false)}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
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
  );
}

/* ─── Main export ────────────────────────────────────────────── */

interface SidebarLayoutProps {
  role: Role;
  userName: string;
  children: React.ReactNode;
}

export function SidebarLayout({ role, userName, children }: SidebarLayoutProps) {
  const pathname = usePathname();

  if (role === 'cashier' || role === 'kitchen') {
    return (
      <CashierLayout role={role} userName={userName} pathname={pathname}>
        {children}
      </CashierLayout>
    );
  }

  return (
    <StandardSidebarLayout role={role} userName={userName} pathname={pathname}>
      {children}
    </StandardSidebarLayout>
  );
}
