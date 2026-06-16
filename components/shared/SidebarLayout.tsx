'use client';

import { useState, useEffect, useRef, createContext, useContext, type ReactNode } from 'react';
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
  Info,
  Menu,
  LogOut,
  Printer,
  History,
  ChevronDown,
  ChevronLeft,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  CreditCard,
  Boxes,
  ClipboardList,
  Truck,
  ShoppingBag,
  Package,
  UserCog,
  Calendar,
  Clock,
  Wallet,
  BookOpen,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { logoutAction } from '@/lib/actions/auth';
import type { Role } from '@/lib/auth/permissions';

/* ─── Header slot context (lets pages inject content into CashierLayout header) ─ */

export const CashierHeaderSlotContext = createContext<((node: ReactNode) => void) | null>(null);

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

/* ─── Module → hrefs mapping ────────────────────────────────── */

const MODULE_HREFS: Record<string, string[]> = {
  pos:             ['/pos', '/pos/history'],
  kds:             ['/kds', '/kds/history'],
  queue:           ['/queue', '/queue/history'],
  tables:          ['/tables', '/tables/history'],
  dashboard:       ['/dashboard'],
  menu:            ['/menu'],
  recipes:         ['/recipes'],
  'pricing-tiles': ['/pricing-tiles'],
  inventory:       ['/inventory', '/inventory/count', '/inventory/ingredients', '/inventory/suppliers', '/inventory/orders'],
  reports:         ['/reports'],
  settings:        ['/settings'],
  users:           ['/users'],
  hr:              ['/hr', '/hr/employees', '/hr/schedule', '/hr/time', '/hr/payroll', '/hr/settings'],

  printers:        ['/printers'],
  system:          ['/system'],
};

function isHrefAllowed(href: string, modules: string[]): boolean {
  if (!modules.length) return true;
  return modules.some((m) => {
    const hrefs = MODULE_HREFS[m] ?? [];
    return hrefs.some((h) => href === h || href.startsWith(h + '/'));
  });
}

function filterSections(sections: NavSection[], modules: string[]): NavSection[] {
  if (!modules.length) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => {
          if (isNavGroup(item)) {
            const filteredChildren = item.children.filter((c) => isHrefAllowed(c.href, modules));
            return filteredChildren.length ? { ...item, children: filteredChildren } : null;
          }
          return isHrefAllowed(item.href, modules) ? item : null;
        })
        .filter(Boolean) as (NavItem | NavGroup)[],
    }))
    .filter((s) => s.items.length > 0);
}

function getModuleForNavItem(item: NavItem | NavGroup): string | null {
  const testHref = isNavGroup(item) ? item.matchPrefix : item.href;
  for (const [mod, hrefs] of Object.entries(MODULE_HREFS)) {
    if (hrefs.some((h) => h === testHref || testHref.startsWith(h + '/') || h.startsWith(testHref + '/'))) {
      return mod;
    }
  }
  return null;
}

function buildModuleItemMap(role: Role): Map<string, NavItem | NavGroup> {
  const map = new Map<string, NavItem | NavGroup>();
  for (const section of NAV[role] ?? []) {
    for (const item of section.items) {
      const modId = getModuleForNavItem(item);
      if (modId) map.set(modId, item);
    }
  }
  return map;
}

type StoredNavLayout = {
  sections: { heading: string; modules: string[] }[];
} | null;

function buildSectionsFromNavLayout(
  navLayout: NonNullable<StoredNavLayout>,
  role: Role,
  allowedModules: string[],
): NavSection[] {
  const modMap = buildModuleItemMap(role);
  const enabledSet = new Set(allowedModules);
  return navLayout.sections
    .map(({ heading, modules }) => ({
      heading: heading || undefined,
      items: modules
        .filter((m) => !enabledSet.size || enabledSet.has(m))
        .map((m) => {
          const item = modMap.get(m);
          if (!item) return null;
          return item;
        })
        .filter((item): item is NavItem | NavGroup => item != null),
    }))
    .filter((s) => s.items.length > 0);
}

