import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`OK ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('already exists') ||
      message.includes('does not exist') ||
      message.includes('duplicate column') ||
      message.includes('duplicate key')
    ) {
      console.log(`SKIP ${label} (${message})`);
      return;
    }
    console.error(`FAIL ${label}`);
    throw error;
  }
}

async function main() {
  console.log('Phase 6B partial payments migration');

  await run('CREATE TYPE payment_settlement_type', () => sql`
    DO $$ BEGIN
      CREATE TYPE "payment_settlement_type" AS ENUM('partial', 'final');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  await run('DROP payments.session_id unique constraint', () => sql`
    ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_session_id_unique";
  `);

  await run('payments.settlement_type', () => sql`
    ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "settlement_type" "payment_settlement_type" DEFAULT 'final' NOT NULL;
  `);

  await run('payments.bill_total_at_payment', () => sql`
    ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "bill_total_at_payment" numeric(10,2) DEFAULT '0' NOT NULL;
  `);

  await run('payments.paid_before', () => sql`
    ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "paid_before" numeric(10,2) DEFAULT '0' NOT NULL;
  `);

  await run('payments.remaining_after', () => sql`
    ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "remaining_after" numeric(10,2) DEFAULT '0' NOT NULL;
  `);

  await run('Backfill settlement metadata', () => sql`
    UPDATE "payments"
    SET
      "settlement_type" = coalesce("settlement_type", 'final'::"payment_settlement_type"),
      "bill_total_at_payment" = CASE
        WHEN "bill_total_at_payment"::numeric = 0 THEN "total"
        ELSE "bill_total_at_payment"
      END,
      "paid_before" = coalesce("paid_before", 0),
      "remaining_after" = coalesce("remaining_after", 0);
  `);

  await run('payments_session_id_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "payments_session_id_idx" ON "payments" ("session_id");
  `);

  await run('payments_settlement_type_idx', () => sql`
    CREATE INDEX IF NOT EXISTS "payments_settlement_type_idx" ON "payments" ("settlement_type");
  `);

  console.log('Phase 6B partial payments migration complete');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
