/**
 * Phase 17POS-AUTH-A5 — Store Day Closing
 *
 * Additive, idempotent migration for the store-wide Bangkok business-day gate.
 * Run ONLY after taking a Neon snapshot backup.
 * Usage: npm run db:migrate-phase17pos-auth-a5
 *
 * Creates:
 *  - store_business_days (one row per Bangkok calendar date)
 *  - unique business-date index and status index
 *
 * No existing payment, session, shift, or approval-code data is changed.
 * Rollback before deploying dependent code:
 *   DROP TABLE store_business_days;
 * After production usage, restore from the pre-migration snapshot instead if
 * closure history must be preserved.
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
  console.log('  Phase 17POS-AUTH-A5 — Store Day Closing');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  Take a Neon snapshot backup before continuing.');
  console.log('');

  console.log('Step 1/2: Creating store_business_days table...');
  await sql`
    CREATE TABLE IF NOT EXISTS store_business_days (
      id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_date            date NOT NULL,
      status                   varchar(16) NOT NULL DEFAULT 'open',
      closed_at                timestamp,
      closed_by_user_id        uuid REFERENCES users(id),
      close_approval_code_id   uuid REFERENCES manager_approval_codes(id),
      close_reason             text,
      reopened_at              timestamp,
      reopened_by_user_id      uuid REFERENCES users(id),
      reopen_approval_code_id  uuid REFERENCES manager_approval_codes(id),
      reopen_reason            text,
      created_at               timestamp NOT NULL DEFAULT now(),
      updated_at               timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log('  ✓ store_business_days ready');

  console.log('Step 2/2: Creating indexes...');
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS store_business_days_business_date_uq
      ON store_business_days (business_date)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS store_business_days_status_idx
      ON store_business_days (status)
  `;
  console.log('  ✓ indexes ready');

  console.log('');
  console.log('✅ Migration complete');
  console.log('Next: npm run db:check-migrations');
  console.log('');
}

migrate().catch((error) => {
  console.error('');
  console.error('❌ Migration failed:', error);
  console.error('All statements are idempotent — rerunning is safe.');
  process.exitCode = 1;
});
