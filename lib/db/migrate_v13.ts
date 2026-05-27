/**
 * Phase 13 Production Migration Script
 *
 * Run ONLY after taking a Neon snapshot backup.
 * Usage: npm run db:migrate-v13
 *
 * What this does (in order):
 *  1.  Add 'manager' to role enum
 *  2.  Add 'linked' to table_status enum
 *  3.  Create tile_category enum
 *  4.  Create discount_type enum
 *  5.  Create reservation_status enum
 *  6.  Create pricing_tiles table
 *  7.  Migrate data: pricing_tiers → pricing_tiles (category='guest')
 *  8.  Add parent_session_id to sessions
 *  9.  Add pricing_tile_id column to session_guests
 * 10.  Migrate data: session_guests.pricing_tier_id → pricing_tile_id
 * 11.  Drop pricing_tier_id FK + column from session_guests
 * 12.  Create payment_line_items table
 * 13.  Create reservations table
 * 14.  Create reservation_guests table
 * 15.  Safety: UPDATE users SET role='manager' WHERE role='host' (no-op if no host exists)
 * 16.  Drop pricing_tiers table
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
  console.log('  Phase 13 — Production Migration');
  console.log('════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  IMPORTANT: Have you taken a Neon snapshot backup?');
  console.log('   If not, cancel now (Ctrl+C) and do it first.');
  console.log('');

  // ── 1. Add 'manager' to role enum ────────────────────────────────────────
  console.log('Step 1/16: Adding manager to role enum...');
  const hasManager = await sql`
    SELECT 1 FROM pg_enum pe
    JOIN pg_type pt ON pe.enumtypid = pt.oid
    WHERE pt.typname = 'role' AND pe.enumlabel = 'manager'
  `;
  if (hasManager.length === 0) {
    await sql`ALTER TYPE role ADD VALUE IF NOT EXISTS 'manager'`;
    console.log('  ✓ manager added to role enum');
  } else {
    console.log('  ℹ manager already in role enum — skip');
  }

  // ── 2. Add 'linked' to table_status enum ─────────────────────────────────
  console.log('Step 2/16: Adding linked to table_status enum...');
  const hasLinked = await sql`
    SELECT 1 FROM pg_enum pe
    JOIN pg_type pt ON pe.enumtypid = pt.oid
    WHERE pt.typname = 'table_status' AND pe.enumlabel = 'linked'
  `;
  if (hasLinked.length === 0) {
    await sql`ALTER TYPE table_status ADD VALUE IF NOT EXISTS 'linked'`;
    console.log('  ✓ linked added to table_status enum');
  } else {
    console.log('  ℹ linked already in table_status enum — skip');
  }

  // ── 3. Create tile_category enum ─────────────────────────────────────────
  console.log('Step 3/16: Creating tile_category enum...');
  await sql`
    DO $$ BEGIN
      CREATE TYPE tile_category AS ENUM('guest', 'addon', 'discount');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `;
  console.log('  ✓ tile_category enum ready');

  // ── 4. Create discount_type enum ─────────────────────────────────────────
  console.log('Step 4/16: Creating discount_type enum...');
  await sql`
    DO $$ BEGIN
      CREATE TYPE discount_type AS ENUM('fixed', 'percentage');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `;
  console.log('  ✓ discount_type enum ready');

  // ── 5. Create reservation_status enum ────────────────────────────────────
  console.log('Step 5/16: Creating reservation_status enum...');
  await sql`
    DO $$ BEGIN
      CREATE TYPE reservation_status AS ENUM('pending', 'arrived', 'cancelled', 'no_show');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `;
  console.log('  ✓ reservation_status enum ready');

  // ── 6. Create pricing_tiles table ────────────────────────────────────────
  console.log('Step 6/16: Creating pricing_tiles table...');
  await sql`
    CREATE TABLE IF NOT EXISTS pricing_tiles (
      id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
      code            VARCHAR(50)    NOT NULL UNIQUE,
      name            VARCHAR(255)   NOT NULL,
      image_url       TEXT,
      category        tile_category  NOT NULL,
      price           NUMERIC(10,2)  NOT NULL,
      vat_rate        NUMERIC(5,2)   NOT NULL DEFAULT 7.00,
      vat_included    BOOLEAN        NOT NULL DEFAULT true,
      discount_type   discount_type,
      discount_value  NUMERIC(10,2),
      color           VARCHAR(7),
      sort_order      INTEGER        NOT NULL DEFAULT 0,
      is_active       BOOLEAN        NOT NULL DEFAULT true,
      notes           TEXT
    )
  `;
  console.log('  ✓ pricing_tiles table ready');

  // ── 7. Migrate pricing_tiers → pricing_tiles ──────────────────────────────
  console.log('Step 7/16: Migrating pricing_tiers → pricing_tiles...');
  const tiersExist = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'pricing_tiers'
  `;
  if (tiersExist.length > 0) {
    // Check if tiers have already been migrated
    const alreadyMigrated = await sql`
      SELECT COUNT(*) AS cnt FROM pricing_tiles WHERE category = 'guest'
    `;
    const cnt = Number((alreadyMigrated[0] as { cnt: string }).cnt);
    if (cnt === 0) {
      await sql`
        INSERT INTO pricing_tiles (id, code, name, price, vat_rate, vat_included, category, sort_order, is_active, notes)
        SELECT id, code, name, price, vat_rate, vat_included, 'guest'::tile_category, sort_order, is_active, notes
        FROM pricing_tiers
        ON CONFLICT (code) DO NOTHING
      `;
      console.log('  ✓ pricing_tiers rows copied to pricing_tiles (category=guest)');
    } else {
      console.log(`  ℹ ${cnt} guest tiles already exist — skip copy`);
    }
  } else {
    console.log('  ℹ pricing_tiers table not found — inserting default guest tiles...');
    await sql`
      INSERT INTO pricing_tiles (code, name, price, vat_rate, vat_included, category, sort_order, is_active, notes)
      VALUES
        ('adult',             'ผู้ใหญ่',             266.00, 7.00, true, 'guest', 1, true, NULL),
        ('child',             'เด็ก',                159.00, 7.00, true, 'guest', 2, true, NULL),
        ('toddler',           'เด็กเล็ก',            0.00,   7.00, true, 'guest', 3, true, 'เด็กที่ยังไม่รับประทานอาหารได้เอง'),
        ('staff',             'พนักงาน',             0.00,   7.00, true, 'guest', 4, true, 'พนักงานร้านหรือพาร์ทเนอร์'),
        ('staff_guest_first', 'พนักงานพา (คนแรก)', 199.00, 7.00, true, 'guest', 5, true, 'แขกที่พนักงานพามา คนแรก')
      ON CONFLICT (code) DO NOTHING
    `;
    console.log('  ✓ Default guest tiles inserted');
  }

  // ── 8. Add parent_session_id to sessions ──────────────────────────────────
  console.log('Step 8/16: Adding parent_session_id to sessions...');
  await sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS parent_session_id UUID
      REFERENCES sessions(id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS sessions_parent_session_id_idx
      ON sessions(parent_session_id)
  `;
  console.log('  ✓ parent_session_id added');

  // ── 9. Add pricing_tile_id to session_guests ──────────────────────────────
  console.log('Step 9/16: Adding pricing_tile_id to session_guests...');
  const hasTileCol = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'session_guests' AND column_name = 'pricing_tile_id'
  `;
  if (hasTileCol.length === 0) {
    // Add nullable first, populate, then set NOT NULL
    await sql`ALTER TABLE session_guests ADD COLUMN pricing_tile_id UUID`;
    console.log('  ✓ pricing_tile_id column added (nullable temporarily)');
  } else {
    console.log('  ℹ pricing_tile_id already exists — skip ADD COLUMN');
  }

  // ── 10. Migrate session_guests data ──────────────────────────────────────
  console.log('Step 10/16: Migrating session_guests.pricing_tier_id → pricing_tile_id...');
  const hasTierCol = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'session_guests' AND column_name = 'pricing_tier_id'
  `;
  if (hasTierCol.length > 0) {
    // Update pricing_tile_id by matching on UUID (since we copied IDs in step 7)
    await sql`
      UPDATE session_guests sg
      SET pricing_tile_id = sg.pricing_tier_id
      WHERE sg.pricing_tile_id IS NULL
        AND EXISTS (SELECT 1 FROM pricing_tiles pt WHERE pt.id = sg.pricing_tier_id)
    `;
    // If any rows still have NULL (tier ID not found in tiles — shouldn't happen), fall back to code match
    await sql`
      UPDATE session_guests sg
      SET pricing_tile_id = pt.id
      FROM pricing_tiers ptr
      JOIN pricing_tiles pt ON pt.code = ptr.code
      WHERE sg.pricing_tier_id = ptr.id
        AND sg.pricing_tile_id IS NULL
    `;
    console.log('  ✓ session_guests rows updated with pricing_tile_id');
  } else {
    console.log('  ℹ pricing_tier_id column not found — checking if data already migrated');
    // Verify we have non-null pricing_tile_id
    const nullCount = await sql`
      SELECT COUNT(*) AS cnt FROM session_guests WHERE pricing_tile_id IS NULL
    `;
    const cnt = Number((nullCount[0] as { cnt: string }).cnt);
    if (cnt > 0) {
      console.log(`  ⚠ WARNING: ${cnt} session_guests rows still have NULL pricing_tile_id!`);
      console.log('  These may need manual correction.');
    } else {
      console.log('  ✓ all session_guests rows have pricing_tile_id');
    }
  }

  // Make pricing_tile_id NOT NULL (only if it has been populated)
  const stillNull = await sql`
    SELECT COUNT(*) AS cnt FROM session_guests WHERE pricing_tile_id IS NULL
  `;
  const stillNullCnt = Number((stillNull[0] as { cnt: string }).cnt);
  if (stillNullCnt === 0) {
    await sql`
      DO $$ BEGIN
        ALTER TABLE session_guests ALTER COLUMN pricing_tile_id SET NOT NULL;
      EXCEPTION WHEN others THEN NULL;
      END $$
    `;
    console.log('  ✓ pricing_tile_id set NOT NULL');
  } else {
    console.log(`  ⚠ Skipping NOT NULL constraint — ${stillNullCnt} rows still NULL`);
  }

  // ── 11. Drop pricing_tier_id FK + column ─────────────────────────────────
  console.log('Step 11/16: Dropping pricing_tier_id from session_guests...');
  if (hasTierCol.length > 0) {
    // Drop FK constraint
    await sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_name = 'session_guests'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%pricing_tier%'
        LOOP
          EXECUTE 'ALTER TABLE session_guests DROP CONSTRAINT "' || r.constraint_name || '"';
        END LOOP;
      END $$
    `;
    // Add FK for pricing_tile_id
    await sql`
      DO $$ BEGIN
        ALTER TABLE session_guests
          ADD CONSTRAINT session_guests_pricing_tile_id_fk
          FOREIGN KEY (pricing_tile_id) REFERENCES pricing_tiles(id);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;
    // Drop old column
    await sql`ALTER TABLE session_guests DROP COLUMN IF EXISTS pricing_tier_id`;
    console.log('  ✓ pricing_tier_id removed, FK to pricing_tiles added');
  } else {
    console.log('  ℹ pricing_tier_id already removed — skip');
  }

  // ── 12. Create payment_line_items table ───────────────────────────────────
  console.log('Step 12/16: Creating payment_line_items table...');
  await sql`
    CREATE TABLE IF NOT EXISTS payment_line_items (
      id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id       UUID           NOT NULL REFERENCES payments(id),
      pricing_tile_id  UUID           NOT NULL REFERENCES pricing_tiles(id),
      quantity         INTEGER        NOT NULL DEFAULT 1,
      amount           NUMERIC(10,2)  NOT NULL,
      applied_at       TIMESTAMP      NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS payment_line_items_payment_id_idx
      ON payment_line_items(payment_id)
  `;
  console.log('  ✓ payment_line_items table ready');

  // ── 13. Create reservations table ─────────────────────────────────────────
  console.log('Step 13/16: Creating reservations table...');
  await sql`
    CREATE TABLE IF NOT EXISTS reservations (
      id                      UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
      table_id                UUID                  NOT NULL REFERENCES tables(id),
      reserved_at             TIMESTAMP             NOT NULL,
      customer_name           VARCHAR(255)          NOT NULL,
      customer_phone          VARCHAR(20),
      party_size              INTEGER               NOT NULL,
      notes                   TEXT,
      status                  reservation_status    NOT NULL DEFAULT 'pending',
      parent_reservation_id   UUID,
      created_at              TIMESTAMP             NOT NULL DEFAULT NOW(),
      created_by              UUID                  NOT NULL REFERENCES users(id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS reservations_table_id_idx ON reservations(table_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS reservations_reserved_at_idx ON reservations(reserved_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS reservations_parent_id_idx ON reservations(parent_reservation_id)
  `;
  console.log('  ✓ reservations table ready');

  // ── 14. Create reservation_guests table ───────────────────────────────────
  console.log('Step 14/16: Creating reservation_guests table...');
  await sql`
    CREATE TABLE IF NOT EXISTS reservation_guests (
      id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      reservation_id    UUID    NOT NULL REFERENCES reservations(id),
      pricing_tile_id   UUID    NOT NULL REFERENCES pricing_tiles(id),
      quantity          INTEGER NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS reservation_guests_reservation_id_idx
      ON reservation_guests(reservation_id)
  `;
  console.log('  ✓ reservation_guests table ready');

  // ── 15. Update any host → manager users ───────────────────────────────────
  console.log('Step 15/16: Checking for role=host users to migrate...');
  // 'host' may not exist in the enum at this point if it never existed.
  // Use raw text comparison to avoid enum cast errors.
  try {
    const updated = await sql`
      UPDATE users SET role = 'manager'::role WHERE role::TEXT = 'host'
    `;
    const count = (updated as unknown as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) {
      console.log(`  ✓ ${count} host user(s) migrated to manager`);
    } else {
      console.log('  ℹ No host users found — skip');
    }
  } catch {
    console.log('  ℹ host role migration skipped (host value never existed in enum)');
  }

  // ── 16. Drop pricing_tiers table ──────────────────────────────────────────
  console.log('Step 16/16: Dropping pricing_tiers table...');
  await sql`DROP TABLE IF EXISTS pricing_tiers CASCADE`;
  console.log('  ✓ pricing_tiers dropped');

  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  ✅  Migration complete!');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Run: npm run db:push   (sync remaining schema diffs if any)');
  console.log('  2. Run: npm run db:seed-v13  (add manager user)');
  console.log('  3. Run: npm run dev       (verify app starts)');
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
