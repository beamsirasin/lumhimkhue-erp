/**
 * Phase 16B — Payment Idempotency + Double Submit Protection
 * Migration Script
 *
 * Run ONLY after taking a Neon snapshot backup.
 * Usage: npm run db:migrate-phase16b
 *
 * ⚠️ REQUIRED before deploying/running the Phase 16B code: schema.ts now
 * includes payments.idempotency_key, so every payments SELECT/INSERT will
 * reference the column. POS payments fail until this migration has run.
 *
 * What this does (in order, both statements idempotent):
 *  1. ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key varchar(64)
 *  2. CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uq
 *       ON payments (idempotency_key)
 *     (NULLs are distinct in Postgres unique indexes, so all pre-16B rows
 *      with NULL keys coexist; only real keys are enforced unique.)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  Phase 16B — Payment Idempotency');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  IMPORTANT: Have you taken a Neon snapshot backup?');
  console.log('   If not, cancel now (Ctrl+C) and do it first.');
  console.log('');

  console.log('Step 1/2: Adding idempotency_key column to payments...');
  await sql`
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS idempotency_key varchar(64)
  `;
  console.log('  ✓ idempotency_key ready');

  console.log('Step 2/2: Creating unique index payments_idempotency_key_uq...');
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uq
      ON payments (idempotency_key)
  `;
  console.log('  ✓ unique index ready');

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  ✅  Migration complete!');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Run: npm run dev  (verify app starts)');
  console.log('  2. POS: process one payment, verify it succeeds');
  console.log('  3. Run the Phase 16B UAT cases (double-tap, retry)');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
}

migrate().catch((err) => {
  console.error('');
  console.error('❌ Migration failed:', err);
  console.error('');
  console.error('Both statements are idempotent — rerunning is safe.');
  process.exit(1);
});
