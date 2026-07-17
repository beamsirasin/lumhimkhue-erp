/**
 * Phase 17UI-DAMAGE — damage catalog (แคตตาล็อกของเสียหาย)
 *
 * 1. Creates `damage_items`: named damage items with a per-unit price,
 *    managed in HR settings (e.g. แก้วน้ำ, ถาดคอนโด, ถ้วยไอศกรีม).
 * 2. Adds snapshot columns `damage_item_name` / `damage_unit_price` to
 *    `employee_incidents` — catalog rows can be deleted or repriced later,
 *    so each report keeps its own copy.
 *
 * Idempotent: CREATE TABLE / CREATE INDEX / ADD COLUMN IF NOT EXISTS — safe to re-run.
 *
 * Rollback notes:
 *   - `DROP TABLE damage_items;` loses only the catalog.
 *   - `ALTER TABLE employee_incidents DROP COLUMN damage_item_name, DROP COLUMN damage_unit_price;`
 *     loses only damage snapshots on incident reports.
 *
 * Run: npm run db:migrate-phase17ui-damage-items
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function main() {
  console.log('Phase 17UI-DAMAGE migration — damage_items + incident snapshot columns');

  await sql`
    CREATE TABLE IF NOT EXISTS damage_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      price_per_unit numeric(10,2) NOT NULL DEFAULT 0,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS damage_items_name_uq ON damage_items (name)`;
  console.log('  ✓ damage_items table + unique name index — created or already present');

  await sql`ALTER TABLE employee_incidents ADD COLUMN IF NOT EXISTS damage_item_name text`;
  await sql`ALTER TABLE employee_incidents ADD COLUMN IF NOT EXISTS damage_unit_price numeric(10,2)`;
  console.log('  ✓ employee_incidents.damage_item_name / damage_unit_price — added or already present');

  const itemCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'damage_items'
  `;
  const incCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_incidents'
      AND column_name IN ('damage_item_name', 'damage_unit_price')
  `;
  const itemNames = itemCols.map((c) => c.column_name);
  const expected = ['id', 'name', 'price_per_unit', 'sort_order', 'created_at'];

  if (expected.every((c) => itemNames.includes(c)) && incCols.length === 2) {
    console.log(`  ✓ verified damage_items columns: ${itemNames.join(', ')}`);
    console.log('  ✓ verified employee_incidents snapshot columns');
    console.log('Done.');
  } else {
    console.error('  ✗ verification failed', { itemNames, incCols });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
