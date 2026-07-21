import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { can, type Action } from '../../lib/auth/permissions';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const inventoryAction = read('lib/actions/inventory.ts');
const procurementDb = read('lib/inventory/procurement-db.ts');
const costMetadata = read('lib/inventory/stock-cost-metadata.ts');
const migration = read('lib/db/migrate-phase17a-procurement-stock.ts');
const migrationStatus = read('scripts/check-migration-status.ts');

describe('Phase 17A.1 receipt concurrency and idempotency contracts', () => {
  it('locks PO item rows in deterministic ID order before the post-lock over-receipt guard', () => {
    const lockAt = inventoryAction.indexOf(".for('update')");
    const guardAt = inventoryAction.indexOf('guard: sql<number>`1 / CASE', lockAt);
    const receiptInsertAt = inventoryAction.indexOf('db.insert(goodsReceipts).values', lockAt);
    assert.ok(lockAt > 0);
    assert.match(inventoryAction, /const sortedIds = po\.items\.map\(\(item\) => item\.id\)\.sort\(\)/);
    assert.ok(guardAt > lockAt);
    assert.ok(receiptInsertAt > guardAt);
    assert.match(inventoryAction, /COALESCE\(\$\{purchaseOrderItems\.receivedQuantity\}, 0\) \+ \$\{item\.receivedQuantity\} > \$\{purchaseOrderItems\.quantity\}/);
    assert.match(inventoryAction, /await db\.batch\(operations\)/);
  });

  it('keeps a database unique idempotency key and validates duplicate ownership', () => {
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_idempotency_key_uq/);
    assert.match(inventoryAction, /duplicate\.purchaseOrderId !== data\.id/);
    assert.match(inventoryAction, /winner\?\.purchaseOrderId === data\.id/);
  });

  it('uses normalized stock quantity exactly once at receipt creation', () => {
    assert.match(inventoryAction, /normalizePurchaseQuantity\(receivedPurchaseQuantity, conversionFactor\)/);
    assert.match(inventoryAction, /receivedQuantity: qty\(item\.receivedQuantity\)/);
    assert.doesNotMatch(procurementDb, /received_quantity\s*\*\s*purchase_unit_conversion/);
  });
});

describe('Phase 17A.1 reviewed-count and cost-only barriers', () => {
  it('finds reviewed counts whose interval contains a historical movement', () => {
    assert.match(procurementDb, /row\.openingSourceDate < effectiveBusinessDate/);
    assert.match(procurementDb, /row\.countDate === effectiveBusinessDate/);
    for (const action of ['receiveOrder', 'createEmergencyPurchase', 'voidGoodsReceipt']) {
      const start = inventoryAction.indexOf(`export async function ${action}`);
      assert.ok(start >= 0);
      assert.match(inventoryAction.slice(start, start + 9000), /findReviewedCountUsingMovement/);
    }
  });

  it('allows late price confirmation to update only cost metadata with audit evidence', () => {
    assert.match(inventoryAction, /prepareCostMetadataRecalculation/);
    assert.match(inventoryAction, /usageCostStatus: recalculation\.after\.usageCostStatus/);
    assert.match(inventoryAction, /recalculation\.before,/);
    assert.match(inventoryAction, /quantityColumnsChanged: false/);
    assert.doesNotMatch(costMetadata, /\.update\(stockCountItems\)/);
    assert.doesNotMatch(costMetadata, /quantityOnHand:\s|regularReceivedQty:\s|estimatedOperationalUsageQty:\s/);
  });

  it('requires permission, reason and audit for a manual opening even when it is zero', () => {
    assert.match(inventoryAction, /if \(manualOpening \|\| openingChanged\)/);
    assert.match(inventoryAction, /กรุณาระบุเหตุผลสำหรับยอดยกมาเริ่มต้น/);
    assert.match(inventoryAction, /before: manualOpening \? null : authoritativeOpening/);
    assert.match(inventoryAction, /usageCostStatus: intervalPriceStatus/);
  });

  it('requires reason and granular permission for review/unreview', () => {
    assert.match(inventoryAction, /can\(session\.user\.role, 'stock_count:review'\)/);
    assert.match(inventoryAction, /can\(session\.user\.role, 'stock_count:unreview'\)/);
    assert.match(inventoryAction, /normalizedReason\.length < 3/);
  });
});

describe('Phase 17A.1 centralized financial and last-cost truth', () => {
  it('recomputes PO totals and global ingredient last cost after every receipt lifecycle action', () => {
    for (const action of ['receiveOrder', 'confirmReceiptPrice', 'createEmergencyPurchase', 'voidGoodsReceipt']) {
      const start = inventoryAction.indexOf(`export async function ${action}`);
      assert.ok(start >= 0);
      const section = inventoryAction.slice(start, start + 12000);
      assert.match(section, /recomputePurchaseFinancialSummary/);
      assert.match(section, /recomputeIngredientLastCost/);
    }
    assert.match(procurementDb, /ORDER BY gr\.received_date DESC, gr\.created_at DESC, gri\.id DESC/);
    assert.match(procurementDb, /gr\.voided_at IS NULL/);
    assert.match(procurementDb, /gri\.price_status = 'confirmed'/);
    assert.match(procurementDb, /gri\.actual_unit_cost > 0/);
  });

  it('aggregates emergency stock only from non-void receipt items', () => {
    assert.match(procurementDb, /eq\(goodsReceipts\.voidedAt, null\)|isNull\(goodsReceipts\.voidedAt\)/);
    assert.match(procurementDb, /purchaseType === 'emergency_direct'/);
    assert.doesNotMatch(procurementDb, /purchaseOrders\.receivedQuantity/);
  });
});

