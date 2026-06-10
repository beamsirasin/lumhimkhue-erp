export type Role = 'owner' | 'manager' | 'cashier' | 'kitchen';

export type Action =
  | 'manage_menu'
  | 'manage_users'
  | 'view_reports'
  | 'manage_settings'
  | 'process_payment'
  | 'manage_tables'
  | 'view_kds'
  | 'manage_queue'
  | 'pricing_tile:edit'
  | 'pricing_tile:reorder'
  | 'table:layout_edit'
  | 'inventory:view'
  | 'inventory:edit'
  | 'stock_count:create'
  | 'purchase_order:manage'
  | 'purchase_order:approve'
  | 'recipe:manage'
  | 'hr:manage';

const PERMISSIONS: Record<Role, Action[]> = {
  owner: [
    'manage_menu',
    'manage_users',
    'view_reports',
    'manage_settings',
    'process_payment',
    'manage_tables',
    'view_kds',
    'manage_queue',
    'pricing_tile:edit',
    'pricing_tile:reorder',
    'table:layout_edit',
    'inventory:view',
    'inventory:edit',
    'stock_count:create',
    'purchase_order:manage',
    'purchase_order:approve',
    'recipe:manage',
    'hr:manage',
  ],
  manager: [
    'manage_menu',
    'process_payment',
    'manage_tables',
    'view_kds',
    'manage_queue',
    'pricing_tile:edit',
    'pricing_tile:reorder',
    'table:layout_edit',
    'inventory:view',
    'inventory:edit',
    'stock_count:create',
    'purchase_order:manage',
    'recipe:manage',
  ],
  cashier: ['process_payment', 'manage_tables', 'manage_queue', 'view_kds'],
  kitchen: ['view_kds', 'manage_queue', 'manage_tables'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role]?.includes(action) ?? false;
}
