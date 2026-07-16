import type { LucideIcon } from 'lucide-react';
import type { Role } from '@/lib/auth/permissions';

/* ─── Types ──────────────────────────────────────────────────── */

export type NavItem = { href: string; label: string; Icon: LucideIcon };
export type NavSection = {
  heading?: string;
  items: (NavItem | NavGroup)[];
};
export type NavGroup = {
  label: string;
  Icon: LucideIcon;
  matchPrefix: string;
  children: NavItem[];
};
export type TabItem  = { href: string; label: string; Icon: LucideIcon };
export type MoreItem = { href: string; label: string; Icon: LucideIcon };
export type StoredNavLayout = {
  sections: { heading: string; modules: string[] }[];
} | null;

export function isNavGroup(item: NavItem | NavGroup): item is NavGroup {
  return 'children' in item;
}

/* ─── Module → hrefs mapping ─────────────────────────────────── */

export const MODULE_HREFS: Record<string, string[]> = {
  pos:             ['/pos', '/pos/shifts', '/pos/history'],
  kds:             ['/kds', '/kds/history'],
  queue:           ['/queue', '/queue/history'],
  tables:          ['/tables', '/tables/history'],
  dashboard:       ['/dashboard'],
  menu:            ['/menu'],
  recipes:         ['/recipes'],
  'pricing-tiles': ['/pricing-tiles'],
  'payment-settings': ['/payment-settings'],
  'approval-code':    ['/approval-code'],
  inventory:       ['/inventory', '/inventory/count', '/inventory/ingredients', '/inventory/suppliers', '/inventory/orders'],
  reports:         ['/reports', '/reports/revenue', '/reports/tables', '/reports/queue', '/reports/kitchen', '/reports/audit'],
  settings:        ['/settings'],
  users:           ['/users'],
  hr:              ['/hr', '/hr/employees', '/hr/schedule', '/hr/time', '/hr/payroll', '/hr/settings'],
  'hr-incidents':  ['/hr-incidents'],
  printers:        ['/printers'],
  system:          ['/system'],
};

/* Module ID → primary href used for touchscreen tab ordering */
export const TOUCHSCREEN_TAB_MODULE: Record<string, string> = {
  pos:    '/pos',
  kds:    '/kds',
  tables: '/tables',
  queue:  '/queue',
};

/* ─── Static string maps ─────────────────────────────────────── */

export const PAGE_TITLES: Record<string, string> = {
  '/dashboard':             'แดชบอร์ด',
  '/pos':                   'POS / แคชเชียร์',
  '/pos/shifts':            'รอบแคชเชียร์',
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
  '/payment-settings':      'Payment Settings',
  '/approval-code':         'รหัสอนุมัติ',
  '/users':                 'User',
  '/reports':               'รายงาน',
  '/reports/revenue':       'รายงานรายได้',
  '/reports/tables':        'รายงานโต๊ะ',
  '/reports/queue':         'รายงานคิว',
  '/reports/kitchen':       'รายงานครัว',
  '/reports/audit':         'รายงานตรวจสอบ',
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

export const ROLE_LABEL: Record<Role, string> = {
  owner:   'เจ้าของร้าน',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

/* ─── Pure helper functions ─────────────────────────────────── */

export function isHrefAllowed(href: string, modules: string[]): boolean {
  if (!modules.length) return true;
  return modules.some((m) => {
    const hrefs = MODULE_HREFS[m] ?? [];
    return hrefs.some((h) => href === h || href.startsWith(h + '/'));
  });
}

export function filterSections(sections: NavSection[], modules: string[]): NavSection[] {
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

export function getModuleForNavItem(item: NavItem | NavGroup): string | null {
  const testHref = isNavGroup(item) ? item.matchPrefix : item.href;
  for (const [mod, hrefs] of Object.entries(MODULE_HREFS)) {
    if (hrefs.some((h) => h === testHref || testHref.startsWith(h + '/') || h.startsWith(testHref + '/'))) {
      return mod;
    }
  }
  return null;
}

/* Takes resolved sections (not role) so callers can keep NAV out of this module. */
export function buildModuleItemMap(sections: NavSection[]): Map<string, NavItem | NavGroup> {
  const map = new Map<string, NavItem | NavGroup>();
  for (const section of sections) {
    for (const item of section.items) {
      const modId = getModuleForNavItem(item);
      if (modId) map.set(modId, item);
    }
  }
  return map;
}

export function buildSectionsFromNavLayout(
  navLayout: NonNullable<StoredNavLayout>,
  sections: NavSection[],
  allowedModules: string[],
): NavSection[] {
  const modMap = buildModuleItemMap(sections);
  const enabledSet = new Set(allowedModules);
  return navLayout.sections
    .map(({ heading, modules }) => ({
      heading: heading || undefined,
      items: modules
        .filter((m) => !enabledSet.size || enabledSet.has(m))
        .map((m) => modMap.get(m) ?? null)
        .filter((item): item is NavItem | NavGroup => item != null),
    }))
    .filter((s) => s.items.length > 0);
}

export function applyMenuLabels(sections: NavSection[], menuLabels: Record<string, string>): NavSection[] {
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

export function reorderSections(sections: NavSection[], modules: string[]): NavSection[] {
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

export function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const key = Object.keys(PAGE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find((k) => k.length > 1 && pathname.startsWith(k + '/'));
  return key ? PAGE_TITLES[key] : '';
}
