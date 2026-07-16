'use client';

import { useState, useRef } from 'react';
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
  Banknote,
  ShieldCheck,
  Settings,
  Info,
  Menu,
  LogOut,
  Printer,
  History,
  ChevronDown,
  ChevronLeft,
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
  KeyRound,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { logoutAction } from '@/lib/actions/auth';
import type { Role } from '@/lib/auth/permissions';
import {
  type NavItem,
  type NavGroup,
  type NavSection,
  type StoredNavLayout,
  isNavGroup,
  filterSections,
  buildSectionsFromNavLayout,
  applyMenuLabels,
  reorderSections,
  getPageTitle,
  ROLE_LABEL,
} from './nav-config';

/* ─── Role NAV config ────────────────────────────────────────── */

const hrGroup: NavGroup = {
  label: 'พนักงาน (HR)',
  Icon: UserCog,
  matchPrefix: '/hr',
  children: [
    { href: '/hr',           label: 'ภาพรวม',        Icon: LayoutDashboard },
    { href: '/hr/employees', label: 'ข้อมูลพนักงาน',  Icon: UsersRound },
    { href: '/hr/schedule',  label: 'ตารางงาน',        Icon: Calendar },
    { href: '/hr/time',      label: 'บันทึกเวลา',      Icon: Clock },
    { href: '/hr/payroll',   label: 'เงินเดือน',        Icon: Wallet },
    { href: '/hr/settings',  label: 'ตั้งค่า HR',       Icon: Settings },
  ],
};

const inventoryGroup: NavGroup = {
  label: 'สต็อก/วัตถุดิบ',
  Icon: Boxes,
  matchPrefix: '/inventory',
  children: [
    { href: '/inventory',             label: 'ภาพรวม',     Icon: Package },
    { href: '/inventory/count',       label: 'นับสต็อก',   Icon: ClipboardList },
    { href: '/inventory/ingredients', label: 'วัตถุดิบ',   Icon: UtensilsCrossed },
    { href: '/inventory/suppliers',   label: 'ผู้ขาย',      Icon: Truck },
    { href: '/inventory/orders',      label: 'ใบสั่งซื้อ', Icon: ShoppingBag },
  ],
};

const posGroup: NavGroup = {
  label: 'POS',
  Icon: ShoppingCart,
  matchPrefix: '/pos',
  children: [
    { href: '/pos',         label: 'หน้า POS',          Icon: ShoppingCart },
    { href: '/pos/shifts',  label: 'รอบแคชเชียร์',      Icon: Clock },
    { href: '/pos/history', label: 'ประวัติชำระเงิน',   Icon: CreditCard },
  ],
};

const kdsGroup: NavGroup = {
  label: 'ครัว (KDS)',
  Icon: ChefHat,
  matchPrefix: '/kds',
  children: [
    { href: '/kds',         label: 'หน้าครัว',    Icon: ChefHat },
    { href: '/kds/history', label: 'ประวัติครัว', Icon: History },
  ],
};

