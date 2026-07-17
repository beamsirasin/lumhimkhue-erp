/**
 * Phase 17UI-INCIDENT-LINK — link payroll deductions/absences to incident reports
 *
 * Adds nullable `incident_id` to `payroll_deductions` and `payroll_absences`,
 * referencing `employee_incidents` (ON DELETE SET NULL).
 *
 * This powers the "ดึงรายการค้าง" flow: pending incident reports (สาย/ขาด/เสียหาย)
 * are pulled into a draft payroll cycle as deduction/absence rows carrying
 * incident_id. An incident counts as "จัดการแล้ว" when a linked row EXISTS —
 * derived state, so deleting the deduction, the payroll item, or the whole
 * cycle automatically reverts the incident to "รอจัดการ" with no bookkeeping.
 *
 * Also adds `resolved_at` / `resolved_by` to `employee_incidents` for MANUAL
 * resolution (จัดการเองนอกรอบเงินเดือน) — undoable, unlike the payroll link.
 *
 * Idempotent: ADD COLUMN / CREATE INDEX IF NOT EXISTS — safe to re-run.
 *
 * Rollback notes:
 *   - Fully reversible: DROP COLUMN incident_id on both tables (loses only
 *     the incident linkage; amounts already applied to payroll are untouched).
 *
 * Run: npm run db:migrate-phase17ui-incident-link
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function main() {
  console.log('Phase 17UI-INCIDENT-LINK migration — incident_id on payroll_deductions/payroll_absences');

  await sql`
    ALTER TABLE payroll_deductions
    ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES employee_incidents(id) ON DELETE SET NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS payroll_deductions_incident_idx ON payroll_deductions (incident_id)`;
  console.log('  ✓ payroll_deductions.incident_id + index — added or already present');

  await sql`
    ALTER TABLE payroll_absences
    ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES employee_incidents(id) ON DELETE SET NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS payroll_absences_incident_idx ON payroll_absences (incident_id)`;
  console.log('  ✓ payroll_absences.incident_id + index — added or already present');

  await sql`ALTER TABLE employee_incidents ADD COLUMN IF NOT EXISTS resolved_at timestamp`;
  await sql`ALTER TABLE employee_incidents ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id)`;
  console.log('  ✓ employee_incidents.resolved_at / resolved_by — added or already present');

  const manualCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_incidents'
      AND column_name IN ('resolved_at', 'resolved_by')
  `;
  const cols = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'incident_id'
      AND table_name IN ('payroll_deductions', 'payroll_absences')
  `;
  if (cols.length === 2 && manualCols.length === 2) {
    console.log(`  ✓ verified: ${cols.map((c) => `${c.table_name}.${c.column_name}`).join(', ')}`);
    console.log('Done.');
  } else {
    console.error('  ✗ verification failed', { cols });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
