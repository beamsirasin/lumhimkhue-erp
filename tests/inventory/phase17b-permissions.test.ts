import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { can, type Role } from '../../lib/auth/permissions';
import {
  canAccessProtectedAdminPath,
  getInventoryUiPermissions,
  isInventoryPath,
} from '../../lib/auth/inventory-access';
import { PHASE17B_MIGRATION_KEY } from '../../lib/db/migrate-phase17b-inventory-init-reorder';
import { PHASE17A1_MIGRATION_KEY } from '../../lib/db/migrate-phase17a-procurement-stock';

describe('Phase 17B — permission model preserved (initial setup + reorder)', () => {
  it('owner and manager can run the initial-setup + draft workflow', () => {
    for (const role of ['owner', 'manager'] as Role[]) {
      assert.equal(can(role, 'inventory:view'), true, role);
      assert.equal(can(role, 'stock_count:create'), true, role);
      assert.equal(can(role, 'stock_count:review'), true, role);
      assert.equal(can(role, 'purchase_order:manage'), true, role);
    }
  });

  it('only the owner approves purchase orders (manager does not)', () => {
    assert.equal(can('owner', 'purchase_order:approve'), true);
    assert.equal(can('manager', 'purchase_order:approve'), false);
  });

  it('cashier cannot touch inventory / initial setup / draft generation', () => {
    assert.equal(can('cashier', 'inventory:view'), false);
    assert.equal(can('cashier', 'stock_count:create'), false);
    assert.equal(can('cashier', 'purchase_order:manage'), false);
  });

  it('kitchen cannot touch inventory or purchase orders', () => {
    assert.equal(can('kitchen', 'inventory:view'), false);
    assert.equal(can('kitchen', 'purchase_order:manage'), false);
    assert.equal(can('kitchen', 'purchase_price:confirm'), false);
  });

  it('manager is not granted unrelated owner-only admin modules', () => {
    assert.equal(can('manager', 'hr:manage'), false);
    assert.equal(can('manager', 'payment:delete'), false);
    assert.equal(can('manager', 'approval_code:manage'), true); // pre-existing, unchanged by 17B
  });
});

describe('Phase 17B — route access for the new inventory pages', () => {
  it('treats /inventory/setup and /inventory/reorder as inventory paths', () => {
    assert.equal(isInventoryPath('/inventory/setup'), true);
    assert.equal(isInventoryPath('/inventory/reorder'), true);
  });

  it('manager reaches the new inventory pages via permission, not just UI', () => {
    assert.equal(canAccessProtectedAdminPath('manager', '/inventory/setup', true), true);
    assert.equal(canAccessProtectedAdminPath('manager', '/inventory/reorder', true), true);
    // but not an unrelated owner-only admin module
    assert.equal(canAccessProtectedAdminPath('manager', '/hr/employees', false), false);
  });

  it('cashier and kitchen are blocked from the new inventory pages at the route guard', () => {
    for (const role of ['cashier', 'kitchen'] as Role[]) {
      assert.equal(canAccessProtectedAdminPath(role, '/inventory/setup', false), false, role);
      assert.equal(canAccessProtectedAdminPath(role, '/inventory/reorder', false), false, role);
    }
  });

  it('owner bypasses the path guard entirely', () => {
    assert.equal(canAccessProtectedAdminPath('owner', '/inventory/reorder', false), true);
  });

  it('exposes review permission separately for the setup review action', () => {
    assert.equal(getInventoryUiPermissions('manager').canReviewStockCount, true);
    assert.equal(getInventoryUiPermissions('manager').canManagePurchaseOrders, true);
    assert.equal(getInventoryUiPermissions('owner').canReviewStockCount, true);
  });
});

describe('Phase 17B — migration wiring', () => {
  it('has a distinct ledger key that depends on the applied Phase 17A key', () => {
    assert.equal(PHASE17B_MIGRATION_KEY, 'phase17b_inventory_init_reorder');
    assert.notEqual(PHASE17B_MIGRATION_KEY, PHASE17A1_MIGRATION_KEY);
    assert.equal(typeof PHASE17A1_MIGRATION_KEY, 'string');
  });
});
