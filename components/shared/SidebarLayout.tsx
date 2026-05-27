'use client';

import { useState } from 'react';
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
  Package,
  Users,
  BarChart3,
  Settings,
  Menu,
  LogOut,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { logoutAction } from '@/lib/actions/auth';
import type { Role } from '@/lib/auth/permissions';

/* ─── Types ─────────────────────────────────────────────────── */

type NavItem = { href: string; label: string; Icon: LucideIcon };
type NavSection = { heading?: string; items: NavItem[] };

/* ─── Nav config per role ────────────────────────────────────── */

const NAV: Record<Role, NavSection[]> = {
  owner: [
    {
      items: [
        { href: '/dashboard', label: 'แดชบอร์ด', Icon: LayoutDashboard },
        { href: '/pos',       label: 'POS',        Icon: ShoppingCart },
        { href: '/kds',       label: 'ครัว',        Icon: ChefHat },
        { href: '/queue',     label: 'คิว',         Icon: UsersRound },
        { href: '/tables',    label: 'โต๊ะ',         Icon: Grid3X3 },
      ],
    },
    {
      heading: 'จัดการ',
      items: [
        { href: '/menu',      label: 'เมนูอาหาร',   Icon: UtensilsCrossed },
        { href: '/packages',  label: 'แพ็กเกจ',      Icon: Package },
        { href: '/users',     label: 'พนักงาน',      Icon: Users },
        { href: '/reports',   label: 'รายงาน',       Icon: BarChart3 },
        { href: '/settings',  label: 'ตั้งค่า',       Icon: Settings },
      ],
    },
  ],
  cashier: [
    {
      items: [
        { href: '/pos',    label: 'POS',   Icon: ShoppingCart },
        { href: '/kds',    label: 'ครัว',  Icon: ChefHat },
        { href: '/tables', label: 'โต๊ะ',  Icon: Grid3X3 },
        { href: '/queue',  label: 'คิว',   Icon: UsersRound },
      ],
    },
  ],
  kitchen: [
    {
      items: [
        { href: '/kds',    label: 'ครัว', Icon: ChefHat },
        { href: '/tables', label: 'โต๊ะ', Icon: Grid3X3 },
        { href: '/queue',  label: 'คิว',  Icon: UsersRound },
      ],
    },
  ],
};

/* ─── Page title map ─────────────────────────────────────────── */

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'แดชบอร์ด',
  '/pos':       'POS / แคชเชียร์',
  '/kds':       'ครัว (KDS)',
  '/queue':     'จัดการคิว',
  '/tables':    'จัดการโต๊ะ',
  '/menu':      'เมนูอาหาร',
  '/packages':  'แพ็กเกจ',
  '/users':     'พนักงาน',
  '/reports':   'รายงาน',
  '/settings':  'ตั้งค่า',
};

const ROLE_LABEL: Record<Role, string> = {
  owner:   'เจ้าของร้าน',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const key = Object.keys(PAGE_TITLES).find(
    (k) => k.length > 1 && pathname.startsWith(k + '/'),
  );
  return key ? PAGE_TITLES[key] : '';
}

/* ─── Sub-components (defined outside to avoid re-mount) ────── */

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
            {section.items.map(({ href, label, Icon }) => {
              const isActive =
                pathname === href || pathname.startsWith(href + '/');
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

/* ─── Main export ────────────────────────────────────────────── */

interface SidebarLayoutProps {
  role: Role;
  userName: string;
  children: React.ReactNode;
}

export function SidebarLayout({ role, userName, children }: SidebarLayoutProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sections = NAV[role] ?? [];
  const pageTitle = getPageTitle(pathname);

  const innerProps = { role, userName, sections, pathname };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* ── Desktop sidebar (fixed) ── */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-20 w-64 border-r border-slate-200">
        <SidebarInner {...innerProps} />
      </aside>

      {/* ── Right content area ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden lg:pl-64">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          {/* Mobile hamburger + sheet drawer */}
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

          {/* Page title */}
          {pageTitle && (
            <h1 className="text-sm font-semibold text-slate-900">{pageTitle}</h1>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
