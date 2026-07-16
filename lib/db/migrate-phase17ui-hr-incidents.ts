/**
 * Phase 17UI-HR-INCIDENTS — employee_incidents table (รายงานพนักงาน)
 *
 * Standalone incident log for owner/manager to report employee events:
 * late (นาที), absence (วันที่), damage (จำนวนชิ้น + รายละเอียด), behavior (รายละเอียด).
 * Not tied to payroll cycles — payroll deductions remain a separate, explicit step.
 *
 * `type` is deliberately text (not a pg enum) to avoid ALTER TYPE friction;
 * values are validated in lib/validations/hr.ts (same precedent as employees.department).
 *
 * Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS — safe to re-run.
 *
 * Rollback notes:
 *   - Fully reversible in place: `DROP TABLE employee_incidents;`
 *     loses only incident reports; nothing else references this table.
 *
 * Run: npm run db:migrate-phase17ui-hr-incidents
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function main() {
  console.log('Phase 17UI-HR-INCIDENTS migration — employee_incidents');

  await sql`
    CREATE TABLE IF NOT EXISTS employee_incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      type text NOT NULL,
      occurred_date date NOT NULL,
      late_minutes integer,
      damage_quantity integer,
      description text,
      reported_by uuid NOT NULL REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log('  ✓ employee_incidents table — created or already present');

  await sql`CREATE INDEX IF NOT EXISTS employee_incidents_emp_idx ON employee_incidents (employee_id)`;
  await sql`CREATE INDEX IF NOT EXISTS employee_incidents_date_idx ON employee_incidents (occurred_date)`;
  console.log('  ✓ indexes — created or already present');

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_incidents'
  `;
  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'employee_incidents'
  `;
  const colNames = cols.map((c) => c.column_name);
  const idxNames = idx.map((i) => i.indexname);
  const expectedCols = ['id', 'employee_id', 'type', 'occurred_date', 'late_minutes', 'damage_quantity', 'description', 'reported_by', 'created_at'];
  const expectedIdx = ['employee_incidents_emp_idx', 'employee_incidents_date_idx'];

  if (expectedCols.every((c) => colNames.includes(c)) && expectedIdx.every((i) => idxNames.includes(i))) {
    console.log(`  ✓ verified columns: ${colNames.join(', ')}`);
    console.log(`  ✓ verified indexes: ${idxNames.join(', ')}`);
    console.log('Done.');
  } else {
    console.error('  ✗ verification failed', { colNames, idxNames });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
