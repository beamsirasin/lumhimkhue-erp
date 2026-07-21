/**
 * Phase 17A.3 disposable-only Manual UAT fixture.
 *
 * This script intentionally never reads DATABASE_URL or dotenv files. It is
 * idempotent and requires both the Phase 17A disposable acknowledgement and a
 * fixture-specific command acknowledgement.
 */

import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DISPOSABLE_ACK = 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE';
const FIXTURE_ACK = 'SEED_PHASE17A_DISPOSABLE_UAT';

const ids = {
  branch: '17a30000-0000-4000-8000-000000000001',
  category: '17a30000-0000-4000-8000-000000000010',
  supplierOnTime: '17a30000-0000-4000-8000-000000000101',
  supplierDelayed: '17a30000-0000-4000-8000-000000000102',
  supplierEmergency: '17a30000-0000-4000-8000-000000000103',
  pork: '17a30000-0000-4000-8000-000000000201',
  beef: '17a30000-0000-4000-8000-000000000202',
  shrimp: '17a30000-0000-4000-8000-000000000203',
  squid: '17a30000-0000-4000-8000-000000000204',
  owner: '17a30000-0000-4000-8000-000000000301',
  manager: '17a30000-0000-4000-8000-000000000302',
  cashier: '17a30000-0000-4000-8000-000000000303',
  kitchen: '17a30000-0000-4000-8000-000000000304',
} as const;

function requireDisposableUrl() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('REFUSED: Phase 17A UAT fixture cannot run in a production/VERCEL process');
  }
  if (process.env.PHASE17A_DISPOSABLE_DB_ACK !== DISPOSABLE_ACK) {
    throw new Error('REFUSED: PHASE17A_DISPOSABLE_DB_ACK is missing or incorrect');
  }
  if (process.env.PHASE17A_UAT_FIXTURE_ACK !== FIXTURE_ACK) {
    throw new Error('REFUSED: PHASE17A_UAT_FIXTURE_ACK is missing or incorrect');
  }

  const raw = process.env.PHASE17A_TEST_DATABASE_URL;
  if (!raw) throw new Error('REFUSED: PHASE17A_TEST_DATABASE_URL is required');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error('REFUSED: PHASE17A_TEST_DATABASE_URL must be a PostgreSQL URL');
  }
  if (url.hostname.toLowerCase().includes('-pooler')) {
    throw new Error('REFUSED: Phase 17A UAT requires a direct non-pooler connection');
  }
  return raw;
}

