import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  PHASE17A1_MIGRATION_KEY,
  runPhase17A1Migration,
} from '../../lib/db/migrate-phase17a-procurement-stock';
import { runMigrationStatusCheck } from '../../scripts/check-migration-status';

type SqlClient = NeonQueryFunction<false, false>;
type ReceiveLine = { itemId: string; quantity: number };

const databaseUrl = process.env.PHASE17A_TEST_DATABASE_URL;
const disposableAcknowledged = process.env.PHASE17A_DISPOSABLE_DB_ACK
  === 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE';
if (databaseUrl?.includes('-pooler')) {
  throw new Error('PHASE17A_TEST_DATABASE_URL must use a direct non-pooler connection');
}
const enabled = Boolean(databaseUrl && disposableAcknowledged);
const sql = enabled ? neon(databaseUrl as string) : null;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const userId = randomUUID();
const categoryId = randomUUID();
const supplierId = randomUUID();
const ingredientId = randomUUID();
const createdPoIds: string[] = [];
let rollbackSchema: string | null = null;
let migrationSnapshot = '';
const legacyIds: Record<string, string> = {};

const phaseConstraintDrops = [
  `ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS phase17a_po_price_status_ck`,
  `ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS phase17a_po_type_ck`,
  `ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS phase17a_poi_price_status_ck`,
  `ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS phase17a_poi_conversion_ck`,
  `ALTER TABLE goods_receipt_items DROP CONSTRAINT IF EXISTS phase17a_gri_price_status_ck`,
  `ALTER TABLE goods_receipt_items DROP CONSTRAINT IF EXISTS phase17a_gri_price_consistency_ck`,
  `ALTER TABLE goods_receipt_items DROP CONSTRAINT IF EXISTS phase17a_gri_quantity_ck`,
  `ALTER TABLE goods_receipt_items DROP CONSTRAINT IF EXISTS phase17a_gri_conversion_ck`,
];

function db(): SqlClient {
  if (!sql) throw new Error('DISPOSABLE_DATABASE_NOT_CONFIGURED');
  return sql;
}

async function cleanupFixtureRows() {
  if (!sql) return;
  await sql`DELETE FROM purchase_price_confirmations
    WHERE confirmed_by = ${userId}
       OR goods_receipt_item_id IN (
         SELECT gri.id FROM goods_receipt_items gri
         JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
         WHERE gr.received_by = ${userId}
       )`;
  await sql`DELETE FROM goods_receipt_items
    WHERE goods_receipt_id IN (SELECT id FROM goods_receipts WHERE received_by = ${userId})`;
  await sql`DELETE FROM goods_receipts WHERE received_by = ${userId}`;
  await sql`DELETE FROM purchase_order_items
    WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE created_by = ${userId})`;
  await sql`DELETE FROM purchase_orders WHERE created_by = ${userId}`;
  await sql`DELETE FROM stock_count_adjustments WHERE created_by = ${userId}`;
  await sql`DELETE FROM stock_count_items
    WHERE stock_count_id IN (SELECT id FROM stock_counts WHERE counted_by = ${userId})`;
  await sql`DELETE FROM stock_counts WHERE counted_by = ${userId}`;
  await sql`DELETE FROM ingredients WHERE id = ${ingredientId}`;
  await sql`DELETE FROM suppliers WHERE id = ${supplierId}`;
  await sql`DELETE FROM ingredient_categories WHERE id = ${categoryId}`;
  await sql`DELETE FROM store_business_days
    WHERE business_date BETWEEN '2098-01-01' AND '2099-12-31'`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
}

async function createBaseFixture() {
  await db().transaction((tx) => [
    tx`INSERT INTO users (id, email, password_hash, name, role)
       VALUES (${userId}, ${`phase17a2-${suffix}@invalid.test`}, 'not-used', 'Phase 17A.2 Test', 'owner')`,
    tx`INSERT INTO ingredient_categories (id, name) VALUES (${categoryId}, ${`Phase17A2-${suffix}`})`,
    tx`INSERT INTO suppliers (id, name) VALUES (${supplierId}, ${`Phase17A2 Supplier ${suffix}`})`,
    tx`INSERT INTO ingredients (id, category_id, name, unit, last_cost)
       VALUES (${ingredientId}, ${categoryId}, ${`Phase17A2 Ingredient ${suffix}`}, 'kg', 42)`,
  ]);
}

