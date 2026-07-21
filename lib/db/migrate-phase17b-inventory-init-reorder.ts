/**
 * Phase 17B — Inventory Initialization & Reorder-to-Draft-PO Workflow
 *
 * IMPORTANT: generating/reviewing this file does not authorize running it.
 * It performs a read-only preflight, then one all-or-nothing Neon HTTP
 * transaction. Every statement is IF NOT EXISTS / idempotent so the migration
 * is rerun-safe and the app_migrations ledger stops a second apply.
 *
 * Additive only — no existing row's quantity, price, or status is changed:
 *  - stock_counts.count_type  (default 'daily' → every existing count stays daily)
 *  - purchase_orders.reorder_generation_key (nullable idempotency tag)
 *  - purchase_order_items.reorder_* snapshot columns (nullable; NULL for old rows)
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PHASE17A1_MIGRATION_KEY } from './migrate-phase17a-procurement-stock';

type SqlClient = NeonQueryFunction<false, false>;

export const PHASE17B_MIGRATION_KEY = 'phase17b_inventory_init_reorder';

async function preflight(sql: SqlClient, quiet: boolean) {
  const [summary] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed_counts,
      COUNT(*)::int AS total_counts
    FROM stock_counts
  `;
  const [poSummary] = await sql`
    SELECT COUNT(*)::int AS total_pos,
           COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_pos
    FROM purchase_orders
  `;
  if (!quiet) {
    console.log('Phase 17B preflight (READ-ONLY)', {
      ...summary,
      ...poSummary,
      initial_setup_semantics: 'count_type=initial_setup zeroes usage; qoh = physical',
      reorder_snapshot: 'stored structurally on purchase_order_items (no note parsing)',
      idempotency: 'purchase_orders.reorder_generation_key unique (base_key:supplier_id)',
    });
  }
}

export async function runPhase17BMigration(
  databaseUrl: string,
  options: { quiet?: boolean } = {},
) {
  if (!databaseUrl) throw new Error('Explicit database URL is required');
  const sql = neon(databaseUrl);
  if (!options.quiet) console.log('Phase 17B — Inventory Initialization & Reorder-to-Draft-PO');

  const [ledgerTable] = await sql`SELECT to_regclass('public.app_migrations') AS table_name`;
  if (!ledgerTable?.table_name) {
    throw new Error('Missing app_migrations ledger. Run the approved Phase 17A migration first.');
  }
  const [phase17aApplied] = await sql`
    SELECT migration_key FROM app_migrations WHERE migration_key = ${PHASE17A1_MIGRATION_KEY} LIMIT 1
  `;
  if (!phase17aApplied) {
    throw new Error('Phase 17A migration not applied. Run db:migrate-phase17a first.');
  }
  const [alreadyApplied] = await sql`
    SELECT migration_key FROM app_migrations WHERE migration_key = ${PHASE17B_MIGRATION_KEY} LIMIT 1
  `;
  if (alreadyApplied) {
    if (!options.quiet) console.log('Phase 17B already applied; ledger gate stopped a rerun.');
    return { applied: false as const };
  }

  await preflight(sql, options.quiet ?? false);

  await sql.transaction([
    sql`ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS count_type varchar(16) NOT NULL DEFAULT 'daily'`,
    sql`ALTER TABLE stock_counts ALTER COLUMN count_type SET DEFAULT 'daily'`,

    sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reorder_generation_key text`,

    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS reorder_reviewed_count_date date`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS reorder_physical_stock numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS reorder_par_level numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS reorder_on_time_incoming numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS reorder_delayed_incoming numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS reorder_recommended_stock_qty numeric(10,2)`,
    sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS reorder_recommended_purchase_qty numeric(10,2)`,

    // Conservative backfill: existing counts are operational 'daily'. The column
    // default already covers new NULLs, this pins any pre-default rows explicitly.
    sql`UPDATE stock_counts SET count_type = 'daily' WHERE count_type IS NULL`,

    // Multiple manual/emergency POs legitimately have a NULL key; Postgres treats
    // NULLs as distinct so a plain unique index still guards non-null keys.
    sql`CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_reorder_gen_key_uq ON purchase_orders(reorder_generation_key)`,

    sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase17b_stock_counts_type_ck') THEN
        ALTER TABLE stock_counts ADD CONSTRAINT phase17b_stock_counts_type_ck CHECK (count_type IN ('daily','initial_setup'));
      END IF;
    END $$`,

    sql`INSERT INTO app_migrations (migration_key, phase, metadata)
      VALUES (${PHASE17B_MIGRATION_KEY}, 'Phase 17B', ${JSON.stringify({
        additiveOnly: true,
        quantityChanged: false,
        countTypeBackfill: 'daily',
        reorderSnapshot: 'purchase_order_items',
      })}::jsonb)
      ON CONFLICT (migration_key) DO NOTHING`,
  ]);

  if (!options.quiet) console.log('Phase 17B migration committed. Run db:check-migrations next.');
  return { applied: true as const };
}

async function runFromCli() {
  // Keep the production CLI contract identical to Phase 17A. Tests import the
  // function above and pass an explicit disposable URL, so importing never
  // reads dotenv.
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set in .env.local');
  await runPhase17BMigration(databaseUrl);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runFromCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
