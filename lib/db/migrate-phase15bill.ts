/**
 * Phase 15BILL-A — Account-Based Receipt Templates + Payment Label Cleanup
 * Migration Script
 *
 * Run ONLY after taking a Neon snapshot backup.
 * Usage: npm run db:migrate-phase15bill
 *
 * What this does (in order):
 *  1. Add bill_account_configs (jsonb) column to store_settings — idempotent
 *  2. Rename default receiving account names to Thai (idempotent by code)
 *  3. Rename default payment method names to Thai (idempotent by code)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

const ACCOUNT_RENAMES: Array<{ code: string; name: string }> = [
  { code: 'bank_cash_a',   name: 'บัญชี A' },
  { code: 'bank_cash_b',   name: 'บัญชี B' },
  { code: 'welfare_a',     name: 'บัญชีสวัสดิการ A' },
  { code: 'welfare_b',     name: 'บัญชีสวัสดิการ B' },
];

const METHOD_RENAMES: Array<{ code: string; name: string }> = [
  { code: 'welfare', name: 'สวัสดิการรัฐ' },
  { code: 'cash',    name: 'เงินสด' },
];

async function migrate() {
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  Phase 15BILL-A — Account-Based Receipt Templates');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  IMPORTANT: Have you taken a Neon snapshot backup?');
  console.log('   If not, cancel now (Ctrl+C) and do it first.');
  console.log('');

  // ── 1. Add bill_account_configs column ───────────────────────────────────
  console.log('Step 1/3: Adding bill_account_configs column to store_settings...');
  await sql`
    ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS bill_account_configs JSONB
  `;
  console.log('  ✓ bill_account_configs ready');

  // ── 2. Rename receiving account display names ─────────────────────────────
  console.log('Step 2/3: Renaming receiving account display names to Thai...');
  for (const { code, name } of ACCOUNT_RENAMES) {
    const result = await sql`
      UPDATE receiving_accounts
      SET name = ${name}
      WHERE code = ${code}
    `;
    const updated = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (updated > 0) {
      console.log(`  ✓ ${code} → "${name}"`);
    } else {
      console.log(`  ℹ ${code} not found or already renamed`);
    }
  }

  // ── 3. Rename payment method display names ────────────────────────────────
  console.log('Step 3/3: Renaming payment method display names to Thai...');
  for (const { code, name } of METHOD_RENAMES) {
    const result = await sql`
      UPDATE payment_methods
      SET name = ${name}
      WHERE code = ${code}
    `;
    const updated = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (updated > 0) {
      console.log(`  ✓ ${code} → "${name}"`);
    } else {
      console.log(`  ℹ ${code} not found or already renamed`);
    }
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  ✅  Migration complete!');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Run: npm run db:push   (sync remaining schema diffs)');
  console.log('  2. Run: npm run dev       (verify app starts)');
  console.log('  3. Open Bill Settings → check account tabs are correct');
  console.log('  4. Open Payment Settings → check account names are Thai');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
}

migrate().catch((err) => {
  console.error('');
  console.error('❌ Migration failed:', err);
  console.error('');
  console.error('The migration runs individual statements so partial changes may');
  console.error('have been applied. Restore from your Neon snapshot if needed.');
  process.exit(1);
});