async function prepareRepeatableMigrationState() {
  const [ledger] = await db()`SELECT to_regclass('public.app_migrations') AS name`;
  if (ledger?.name) {
    await db()`DELETE FROM app_migrations WHERE migration_key = ${PHASE17A1_MIGRATION_KEY}`;
  }
  for (const statement of phaseConstraintDrops) {
    await db().query(statement);
  }
}

async function insertLegacyPo(
  code: string,
  status: 'draft' | 'ordered' | 'partial_received' | 'received' | 'cancelled',
  items: Array<{ key: string; quantity: number; unitCost: number | null; cachedReceived?: number }>,
) {
  const poId = randomUUID();
  legacyIds[`po_${code}`] = poId;
  const queries = [
    db()`INSERT INTO purchase_orders
      (id, po_number, supplier_id, status, order_date, created_by)
      VALUES (${poId}, ${`LEG-${suffix}-${code}`}, ${supplierId}, ${status}, '2099-02-01', ${userId})`,
  ];
  for (const item of items) {
    const itemId = randomUUID();
    legacyIds[`item_${item.key}`] = itemId;
    queries.push(db()`INSERT INTO purchase_order_items
      (id, purchase_order_id, ingredient_id, quantity, unit, unit_cost, line_total, received_quantity,
       last_cost_snapshot, estimated_unit_cost, confirmed_unit_cost, price_status)
      VALUES (${itemId}, ${poId}, ${ingredientId}, ${item.quantity}, 'kg', ${item.unitCost},
       ${item.unitCost == null ? null : item.quantity * item.unitCost}, ${item.cachedReceived ?? 0},
       NULL, NULL, NULL, 'pending')`);
  }
  for (const query of queries) await query;
}

async function insertLegacyReceipt(
  key: string,
  poKey: string,
  itemKey: string,
  quantity: number,
  actualUnitCost: number | null,
  voided = false,
) {
  const receiptId = randomUUID();
  const receiptItemId = randomUUID();
  legacyIds[`receipt_${key}`] = receiptId;
  legacyIds[`receipt_item_${key}`] = receiptItemId;
  await db().transaction((tx) => [
    tx`INSERT INTO goods_receipts
      (id, purchase_order_id, received_date, idempotency_key, received_by, voided_at, voided_by, void_reason)
      VALUES (${receiptId}, ${legacyIds[`po_${poKey}`]}, '2099-02-02', ${`legacy-${suffix}-${key}`}, ${userId},
       ${voided ? new Date('2099-02-03T00:00:00Z') : null}, ${voided ? userId : null},
       ${voided ? 'legacy void fixture' : null})`,
    tx`INSERT INTO goods_receipt_items
      (id, goods_receipt_id, purchase_order_item_id, received_quantity,
       discrepancy_type, estimated_unit_cost, actual_unit_cost, price_status)
      VALUES (${receiptItemId}, ${receiptId}, ${legacyIds[`item_${itemKey}`]}, ${quantity},
       'none', NULL, ${actualUnitCost}, 'pending')`,
  ]);
}

async function snapshotLegacyRows() {
  const poIds = Object.entries(legacyIds)
    .filter(([key]) => key.startsWith('po_'))
    .map(([, id]) => id);
  const rows = await db()`SELECT id, status, price_status, has_pending_prices,
      confirmed_subtotal, confirmed_vat_amount, confirmed_total,
      estimated_subtotal, estimated_vat_amount, estimated_total, pending_price_item_count
    FROM purchase_orders WHERE id = ANY(${poIds}) ORDER BY id`;
  const items = await db()`SELECT id, received_quantity, unit_cost, estimated_unit_cost,
      confirmed_unit_cost, price_status, purchase_quantity, purchase_unit, purchase_unit_conversion
    FROM purchase_order_items WHERE purchase_order_id = ANY(${poIds}) ORDER BY id`;
  const receipts = await db()`SELECT gri.id, gri.received_quantity, gri.actual_unit_cost,
      gri.estimated_unit_cost, gri.price_status, gr.voided_at
    FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
    WHERE gr.purchase_order_id = ANY(${poIds}) ORDER BY gri.id`;
  const ledger = await db()`SELECT migration_key, phase, metadata
    FROM app_migrations WHERE migration_key = ${PHASE17A1_MIGRATION_KEY}`;
  const confirmations = await db()`SELECT id FROM purchase_price_confirmations
    WHERE goods_receipt_item_id = ANY(${Object.entries(legacyIds)
      .filter(([key]) => key.startsWith('receipt_item_')).map(([, id]) => id)}) ORDER BY id`;
  return JSON.stringify({ rows, items, receipts, ledger, confirmations });
}