function applyMenuLabels(sections: NavSection[], menuLabels: Record<string, string>): NavSection[] {
  if (!Object.keys(menuLabels).length) return sections;
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const modId = getModuleForNavItem(item);
      const customLabel = modId ? menuLabels[modId] : undefined;
      if (!customLabel) return item;
      return { ...item, label: customLabel };
    }),
  }));
}

function reorderSections(sections: NavSection[], modules: string[]): NavSection[] {
  if (!modules.length) return sections;
  return sections.map((section) => ({
    ...section,
    items: [...section.items].sort((a, b) => {
      const ma = getModuleForNavItem(a);
      const mb = getModuleForNavItem(b);
      const ia = ma ? modules.indexOf(ma) : 999;
      const ib = mb ? modules.indexOf(mb) : 999;
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    }),
  }));
}

/* Module ID → primary touchscreen tab href */
const TOUCHSCREEN_TAB_MODULE: Record<string, string> = {
  pos:    '/pos',
  kds:    '/kds',
  tables: '/tables',
  queue:  '/queue',
};

/* ─── Nav config per role ────────────────────────────────────── */

const hrGroup: NavGroup = {
  label: 'พนักงาน (HR)',
  Icon: UserCog,
  matchPrefix: '/hr',
  children: [
    { href: '/hr',           label: 'ภาพรวม',       Icon: LayoutDashboard },
    { href: '/hr/employees', label: 'ข้อมูลพนักงาน', Icon: UsersRound },
    { href: '/hr/schedule',  label: 'ตารางงาน',       Icon: Calendar },
    { href: '/hr/time',      label: 'บันทึกเวลา',     Icon: Clock },
    { href: '/hr/payroll',   label: 'เงินเดือน',       Icon: Wallet },
    { href: '/hr/settings',  label: 'ตั้งค่า HR',      Icon: Settings },
  ],
};

const inventoryGroup: NavGroup = {
  label: 'สต็อก/วัตถุดิบ',
  Icon: Boxes,
  matchPrefix: '/inventory',
  children: [
    { href: '/inventory',              label: 'ภาพรวม',     Icon: Package },
    { href: '/inventory/count',        label: 'นับสต็อก',   Icon: ClipboardList },
    { href: '/inventory/ingredients',  label: 'วัตถุดิบ',   Icon: UtensilsCrossed },
    { href: '/inventory/suppliers',    label: 'ผู้ขาย',      Icon: Truck },
    { href: '/inventory/orders',       label: 'ใบสั่งซื้อ', Icon: ShoppingBag },
  ],
};

const posGroup: NavGroup = {
  label: 'POS',
  Icon: ShoppingCart,
  matchPrefix: '/pos',
  children: [
    { href: '/pos',         label: 'หน้า POS',          Icon: ShoppingCart },
    { href: '/pos/history', label: 'ประวัติชำระเงิน',   Icon: CreditCard },
  ],
};

const kdsGroup: NavGroup = {
  label: 'ครัว (KDS)',
  Icon: ChefHat,
  matchPrefix: '/kds',
  children: [
    { href: '/kds',         label: 'หน้าครัว',     Icon: ChefHat },
    { href: '/kds/history', label: 'ประวัติครัว',  Icon: History },
  ],
};

const tableGroup: NavGroup = {
  label: 'จัดการโต๊ะ',
  Icon: Grid3X3,
  matchPrefix: '/tables',
  children: [
    { href: '/tables',         label: 'ดูโต๊ะ',     Icon: Grid3X3 },
    { href: '/tables/history', label: 'ประวัติโต๊ะ', Icon: History },
  ],
};

const queueGroup: NavGroup = {
  label: 'คิว',
  Icon: UsersRound,
  matchPrefix: '/queue',
  children: [
    { href: '/queue',         label: 'จัดการคิว',  Icon: UsersRound },
    { href: '/queue/history', label: 'ประวัติคิว', Icon: History },
  ],
};

