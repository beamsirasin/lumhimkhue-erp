/**
 * Phase 17UI-EMP (part 2) — hr_lookup_options table
 *
 * User-extensible option lists for HR forms: extra departments/banks beyond
 * the built-in defaults hardcoded in the UI. Queried by /hr/employees on load.
 *
 * Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS — safe to re-run.
 *
 * Rollback notes:
 *   - Fully reversible in place: `DROP TABLE hr_lookup_options;`
 *     loses only custom option labels — employees.department keeps its text
 *     values regardless (nothing FKs into this table).
 *
 * Run: npm run db:migrate-phase17ui-hr-options
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function main() {
  console.log('Phase 17UI-EMP migration — hr_lookup_options');

  await sql`
    CREATE TABLE IF NOT EXISTS hr_lookup_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      label text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log('  ✓ table hr_lookup_options — created or already present');

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS hr_lookup_options_kind_label_uq ON hr_lookup_options (kind, label)`;
  await sql`CREATE INDEX IF NOT EXISTS hr_lookup_options_kind_idx ON hr_lookup_options (kind)`;
  console.log('  ✓ indexes — created or already present');

  const check = await sql`
    SELECT COUNT(*)::int AS cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hr_lookup_options'
  `;
  if ((check[0] as { cols: number }).cols === 6) {
    console.log('  ✓ verified: 6 columns present');
    console.log('Done.');
  } else {
    console.error(`  ✗ verification failed — expected 6 columns, found ${(check[0] as { cols: number }).cols}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
