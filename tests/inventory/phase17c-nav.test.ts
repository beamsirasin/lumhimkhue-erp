import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INVENTORY_NAV_ITEMS } from '../../lib/inventory/inventory-nav';
import { isInventoryPath, canAccessProtectedAdminPath } from '../../lib/auth/inventory-access';
import { can, type Role } from '../../lib/auth/permissions';

describe('Phase 17C — inventory navigation order', () => {
  it('follows the daily flow order', () => {
    assert.deepEqual(
      INVENTORY_NAV_ITEMS.map((i) => i.href),
      [
        '/inventory',
        '/inventory/count',
        '/inventory/reorder',
        '/inventory/orders',
        '/inventory/ingredients',
        '/inventory/suppliers',
      ],
    );
  });

  it('uses staff-friendly labels (แนะนำให้ซื้อ, not คำแนะนำสั่งซื้อ)', () => {
    const reorder = INVENTORY_NAV_ITEMS.find((i) => i.href === '/inventory/reorder');
    assert.equal(reorder?.label, 'แนะนำให้ซื้อ');
  });

  it('hides Initial Setup from the permanent nav after initialization', () => {
    assert.equal(INVENTORY_NAV_ITEMS.some((i) => i.href === '/inventory/setup'), false);
  });

  it('every nav target is an inventory path (no non-inventory route leaks in)', () => {
    for (const item of INVENTORY_NAV_ITEMS) {
      assert.equal(isInventoryPath(item.href), true, item.href);
    }
  });

  it('overview is exact-match, sub-pages are prefix-match', () => {
    const overview = INVENTORY_NAV_ITEMS.find((i) => i.href === '/inventory');
    assert.equal(overview?.exact, true);
    assert.equal(INVENTORY_NAV_ITEMS.filter((i) => i.href !== '/inventory').every((i) => !i.exact), true);
  });
});

describe('Phase 17C — permissions unchanged (no regression from UX work)', () => {
  it('owner and manager keep inventory access', () => {
    for (const role of ['owner', 'manager'] as Role[]) {
      assert.equal(can(role, 'inventory:view'), true, role);
      assert.equal(canAccessProtectedAdminPath(role, '/inventory', true), true, role);
    }
  });

  it('cashier and kitchen still cannot access inventory', () => {
    for (const role of ['cashier', 'kitchen'] as Role[]) {
      assert.equal(can(role, 'inventory:view'), false, role);
      for (const item of INVENTORY_NAV_ITEMS) {
        assert.equal(canAccessProtectedAdminPath(role, item.href, false), false, `${role} ${item.href}`);
      }
    }
  });

  it('manager gains no POS/HR/payment module from the inventory UX changes', () => {
    assert.equal(can('manager', 'hr:manage'), false);
    assert.equal(can('manager', 'payment:delete'), false);
    // non-inventory admin path stays blocked for manager (route guard, not UI-only)
    assert.equal(canAccessProtectedAdminPath('manager', '/hr/employees', false), false);
    assert.equal(canAccessProtectedAdminPath('manager', '/users', false), false);
  });
});
