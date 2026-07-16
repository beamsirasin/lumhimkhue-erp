export type Role = 'owner' | 'manager' | 'cashier' | 'kitchen';

export type Action =
  // --- legacy snake_case (kept for backward compat — 10+ server actions reference these) ---
  | 'manage_menu'
  | 'manage_users'
  | 'view_reports'
  | 'manage_settings'
  | 'process_payment'       // covers basic payment receipt; use payment:void/refund/reopen for destructive ops
  | 'manage_tables'
  | 'view_kds'
  | 'manage_queue'
  | 'pricing_tile:edit'
  | 'pricing_tile:reorder'
  | 'payment_settings:manage'
  | 'table:layout_edit'
  | 'inventory:view'
  | 'inventory:edit'
  | 'stock_count:create'
  | 'purchase_order:manage'
  | 'purchase_order:approve'
  | 'recipe:manage'
  | 'hr:manage'
  // --- Phase 1: granular payment & cash-control permissions (colon-style) ---
  | 'payment:void'           // soft-void a completed payment
  | 'payment:refund'         // issue a refund
  | 'payment:reopen'         // reopen a paid session
  | 'payment:delete'         // hard-delete payment record (owner only)
  | 'discount:apply'         // apply a discount at checkout (within role limit)
  | 'discount:approve'       // approve a discount that exceeds cashier limit
  | 'order:cancel'           // cancel an order item
  | 'order:cancel:approve'   // approve a cancel requested by cashier
  | 'cashier_shift:manage'   // open / close cashier shift
  | 'printer:network_print'  // relay a print job to a LAN TCP printer
  | 'approval_code:manage'   // view/generate/revoke the manager approval code (Phase 17POS-AUTH-A1)
  | 'hr:incident:manage';    // report/view employee incidents — late/absence/damage/behavior (รายงานพนักงาน)

const PERMISSIONS: Record<Role, Action[]> = {
  owner: [
    // legacy
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
    'payment_settings:manage',
    'table:layout_edit',
    'inventory:view',
    'inventory:edit',
    'stock_count:create',
    'purchase_order:manage',
    'purchase_order:approve',
    'recipe:manage',
    'hr:manage',
    // Phase 1
    'payment:void',
    'payment:refund',
    'payment:reopen',
    'payment:delete',
    'discount:apply',
    'discount:approve',
    'order:cancel',
    'order:cancel:approve',
    'cashier_shift:manage',
    'printer:network_print',
    'approval_code:manage',
    'hr:incident:manage',
  ],
  manager: [
    // legacy
    'manage_menu',
    'process_payment',
    'manage_tables',
    'view_kds',
    'manage_queue',
    'pricing_tile:edit',
    'pricing_tile:reorder',
    'payment_settings:manage',
    'table:layout_edit',
    'inventory:view',
    'inventory:edit',
    'stock_count:create',
    'purchase_order:manage',
    'recipe:manage',
    // Phase 1
    'payment:void',
    'payment:refund',
    'payment:reopen',
    'discount:apply',
    'discount:approve',
    'order:cancel',
    'order:cancel:approve',
    'cashier_shift:manage',
    'printer:network_print',
    'approval_code:manage',
    'hr:incident:manage',
  ],
  cashier: [
    'process_payment',
    'manage_tables',
    'manage_queue',
    'view_kds',
    // Phase 1
    'discount:apply',
    'order:cancel',
    'cashier_shift:manage',
    'printer:network_print',
  ],
  // kitchen: view_kds only — no table/queue/payment access
  kitchen: ['view_kds'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role]?.includes(action) ?? false;
}
