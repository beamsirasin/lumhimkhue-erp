/**
 * Phase 17UI-EMP — employees.department column
 *
 * Adds a nullable free-text `department` column to `employees`
 * (kitchen/service/dishwash/cashier/icecream — validated in
 * lib/validations/hr.ts, deliberately NOT a pg enum to avoid
 * ALTER TYPE friction; same precedent as manager_approval_codes.status).
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run.
 *
 * Rollback notes:
 *   - Fully reversible in place: `ALTER TABLE employees DROP COLUMN department;`
 *     loses only department assignments, never payroll/time/identity data.
 *   - No backfill, no data migration, nothing else references this column.
 *
 * Run: npm run db:migrate-phase17ui-emp-dept
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function main() {
  console.log('Phase 17UI-EMP migration — employees.department');

  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS department text`;
  console.log('  ✓ employees.department (text, nullable) — added or already present');

  const check = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'department'
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
