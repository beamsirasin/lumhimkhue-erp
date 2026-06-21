/**
 * Phase 15Q-A — Queue Tablet Touchscreen + Seating Fit Foundation
 * Migration Script
 *
 * Run ONLY after taking a Neon snapshot backup.
 * Usage: npm run db:migrate-phase15q
 *
 * What this does (in order):
 *  1.  Add new values to queue_status enum
 *  2.  Add adult_count column to queue_entries
 *  3.  Add child_count column to queue_entries
 *  4.  Add customer_type column to queue_entries
 *  5.  Add soup_pots (jsonb) column to queue_entries
 *  6.  Add seating_fit column to queue_entries
 *  7.  Add planned_table_note column to queue_entries
 *  8.  Add skip_reason column to queue_entries
 *  9.  Add bill_issued column to queue_entries
 * 10.  Add admitted_at column to queue_entries
 * 11.  Backfill adult_count from party_size for existing rows
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
  console.log('  Phase 15Q-A — Queue Tablet Touchscreen Migration');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  IMPORTANT: Have you taken a Neon snapshot backup?');
  console.log('   If not, cancel now (Ctrl+C) and do it first.');
  console.log('');

  // ── 1. Add new queue_status enum values ──────────────────────────────────
  console.log('Step 1/11: Adding new values to queue_status enum...');
  for (const val of ['waiting_suitable_table', 'admitted', 'skipped', 'cancelled']) {
    const exists = await sql`
      SELECT 1 FROM pg_enum pe
      JOIN pg_type pt ON pe.enumtypid = pt.oid
      WHERE pt.typname = 'queue_status' AND pe.enumlabel = ${val}
    `;
    if (exists.length === 0) {
      await sql`ALTER TYPE queue_status ADD VALUE IF NOT EXISTS ${sql.unsafe(val)}`;
      console.log(`  ✓ Added '${val}' to queue_status enum`);
    } else {
      console.log(`  ℹ '${val}' already in queue_status enum — skip`);
    }
  }

  // ── 2. Add adult_count ────────────────────────────────────────────────────
  console.log('Step 2/11: Adding adult_count column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS adult_count INTEGER NOT NULL DEFAULT 1
  `;
  console.log('  ✓ adult_count ready');

  // ── 3. Add child_count ────────────────────────────────────────────────────
  console.log('Step 3/11: Adding child_count column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS child_count INTEGER NOT NULL DEFAULT 0
  `;
  console.log('  ✓ child_count ready');

  // ── 4. Add customer_type ──────────────────────────────────────────────────
  console.log('Step 4/11: Adding customer_type column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) NOT NULL DEFAULT 'normal'
  `;
  console.log('  ✓ customer_type ready');

  // ── 5. Add soup_pots (jsonb) ──────────────────────────────────────────────
  console.log('Step 5/11: Adding soup_pots column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS soup_pots JSONB
  `;
  console.log('  ✓ soup_pots ready');

  // ── 6. Add seating_fit ────────────────────────────────────────────────────
  console.log('Step 6/11: Adding seating_fit column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS seating_fit VARCHAR(50)
  `;
  console.log('  ✓ seating_fit ready');

  // ── 7. Add planned_table_note ─────────────────────────────────────────────
  console.log('Step 7/11: Adding planned_table_note column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS planned_table_note VARCHAR(255)
  `;
  console.log('  ✓ planned_table_note ready');

  // ── 8. Add skip_reason ────────────────────────────────────────────────────
  console.log('Step 8/11: Adding skip_reason column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS skip_reason VARCHAR(255)
  `;
  console.log('  ✓ skip_reason ready');

  // ── 9. Add bill_issued ────────────────────────────────────────────────────
  console.log('Step 9/11: Adding bill_issued column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS bill_issued BOOLEAN NOT NULL DEFAULT false
  `;
  console.log('  ✓ bill_issued ready');

  // ── 10. Add admitted_at ───────────────────────────────────────────────────
  console.log('Step 10/11: Adding admitted_at column...');
  await sql`
    ALTER TABLE queue_entries
      ADD COLUMN IF NOT EXISTS admitted_at TIMESTAMP
  `;
  console.log('  ✓ admitted_at ready');

  // ── 11. Backfill adult_count from party_size for existing rows ────────────
  console.log('Step 11/11: Backfilling adult_count from party_size for existing rows...');
  const result = await sql`
    UPDATE queue_entries
    SET adult_count = party_size
    WHERE adult_count = 1 AND child_count = 0 AND party_size > 1
  `;
  const updated = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (updated > 0) {
    console.log(`  ✓ Backfilled adult_count for ${updated} existing rows`);
  } else {
    console.log('  ℹ No rows needed backfill');
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  ✅  Migration complete!');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Run: npm run db:push   (sync remaining schema diffs if any)');
  console.log('  2. Run: npm run dev       (verify app starts)');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
}

migrate().catch((err) => {
  console.error('');
  console.error('❌ Migration failed:', err);
  console.error('');
  console.error('The migration runs individual statements (not wrapped in one');
  console.error('transaction), so partial changes may have been applied.');
  console.error('Restore from your Neon snapshot backup if needed.');
  process.exit(1);
});
