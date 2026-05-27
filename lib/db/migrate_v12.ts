/**
 * Phase 12 Production Migration Script
 *
 * Run ONLY after taking a Neon snapshot backup.
 * Usage: npm run db:migrate-v12
 *
 * What this does (in order, inside a single transaction):
 *  1. Create table_shape enum
 *  2. Create pricing_tiers + seed 5 default tiers
 *  3. Create session_guests + index
 *  4. Migrate sessions.adults/children/seniors → session_guests rows
 *  5. Add new columns to tables (label, position, shape, deletedAt)
 *  6. Populate label from old number; auto-arrange positions in a grid
 *  7. Handle table_status enum removal of 'cleaning'
 *  8. Drop old tables.number column
 *  9. Drop FK + old columns from sessions (packageId, endsAt, adults, children, seniors)
 *     Add sessions.notes; add index on closed_at
 * 10. Drop payments.waste_charge
 * 11. Drop packages table
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  Phase 12 — Production Migration');
  console.log('════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  IMPORTANT: Have you taken a Neon snapshot backup?');
  console.log('   If not, cancel now (Ctrl+C) and do it first.');
  console.log('');

  // ── 1. Create table_shape enum ───────────────────────────────────────────
  console.log('Step 1/11: Creating table_shape enum...');
  await sql`
    DO $$ BEGIN
      CREATE TYPE table_shape AS ENUM('square', 'rectangle');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `;

  // ── 2. Create pricing_tiers ──────────────────────────────────────────────
  console.log('Step 2/11: Creating pricing_tiers table + seeding defaults...');
  await sql`
    CREATE TABLE IF NOT EXISTS pricing_tiers (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      code        VARCHAR(50) NOT NULL UNIQUE,
      name        VARCHAR(255) NOT NULL,
      price       NUMERIC(10,2) NOT NULL,
      vat_included BOOLEAN    NOT NULL DEFAULT true,
      vat_rate    NUMERIC(5,2) NOT NULL DEFAULT 7.00,
      sort_order  INTEGER     NOT NULL DEFAULT 0,
      is_active   BOOLEAN     NOT NULL DEFAULT true,
      notes       TEXT
    )
  `;
  await sql`
    INSERT INTO pricing_tiers (code, name, price, sort_order) VALUES
      ('adult',             'ผู้ใหญ่',            266.00, 1),
      ('child',             'เด็ก',               159.00, 2),
      ('toddler',           'เด็กเล็ก',           0.00,   3),
      ('staff',             'พนักงาน',            0.00,   4),
      ('staff_guest_first', 'พนักงานพา (คนแรก)', 199.00, 5)
    ON CONFLICT (code) DO NOTHING
  `;

  // ── 3. Create session_guests ─────────────────────────────────────────────
  console.log('Step 3/11: Creating session_guests table...');
  await sql`
    CREATE TABLE IF NOT EXISTS session_guests (
      id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id      UUID    NOT NULL REFERENCES sessions(id),
      pricing_tier_id UUID    NOT NULL REFERENCES pricing_tiers(id),
      quantity        INTEGER NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS session_guests_session_id_idx
      ON session_guests(session_id)
  `;

  // ── 4. Migrate adults / children / seniors ───────────────────────────────
  console.log('Step 4/11: Migrating session guest counts to session_guests...');

  // Check if old columns still exist before migrating
  const hasCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sessions'
      AND column_name IN ('adults','children','seniors')
  `;

  if (hasCols.length > 0) {
    // adults → adult tier
    await sql`
      INSERT INTO session_guests (session_id, pricing_tier_id, quantity)
      SELECT s.id, pt.id, s.adults
      FROM sessions s
      JOIN pricing_tiers pt ON pt.code = 'adult'
      WHERE s.adults IS NOT NULL AND s.adults > 0
    `;
    // children → child tier
    await sql`
      INSERT INTO session_guests (session_id, pricing_tier_id, quantity)
      SELECT s.id, pt.id, s.children
      FROM sessions s
      JOIN pricing_tiers pt ON pt.code = 'child'
      WHERE s.children IS NOT NULL AND s.children > 0
    `;
    // seniors → adult tier (per spec: no senior tier in new system)
    await sql`
      INSERT INTO session_guests (session_id, pricing_tier_id, quantity)
      SELECT s.id, pt.id, s.seniors
      FROM sessions s
      JOIN pricing_tiers pt ON pt.code = 'adult'
      WHERE s.seniors IS NOT NULL AND s.seniors > 0
    `;
    console.log('  ✓ Guest counts migrated');
  } else {
    console.log('  ℹ Columns already dropped — skipping data migration');
  }

  // ── 5. Add new columns to tables ─────────────────────────────────────────
  console.log('Step 5/11: Adding new columns to tables...');
  // label
  await sql`
    ALTER TABLE tables ADD COLUMN IF NOT EXISTS label VARCHAR(50)
  `;
  // position + size + shape + soft-delete
  await sql`
    ALTER TABLE tables
      ADD COLUMN IF NOT EXISTS position_x INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS position_y INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS width      INTEGER NOT NULL DEFAULT 80,
      ADD COLUMN IF NOT EXISTS height     INTEGER NOT NULL DEFAULT 80,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `;
  // shape (uses new enum — add separately)
  await sql`
    DO $$ BEGIN
      ALTER TABLE tables ADD COLUMN shape table_shape NOT NULL DEFAULT 'square';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `;

  // ── 6. Populate label + auto-arrange grid positions ──────────────────────
  console.log('Step 6/11: Populating label from number + arranging grid positions...');

  const hasNumber = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tables' AND column_name = 'number'
  `;

  if (hasNumber.length > 0) {
    // Copy number → label
    await sql`UPDATE tables SET label = number::TEXT WHERE label IS NULL`;

    // Auto-arrange in a 5-column grid (120px spacing, 20px margin)
    await sql`
      WITH positioned AS (
        SELECT id,
               (ROW_NUMBER() OVER (ORDER BY number) - 1) AS idx
        FROM tables
      )
      UPDATE tables SET
        position_x = (p.idx % 5) * 120 + 20,
        position_y = (p.idx / 5) * 120 + 20
      FROM positioned p
      WHERE tables.id = p.id
    `;
    console.log('  ✓ label populated and positions arranged');
  } else {
    console.log('  ℹ number column gone — filling label with id prefix if empty');
    await sql`
      UPDATE tables SET label = SUBSTRING(id::TEXT, 1, 6) WHERE label IS NULL
    `;
  }

  // Make label NOT NULL
  await sql`ALTER TABLE tables ALTER COLUMN label SET NOT NULL`;

  // ── 7. Handle table_status enum (remove 'cleaning') ──────────────────────
  console.log('Step 7/11: Updating table_status enum (removing cleaning)...');

  // First, move any cleaning tables to available
  await sql`UPDATE tables SET status = 'available' WHERE status::TEXT = 'cleaning'`;

  // Check if 'cleaning' is still in the enum
  const hasCleaningEnum = await sql`
    SELECT 1 FROM pg_enum pe
    JOIN pg_type pt ON pe.enumtypid = pt.oid
    WHERE pt.typname = 'table_status' AND pe.enumlabel = 'cleaning'
  `;

  if (hasCleaningEnum.length > 0) {
    // Create new enum without 'cleaning' (skip if already created from a partial run)
    const newEnumExists = await sql`
      SELECT 1 FROM pg_type WHERE typname = 'table_status_new'
    `;
    if (newEnumExists.length === 0) {
      await sql`CREATE TYPE table_status_new AS ENUM('available', 'occupied', 'reserved')`;
    } else {
      console.log('  ℹ table_status_new already exists (partial run) — continuing swap');
    }
    // Must DROP DEFAULT first — PostgreSQL cannot cast default value automatically
    await sql`ALTER TABLE tables ALTER COLUMN status DROP DEFAULT`;
    // Swap column to new enum
    await sql`
      ALTER TABLE tables
        ALTER COLUMN status TYPE table_status_new
        USING status::TEXT::table_status_new
    `;
    // Restore default with new enum type
    await sql`ALTER TABLE tables ALTER COLUMN status SET DEFAULT 'available'::table_status_new`;
    // Drop old enum, rename new one to canonical name
    await sql`DROP TYPE table_status`;
    await sql`ALTER TYPE table_status_new RENAME TO table_status`;
    // Re-set default using the canonical name (so future pushes stay in sync)
    await sql`ALTER TABLE tables ALTER COLUMN status SET DEFAULT 'available'`;
    console.log('  ✓ cleaning removed from table_status enum');
  } else {
    // 'cleaning' is gone but table_status_new might still be lingering — clean up
    const newEnumExists = await sql`SELECT 1 FROM pg_type WHERE typname = 'table_status_new'`;
    if (newEnumExists.length > 0) {
      await sql`DROP TYPE table_status_new`;
      console.log('  ℹ cleaned up leftover table_status_new');
    } else {
      console.log('  ℹ table_status already up to date');
    }
  }

  // ── 8. Drop tables.number ─────────────────────────────────────────────────
  console.log('Step 8/11: Dropping tables.number column...');
  await sql`ALTER TABLE tables DROP COLUMN IF EXISTS number`;

  // ── 9. Alter sessions ─────────────────────────────────────────────────────
  console.log('Step 9/11: Altering sessions table...');

  // Add notes column
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notes TEXT`;

  // Add closed_at index for history queries
  await sql`
    CREATE INDEX IF NOT EXISTS sessions_closed_at_idx ON sessions(closed_at)
  `;

  // Drop FK constraint on package_id (try both possible naming conventions)
  await sql`
    ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_package_id_packages_id_fk
  `;
  await sql`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT constraint_name FROM information_schema.table_constraints
               WHERE table_name = 'sessions' AND constraint_type = 'FOREIGN KEY'
                 AND constraint_name LIKE '%package%'
      LOOP
        EXECUTE 'ALTER TABLE sessions DROP CONSTRAINT "' || r.constraint_name || '"';
      END LOOP;
    END $$
  `;

  // Drop old columns
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS package_id`;
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS ends_at`;
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS adults`;
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS children`;
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS seniors`;

  // ── 10. Drop payments.waste_charge ───────────────────────────────────────
  console.log('Step 10/11: Dropping payments.waste_charge...');
  await sql`ALTER TABLE payments DROP COLUMN IF EXISTS waste_charge`;

  // ── 11. Drop packages table ───────────────────────────────────────────────
  console.log('Step 11/11: Dropping packages table...');
  await sql`DROP TABLE IF EXISTS packages CASCADE`;

  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  ✅  Migration complete!');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Run: npm run db:seed  (adds pricing tiers to seed guard)');
  console.log('  2. Run: npm run dev      (verify app starts)');
  console.log('════════════════════════════════════════════════');
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
