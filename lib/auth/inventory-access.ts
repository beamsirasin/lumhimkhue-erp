import { can, type Role } from './permissions';

export type InventoryUiPermissions = ReturnType<typeof getInventoryUiPermissions>;

export function isInventoryPath(pathname: string) {
  return pathname === '/inventory' || pathname.startsWith('/inventory/');
}

export function canAccessProtectedAdminPath(
  role: Role,
  pathname: string,
  inventoryViewAllowed = can(role, 'inventory:view'),
) {
  if (role === 'owner') return true;
  return isInventoryPath(pathname) && inventoryViewAllowed;
}

export function getInventoryUiPermissions(role: Role) {
  return {
    canView: can(role, 'inventory:view'),
    canEdit: can(role, 'inventory:edit'),
    canCreateStockCount: can(role, 'stock_count:create'),
    canManagePurchaseOrders: can(role, 'purchase_order:manage'),
    canApprovePurchaseOrders: can(role, 'purchase_order:approve'),
    canConfirmPurchasePrice: can(role, 'purchase_price:confirm'),
    canVoidGoodsReceipt: can(role, 'goods_receipt:void'),
    canOverReceive: can(role, 'goods_receipt:over_receive'),
    canCreateEmergencyPurchase: can(role, 'purchase_emergency:create'),
    canCancelRemaining: can(role, 'purchase_order:cancel_remaining'),
    canReviewStockCount: can(role, 'stock_count:review'),
    canUnreviewStockCount: can(role, 'stock_count:unreview'),
  };
}
