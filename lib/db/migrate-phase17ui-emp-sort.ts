/**
 * Phase 17UI-EMP (part 3) — employees.sort_order column
 *
 * Manual display order for employee rows in the schedule grid and the
 * employees list (move-up/move-down within department groups).
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run.
 *
 * Rollback notes:
 *   - Fully reversible in place: `ALTER TABLE employees DROP COLUMN sort_order;`
 *     loses only manual display ordering, never payroll/time/identity data.
 *
 * Run: npm run db:migrate-phase17ui-emp-sort
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function main() {
  console.log('Phase 17UI-EMP migration — employees.sort_order');

  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`;
  console.log('  ✓ employees.sort_order (integer, default 0) — added or already present');

  const check = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'sort_order'
  `;
  if (check.length === 1) {
    console.log(`  ✓ verified: ${JSON.stringify(check[0])}`);
    console.log('Done.');
  } else {
    console.error('  ✗ verification failed — column not found after ALTER');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