async function createPo(quantities: number[]) {
  const poId = randomUUID();
  const itemIds = quantities.map(() => randomUUID());
  createdPoIds.push(poId);
  await db().transaction((tx) => [
    tx`INSERT INTO purchase_orders
       (id, po_number, supplier_id, status, order_date, created_by)
       VALUES (${poId}, ${`IT-${suffix}-${createdPoIds.length}`}, ${supplierId}, 'ordered', '2098-01-10', ${userId})`,
    ...quantities.map((quantity, index) => tx`INSERT INTO purchase_order_items
       (id, purchase_order_id, ingredient_id, quantity, unit, unit_cost, line_total, received_quantity)
       VALUES (${itemIds[index]}, ${poId}, ${ingredientId}, ${quantity}, 'kg', NULL, NULL, 0)`),
  ]);
  return { poId, itemIds };
}

async function executeReceiveTransaction(
  poId: string,
  lines: ReceiveLine[],
  idempotencyKey: string,
  failFinancialRecompute = false,
) {
  const receiptId = randomUUID();
  try {
    await db().transaction((tx) => [
      tx`SELECT id FROM purchase_order_items
         WHERE purchase_order_id = ${poId}
         ORDER BY id FOR UPDATE`,
      ...lines.map((line) => tx`SELECT 1 / CASE WHEN
         COALESCE(received_quantity, 0) + ${line.quantity} > quantity + 0.005
         THEN 0 ELSE 1 END AS guard
         FROM purchase_order_items WHERE id = ${line.itemId}`),
      tx`INSERT INTO goods_receipts
         (id, purchase_order_id, received_date, idempotency_key, received_by)
         VALUES (${receiptId}, ${poId}, '2098-01-10', ${idempotencyKey}, ${userId})`,
      ...lines.map((line) => tx`INSERT INTO goods_receipt_items
         (id, goods_receipt_id, purchase_order_item_id, received_quantity,
          received_purchase_quantity, purchase_unit, purchase_unit_conversion,
          stock_unit, discrepancy_type, price_status)
         VALUES (${randomUUID()}, ${receiptId}, ${line.itemId}, ${line.quantity},
          ${line.quantity}, 'kg', 1, 'kg', 'none', 'pending')`),
      ...lines.map((line) => tx`UPDATE purchase_order_items
         SET received_quantity = COALESCE(received_quantity, 0) + ${line.quantity}
         WHERE id = ${line.itemId}`),
      tx`UPDATE purchase_orders SET status = CASE WHEN NOT EXISTS (
           SELECT 1 FROM purchase_order_items poi
           WHERE poi.purchase_order_id = ${poId}
             AND COALESCE(poi.received_quantity, 0) < poi.quantity - 0.005
         ) THEN 'received'::purchase_order_status
         ELSE 'partial_received'::purchase_order_status END,
         received_date = CASE WHEN NOT EXISTS (
           SELECT 1 FROM purchase_order_items poi
           WHERE poi.purchase_order_id = ${poId}
             AND COALESCE(poi.received_quantity, 0) < poi.quantity - 0.005
         ) THEN '2098-01-10'::date ELSE NULL END
         WHERE id = ${poId}`,
      failFinancialRecompute
        ? tx`UPDATE purchase_orders SET confirmed_total = 1 / 0 WHERE id = ${poId}`
        : tx`UPDATE purchase_orders po SET confirmed_subtotal = COALESCE((
            SELECT SUM(gri.received_quantity * COALESCE(gri.actual_unit_cost, 0))
            FROM purchase_order_items poi
            JOIN goods_receipt_items gri ON gri.purchase_order_item_id = poi.id
            JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
            WHERE poi.purchase_order_id = po.id AND gr.voided_at IS NULL
          ), 0) WHERE po.id = ${poId}`,
    ]);
    return { duplicate: false, receiptId };
  } catch (error) {
    const [winner] = await db()`SELECT id FROM goods_receipts
      WHERE idempotency_key = ${idempotencyKey} LIMIT 1`;
    if (winner) return { duplicate: true, receiptId: String(winner.id) };
    throw new Error('CONTROLLED_RECEIPT_TRANSACTION_FAILURE', { cause: error });
  }
}