const NAV: Record<Role, NavSection[]> = {
  owner: [
    {
      heading: 'หน้าบ้าน',
      items: [
        posGroup,
        kdsGroup,
        queueGroup,
        tableGroup,
      ],
    },
    {
      heading: 'จัดการ',
      items: [
        { href: '/dashboard',     label: 'แดชบอร์ด',     Icon: LayoutDashboard },
        { href: '/menu',          label: 'เมนูอาหาร',    Icon: UtensilsCrossed },
        { href: '/recipes',       label: 'สูตรอาหาร',    Icon: BookOpen },
        { href: '/pricing-tiles', label: 'Pricing Tiles', Icon: Tag },
        inventoryGroup,
        { href: '/reports',       label: 'รายงาน',        Icon: BarChart3 },
        hrGroup,
      ],
    },
    {
      heading: 'ตั้งค่า / Admin',
      items: [
        { href: '/settings', label: 'ตั้งค่าบิล',   Icon: Settings },
        { href: '/users',    label: 'บัญชีผู้ใช้',   Icon: Users },

        { href: '/printers', label: 'เครื่องพิมพ์',  Icon: Printer },
        { href: '/system',   label: 'ข้อมูลระบบ',    Icon: Info },
      ],
    },
  ],
  manager: [
    {
      items: [
        { href: '/pos',   label: 'POS',  Icon: ShoppingCart },
        kdsGroup,
        queueGroup,
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
        queueGroup,
        { href: '/printers', label: 'เครื่องพิมพ์',   Icon: Printer },
      ],
    },
  ],
  kitchen: [
    {
      items: [
        { href: '/kds',      label: 'ครัว',          Icon: ChefHat },
        tableGroup,
        queueGroup,
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
  '/kds/history':           'ประวัติครัว',
  '/queue':                 'จัดการคิว',
  '/queue/history':         'ประวัติคิว',
  '/tables':                'จัดการโต๊ะ',
  '/tables/history':        'ประวัติโต๊ะ',
  '/menu':                  'เมนูอาหาร',
  '/recipes':               'สูตรอาหาร',
  '/pricing-tiles':         'Pricing Tiles',
  '/users':                 'User',
  '/reports':               'รายงาน',
  '/settings':              'ตั้งค่าบิล',
  '/printers':              'เครื่องพิมพ์',
  '/system':                'ข้อมูลระบบ',
  '/inventory':             'ภาพรวมสต็อก',
  '/inventory/count':       'นับสต็อกรายวัน',
  '/inventory/ingredients': 'วัตถุดิบ',
  '/inventory/suppliers':   'ผู้ขาย (Supplier)',
  '/inventory/orders':      'ใบสั่งซื้อ (PO)',
  '/hr':                    'ภาพรวม HR',
  '/hr/employees':          'ข้อมูลพนักงาน',
  '/hr/schedule':           'ตารางงาน',
  '/hr/time':               'บันทึกเวลา',
  '/hr/payroll':            'เงินเดือน',
  '/hr/settings':           'ตั้งค่า HR',
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

/* ─── Badge ──────────────────────────────────────────────────── */

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* ─── Tooltip for collapsed sidebar ─────────────────────────── */

function SidebarTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={wrapperRef}
      className="w-full"
      onMouseEnter={() => {
        if (!wrapperRef.current || !tipRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        tipRef.current.style.top = `${rect.top + rect.height / 2}px`;
        tipRef.current.style.display = 'block';
      }}
      onMouseLeave={() => {
        if (tipRef.current) tipRef.current.style.display = 'none';
      }}
    >
      {children}
      <div
        ref={tipRef}
        style={{ position: 'fixed', left: 'calc(4rem + 10px)', display: 'none', transform: 'translateY(-50%)' }}
        className="pointer-events-none z-50 whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-lg"
      >
        {label}
      </div>
    </div>
  );
}

/* ─── NavGroup component (collapsible) ──────────────────────── */

function NavGroupItem({
  group,
  pathname,
  onNavigate,
  badgeCounts,
  size = 'default',
  collapsed = false,
  onExpand,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate?: () => void;
  badgeCounts?: Record<string, number>;
  size?: 'default' | 'large';
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const isGroupActive = pathname === group.matchPrefix
    || pathname.startsWith(group.matchPrefix + '/')
    || group.children.some(c => pathname === c.href || (c.href.length > 1 && pathname.startsWith(c.href + '/')));
  const [open, setOpen] = useState(isGroupActive);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const { Icon } = group;
  const totalGroupBadge = group.children.reduce((s, c) => s + (badgeCounts?.[c.href] ?? 0), 0);

  if (collapsed) {
    return (
      <div
        ref={wrapperRef}
        className="w-full"
        onMouseEnter={() => {
          if (!wrapperRef.current || !flyoutRef.current) return;
          const rect = wrapperRef.current.getBoundingClientRect();
          flyoutRef.current.style.top = `${rect.top}px`;
          flyoutRef.current.style.display = 'block';
        }}
        onMouseLeave={() => {
          if (flyoutRef.current) flyoutRef.current.style.display = 'none';
        }}
      >
        <button
          type="button"
          className={`relative flex w-full items-center justify-center rounded-xl p-3 transition-all duration-150 ${
            isGroupActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
          }`}
        >
          <Icon className="size-5 shrink-0" />
          {totalGroupBadge > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-400 shadow-sm" />
          )}
        </button>

        <div
          ref={flyoutRef}
          style={{ position: 'fixed', left: 'calc(4rem + 8px)', top: 0, display: 'none', background: 'var(--sidebar-accent)' }}
          className="z-50 min-w-[180px] overflow-hidden rounded-xl border border-white/10 shadow-xl"
        >
          <p className="border-b border-white/8 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
            {group.label}
          </p>
          <div className="p-1.5 space-y-0.5">
            {group.children.map(({ href, label, Icon: ChildIcon }) => {
              const isActive = href === '/tables'
                ? pathname === '/tables'
                : pathname === href || pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                    isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  }`}
                >
                  <ChildIcon className="size-4 shrink-0" />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const triggerCls = size === 'large'
    ? `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors duration-150`
    : `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150`;
  const iconCls   = size === 'large' ? 'size-5 shrink-0' : 'size-4 shrink-0';
  const childCls  = size === 'large'
    ? `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150`
    : `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150`;
  const childIconCls = size === 'large' ? 'size-4 shrink-0' : 'size-3.5 shrink-0';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={`${triggerCls} ${
        isGroupActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold border-l-[3px] border-l-sidebar-primary'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
      }`}>
        <Icon className={`${iconCls} ${isGroupActive ? 'text-sidebar-primary' : ''}`} />
        <span className="flex-1 text-left">{group.label}</span>
        {!open && totalGroupBadge > 0 && (
          <span className="size-1.5 rounded-full bg-red-400" />
        )}
        <ChevronDown className={`size-3.5 shrink-0 transition-transform duration-200 text-sidebar-foreground/40 ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-0.5 ml-4 border-l border-sidebar-border pl-3 space-y-px">
          {group.children.map(({ href, label, Icon: ChildIcon }) => {
            const isActive = href === '/tables'
              ? pathname === '/tables'
              : pathname === href || pathname.startsWith(href + '/');
            const badge = badgeCounts?.[href] ?? 0;
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                onClick={onNavigate}
                className={`${childCls} ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-[3px] border-l-sidebar-primary'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                }`}
              >
                <ChildIcon className={`${childIconCls} ${isActive ? 'text-sidebar-primary' : ''}`} />
                {label}
                <NavBadge count={badge} />
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
  badgeCounts,
  size = 'default',
  collapsed = false,
  onExpand,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
  badgeCounts?: Record<string, number>;
  size?: 'default' | 'large';
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const itemCls = size === 'large'
    ? 'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors duration-150'
    : 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150';
  const iconCls = size === 'large' ? 'size-5 shrink-0' : 'size-4 shrink-0';

  if (collapsed) {
    const allItems = sections.flatMap((s) => s.items);
    return (
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {allItems.map((item) => {
          if (isNavGroup(item)) {
            return (
              <NavGroupItem
                key={item.matchPrefix}
                group={item}
                pathname={pathname}
                onNavigate={onNavigate}
                badgeCounts={badgeCounts}
                size="large"
                collapsed={true}
                onExpand={onExpand}
              />
            );
          }

          const { href, label, Icon } = item;
          const isActive = pathname === href || (href.length > 1 && pathname.startsWith(href + '/'));
          const badge = badgeCounts?.[href] ?? 0;
          return (
            <SidebarTooltip key={href} label={label}>
              <Link
                href={href}
                prefetch={false}
                onClick={onNavigate}
                className={`relative flex items-center justify-center rounded-xl p-3 transition-all duration-150 ${
                  isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                }`}
              >
                <Icon className={`size-5 shrink-0 transition-colors ${isActive ? 'text-sidebar-primary' : ''}`} />
                {badge > 0 && (
                  <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-400 shadow-sm" />
                )}
              </Link>
            </SidebarTooltip>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {sections.map((section, i) => (
        <div key={i}>
          {section.heading && (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
              {section.heading}
            </p>
          )}
          <div className="space-y-px">
            {section.items.map((item) => {
              if (isNavGroup(item)) {
                return (
                  <NavGroupItem
                    key={item.matchPrefix}
                    group={item}
                    pathname={pathname}
                    onNavigate={onNavigate}
                    badgeCounts={badgeCounts}
                    size={size}
                  />
                );
              }

              const { href, label, Icon } = item;
              const isActive = pathname === href || (href.length > 1 && pathname.startsWith(href + '/'));
              const badge = badgeCounts?.[href] ?? 0;
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  onClick={onNavigate}
                  className={`${itemCls} ${
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold border-l-[3px] border-l-sidebar-primary'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  }`}
                >
                  <Icon className={`${iconCls} ${isActive ? 'text-sidebar-primary' : ''}`} />
                  {label}
                  <NavBadge count={badge} />
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
  badgeCounts,
  size = 'default',
  collapsed = false,
  onToggleCollapse,
}: {
  role: Role;
  userName: string;
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
  badgeCounts?: Record<string, number>;
  size?: 'default' | 'large';
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Logo / Header */}
      {collapsed ? (
        <div className="flex h-14 shrink-0 items-center justify-center border-b border-white/8 bg-[var(--sidebar-header)]">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="ขยาย sidebar"
            className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary/20 ring-1 ring-sidebar-primary/40 hover:bg-sidebar-primary/30 transition-colors"
          >
            <ChevronLeft className="size-4 text-sidebar-primary rotate-180" />
          </button>
        </div>
      ) : (
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/8 px-4 bg-[var(--sidebar-header)]">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/20 ring-1 ring-sidebar-primary/40">
            <Image
              src="/images/logo.png"
              alt="ร้านชาบู ERP"
              width={20}
              height={20}
              className="rounded object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white leading-tight">ร้านชาบู ERP</span>
            <span className="block text-[10px] text-sidebar-foreground/60 leading-tight">Restaurant Management</span>
          </div>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="ยุบ sidebar"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/10 hover:text-white transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
        </div>
      )}

      {/* Navigation */}
      <NavItems
        sections={sections}
        pathname={pathname}
        onNavigate={onNavigate}
        badgeCounts={badgeCounts}
        size={size}
        collapsed={collapsed}
        onExpand={onToggleCollapse}
      />

      {/* User info + logout */}
      {collapsed ? (
        <div className="shrink-0 border-t border-white/8 p-2 flex flex-col items-center gap-1.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-sidebar-primary/20 text-xs font-bold text-sidebar-primary ring-1 ring-sidebar-primary/30">
            {userName.charAt(0).toUpperCase()}
          </div>
          <SidebarTooltip label="ออกจากระบบ">
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="ออกจากระบบ"
                className="flex w-full items-center justify-center rounded-lg p-2 text-sidebar-foreground/40 hover:bg-red-500/12 hover:text-red-300 transition-colors duration-150"
              >
                <LogOut className="size-4 shrink-0" />
              </button>
            </form>
          </SidebarTooltip>
        </div>
      ) : (
        <div className="shrink-0 border-t border-white/8 p-3 space-y-1">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/20 text-xs font-bold text-sidebar-primary ring-1 ring-sidebar-primary/30">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white leading-tight">{userName}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/60 leading-tight mt-0.5">{ROLE_LABEL[role]}</p>
            </div>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/50 transition-colors duration-150 hover:bg-red-500/12 hover:text-red-300"
            >
              <LogOut className="size-4 shrink-0" />
              ออกจากระบบ
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ─── Persist tablet collapsed state across client-side navigations ─ */
// Module-level: survives segment boundary remounts; resets only on full page reload.
// Server always sees false (fresh module per request) → no hydration mismatch.
let _tabletCollapsed = false;

/* ─── Standard sidebar layout (owner / manager / desktop) ───── */

function StandardSidebarLayout({
  role,
  userName,
  children,
  pathname,
  badgeCounts,
  allowedModules,
  navLayout,
  menuLabels,
  variant = 'default',
}: {
  role: Role;
  userName: string;
  children: React.ReactNode;
  pathname: string;
  badgeCounts?: Record<string, number>;
  allowedModules: string[];
  navLayout?: StoredNavLayout;
  menuLabels?: Record<string, string>;
  variant?: 'default' | 'tablet';
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isTablet = variant === 'tablet';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isTablet ? _tabletCollapsed : false);
  const rawSections = NAV[role] ?? [];
  const builtSections = navLayout?.sections?.length
    ? buildSectionsFromNavLayout(navLayout, role, allowedModules)
    : reorderSections(filterSections(rawSections, allowedModules), allowedModules);
  const sections = menuLabels ? applyMenuLabels(builtSections, menuLabels) : builtSections;
  const pageTitle = getPageTitle(pathname);

  const size: 'default' | 'large' = isTablet ? 'large' : 'default';

  const toggleCollapse = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      _tabletCollapsed = next;
      return next;
    });
  };

  const innerProps = {
    role, userName, sections, pathname, badgeCounts, size,
    ...(isTablet ? { collapsed: sidebarCollapsed, onToggleCollapse: toggleCollapse } : {}),
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className={isTablet
        ? sidebarCollapsed
          ? 'transition-all duration-300 hidden md:block fixed inset-y-0 left-0 z-20 w-16'
          : 'transition-all duration-300 hidden md:block fixed inset-y-0 left-0 z-20 w-72'
        : 'hidden lg:block fixed inset-y-0 left-0 z-20 w-64'
      }>
        <SidebarInner {...innerProps} />
      </aside>

      {/* Right content area */}
      <div className={isTablet
        ? sidebarCollapsed
          ? 'flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-300 md:pl-16'
          : 'flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-300 md:pl-72'
        : 'flex flex-col flex-1 min-w-0 overflow-hidden lg:pl-64'
      }>
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/80 backdrop-blur-sm px-5">
          <Sheet open={mobileOpen} onOpenChange={(open) => setMobileOpen(open)}>
            <SheetTrigger
              aria-label="เปิดเมนู"
              className={isTablet
                ? 'flex md:hidden items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                : 'flex lg:hidden items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent
              side="left"
              className={isTablet ? 'w-72 p-0' : 'w-64 p-0'}
              showCloseButton={false}
            >
              <SidebarInner
                {...innerProps}
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          {pageTitle && (
            <h1 className="text-[15px] font-semibold text-foreground tracking-tight">{pageTitle}</h1>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

/* ─── Bottom-tab layout (touchscreen) ─────────────────────────── */

type TabItem  = { href: string; label: string; Icon: LucideIcon };
type MoreItem = { href: string; label: string; Icon: LucideIcon };

const ALL_TOUCHSCREEN_TABS: TabItem[] = [
  { href: '/pos',    label: 'POS',  Icon: ShoppingCart },
  { href: '/kds',    label: 'ครัว', Icon: ChefHat },
  { href: '/tables', label: 'โต๊ะ', Icon: Grid3X3 },
  { href: '/queue',  label: 'คิว',  Icon: UsersRound },
];

const ALL_TOUCHSCREEN_MORE: MoreItem[] = [
  { href: '/kds/history',    label: 'ประวัติครัว',     Icon: ChefHat },
  { href: '/tables/history', label: 'ประวัติโต๊ะ',    Icon: History },
  { href: '/queue/history',  label: 'ประวัติคิว',      Icon: UsersRound },
  { href: '/pos/history',    label: 'ประวัติชำระเงิน', Icon: CreditCard },
  { href: '/printers',       label: 'เครื่องพิมพ์',    Icon: Printer },
];

const ROLE_TOUCHSCREEN_TABS: Record<'cashier' | 'kitchen', TabItem[]> = {
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

const ROLE_TOUCHSCREEN_MORE: Record<'cashier' | 'kitchen', MoreItem[]> = {
  cashier: [
    { href: '/kds/history',    label: 'ประวัติครัว',     Icon: ChefHat },
    { href: '/tables/history', label: 'ประวัติโต๊ะ',    Icon: History },
    { href: '/queue/history',  label: 'ประวัติคิว',      Icon: UsersRound },
    { href: '/pos/history',    label: 'ประวัติชำระเงิน', Icon: CreditCard },
    { href: '/printers',       label: 'เครื่องพิมพ์',    Icon: Printer },
  ],
  kitchen: [
    { href: '/kds/history',    label: 'ประวัติครัว',   Icon: ChefHat },
    { href: '/tables/history', label: 'ประวัติโต๊ะ',  Icon: History },
    { href: '/queue/history',  label: 'ประวัติคิว',    Icon: UsersRound },
    { href: '/printers',       label: 'เครื่องพิมพ์', Icon: Printer },
  ],
};

function CashierLayout({
  role,
  userName,
  children,
  pathname,
  tabs,
  moreTabs,
}: {
  role: Role;
  userName: string;
  children: React.ReactNode;
  pathname: string;
  tabs: TabItem[];
  moreTabs: MoreItem[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [headerSlotContent, setHeaderSlotContent] = useState<ReactNode>(null);

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

        {/* More popover — floats above the tab bar */}
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

/* ─── Main export ────────────────────────────────────────────── */

interface SidebarLayoutProps {
  role: Role;
  userName: string;
  children: React.ReactNode;
  badgeCounts?: Record<string, number>;
  uiLayout?: 'touchscreen' | 'desktop' | 'tablet' | null;
  allowedModules?: string[] | null;
  navLayout?: StoredNavLayout;
  menuLabels?: Record<string, string>;
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
}: SidebarLayoutProps) {
  const pathname = usePathname();
  const modules = allowedModules ?? [];

  // Determine layout: explicit uiLayout overrides role-based fallback
  const useTouchscreen =
    uiLayout === 'touchscreen' ||
    (uiLayout == null && (role === 'cashier' || role === 'kitchen'));
  const useTablet = uiLayout === 'tablet';

  if (useTouchscreen) {
    // Compute bottom tabs: use allowedModules if set, else fall back to role defaults
    let tabs: TabItem[];
    let moreTabs: MoreItem[];
    if (modules.length > 0) {
      const filtered = ALL_TOUCHSCREEN_TABS.filter((t) => isHrefAllowed(t.href, modules));
      tabs = [...filtered].sort((a, b) => {
        const ma = Object.entries(TOUCHSCREEN_TAB_MODULE).find(([, href]) => href === a.href)?.[0];
        const mb = Object.entries(TOUCHSCREEN_TAB_MODULE).find(([, href]) => href === b.href)?.[0];
        const ia = ma ? modules.indexOf(ma) : 999;
        const ib = mb ? modules.indexOf(mb) : 999;
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      moreTabs = ALL_TOUCHSCREEN_MORE.filter((t) => isHrefAllowed(t.href, modules));
    } else {
      const r = (role === 'cashier' || role === 'kitchen') ? role : 'cashier';
      tabs = ROLE_TOUCHSCREEN_TABS[r];
      moreTabs = ROLE_TOUCHSCREEN_MORE[r];
    }
    return (
      <CashierLayout role={role} userName={userName} pathname={pathname} tabs={tabs} moreTabs={moreTabs}>
        {children}
      </CashierLayout>
    );
  }

  return (
    <StandardSidebarLayout
      role={role}
      userName={userName}
      pathname={pathname}
      badgeCounts={badgeCounts}
      allowedModules={modules}
      navLayout={navLayout}
      menuLabels={menuLabels}
      variant={useTablet ? 'tablet' : 'default'}
    >
      {children}
    </StandardSidebarLayout>
  );
}
