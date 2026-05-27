export type Role = 'owner' | 'cashier' | 'kitchen';

export type Action =
  | 'manage_menu'
  | 'manage_packages'
  | 'manage_users'
  | 'view_reports'
  | 'manage_settings'
  | 'process_payment'
  | 'manage_tables'
  | 'view_kds'
  | 'manage_queue';

const PERMISSIONS: Record<Role, Action[]> = {
  owner: [
    'manage_menu',
    'manage_packages',
    'manage_users',
    'view_reports',
    'manage_settings',
    'process_payment',
    'manage_tables',
    'view_kds',
    'manage_queue',
  ],
  cashier: ['process_payment', 'manage_tables', 'manage_queue', 'view_kds'],
  kitchen: ['view_kds', 'manage_queue', 'manage_tables'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role]?.includes(action) ?? false;
}