const tableGroup: NavGroup = {
  label: 'จัดการโต๊ะ',
  Icon: Grid3X3,
  matchPrefix: '/tables',
  children: [
    { href: '/tables',         label: 'ดูโต๊ะ',      Icon: Grid3X3 },
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

const reportsGroup: NavGroup = {
  label: 'รายงาน',
  Icon: BarChart3,
  matchPrefix: '/reports',
  children: [
    { href: '/reports/revenue', label: 'รายได้',  Icon: Banknote },
    { href: '/reports/tables',  label: 'โต๊ะ',    Icon: Grid3X3 },
    { href: '/reports/queue',   label: 'คิว',      Icon: UsersRound },
    { href: '/reports/kitchen', label: 'ครัว',     Icon: ChefHat },
    { href: '/reports/audit',   label: 'ตรวจสอบ', Icon: ShieldCheck },
  ],
};

const NAV: Record<Role, NavSection[]> = {
  owner: [
    {
      heading: 'หน้าบ้าน',
      items: [posGroup, kdsGroup, queueGroup, tableGroup],
    },
    {
      heading: 'จัดการ',
      items: [
        { href: '/dashboard',     label: 'แดชบอร์ด',     Icon: LayoutDashboard },
        { href: '/menu',          label: 'เมนูอาหาร',    Icon: UtensilsCrossed },
        { href: '/recipes',       label: 'สูตรอาหาร',    Icon: BookOpen },
        { href: '/pricing-tiles', label: 'Pricing Tiles', Icon: Tag },
        inventoryGroup,
        reportsGroup,
        hrGroup,
      ],
    },
    {
      heading: 'ตั้งค่า / Admin',
      items: [
        { href: '/settings',         label: 'ตั้งค่าบิล',      Icon: Settings },
        { href: '/payment-settings', label: 'Payment Settings', Icon: CreditCard },
        { href: '/approval-code',    label: 'รหัสอนุมัติ',     Icon: KeyRound },
        { href: '/users',            label: 'บัญชีผู้ใช้',     Icon: Users },
        { href: '/printers',         label: 'เครื่องพิมพ์',    Icon: Printer },
        { href: '/system',           label: 'ข้อมูลระบบ',      Icon: Info },
      ],
    },
  ],
  manager: [
    {
      items: [
        posGroup,
        kdsGroup,
        queueGroup,
        tableGroup,
        { href: '/payment-settings', label: 'Payment Settings', Icon: CreditCard },
        { href: '/approval-code',    label: 'รหัสอนุมัติ',     Icon: KeyRound },
        { href: '/printers', label: 'เครื่องพิมพ์', Icon: Printer },
      ],
    },
  ],
  cashier: [
    {
      items: [
        posGroup,
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

/* ─── Shared style constants ─────────────────────────────────── */

const ACTIVE_CLS   = 'bg-[var(--sidebar-active)] text-[var(--sidebar-active-foreground)]';
const INACTIVE_CLS = 'text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground';
const ACTIVE_BORDER = 'border-l-2 border-l-sidebar-primary';

/* ─── Badge ──────────────────────────────────────────────────── */

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground tabular-nums">
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
        className="pointer-events-none z-50 whitespace-nowrap rounded-lg border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-[var(--shadow-raised)]"
      >
        {label}
      </div>
    </div>
  );
}

/* ─── NavGroup (collapsible) ─────────────────────────────────── */

function NavGroupItem({
  group,
  pathname,
  onNavigate,
  badgeCounts,
  size = 'default',
  collapsed = false,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate?: () => void;
  badgeCounts?: Record<string, number>;
  size?: 'default' | 'large';
  collapsed?: boolean;
}) {
  const isGroupActive =
    pathname === group.matchPrefix ||
    pathname.startsWith(group.matchPrefix + '/') ||
    group.children.some(
      (c) => pathname === c.href || (c.href.length > 1 && pathname.startsWith(c.href + '/')),
    );
  const [open, setOpen] = useState(isGroupActive);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { Icon } = group;
  const totalGroupBadge = group.children.reduce((s, c) => s + (badgeCounts?.[c.href] ?? 0), 0);
  const isChildActive = (href: string) =>
    href === group.matchPrefix
      ? pathname === href
      : pathname === href || pathname.startsWith(href + '/');

  if (collapsed) {
    return (
      <div
        ref={wrapperRef}
        className="w-full"
        onMouseEnter={() => {
          if (leaveTimer.current) clearTimeout(leaveTimer.current);
          if (!wrapperRef.current || !flyoutRef.current) return;
          const rect = wrapperRef.current.getBoundingClientRect();
          flyoutRef.current.style.top = `${rect.top}px`;
          flyoutRef.current.style.display = 'block';
        }}
        onMouseLeave={() => {
          leaveTimer.current = setTimeout(() => {
            if (flyoutRef.current) flyoutRef.current.style.display = 'none';
          }, 150);
        }}
      >
        <button
          type="button"
          className={`relative flex w-full items-center justify-center rounded-lg p-3 transition-colors duration-150 ${
            isGroupActive ? ACTIVE_CLS : INACTIVE_CLS
          }`}
        >
          <Icon className="size-5 shrink-0" />
          {totalGroupBadge > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-400 shadow-sm" />
          )}
        </button>

        <div
          ref={flyoutRef}
          style={{
            position: 'fixed',
            left: 'calc(4rem + 8px)',
            top: 0,
            display: 'none',
            background: 'var(--sidebar-accent)',
          }}
          className="z-50 min-w-[188px] overflow-hidden rounded-xl border border-white/10 shadow-[var(--shadow-raised)]"
          onMouseEnter={() => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
          }}
          onMouseLeave={() => {
            leaveTimer.current = setTimeout(() => {
              if (flyoutRef.current) flyoutRef.current.style.display = 'none';
            }, 150);
          }}
        >
          <p className="border-b border-white/8 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
            {group.label}
          </p>
          <div className="p-1.5 space-y-0.5">
            {group.children.map(({ href, label, Icon: ChildIcon }) => {
              const isActive = isChildActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    isActive ? ACTIVE_CLS : INACTIVE_CLS
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

  const triggerCls =
    size === 'large'
      ? 'flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors duration-150'
      : 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150';
  const iconCls   = size === 'large' ? 'size-5 shrink-0' : 'size-4 shrink-0';
  const childCls  =
    size === 'large'
      ? 'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150'
      : 'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150';
  const childIconCls = size === 'large' ? 'size-4 shrink-0' : 'size-3.5 shrink-0';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={`${triggerCls} ${
          isGroupActive
            ? `${ACTIVE_CLS} font-semibold ${ACTIVE_BORDER}`
            : INACTIVE_CLS
        }`}
      >
        <Icon className={`${iconCls} ${isGroupActive ? 'text-sidebar-primary' : ''}`} />
        <span className="flex-1 text-left">{group.label}</span>
        {!open && totalGroupBadge > 0 && (
          <span className="size-1.5 rounded-full bg-red-400" />
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform duration-200 text-sidebar-foreground/40 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-0.5 ml-4 border-l border-sidebar-border/60 pl-3 space-y-px">
          {group.children.map(({ href, label, Icon: ChildIcon }) => {
            const isActive = isChildActive(href);
            const badge = badgeCounts?.[href] ?? 0;
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                onClick={onNavigate}
                className={`${childCls} ${
                  isActive
                    ? `${ACTIVE_CLS} font-medium ${ACTIVE_BORDER}`
                    : INACTIVE_CLS
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
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
  badgeCounts?: Record<string, number>;
  size?: 'default' | 'large';
  collapsed?: boolean;
}) {
  const itemCls =
    size === 'large'
      ? 'flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors duration-150'
      : 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150';
  const iconCls = size === 'large' ? 'size-5 shrink-0' : 'size-4 shrink-0';

  if (collapsed) {
    const allItems = sections.flatMap((s) => s.items);
    return (
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
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
                className={`relative flex items-center justify-center rounded-lg p-3 transition-colors duration-150 ${
                  isActive ? ACTIVE_CLS : INACTIVE_CLS
                }`}
              >
                <Icon className={`size-5 shrink-0 ${isActive ? 'text-sidebar-primary' : ''}`} />
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
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      {sections.map((section, i) => (
        <div key={i}>
          {section.heading && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/35">
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
              const { href, label, Icon } = item as NavItem & { Icon: LucideIcon };
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
                      ? `${ACTIVE_CLS} font-semibold ${ACTIVE_BORDER}`
                      : INACTIVE_CLS
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

/* ─── SidebarInner ───────────────────────────────────────────── */

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
      {/* Logo strip */}
      {collapsed ? (
        <div className="flex h-[52px] shrink-0 items-center justify-center border-b border-sidebar-border/50 bg-[var(--sidebar-header)]">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="ขยาย sidebar"
            className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary/15 ring-1 ring-sidebar-primary/30 hover:bg-sidebar-primary/25 transition-colors"
          >
            <ChevronLeft className="size-4 text-sidebar-primary rotate-180" />
          </button>
        </div>
      ) : (
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-sidebar-border/50 px-4 bg-[var(--sidebar-header)]">
          <div className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/15 ring-1 ring-sidebar-primary/30">
            <Image
              src="/images/logo.png"
              alt="ร้านชาบู ERP"
              width={20}
              height={20}
              className="rounded object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-white leading-tight tracking-tight">
              ร้านชาบู ERP
            </span>
            <span className="block text-[10px] text-sidebar-foreground/50 leading-tight mt-0.5">
              Restaurant Management
            </span>
          </div>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="ยุบ sidebar"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/40 hover:bg-white/8 hover:text-sidebar-foreground transition-colors"
            >
              <ChevronLeft className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <NavItems
        sections={sections}
        pathname={pathname}
        onNavigate={onNavigate}
        badgeCounts={badgeCounts}
        size={size}
        collapsed={collapsed}
      />

      {/* User footer */}
      {collapsed ? (
        <div className="shrink-0 border-t border-sidebar-border/50 p-2 flex flex-col items-center gap-1.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary ring-1 ring-sidebar-primary/25">
            {userName.charAt(0).toUpperCase()}
          </div>
          <SidebarTooltip label="ออกจากระบบ">
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="ออกจากระบบ"
                className="flex w-full items-center justify-center rounded-lg p-2 text-sidebar-foreground/35 hover:bg-red-500/10 hover:text-red-300 transition-colors duration-150"
              >
                <LogOut className="size-4 shrink-0" />
              </button>
            </form>
          </SidebarTooltip>
        </div>
      ) : (
        <div className="shrink-0 border-t border-sidebar-border/50 p-3 space-y-1">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary ring-1 ring-sidebar-primary/25">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white leading-tight">{userName}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/50 leading-tight mt-0.5">
                {ROLE_LABEL[role]}
              </p>
            </div>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/45 transition-colors duration-150 hover:bg-red-500/10 hover:text-red-300"
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

/* Persists collapsed state across client-side navigations within the same session. */
let _tabletCollapsed = false;

/* ─── StandardSidebarLayout ─────────────────────────────────── */

export interface StandardSidebarLayoutProps {
  role: Role;
  userName: string;
  children: React.ReactNode;
  badgeCounts?: Record<string, number>;
  allowedModules: string[];
  navLayout?: StoredNavLayout;
  menuLabels?: Record<string, string>;
  variant?: 'default' | 'tablet';
  showThemeToggle?: boolean;
}

export function StandardSidebarLayout({
  role,
  userName,
  children,
  badgeCounts,
  allowedModules,
  navLayout,
  menuLabels,
  variant = 'default',
  showThemeToggle = false,
}: StandardSidebarLayoutProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isTablet = variant === 'tablet';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    isTablet ? _tabletCollapsed : false,
  );

  const rawSections = NAV[role] ?? [];
  const builtSections = navLayout?.sections?.length
    ? buildSectionsFromNavLayout(navLayout, rawSections, allowedModules)
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
    role,
    userName,
    sections,
    pathname,
    badgeCounts,
    size,
    ...(isTablet ? { collapsed: sidebarCollapsed, onToggleCollapse: toggleCollapse } : {}),
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop / tablet fixed sidebar */}
      <aside
        className={
          isTablet
            ? sidebarCollapsed
              ? 'transition-all duration-300 hidden md:block fixed inset-y-0 left-0 z-20 w-16'
              : 'transition-all duration-300 hidden md:block fixed inset-y-0 left-0 z-20 w-[260px]'
            : 'hidden lg:block fixed inset-y-0 left-0 z-20 w-[260px]'
        }
      >
        <SidebarInner {...innerProps} />
      </aside>

      {/* Main content area */}
      <div
        className={
          isTablet
            ? sidebarCollapsed
              ? 'flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-300 md:pl-16'
              : 'flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-300 md:pl-[260px]'
            : 'flex flex-col flex-1 min-w-0 overflow-hidden lg:pl-[260px]'
        }
      >
        {/* Top header bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-[var(--surface-1)] px-4 md:px-5">
          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={(open) => setMobileOpen(open)}>
            <SheetTrigger
              aria-label="เปิดเมนู"
              className={
                isTablet
                  ? 'flex md:hidden items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                  : 'flex lg:hidden items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[260px] p-0"
              showCloseButton={false}
            >
              <SidebarInner
                {...innerProps}
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          {/* Page title */}
          <div className="flex-1 min-w-0">
            {pageTitle && (
              <h1 className="text-[15px] font-semibold text-foreground tracking-tight truncate">
                {pageTitle}
              </h1>
            )}
          </div>

          {showThemeToggle && <ThemeToggle />}

          {/* User avatar — visible on small screens where sidebar is hidden */}
          <div
            className={
              isTablet ? 'flex md:hidden items-center' : 'flex lg:hidden items-center'
            }
          >
            <div className="flex size-7 items-center justify-center rounded-full bg-[var(--surface-primary-subtle)] text-xs font-semibold text-primary ring-1 ring-primary/20">
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
