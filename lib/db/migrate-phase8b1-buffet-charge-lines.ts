/**
 * Phase 8B-1: Buffet Charge Lines + Payment Allocations — Schema Migration & Backfill
 *
 * Idempotent — safe to run multiple times.
 *
 * Steps:
 *  1. Add session_guests.unit_price column (if absent)
 *  2. Create buffet_charge_lines table (if absent)
 *  3. Create payment_allocations table (if absent)
 *  4. Backfill session_guests.unit_price from pricingTiles.price
 *  5. Create initial buffet_charge_lines from existing session_guests (skip if already present)
 *
 * Does NOT create payment_allocations rows — existing payments remain legacy/unallocated.
 */

import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`  OK   ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('already exists') ||
      message.includes('does not exist') ||
      message.includes('duplicate column') ||
      message.includes('duplicate key')
    ) {
      console.log(`  SKIP ${label} (${message.slice(0, 80)})`);
      return;
    }
    console.error(`  FAIL ${label}`);
    throw error;
  }
}

async function main() {
  console.log('Phase 8B-1: buffet charge lines + payment allocations migration');

  // ── Step 1: session_guests.unit_price ──────────────────────────────────────
  console.log('\n[1] session_guests.unit_price');

  await run('ADD COLUMN session_guests.unit_price', () => sql`
    ALTER TABLE "session_guests"
      ADD COLUMN IF NOT EXISTS "unit_price" numeric(10,2) NOT NULL DEFAULT '0';
  `);

  // ── Step 2: buffet_charge_lines table ─────────────────────────────────────
  console.log('\n[2] buffet_charge_lines');

  await run('CREATE TABLE buffet_charge_lines', () => sql`
    CREATE TABLE IF NOT EXISTS "buffet_charge_lines" (
      "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      "session_id"       uuid        NOT NULL REFERENCES "sessions"("id"),
      "pricing_tile_id"  uuid        REFERENCES "pricing_tiles"("id"),
      "charge_type"      varchar(30) NOT NULL,
      "label"            varchar(255) NOT NULL,
      "unit_price"       numeric(10,2) NOT NULL,
      "quantity"         integer     NOT NULL,
      "total"            numeric(10,2) NOT NULL,
      "created_at"       timestamp   NOT NULL DEFAULT now(),
      "voided_at"        timestamp
    );
  `);

  await run('INDEX buffet_charge_lines_session_id_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "buffet_charge_lines_session_id_idx"
      ON "buffet_charge_lines" ("session_id");
  `);

  await run('INDEX buffet_charge_lines_pricing_tile_id_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "buffet_charge_lines_pricing_tile_id_idx"
      ON "buffet_charge_lines" ("pricing_tile_id");
  `);

  await run('INDEX buffet_charge_lines_charge_type_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "buffet_charge_lines_charge_type_idx"
      ON "buffet_charge_lines" ("charge_type");
  `);

  await run('INDEX buffet_charge_lines_voided_at_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "buffet_charge_lines_voided_at_idx"
      ON "buffet_charge_lines" ("voided_at");
  `);

  // ── Step 3: payment_allocations table ─────────────────────────────────────
  console.log('\n[3] payment_allocations');

  await run('CREATE TABLE payment_allocations', () => sql`
    CREATE TABLE IF NOT EXISTS "payment_allocations" (
      "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      "payment_id"      uuid        NOT NULL REFERENCES "payments"("id"),
      "session_id"      uuid        NOT NULL REFERENCES "sessions"("id"),
      "charge_line_id"  uuid        NOT NULL REFERENCES "buffet_charge_lines"("id"),
      "quantity"        integer     NOT NULL,
      "amount"          numeric(10,2) NOT NULL,
      "note"            text,
      "created_at"      timestamp   NOT NULL DEFAULT now()
    );
  `);

  await run('INDEX payment_allocations_payment_id_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "payment_allocations_payment_id_idx"
      ON "payment_allocations" ("payment_id");
  `);

  await run('INDEX payment_allocations_session_id_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "payment_allocations_session_id_idx"
      ON "payment_allocations" ("session_id");
  `);

  await run('INDEX payment_allocations_charge_line_id_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "payment_allocations_charge_line_id_idx"
      ON "payment_allocations" ("charge_line_id");
  `);

  // ── Step 4: Backfill session_guests.unit_price ────────────────────────────
  console.log('\n[4] Backfill session_guests.unit_price from pricing_tiles.price');

  const backfillResult = await sql`
    UPDATE "session_guests" sg
    SET "unit_price" = pt."price"
    FROM "pricing_tiles" pt
    WHERE sg."pricing_tile_id" = pt."id"
      AND sg."unit_price" = '0';
  `;
  console.log(`  OK   Backfilled ${(backfillResult as { rowCount?: number }).rowCount ?? '?'} session_guests rows`);

  // ── Step 5: Create buffet_charge_lines from existing session_guests ────────
  console.log('\n[5] Create buffet_charge_lines from existing session_guests (idempotent)');

  // Insert a charge line for each session_guest row that does not already have one.
  // Idempotency key: (session_id, pricing_tile_id) — one charge line per tile per session.
  const insertResult = await sql`
    INSERT INTO "buffet_charge_lines"
      ("session_id", "pricing_tile_id", "charge_type", "label", "unit_price", "quantity", "total", "created_at")
    SELECT
      sg."session_id",
      sg."pricing_tile_id",
      COALESCE(NULLIF(pt."code", ''), pt."name", 'guest') AS "charge_type",
      pt."name"                                            AS "label",
      CASE WHEN sg."unit_price" > 0 THEN sg."unit_price" ELSE pt."price" END AS "unit_price",
      sg."quantity",
      (CASE WHEN sg."unit_price" > 0 THEN sg."unit_price" ELSE pt."price" END) * sg."quantity" AS "total",
      now()
    FROM "session_guests" sg
    JOIN "pricing_tiles" pt ON pt."id" = sg."pricing_tile_id"
    WHERE NOT EXISTS (
      SELECT 1 FROM "buffet_charge_lines" bcl
      WHERE bcl."session_id"      = sg."session_id"
        AND bcl."pricing_tile_id" = sg."pricing_tile_id"
    );
  `;
  console.log(`  OK   Inserted ${(insertResult as { rowCount?: number }).rowCount ?? '?'} buffet_charge_lines rows`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\nPhase 8B-1 migration complete.');
  console.log('');
  console.log('Manual checks:');
  console.log('  SELECT count(*), avg(unit_price::numeric) FROM session_guests WHERE unit_price > 0;');
  console.log('  SELECT count(*) FROM buffet_charge_lines;');
  console.log('  SELECT count(*) FROM payment_allocations;  -- should be 0');
  console.log('  Run migration twice to verify idempotency (counts should not increase on second run).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