async function main() {
  const databaseUrl = requireDisposableUrl();
  const password = process.env.PHASE17A_UAT_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('REFUSED: PHASE17A_UAT_PASSWORD must contain at least 12 characters');
  }

  const sql = neon(databaseUrl);
  const [migration] = await sql`
    SELECT migration_key
    FROM app_migrations
    WHERE migration_key = 'phase17a1_procurement_stock_integrity'
    LIMIT 1
  `;
  if (!migration) throw new Error('REFUSED: Phase 17A migration ledger entry is missing');

  const passwordHash = await bcrypt.hash(password, 12);
  await sql.transaction([
    sql`INSERT INTO branches (id, name, address, is_active)
        VALUES (${ids.branch}, '[UAT17A] Disposable Branch', 'Fake data only', true)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          is_active = true,
          updated_at = now()`,

    sql`INSERT INTO ingredient_categories (id, name, sort_order, is_active)
        VALUES (${ids.category}, '[UAT17A] วัตถุดิบทดสอบ', 1703, true)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          sort_order = EXCLUDED.sort_order,
          is_active = true`,

    sql`INSERT INTO suppliers
          (id, name, contact_name, avg_lead_time_days, notes, is_active)
        VALUES
          (${ids.supplierOnTime}, '[UAT17A] Supplier ตรงเวลา', 'Fake UAT Contact', 1, 'Phase 17A.3 fake data only', true),
          (${ids.supplierDelayed}, '[UAT17A] Supplier ส่งล่าช้า', 'Fake UAT Contact', 3, 'Phase 17A.3 fake data only', true),
          (${ids.supplierEmergency}, '[UAT17A] ร้านซื้อฉุกเฉิน', 'Fake UAT Contact', 0, 'Phase 17A.3 fake data only', true)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          contact_name = EXCLUDED.contact_name,
          avg_lead_time_days = EXCLUDED.avg_lead_time_days,
          notes = EXCLUDED.notes,
          is_active = true`,

    sql`INSERT INTO ingredients
          (id, category_id, name, unit, min_stock, par_level, last_cost,
           default_supplier_id, is_active, count_frequency, yield_percent,
           order_unit, order_unit_conversion, storage_location, notes)
        VALUES
          (${ids.pork}, ${ids.category}, '[UAT17A] หมูสไลด์', 'kg', 10, 30, 145,
           ${ids.supplierOnTime}, true, 'daily', 100, 'pack', 5, 'UAT freezer', '1 pack = 5 kg; fake data only'),
          (${ids.beef}, ${ids.category}, '[UAT17A] เนื้อสไลด์', 'kg', 5, 15, 155,
           ${ids.supplierOnTime}, true, 'daily', 100, 'kg', 1, 'UAT freezer', 'Fake data only'),
          (${ids.shrimp}, ${ids.category}, '[UAT17A] กุ้ง', 'kg', 3, 12, 200,
           ${ids.supplierDelayed}, true, 'daily', 100, 'box', 3, 'UAT freezer', '1 box = 3 kg; fake data only'),
          (${ids.squid}, ${ids.category}, '[UAT17A] ปลาหมึก', 'kg', 3, 10, 180,
           ${ids.supplierOnTime}, true, 'daily', 100, 'kg', 1, 'UAT freezer', 'Fake data only')
        ON CONFLICT (id) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          name = EXCLUDED.name,
          unit = EXCLUDED.unit,
          min_stock = EXCLUDED.min_stock,
          par_level = EXCLUDED.par_level,
          last_cost = EXCLUDED.last_cost,
          default_supplier_id = EXCLUDED.default_supplier_id,
          is_active = true,
          count_frequency = EXCLUDED.count_frequency,
          yield_percent = EXCLUDED.yield_percent,
          order_unit = EXCLUDED.order_unit,
          order_unit_conversion = EXCLUDED.order_unit_conversion,
          storage_location = EXCLUDED.storage_location,
          notes = EXCLUDED.notes,
          updated_at = now()`,

    sql`INSERT INTO users
          (id, email, password_hash, name, role, is_active, branch_id, allowed_modules)
        VALUES
          (${ids.owner}, 'uat.phase17a.owner@invalid.local', ${passwordHash}, '[UAT17A] Owner', 'owner', true, ${ids.branch}, ARRAY['inventory']::text[]),
          (${ids.manager}, 'uat.phase17a.manager@invalid.local', ${passwordHash}, '[UAT17A] Manager', 'manager', true, ${ids.branch}, ARRAY['inventory']::text[]),
          (${ids.cashier}, 'uat.phase17a.cashier@invalid.local', ${passwordHash}, '[UAT17A] Cashier', 'cashier', true, ${ids.branch}, ARRAY[]::text[]),
          (${ids.kitchen}, 'uat.phase17a.kitchen@invalid.local', ${passwordHash}, '[UAT17A] Kitchen', 'kitchen', true, ${ids.branch}, ARRAY[]::text[])
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          is_active = true,
          branch_id = EXCLUDED.branch_id,
          allowed_modules = EXCLUDED.allowed_modules,
          updated_at = now()`,
  ]);

  const [summary] = await sql`
    SELECT
      (SELECT count(*)::int FROM ingredients WHERE id IN (${ids.pork}, ${ids.beef}, ${ids.shrimp}, ${ids.squid})) AS ingredients,
      (SELECT count(*)::int FROM suppliers WHERE id IN (${ids.supplierOnTime}, ${ids.supplierDelayed}, ${ids.supplierEmergency})) AS suppliers,
      (SELECT count(*)::int FROM users WHERE email LIKE 'uat.phase17a.%@invalid.local') AS users
  `;
  console.log('PHASE17A_UAT_FIXTURE=' + JSON.stringify(summary));
  console.log('PHASE17A_UAT_USERS=owner,manager,cashier,kitchen');
  console.log('PHASE17A_UAT_PASSWORD_SOURCE=PHASE17A_UAT_PASSWORD');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