async function executeVoidTransaction(receiptId: string) {
  const [receipt] = await db()`SELECT purchase_order_id FROM goods_receipts
    WHERE id = ${receiptId} AND voided_at IS NULL`;
  if (!receipt) throw new Error('RECEIPT_ALREADY_VOIDED');
  const lines = await db()`SELECT gri.purchase_order_item_id, gri.received_quantity
    FROM goods_receipt_items gri WHERE gri.goods_receipt_id = ${receiptId}`;
  const poId = String(receipt.purchase_order_id);
  await db().transaction((tx) => [
    tx`SELECT id FROM goods_receipts
       WHERE id = ${receiptId} AND voided_at IS NULL FOR UPDATE`,
    tx`SELECT 1 / CASE WHEN EXISTS (
         SELECT 1 FROM goods_receipts WHERE id = ${receiptId} AND voided_at IS NULL
       ) THEN 1 ELSE 0 END AS guard`,
    tx`SELECT id FROM purchase_order_items
       WHERE purchase_order_id = ${poId} ORDER BY id FOR UPDATE`,
    tx`UPDATE goods_receipts SET voided_at = now(), voided_by = ${userId},
       void_reason = 'Phase 17A.2 concurrent void'
       WHERE id = ${receiptId} AND voided_at IS NULL`,
    ...lines.map((line) => tx`UPDATE purchase_order_items
       SET received_quantity = GREATEST(
         COALESCE(received_quantity, 0) - ${Number(line.received_quantity)}, 0
       ) WHERE id = ${String(line.purchase_order_item_id)}`),
    tx`UPDATE purchase_orders SET status = CASE
       WHEN NOT EXISTS (SELECT 1 FROM purchase_order_items poi
         WHERE poi.purchase_order_id = ${poId}
           AND COALESCE(poi.received_quantity, 0) < poi.quantity - 0.005)
         THEN 'received'::purchase_order_status
       WHEN EXISTS (SELECT 1 FROM purchase_order_items poi
         WHERE poi.purchase_order_id = ${poId}
           AND COALESCE(poi.received_quantity, 0) > 0.005)
         THEN 'partial_received'::purchase_order_status
       ELSE 'ordered'::purchase_order_status END
       WHERE id = ${poId}`,
  ]);
}

async function assertQuantityTruth(poId: string, expected: number) {
  const [row] = await db()`SELECT
    COALESCE(SUM(DISTINCT poi.received_quantity), 0) AS cached,
    COALESCE((SELECT SUM(gri.received_quantity)
      FROM purchase_order_items pi
      JOIN goods_receipt_items gri ON gri.purchase_order_item_id = pi.id
      JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      WHERE pi.purchase_order_id = ${poId} AND gr.voided_at IS NULL), 0) AS source
    FROM purchase_order_items poi WHERE poi.purchase_order_id = ${poId}`;
  assert.equal(Number(row.cached), expected);
  assert.equal(Number(row.source), expected);
}