describe('Phase 17A.1 immutable receipt-price confirmation', () => {
  it('rejects repeated confirmation and enforces one history row per receipt item', () => {
    assert.match(inventoryAction, /target\.priceStatus === 'confirmed'/);
    assert.match(inventoryAction, /ne\(goodsReceiptItems\.priceStatus, 'confirmed'\)/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS purchase_price_confirmations_receipt_item_uq/);
  });
});

describe('Phase 17A.1 void concurrency safety', () => {
  it('locks receipt and PO items, guards repeated void, and decrements cached quantity atomically', () => {
    const start = inventoryAction.indexOf('export async function voidGoodsReceipt');
    assert.ok(start >= 0);
    const section = inventoryAction.slice(start, start + 12000);
    assert.match(section, /goodsReceipts\.voidedAt[\s\S]*for\('update'\)/);
    assert.match(section, /1 \/ CASE WHEN EXISTS/);
    assert.match(section, /orderBy\(asc\(purchaseOrderItems\.id\)\)[\s\S]*for\('update'\)/);
    assert.match(section, /GREATEST\([\s\S]*purchaseOrderItems\.receivedQuantity[\s\S]*-/);
    assert.match(section, /purchaseOrderStatus: 'recomputed_after_void'/);
  });
});
describe('Phase 17A.1 conservative all-or-nothing migration', () => {
  it('runs a read-only preflight before one transaction and records a ledger gate', () => {
    assert.match(migration, /async function preflight/);
    assert.ok(migration.indexOf('await preflight(sql') < migration.indexOf('await sql.transaction(['));
    assert.match(migration, /CREATE TABLE IF NOT EXISTS app_migrations/);
    assert.match(migration, /ON CONFLICT \(migration_key\) DO NOTHING/);
  });

  it('never promotes null/zero/planning-only prices to confirmed', () => {
    assert.match(migration, /WHEN confirmed_unit_cost > 0 THEN 'confirmed'/);
    assert.match(migration, /WHEN COALESCE\(estimated_unit_cost, unit_cost\) > 0 THEN 'estimated'/);
    assert.match(migration, /WHEN gri\.actual_unit_cost > 0 THEN 'confirmed'/);
    assert.doesNotMatch(migration, /confirmed_unit_cost = COALESCE\(confirmed_unit_cost, unit_cost\)/);
    assert.doesNotMatch(migration, /confirmed_total = COALESCE\(confirmed_total, total\)/);
  });

  it('preserves historical quantities and PO lifecycle statuses', () => {
    assert.doesNotMatch(migration, /SET received_quantity\s*=/);
    assert.doesNotMatch(migration, /SET quantity_on_hand\s*=/);
    assert.doesNotMatch(migration, /UPDATE purchase_orders\s+SET status\s*=/);
  });

  it('derives remaining quantity from non-void receipt truth instead of the cached PO value', () => {
    assert.match(migration, /received_truth AS/);
    assert.match(migration, /WHERE gr\.voided_at IS NULL/);
    assert.match(migration, /COALESCE\(rt\.received_quantity, 0\)/);
    assert.doesNotMatch(migration, /poi\.quantity - poi\.received_quantity/);
  });

  it('makes the migration checker fail when any runtime-critical additive column is missing', () => {
    for (const column of [
      'reviewed_by',
      'opening_source_count_id',
      'usage_cost_status',
      'has_pending_prices',
      'confirmed_total',
      'purchase_quantity',
      'voided_by',
      'price_confirmed_at',
    ]) assert.match(migrationStatus, new RegExp(`column: '${column}'`));
    assert.match(migrationStatus, /purchase_price_confirmations_receipt_item_uq/);
  });

  it('adds bounded status, positive quantity, conversion, and actual-price consistency constraints', () => {
    for (const constraint of [
      'phase17a_po_price_status_ck',
      'phase17a_po_type_ck',
      'phase17a_poi_price_status_ck',
      'phase17a_gri_price_status_ck',
      'phase17a_gri_price_consistency_ck',
      'phase17a_gri_quantity_ck',
      'phase17a_gri_conversion_ck',
    ]) assert.match(migration, new RegExp(constraint));
    assert.match(migration, /received_quantity > 0/);
    assert.match(migration, /purchase_unit_conversion IS NULL OR purchase_unit_conversion > 0/);
  });
});

describe('Phase 17A.1 permission matrix', () => {
  const sensitive: Action[] = [
    'purchase_price:confirm',
    'goods_receipt:void',
    'goods_receipt:over_receive',
    'purchase_emergency:create',
    'purchase_order:cancel_remaining',
    'stock_count:override_opening',
    'stock_count:review',
    'stock_count:unreview',
  ];

  it('grants every sensitive action to owner and manager only', () => {
    for (const action of sensitive) {
      assert.equal(can('owner', action), true);
      assert.equal(can('manager', action), true);
      assert.equal(can('cashier', action), false);
      assert.equal(can('kitchen', action), false);
    }
  });
});

describe('Phase 17A physical-stock non-goal', () => {
  it('does not mutate physical stock from customer order or POS actions', () => {
    for (const file of ['lib/actions/orders.ts', 'lib/actions/pos.ts']) {
      const source = read(file);
      assert.doesNotMatch(source, /stockCountItems|stockCounts|quantityOnHand/);
      assert.doesNotMatch(source, /update\(ingredients\)/);
    }
  });
});
