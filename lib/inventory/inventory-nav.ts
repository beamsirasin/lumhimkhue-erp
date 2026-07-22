/**
 * Phase 17C — Inventory sub-navigation config (pure, testable).
 * Ordered to follow the daily flow. Initial Setup is intentionally NOT a
 * permanent tab — it is reached through the dashboard "what to do next" card
 * (and remains accessible at /inventory/setup for owner/manager when needed).
 */
export type InventoryNavItem = {
  href: string;
  /** Short, staff-friendly Thai label. */
  label: string;
  /** Match the href exactly (overview) vs prefix-match (sub-pages). */
  exact: boolean;
};

export const INVENTORY_NAV_ITEMS: InventoryNavItem[] = [
  { href: '/inventory', label: 'ภาพรวม', exact: true },
  { href: '/inventory/count', label: 'นับสต็อก', exact: false },
  { href: '/inventory/reorder', label: 'แนะนำให้ซื้อ', exact: false },
  { href: '/inventory/orders', label: 'ใบสั่งซื้อ', exact: false },
  { href: '/inventory/ingredients', label: 'วัตถุดิบ', exact: false },
  { href: '/inventory/suppliers', label: 'ผู้ขาย', exact: false },
];