describe('Phase 17A.2 real PostgreSQL schema and migration', { skip: !enabled }, () => {
  before(async () => {
    await cleanupFixtureRows();
    await prepareRepeatableMigrationState();
    await createBaseFixture();
  });

  after(async () => {
    if (rollbackSchema && sql) {
      await sql`DROP SCHEMA IF EXISTS ${sql.unsafe(rollbackSchema)} CASCADE`;
    }
    await cleanupFixtureRows();
  });

  it('migrates a real legacy fixture and preserves lifecycle, received, and physical truth', async () => {
    await insertLegacyPo('null', 'draft', [
      { key: 'null', quantity: 8, unitCost: null },
    ]);
    await insertLegacyPo('zero', 'ordered', [
      { key: 'zero', quantity: 8, unitCost: 0 },
    ]);
    await insertLegacyPo('positive', 'ordered', [
      { key: 'positive', quantity: 8, unitCost: 100 },
    ]);
    await insertLegacyPo('partial', 'partial_received', [
      { key: 'partial', quantity: 10, unitCost: 80, cachedReceived: 9 },
    ]);
    await insertLegacyPo('full', 'received', [
      { key: 'full', quantity: 5, unitCost: 70, cachedReceived: 5 },
    ]);
    await insertLegacyPo('cancelled', 'cancelled', [
      { key: 'cancelled', quantity: 4, unitCost: null, cachedReceived: 2 },
    ]);
    await insertLegacyPo('mixed', 'ordered', [
      { key: 'mixed_confirmed', quantity: 2, unitCost: 100, cachedReceived: 2 },
      { key: 'mixed_estimated', quantity: 3, unitCost: 90 },
      { key: 'mixed_pending', quantity: 4, unitCost: null },
    ]);
    await insertLegacyPo('void', 'received', [
      { key: 'void', quantity: 1, unitCost: 50, cachedReceived: 1 },
    ]);
    await insertLegacyPo('multi', 'received', [
      { key: 'multi', quantity: 2, unitCost: 100, cachedReceived: 2 },
    ]);

    await insertLegacyReceipt('partial', 'partial', 'partial', 4, 90);
    await insertLegacyReceipt('full', 'full', 'full', 5, 75);
    await insertLegacyReceipt('cancelled', 'cancelled', 'cancelled', 2, null);
    await insertLegacyReceipt('mixed', 'mixed', 'mixed_confirmed', 2, 110);
    await insertLegacyReceipt('void', 'void', 'void', 1, 999, true);
    await insertLegacyReceipt('multi_a', 'multi', 'multi', 1, 120);
    await insertLegacyReceipt('multi_b', 'multi', 'multi', 1, 130);

    const stockFixtures = [
      { key: 'draft', date: '2099-03-10', status: 'draft', quantity: 11 },
      { key: 'submitted', date: '2099-03-11', status: 'submitted', quantity: 12 },
      { key: 'reviewed', date: '2099-03-12', status: 'reviewed', quantity: 13 },
    ] as const;
    for (const fixture of stockFixtures) {
      const countId = randomUUID();
      legacyIds[`count_${fixture.key}`] = countId;
      await db().transaction((tx) => [
        tx`INSERT INTO stock_counts (id, count_date, counted_by, status, submitted_at)
          VALUES (${countId}, ${fixture.date}, ${userId}, ${fixture.status},
            ${fixture.status === 'draft' ? null : new Date(`${fixture.date}T10:00:00Z`)})`,
        tx`INSERT INTO stock_count_items
          (id, stock_count_id, ingredient_id, opening_balance, received_qty, used_qty,
           quantity_on_hand, unit, is_counted)
          VALUES (${randomUUID()}, ${countId}, ${ingredientId}, 20, 5, 2,
           ${fixture.quantity}, 'kg', true)`,
      ]);
    }

    const poIds = Object.entries(legacyIds)
      .filter(([key]) => key.startsWith('po_')).map(([, id]) => id);
    const countIds = stockFixtures.map((fixture) => legacyIds[`count_${fixture.key}`]);
    const beforeLifecycle = await db()`SELECT id, status FROM purchase_orders
      WHERE id = ANY(${poIds}) ORDER BY id`;
    const beforeReceived = await db()`SELECT id, received_quantity FROM purchase_order_items
      WHERE purchase_order_id = ANY(${poIds}) ORDER BY id`;
    const beforePhysical = await db()`SELECT sc.id, sc.status, sci.opening_balance,
      sci.received_qty, sci.used_qty, sci.quantity_on_hand, sci.is_counted
      FROM stock_counts sc JOIN stock_count_items sci ON sci.stock_count_id = sc.id
      WHERE sc.id = ANY(${countIds}) ORDER BY sc.id`;

    const migrationResult = await runPhase17A1Migration(databaseUrl as string, { quiet: true });
    assert.equal(migrationResult.applied, true);

    const afterLifecycle = await db()`SELECT id, status FROM purchase_orders
      WHERE id = ANY(${poIds}) ORDER BY id`;
    const afterReceived = await db()`SELECT id, received_quantity FROM purchase_order_items
      WHERE purchase_order_id = ANY(${poIds}) ORDER BY id`;
    const afterPhysical = await db()`SELECT sc.id, sc.status, sci.opening_balance,
      sci.received_qty, sci.used_qty, sci.quantity_on_hand, sci.is_counted
      FROM stock_counts sc JOIN stock_count_items sci ON sci.stock_count_id = sc.id
      WHERE sc.id = ANY(${countIds}) ORDER BY sc.id`;
    assert.deepEqual(afterLifecycle, beforeLifecycle);
    assert.deepEqual(afterReceived, beforeReceived);
    assert.deepEqual(afterPhysical, beforePhysical);

    const headers = await db()`SELECT id, price_status, has_pending_prices,
      confirmed_subtotal, estimated_subtotal, pending_price_item_count
      FROM purchase_orders WHERE id = ANY(${poIds})`;
    const byId = new Map(headers.map((row) => [String(row.id), row]));
    assert.equal(byId.get(legacyIds.po_null)?.price_status, 'pending');
    assert.equal(byId.get(legacyIds.po_zero)?.price_status, 'pending');
    assert.equal(byId.get(legacyIds.po_positive)?.price_status, 'estimated');
    assert.equal(Number(byId.get(legacyIds.po_positive)?.estimated_subtotal), 800);
    assert.equal(byId.get(legacyIds.po_partial)?.price_status, 'estimated');
    assert.equal(Number(byId.get(legacyIds.po_partial)?.confirmed_subtotal), 360);
    assert.equal(Number(byId.get(legacyIds.po_partial)?.estimated_subtotal), 480);
    assert.equal(byId.get(legacyIds.po_full)?.price_status, 'confirmed');
    assert.equal(Number(byId.get(legacyIds.po_full)?.confirmed_subtotal), 375);
    assert.equal(byId.get(legacyIds.po_cancelled)?.price_status, 'pending');
    assert.equal(byId.get(legacyIds.po_mixed)?.price_status, 'pending');
    assert.equal(Number(byId.get(legacyIds.po_mixed)?.confirmed_subtotal), 220);
    assert.equal(Number(byId.get(legacyIds.po_mixed)?.estimated_subtotal), 270);
    assert.equal(byId.get(legacyIds.po_void)?.price_status, 'estimated');
    assert.equal(Number(byId.get(legacyIds.po_void)?.confirmed_subtotal), 0);
    assert.equal(Number(byId.get(legacyIds.po_void)?.estimated_subtotal), 50);
    assert.equal(byId.get(legacyIds.po_multi)?.price_status, 'confirmed');
    assert.equal(Number(byId.get(legacyIds.po_multi)?.confirmed_subtotal), 250);

    const receiptPrices = await db()`SELECT gri.id, gri.price_status, gri.actual_unit_cost, gr.voided_at
      FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      WHERE gr.purchase_order_id = ANY(${poIds}) ORDER BY gri.id`;
    for (const row of receiptPrices) {
      if (Number(row.actual_unit_cost ?? 0) > 0) assert.equal(row.price_status, 'confirmed');
      else assert.notEqual(row.price_status, 'confirmed');
    }

    const expectedConstraints = [
      'phase17a_po_price_status_ck', 'phase17a_po_type_ck',
      'phase17a_poi_price_status_ck', 'phase17a_poi_conversion_ck',
      'phase17a_gri_price_status_ck', 'phase17a_gri_price_consistency_ck',
      'phase17a_gri_quantity_ck', 'phase17a_gri_conversion_ck',
      'stock_counts_business_day_id_fk', 'stock_counts_reviewed_by_fk',
      'stock_count_items_opening_source_fk', 'stock_count_adjustments_business_day_fk',
      'purchase_orders_business_day_id_fk', 'purchase_orders_source_po_id_fk',
      'goods_receipts_business_day_id_fk', 'goods_receipts_voided_by_fk',
      'goods_receipt_items_price_confirmed_by_fk',
    ];
    const constraints = await db()`SELECT conname FROM pg_constraint
      WHERE conname = ANY(${expectedConstraints})`;
    assert.equal(constraints.length, expectedConstraints.length);

    const defaults = await db()`SELECT table_name, column_name, column_default
      FROM information_schema.columns WHERE table_schema = 'public' AND (
        (table_name = 'purchase_orders' AND column_name IN ('price_status','has_pending_prices'))
        OR (table_name = 'purchase_order_items' AND column_name = 'price_status')
        OR (table_name = 'goods_receipt_items' AND column_name = 'price_status')
        OR (table_name = 'stock_count_items' AND column_name = 'usage_cost_status')
      )`;
    assert.equal(defaults.length, 5);
    for (const row of defaults) {
      if (row.column_name === 'has_pending_prices') assert.match(String(row.column_default), /true/);
      else assert.match(String(row.column_default), /pending/);
    }

    const [ledger] = await db()`SELECT COUNT(*)::int AS count FROM app_migrations
      WHERE migration_key = ${PHASE17A1_MIGRATION_KEY}`;
    assert.equal(Number(ledger.count), 1);
    const checker = await runMigrationStatusCheck(
      databaseUrl as string,
      'public',
      { redactDatabaseIdentity: true },
    );
    assert.equal(checker.ok, true);
    migrationSnapshot = await snapshotLegacyRows();
  });

  it('serializes concurrent 8 + 8 receives on real procurement tables', async () => {
    const { poId, itemIds } = await createPo([8]);
    const outcomes = await Promise.allSettled([
      executeReceiveTransaction(poId, [{ itemId: itemIds[0], quantity: 8 }], randomUUID()),
      executeReceiveTransaction(poId, [{ itemId: itemIds[0], quantity: 8 }], randomUUID()),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
    await assertQuantityTruth(poId, 8);
  });

  it('keeps receive versus void cached and source quantities consistent', async () => {
    const { poId, itemIds } = await createPo([8]);
    const original = await executeReceiveTransaction(
      poId, [{ itemId: itemIds[0], quantity: 8 }], randomUUID(),
    );
    const outcomes = await Promise.allSettled([
      executeVoidTransaction(original.receiptId),
      executeReceiveTransaction(poId, [{ itemId: itemIds[0], quantity: 8 }], randomUUID()),
    ]);
    assert.ok(outcomes.some((result) => result.status === 'fulfilled'));
    const [row] = await db()`SELECT
      poi.received_quantity AS cached,
      COALESCE(SUM(gri.received_quantity) FILTER (WHERE gr.voided_at IS NULL), 0) AS source
      FROM purchase_order_items poi
      LEFT JOIN goods_receipt_items gri ON gri.purchase_order_item_id = poi.id
      LEFT JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      WHERE poi.id = ${itemIds[0]} GROUP BY poi.received_quantity`;
    assert.equal(Number(row.cached), Number(row.source));
    assert.ok(Number(row.cached) === 0 || Number(row.cached) === 8);
  });

  it('allows only one concurrent void and decrements exactly once', async () => {
    const { poId, itemIds } = await createPo([8]);
    const receipt = await executeReceiveTransaction(
      poId, [{ itemId: itemIds[0], quantity: 8 }], randomUUID(),
    );
    const outcomes = await Promise.allSettled([
      executeVoidTransaction(receipt.receiptId),
      executeVoidTransaction(receipt.receiptId),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
    await assertQuantityTruth(poId, 0);
  });

  it('avoids deadlock when concurrent multi-item receive payloads use reverse order', async () => {
    const { poId, itemIds } = await createPo([8, 8]);
    await Promise.all([
      executeReceiveTransaction(poId, [
        { itemId: itemIds[1], quantity: 4 },
        { itemId: itemIds[0], quantity: 4 },
      ], randomUUID()),
      executeReceiveTransaction(poId, [
        { itemId: itemIds[0], quantity: 4 },
        { itemId: itemIds[1], quantity: 4 },
      ], randomUUID()),
    ]);
    const rows = await db()`SELECT received_quantity FROM purchase_order_items
      WHERE purchase_order_id = ${poId} ORDER BY id`;
    assert.deepEqual(rows.map((row) => Number(row.received_quantity)), [8, 8]);
  });

  it('rolls back receipt, cached quantity, status, and header when financial recompute fails', async () => {
    const { poId, itemIds } = await createPo([8]);
    await assert.rejects(() => executeReceiveTransaction(
      poId, [{ itemId: itemIds[0], quantity: 3 }], randomUUID(), true,
    ));
    const [po] = await db()`SELECT status, confirmed_total FROM purchase_orders WHERE id = ${poId}`;
    assert.equal(po.status, 'ordered');
    assert.equal(Number(po.confirmed_total ?? 0), 0);
    await assertQuantityTruth(poId, 0);
  });

  it('uses the migration ledger to make rerun a data-identical no-op', async () => {
    assert.ok(migrationSnapshot.length > 0);
    const rerun = await runPhase17A1Migration(databaseUrl as string, { quiet: true });
    assert.equal(rerun.applied, false);
    const afterRerun = await snapshotLegacyRows();
    assert.equal(afterRerun, migrationSnapshot);
    const [ledger] = await db()`SELECT COUNT(*)::int AS count FROM app_migrations
      WHERE migration_key = ${PHASE17A1_MIGRATION_KEY}`;
    assert.equal(Number(ledger.count), 1);
  });

  it('rolls back DDL, backfill, and ledger together after an injected transaction failure', async () => {
    rollbackSchema = `phase17a_rollback_${suffix}`;
    const table = `${rollbackSchema}.legacy_items`;
    const ledger = `${rollbackSchema}.app_migrations`;
    await db()`CREATE SCHEMA ${db().unsafe(rollbackSchema)}`;
    await db()`CREATE TABLE ${db().unsafe(table)} (
      id integer PRIMARY KEY,
      unit_cost numeric(10,2)
    )`;
    await db()`INSERT INTO ${db().unsafe(table)} (id, unit_cost) VALUES (1, 100)`;

    await assert.rejects(() => db().transaction((tx) => [
      tx`ALTER TABLE ${tx.unsafe(table)} ADD COLUMN price_status varchar(16)`,
      tx`UPDATE ${tx.unsafe(table)} SET price_status = CASE
        WHEN unit_cost > 0 THEN 'estimated' ELSE 'pending' END`,
      tx`CREATE TABLE ${tx.unsafe(ledger)} (
        migration_key text PRIMARY KEY,
        applied_at timestamp NOT NULL DEFAULT now()
      )`,
      tx`INSERT INTO ${tx.unsafe(ledger)} (migration_key) VALUES (${PHASE17A1_MIGRATION_KEY})`,
      tx`SELECT 1 / 0 AS injected_failure_after_mutation`,
    ]));

    const [column] = await db()`SELECT COUNT(*)::int AS count
      FROM information_schema.columns
      WHERE table_schema = ${rollbackSchema}
        AND table_name = 'legacy_items'
        AND column_name = 'price_status'`;
    const [ledgerTable] = await db()`SELECT to_regclass(${ledger}) AS name`;
    const [original] = await db()`SELECT unit_cost FROM ${db().unsafe(table)} WHERE id = 1`;
    assert.equal(Number(column.count), 0);
    assert.equal(ledgerTable.name, null);
    assert.equal(Number(original.unit_cost), 100);

    await db().transaction((tx) => [
      tx`ALTER TABLE ${tx.unsafe(table)} ADD COLUMN price_status varchar(16)`,
      tx`UPDATE ${tx.unsafe(table)} SET price_status = CASE
        WHEN unit_cost > 0 THEN 'estimated' ELSE 'pending' END`,
      tx`CREATE TABLE ${tx.unsafe(ledger)} (
        migration_key text PRIMARY KEY,
        applied_at timestamp NOT NULL DEFAULT now()
      )`,
      tx`INSERT INTO ${tx.unsafe(ledger)} (migration_key) VALUES (${PHASE17A1_MIGRATION_KEY})`,
    ]);
    const [recovered] = await db()`SELECT unit_cost, price_status
      FROM ${db().unsafe(table)} WHERE id = 1`;
    const [recoveredLedger] = await db()`SELECT COUNT(*)::int AS count FROM ${db().unsafe(ledger)}`;
    assert.equal(Number(recovered.unit_cost), 100);
    assert.equal(recovered.price_status, 'estimated');
    assert.equal(Number(recoveredLedger.count), 1);
  });
});
