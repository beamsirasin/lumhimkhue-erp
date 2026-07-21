import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authConfig } from '../../lib/auth/config';
import {
  canAccessProtectedAdminPath,
  getInventoryUiPermissions,
  isInventoryPath,
} from '../../lib/auth/inventory-access';

async function authorize(role: 'owner' | 'manager' | 'cashier' | 'kitchen', pathname: string) {
  const callback = authConfig.callbacks?.authorized;
  assert.equal(typeof callback, 'function');
  return callback!({
    auth: { user: { role, isActive: true } },
    request: { nextUrl: new URL(pathname, 'http://uat.invalid') },
  } as never);
}

test('Inventory route matching is exact and includes nested routes', () => {
  assert.equal(isInventoryPath('/inventory'), true);
  assert.equal(isInventoryPath('/inventory/orders'), true);
  assert.equal(isInventoryPath('/inventoryevil'), false);
});

test('Owner keeps admin bypass and Manager follows inventory:view', () => {
  assert.equal(canAccessProtectedAdminPath('owner', '/inventory'), true);
  assert.equal(canAccessProtectedAdminPath('owner', '/settings'), true);
  assert.equal(canAccessProtectedAdminPath('manager', '/inventory'), true);
  assert.equal(canAccessProtectedAdminPath('manager', '/inventory/orders'), true);
  assert.equal(canAccessProtectedAdminPath('manager', '/inventory', false), false);
});

test('Inventory permission never opens another admin module', () => {
  assert.equal(canAccessProtectedAdminPath('manager', '/reports', true), false);
  assert.equal(canAccessProtectedAdminPath('manager', '/settings', true), false);
  assert.equal(canAccessProtectedAdminPath('manager', '/hr', true), false);
  assert.equal(canAccessProtectedAdminPath('manager', '/payment-settings', true), false);
});

test('Cashier and Kitchen are denied while an explicit future grant is honored', () => {
  assert.equal(canAccessProtectedAdminPath('cashier', '/inventory'), false);
  assert.equal(canAccessProtectedAdminPath('kitchen', '/inventory'), false);
  assert.equal(canAccessProtectedAdminPath('cashier', '/inventory', true), true);
});

test('Inventory UI flags mirror granular server-action permissions', () => {
  const owner = getInventoryUiPermissions('owner');
  const manager = getInventoryUiPermissions('manager');
  const cashier = getInventoryUiPermissions('cashier');
  const kitchen = getInventoryUiPermissions('kitchen');

  assert.equal(owner.canView, true);
  assert.equal(owner.canApprovePurchaseOrders, true);
  assert.equal(manager.canView, true);
  assert.equal(manager.canApprovePurchaseOrders, false);
  assert.equal(manager.canConfirmPurchasePrice, true);
  assert.equal(manager.canVoidGoodsReceipt, true);
  assert.equal(manager.canOverReceive, true);
  assert.equal(manager.canUnreviewStockCount, true);

  for (const denied of [cashier, kitchen]) {
    assert.equal(denied.canView, false);
    assert.equal(denied.canConfirmPurchasePrice, false);
    assert.equal(denied.canVoidGoodsReceipt, false);
    assert.equal(denied.canOverReceive, false);
    assert.equal(denied.canUnreviewStockCount, false);
  }
});

test('NextAuth direct URL callback uses the same Inventory authorization boundary', async () => {
  assert.equal(await authorize('owner', '/inventory'), true);
  assert.equal(await authorize('manager', '/inventory'), true);
  assert.equal(await authorize('manager', '/inventory/orders'), true);

  for (const role of ['cashier', 'kitchen'] as const) {
    const denied = await authorize(role, '/inventory');
    assert.ok(denied instanceof Response);
    assert.equal(new URL(denied.headers.get('location')!).pathname, '/');
  }

  const managerSettings = await authorize('manager', '/settings');
  assert.ok(managerSettings instanceof Response);
  assert.equal(new URL(managerSettings.headers.get('location')!).pathname, '/');
});
