/**
 * Phase 17POS-AUTH-A1 — Manager Approval Code Foundation
 * Migration Script
 *
 * Run ONLY after taking a Neon snapshot backup.
 * Usage: npm run db:migrate-phase17pos-auth-a1
 *
 * ⚠️ REQUIRED before deploying/running the Phase 17POS-AUTH-A1 code: schema.ts
 * now declares the manager_approval_codes table, so the approval-code page
 * and server actions fail (table not found) until this migration has run.
 * No existing table/column is modified — this script is purely additive and
 * has zero impact on POS/payment/session/report code paths.
 *
 * What this does (in order, idempotent):
 *  1. CREATE TABLE IF NOT EXISTS manager_approval_codes (status is
 *     varchar, not a pg enum — avoids ALTER TYPE ADD VALUE complexity per
 *     docs/architecture/MIGRATIONS.md §4.1 lesson learned on tile_category)
 *  2. CREATE INDEX IF NOT EXISTS on status, (branch_id, status), expires_at,
 *     generated_at
 *
 * Rollback notes: this table has no dependents (nothing else FKs into it in
 * this phase — usage/consumption wiring is Phase 17POS-AUTH-A2). Safe to
 * DROP TABLE manager_approval_codes to fully revert; no data migration or
 * backfill occurs, so rollback loses only approval-code history, never
 * payment/session data.
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
  console.log('  Phase 17POS-AUTH-A1 — Manager Approval Code Foundation');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  IMPORTANT: Have you taken a Neon snapshot backup?');
  console.log('   If not, cancel now (Ctrl+C) and do it first.');
  console.log('');

  console.log('Step 1/2: Creating manager_approval_codes table...');
  await sql`
    CREATE TABLE IF NOT EXISTS manager_approval_codes (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      branch_id             uuid REFERENCES branches(id),
      code_hash             varchar(100) NOT NULL,
      status                varchar(16) NOT NULL DEFAULT 'active',
      generated_by_user_id  uuid NOT NULL REFERENCES users(id),
      generated_at          timestamp NOT NULL DEFAULT now(),
      expires_at            timestamp NOT NULL,
      used_at               timestamp,
      used_by_user_id       uuid REFERENCES users(id),
      used_for_action       varchar(64),
      used_entity_type      varchar(32),
      used_entity_id        varchar(128),
      revoked_at            timestamp,
      revoked_by_user_id    uuid REFERENCES users(id),
      created_at            timestamp NOT NULL DEFAULT now(),
      updated_at            timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log('  ✓ manager_approval_codes ready');

  console.log('Step 2/2: Creating indexes...');
  await sql`
    CREATE INDEX IF NOT EXISTS manager_approval_codes_status_idx
      ON manager_approval_codes (status)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS manager_approval_codes_branch_status_idx
      ON manager_approval_codes (branch_id, status)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS manager_approval_codes_expires_at_idx
      ON manager_approval_codes (expires_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS manager_approval_codes_generated_at_idx
      ON manager_approval_codes (generated_at)
  `;
  console.log('  ✓ indexes ready');

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  ✅  Migration complete!');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Run: npm run dev  (verify app starts)');
  console.log('  2. Open /approval-code as owner, generate + revoke a code');
  console.log('  3. Run: npm run db:check-migrations');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
}

migrate().catch((err) => {
  console.error('');
  console.error('❌ Migration failed:', err);
  console.error('');
  console.error('All statements are idempotent — rerunning is safe.');
  process.exit(1);
});
