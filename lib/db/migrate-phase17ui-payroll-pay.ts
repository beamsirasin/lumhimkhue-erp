/**
 * Phase 17UI-PAYROLL — mixed pay method + second payment proof image
 *
 * 1. Adds 'mixed' (เงินสด+โอน) to the hr_payment_method enum.
 * 2. Adds nullable `payment_proof_url_2` column to `payroll_items`
 *    so a payout can carry two proof images (e.g. cash receipt + transfer slip).
 * 3. Adds nullable `paid_cash_amount` / `paid_transfer_amount` columns to
 *    `payroll_items` so the actual paid amount (and the cash/transfer split
 *    for mixed payments) is recorded and printable on the payslip.
 *
 * Idempotent: ADD VALUE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — safe to re-run.
 *
 * Rollback notes:
 *   - payment_proof_url_2 is fully reversible:
 *       ALTER TABLE payroll_items DROP COLUMN payment_proof_url_2;
 *   - Postgres cannot drop an enum value in place; 'mixed' stays once added.
 *     It is additive and harmless — existing rows are untouched.
 *
 * Run: npm run db:migrate-phase17ui-payroll-pay
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function main() {
  console.log('Phase 17UI-PAYROLL migration — mixed pay method + payment_proof_url_2');

  await sql`ALTER TYPE hr_payment_method ADD VALUE IF NOT EXISTS 'mixed'`;
  console.log("  ✓ hr_payment_method 'mixed' — added or already present");

  await sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS payment_proof_url_2 text`;
  console.log('  ✓ payroll_items.payment_proof_url_2 (text, nullable) — added or already present');

  await sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS paid_cash_amount numeric(12,2)`;
  await sql`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS paid_transfer_amount numeric(12,2)`;
  console.log('  ✓ payroll_items.paid_cash_amount / paid_transfer_amount (numeric, nullable) — added or already present');

  const enumCheck = await sql`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'hr_payment_method'
    ORDER BY e.enumsortorder
  `;
  const labels = enumCheck.map((r) => r.enumlabel);
  const colCheck = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_items'
      AND column_name IN ('payment_proof_url_2', 'paid_cash_amount', 'paid_transfer_amount')
  `;

  if (labels.includes('mixed') && colCheck.length === 3) {
    console.log(`  ✓ verified enum values: ${labels.join(', ')}`);
    console.log(`  ✓ verified column: ${JSON.stringify(colCheck[0])}`);
    console.log('Done.');
  } else {
    console.error('  ✗ verification failed', { labels, colCheck });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
