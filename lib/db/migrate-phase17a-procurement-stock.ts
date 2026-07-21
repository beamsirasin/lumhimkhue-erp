/**
 * Phase 17A.1 — Procurement and Stock Integrity
 *
 * IMPORTANT: generating/reviewing this file does not authorize running it.
 * It performs a read-only preflight first, then one all-or-nothing Neon HTTP
 * transaction. Legacy PO unit_cost is treated as planning evidence only;
 * zero/null prices are pending and positive planning prices are estimated.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type SqlClient = NeonQueryFunction<false, false>;

export const PHASE17A1_MIGRATION_KEY = 'phase17a1_procurement_stock_integrity';

async function preflight(sql: SqlClient, quiet: boolean) {
  const [summary] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE poi.unit_cost IS NULL)::int AS null_price_items,
      COUNT(*) FILTER (WHERE poi.unit_cost = 0)::int AS zero_price_items,
      COUNT(*) FILTER (WHERE poi.unit_cost > 0)::int AS positive_planning_price_items,
      COUNT(DISTINCT po.id) FILTER (WHERE po.status = 'partial_received')::int AS partial_pos,
      COUNT(DISTINCT po.id) FILTER (WHERE po.status = 'cancelled')::int AS cancelled_pos,
      COUNT(DISTINCT po.id) FILTER (WHERE po.status = 'received')::int AS received_pos
    FROM purchase_order_items poi
    INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
  `;
  const [receiptSummary] = await sql`
    SELECT
      COUNT(*)::int AS receipt_items_without_proven_actual_price,
      COUNT(*) FILTER (WHERE received_quantity <= 0)::int AS invalid_received_quantity
    FROM goods_receipt_items
  `;
  const priceSamples = await sql`
    SELECT poi.id, poi.purchase_order_id, poi.unit_cost, po.status
    FROM purchase_order_items poi
    INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.unit_cost IS NULL OR poi.unit_cost <= 0
    ORDER BY po.order_date DESC, poi.id
    LIMIT 20
  `;
  const receiptSamples = await sql`
    SELECT gri.id, gri.goods_receipt_id, gri.purchase_order_item_id, gri.received_quantity
    FROM goods_receipt_items gri
    ORDER BY gri.id
    LIMIT 20
  `;
  if (!quiet) {
    console.log('Phase 17A.1 preflight (READ-ONLY)', {
      ...summary,
      ...receiptSummary,
      price_sample_ids: priceSamples,
      receipt_sample_ids: receiptSamples,
      legacy_price_decision: 'unit_cost > 0 => estimated; unit_cost <= 0/null => pending',
    });
  }
  if (Number(receiptSummary?.invalid_received_quantity ?? 0) > 0) {
    throw new Error('PREFLIGHT_BLOCKED: goods_receipt_items contains received_quantity <= 0');
  }
}

export async function runPhase17A1Migration(
  databaseUrl: string,
  options: { quiet?: boolean } = {},
) {
  if (!databaseUrl) throw new Error('Explicit database URL is required');
  const sql = neon(databaseUrl);
  if (!options.quiet) console.log('Phase 17A.1 — Procurement and Stock Integrity');
  const [dependency] = await sql`SELECT to_regclass('public.store_business_days') AS table_name`;
  if (!dependency?.table_name) {
    throw new Error('Missing store_business_days. Run the approved Phase 17POS-AUTH-A5 migration first.');
  }

  const [ledgerTable] = await sql`SELECT to_regclass('public.app_migrations') AS table_name`;
  if (ledgerTable?.table_name) {
    const [alreadyApplied] = await sql`
      SELECT migration_key FROM app_migrations WHERE migration_key = ${PHASE17A1_MIGRATION_KEY} LIMIT 1
    `;
    if (alreadyApplied) {
      if (!options.quiet) console.log('Phase 17A.1 already applied; ledger gate stopped a rerun.');
      return { applied: false as const };
    }
  }

  await preflight(sql, options.quiet ?? false);

  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS app_migrations (
      migration_key text PRIMARY KEY,
      phase text NOT NULL,
      applied_at timestamp NOT NULL DEFAULT now(),
      metadata jsonb
    )`,

    sql`ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS business_day_id uuid`,
    sql`ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS reviewed_at timestamp`,
    sql`ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS reviewed_by uuid`,

    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS is_counted boolean NOT NULL DEFAULT true`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS opening_source_count_id uuid`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS opening_source_date date`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS opening_override_reason text`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS regular_received_qty numeric(10,2) NOT NULL DEFAULT 0`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS emergency_received_qty numeric(10,2) NOT NULL DEFAULT 0`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS positive_adjustment_qty numeric(10,2) NOT NULL DEFAULT 0`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS recorded_waste_qty numeric(10,2) NOT NULL DEFAULT 0`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS other_outbound_qty numeric(10,2) NOT NULL DEFAULT 0`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS total_depletion_qty numeric(10,2) NOT NULL DEFAULT 0`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS estimated_operational_usage_qty numeric(10,2) NOT NULL DEFAULT 0`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS usage_unit_cost numeric(12,4)`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS usage_cost_status varchar(16) NOT NULL DEFAULT 'pending'`,
    sql`ALTER TABLE stock_count_items ALTER COLUMN usage_cost_status SET DEFAULT 'pending'`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS estimated_usage_cost numeric(12,2)`,
    sql`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS cost_recalculated_at timestamp`,

    sql`ALTER TABLE stock_count_adjustments ADD COLUMN IF NOT EXISTS business_day_id uuid`,
    sql`ALTER TABLE stock_count_adjustments ADD COLUMN IF NOT EXISTS effective_date date`,

    sql`ALTER TABLE purchase_orders ALTER COLUMN supplier_id DROP NOT NULL`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS business_day_id uuid`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchase_type varchar(24) NOT NULL DEFAULT 'supplier_order'`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_name text`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchased_at timestamp`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source_purchase_order_id uuid`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS price_status varchar(16) NOT NULL DEFAULT 'pending'`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS has_pending_prices boolean NOT NULL DEFAULT true`,
    sql`ALTER TABLE purchase_orders ALTER COLUMN price_status SET DEFAULT 'pending'`,
    sql`ALTER TABLE purchase_orders ALTER COLUMN has_pending_prices SET DEFAULT true`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_subtotal numeric(12,2)`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_vat_amount numeric(12,2)`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_total numeric(12,2)`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS estimated_subtotal numeric(12,2)`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS estimated_vat_amount numeric(12,2)`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS estimated_total numeric(12,2)`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS pending_price_item_count integer NOT NULL DEFAULT 0`,
    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_remaining_reason text`,

    sql`ALTER TABLE purchase_order_items ALTER COLUMN unit_cost DROP NOT NULL`,
    sql`ALTER TABLE purchase_order_items ALTER COLUMN line_total DROP NOT NULL`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS last_cost_snapshot numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS estimated_unit_cost numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS confirmed_unit_cost numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS price_status varchar(16) NOT NULL DEFAULT 'pending'`,
    sql`ALTER TABLE purchase_order_items ALTER COLUMN price_status SET DEFAULT 'pending'`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS purchase_quantity numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS purchase_unit text`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS purchase_unit_conversion numeric(10,4)`,

    sql`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS business_day_id uuid`,
    sql`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS idempotency_key varchar(64)`,
    sql`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS receipt_image_url text`,
    sql`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS voided_at timestamp`,
    sql`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS voided_by uuid`,
    sql`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS void_reason text`,

    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS received_purchase_quantity numeric(10,2)`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS purchase_unit text`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS purchase_unit_conversion numeric(10,4)`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS stock_unit text`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS estimated_unit_cost numeric(10,2)`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS actual_unit_cost numeric(10,2)`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS price_status varchar(16) NOT NULL DEFAULT 'pending'`,
    sql`ALTER TABLE goods_receipt_items ALTER COLUMN price_status SET DEFAULT 'pending'`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS price_confirmed_at timestamp`,
    sql`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS price_confirmed_by uuid`,

    sql`CREATE TABLE IF NOT EXISTS purchase_price_confirmations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      goods_receipt_item_id uuid NOT NULL REFERENCES goods_receipt_items(id),
      estimated_unit_cost numeric(10,2),
      previous_actual_unit_cost numeric(10,2),
      actual_unit_cost numeric(10,2) NOT NULL,
      variance_amount numeric(12,2),
      variance_percent numeric(9,2),
      reason text NOT NULL,
      confirmed_by uuid NOT NULL REFERENCES users(id),
      confirmed_at timestamp NOT NULL DEFAULT now()
    )`,

    sql`CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_idempotency_key_uq ON goods_receipts(idempotency_key)`,
    sql`CREATE INDEX IF NOT EXISTS purchase_orders_business_day_idx ON purchase_orders(business_day_id)`,
    sql`CREATE INDEX IF NOT EXISTS purchase_orders_type_idx ON purchase_orders(purchase_type)`,
    sql`CREATE INDEX IF NOT EXISTS purchase_orders_price_status_idx ON purchase_orders(price_status)`,
    sql`CREATE INDEX IF NOT EXISTS goods_receipts_business_day_idx ON goods_receipts(business_day_id)`,
    sql`CREATE INDEX IF NOT EXISTS goods_receipts_voided_idx ON goods_receipts(voided_at)`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS purchase_price_confirmations_receipt_item_uq ON purchase_price_confirmations(goods_receipt_item_id)`,

    sql`INSERT INTO store_business_days (business_date, status)
      SELECT d, 'open'
      FROM (
        SELECT count_date AS d FROM stock_counts
        UNION SELECT order_date AS d FROM purchase_orders
        UNION SELECT received_date AS d FROM goods_receipts
      ) dates
      WHERE d IS NOT NULL
      ON CONFLICT (business_date) DO NOTHING`,
    sql`UPDATE stock_counts sc SET business_day_id = sbd.id
      FROM store_business_days sbd
      WHERE sc.business_day_id IS NULL AND sbd.business_date = sc.count_date`,
    sql`UPDATE purchase_orders po SET business_day_id = sbd.id
      FROM store_business_days sbd
      WHERE po.business_day_id IS NULL AND sbd.business_date = po.order_date`,
    sql`UPDATE goods_receipts gr SET business_day_id = sbd.id
      FROM store_business_days sbd
      WHERE gr.business_day_id IS NULL AND sbd.business_date = gr.received_date`,
    sql`UPDATE stock_count_adjustments sca
      SET business_day_id = COALESCE(sca.business_day_id, sc.business_day_id),
          effective_date = COALESCE(sca.effective_date, sc.count_date)
      FROM stock_counts sc WHERE sca.stock_count_id = sc.id`,

    sql`UPDATE purchase_order_items
      SET last_cost_snapshot = COALESCE(last_cost_snapshot, NULLIF(unit_cost, 0)),
          estimated_unit_cost = CASE
            WHEN estimated_unit_cost > 0 THEN estimated_unit_cost
            WHEN unit_cost > 0 THEN unit_cost
            ELSE NULL
          END,
          confirmed_unit_cost = CASE WHEN confirmed_unit_cost > 0 THEN confirmed_unit_cost ELSE NULL END,
          price_status = CASE
            WHEN confirmed_unit_cost > 0 THEN 'confirmed'
            WHEN COALESCE(estimated_unit_cost, unit_cost) > 0 THEN 'estimated'
            ELSE 'pending'
          END,
          purchase_quantity = COALESCE(purchase_quantity, quantity),
          purchase_unit = COALESCE(purchase_unit, unit),
          purchase_unit_conversion = COALESCE(purchase_unit_conversion, 1)`,

    sql`UPDATE goods_receipt_items gri
      SET actual_unit_cost = CASE WHEN gri.actual_unit_cost > 0 THEN gri.actual_unit_cost ELSE NULL END,
          estimated_unit_cost = CASE
            WHEN gri.estimated_unit_cost > 0 THEN gri.estimated_unit_cost
            WHEN poi.estimated_unit_cost > 0 THEN poi.estimated_unit_cost
            WHEN poi.unit_cost > 0 THEN poi.unit_cost
            ELSE NULL
          END,
          price_status = CASE
            WHEN gri.actual_unit_cost > 0 THEN 'confirmed'
            WHEN COALESCE(gri.estimated_unit_cost, poi.estimated_unit_cost, poi.unit_cost) > 0 THEN 'estimated'
            ELSE 'pending'
          END,
          received_purchase_quantity = COALESCE(gri.received_purchase_quantity, gri.received_quantity),
          purchase_unit = COALESCE(gri.purchase_unit, poi.unit),
          purchase_unit_conversion = COALESCE(gri.purchase_unit_conversion, 1),
          stock_unit = COALESCE(gri.stock_unit, poi.unit)
      FROM purchase_order_items poi
      WHERE gri.purchase_order_item_id = poi.id`,

    sql`WITH receipt_financial AS (
      SELECT po.id,
        COALESCE(SUM(CASE WHEN gr.voided_at IS NULL AND gri.price_status = 'confirmed' AND gri.actual_unit_cost > 0
          THEN gri.received_quantity * gri.actual_unit_cost ELSE 0 END), 0) AS confirmed_subtotal,
        COALESCE(SUM(CASE WHEN gr.voided_at IS NULL AND gri.price_status <> 'confirmed'
          AND COALESCE(gri.estimated_unit_cost, poi.estimated_unit_cost, poi.unit_cost) > 0
          THEN gri.received_quantity * COALESCE(gri.estimated_unit_cost, poi.estimated_unit_cost, poi.unit_cost)
          ELSE 0 END), 0) AS estimated_subtotal,
        COUNT(*) FILTER (WHERE gr.voided_at IS NULL AND gri.price_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE gr.voided_at IS NULL AND gri.price_status <> 'confirmed')::int AS unconfirmed_count
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      LEFT JOIN goods_receipt_items gri ON gri.purchase_order_item_id = poi.id
      LEFT JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      GROUP BY po.id
    ), received_truth AS (
      SELECT gri.purchase_order_item_id,
        SUM(gri.received_quantity) AS received_quantity
      FROM goods_receipt_items gri
      INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      WHERE gr.voided_at IS NULL
      GROUP BY gri.purchase_order_item_id
    ), item_state AS (
      SELECT po.id,
        COALESCE(SUM(CASE
          WHEN poi.price_status <> 'confirmed' AND COALESCE(poi.estimated_unit_cost, poi.unit_cost) > 0
          THEN GREATEST(poi.quantity - COALESCE(rt.received_quantity, 0), 0)
            * COALESCE(poi.estimated_unit_cost, poi.unit_cost)
          ELSE 0 END), 0) AS remaining_estimated_subtotal,
        COUNT(*) FILTER (
          WHERE GREATEST(poi.quantity - COALESCE(rt.received_quantity, 0), 0) > 0
            AND poi.price_status = 'pending'
        )::int AS pending_count,
        COUNT(*) FILTER (
          WHERE GREATEST(poi.quantity - COALESCE(rt.received_quantity, 0), 0) > 0
            AND poi.price_status <> 'confirmed'
        )::int AS unconfirmed_count
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      LEFT JOIN received_truth rt ON rt.purchase_order_item_id = poi.id
      GROUP BY po.id
    ), financial AS (
      SELECT rf.id,
        rf.confirmed_subtotal,
        rf.estimated_subtotal + ist.remaining_estimated_subtotal AS estimated_subtotal,
        rf.pending_count + ist.pending_count AS pending_count,
        rf.unconfirmed_count + ist.unconfirmed_count AS unconfirmed_count
      FROM receipt_financial rf
      INNER JOIN item_state ist ON ist.id = rf.id
    )
    UPDATE purchase_orders po
      SET confirmed_subtotal = f.confirmed_subtotal,
          confirmed_vat_amount = ROUND(f.confirmed_subtotal * po.vat_rate / 100, 2),
          confirmed_total = ROUND(f.confirmed_subtotal * (1 + po.vat_rate / 100), 2),
          estimated_subtotal = f.estimated_subtotal,
          estimated_vat_amount = ROUND(f.estimated_subtotal * po.vat_rate / 100, 2),
          estimated_total = ROUND(f.estimated_subtotal * (1 + po.vat_rate / 100), 2),
          pending_price_item_count = f.pending_count,
          has_pending_prices = f.unconfirmed_count > 0,
          price_status = CASE
            WHEN f.pending_count > 0 THEN 'pending'
            WHEN f.unconfirmed_count > 0 THEN 'estimated'
            ELSE 'confirmed'
          END
      FROM financial f WHERE f.id = po.id`,

    sql`UPDATE stock_count_items sci
      SET regular_received_qty = sci.received_qty,
          total_depletion_qty = sci.used_qty,
          estimated_operational_usage_qty = sci.used_qty,
          usage_unit_cost = COALESCE(sci.usage_unit_cost, NULLIF(ing.last_cost, 0)),
          usage_cost_status = CASE WHEN ing.last_cost > 0 THEN 'confirmed' ELSE 'pending' END,
          estimated_usage_cost = CASE WHEN ing.last_cost > 0 THEN sci.used_qty * ing.last_cost ELSE NULL END,
          cost_recalculated_at = COALESCE(sci.cost_recalculated_at, now())
      FROM ingredients ing WHERE sci.ingredient_id = ing.id`,

    sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_po_price_status_ck') THEN
        ALTER TABLE purchase_orders ADD CONSTRAINT phase17a_po_price_status_ck CHECK (price_status IN ('pending','estimated','confirmed'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_po_type_ck') THEN
        ALTER TABLE purchase_orders ADD CONSTRAINT phase17a_po_type_ck CHECK (purchase_type IN ('supplier_order','emergency_direct'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_poi_price_status_ck') THEN
        ALTER TABLE purchase_order_items ADD CONSTRAINT phase17a_poi_price_status_ck CHECK (price_status IN ('pending','estimated','confirmed'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_poi_conversion_ck') THEN
        ALTER TABLE purchase_order_items ADD CONSTRAINT phase17a_poi_conversion_ck CHECK (purchase_unit_conversion IS NULL OR purchase_unit_conversion > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_gri_price_status_ck') THEN
        ALTER TABLE goods_receipt_items ADD CONSTRAINT phase17a_gri_price_status_ck CHECK (price_status IN ('pending','estimated','confirmed'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_gri_price_consistency_ck') THEN
        ALTER TABLE goods_receipt_items ADD CONSTRAINT phase17a_gri_price_consistency_ck CHECK (
          (price_status = 'confirmed' AND actual_unit_cost > 0)
          OR (price_status <> 'confirmed' AND actual_unit_cost IS NULL)
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_gri_quantity_ck') THEN
        ALTER TABLE goods_receipt_items ADD CONSTRAINT phase17a_gri_quantity_ck CHECK (received_quantity > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17a_gri_conversion_ck') THEN
        ALTER TABLE goods_receipt_items ADD CONSTRAINT phase17a_gri_conversion_ck CHECK (purchase_unit_conversion IS NULL OR purchase_unit_conversion > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_counts_business_day_id_fk') THEN
        ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_business_day_id_fk FOREIGN KEY (business_day_id) REFERENCES store_business_days(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_counts_reviewed_by_fk') THEN
        ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES users(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_count_items_opening_source_fk') THEN
        ALTER TABLE stock_count_items ADD CONSTRAINT stock_count_items_opening_source_fk FOREIGN KEY (opening_source_count_id) REFERENCES stock_counts(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_count_adjustments_business_day_fk') THEN
        ALTER TABLE stock_count_adjustments ADD CONSTRAINT stock_count_adjustments_business_day_fk FOREIGN KEY (business_day_id) REFERENCES store_business_days(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_business_day_id_fk') THEN
        ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_business_day_id_fk FOREIGN KEY (business_day_id) REFERENCES store_business_days(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_source_po_id_fk') THEN
        ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_source_po_id_fk FOREIGN KEY (source_purchase_order_id) REFERENCES purchase_orders(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipts_business_day_id_fk') THEN
        ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_business_day_id_fk FOREIGN KEY (business_day_id) REFERENCES store_business_days(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipts_voided_by_fk') THEN
        ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_voided_by_fk FOREIGN KEY (voided_by) REFERENCES users(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipt_items_price_confirmed_by_fk') THEN
        ALTER TABLE goods_receipt_items ADD CONSTRAINT goods_receipt_items_price_confirmed_by_fk FOREIGN KEY (price_confirmed_by) REFERENCES users(id);
      END IF;
    END $$`,

    sql`INSERT INTO app_migrations (migration_key, phase, metadata)
      VALUES (${PHASE17A1_MIGRATION_KEY}, 'Phase 17A.1', ${JSON.stringify({
        priceBackfill: 'conservative',
        quantityChanged: false,
        legacyPositiveUnitCost: 'estimated',
      })}::jsonb)
      ON CONFLICT (migration_key) DO NOTHING`,
  ]);

  if (!options.quiet) console.log('Phase 17A.1 migration committed. Run db:check-migrations next.');
  return { applied: true as const };
}

async function runFromCli() {
  // Keep the production CLI contract unchanged. Tests import the function above
  // and pass PHASE17A_TEST_DATABASE_URL explicitly, so importing never reads dotenv.
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set in .env.local');
  await runPhase17A1Migration(databaseUrl);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runFromCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
