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
  console.log('Payment foundation migration');

  await run('CREATE TYPE payment_method_type', () => sql`
    DO $$ BEGIN
      CREATE TYPE "payment_method_type" AS ENUM('promptpay', 'cash', 'welfare', 'mixed_legacy', 'other');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  await run('CREATE TYPE receiving_account_type', () => sql`
    DO $$ BEGIN
      CREATE TYPE "receiving_account_type" AS ENUM('bank_cash_group', 'welfare', 'cash_drawer', 'other');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  await run('CREATE TABLE payment_methods', () => sql`
    CREATE TABLE IF NOT EXISTS "payment_methods" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "code" varchar(50) NOT NULL UNIQUE,
      "name" varchar(255) NOT NULL,
      "type" "payment_method_type" NOT NULL,
      "requires_reference" boolean DEFAULT false NOT NULL,
      "allow_overpay" boolean DEFAULT false NOT NULL,
      "is_active" boolean DEFAULT true NOT NULL,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await run('CREATE TABLE receiving_accounts', () => sql`
    CREATE TABLE IF NOT EXISTS "receiving_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "code" varchar(50) NOT NULL UNIQUE,
      "name" varchar(255) NOT NULL,
      "type" "receiving_account_type" NOT NULL,
      "bank_name" varchar(255),
      "account_label" varchar(255),
      "account_last4" varchar(4),
      "is_active" boolean DEFAULT true NOT NULL,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await run('CREATE TABLE payment_method_accounts', () => sql`
    CREATE TABLE IF NOT EXISTS "payment_method_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "payment_method_id" uuid NOT NULL REFERENCES "payment_methods"("id"),
      "receiving_account_id" uuid NOT NULL REFERENCES "receiving_accounts"("id"),
      "is_default" boolean DEFAULT false NOT NULL,
      "is_active" boolean DEFAULT true NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "payment_method_accounts_unique_idx" UNIQUE("payment_method_id", "receiving_account_id")
    );
  `);

  await run('CREATE TABLE payment_rows', () => sql`
    CREATE TABLE IF NOT EXISTS "payment_rows" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "payment_id" uuid NOT NULL REFERENCES "payments"("id"),
      "session_id" uuid NOT NULL REFERENCES "sessions"("id"),
      "payment_method_id" uuid NOT NULL REFERENCES "payment_methods"("id"),
      "receiving_account_id" uuid NOT NULL REFERENCES "receiving_accounts"("id"),
      "amount" numeric(10,2) NOT NULL,
      "amount_tendered" numeric(10,2),
      "change_amount" numeric(10,2) DEFAULT '0' NOT NULL,
      "reference_no" varchar(100),
      "payer_label" varchar(100),
      "note" text,
      "status" "payment_status" DEFAULT 'completed' NOT NULL,
      "cashier_id" uuid REFERENCES "users"("id"),
      "shift_id" uuid REFERENCES "cashier_shifts"("id"),
      "paid_at" timestamp DEFAULT now() NOT NULL,
      "voided_at" timestamp,
      "void_reason" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  const indexes: Array<[string, () => Promise<unknown>]> = [
    ['payment_methods_type_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_methods_type_idx" ON "payment_methods" ("type")`],
    ['payment_methods_active_sort_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_methods_active_sort_idx" ON "payment_methods" ("is_active", "sort_order")`],
    ['receiving_accounts_type_idx', () => sql`CREATE INDEX IF NOT EXISTS "receiving_accounts_type_idx" ON "receiving_accounts" ("type")`],
    ['receiving_accounts_active_sort_idx', () => sql`CREATE INDEX IF NOT EXISTS "receiving_accounts_active_sort_idx" ON "receiving_accounts" ("is_active", "sort_order")`],
    ['payment_method_accounts_method_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_method_accounts_method_idx" ON "payment_method_accounts" ("payment_method_id")`],
    ['payment_method_accounts_account_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_method_accounts_account_idx" ON "payment_method_accounts" ("receiving_account_id")`],
    ['payment_method_accounts_active_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_method_accounts_active_idx" ON "payment_method_accounts" ("is_active")`],
    ['payment_rows_payment_id_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_rows_payment_id_idx" ON "payment_rows" ("payment_id")`],
    ['payment_rows_session_id_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_rows_session_id_idx" ON "payment_rows" ("session_id")`],
    ['payment_rows_method_id_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_rows_method_id_idx" ON "payment_rows" ("payment_method_id")`],
    ['payment_rows_account_id_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_rows_account_id_idx" ON "payment_rows" ("receiving_account_id")`],
    ['payment_rows_shift_id_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_rows_shift_id_idx" ON "payment_rows" ("shift_id")`],
    ['payment_rows_status_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_rows_status_idx" ON "payment_rows" ("status")`],
    ['payment_rows_paid_at_idx', () => sql`CREATE INDEX IF NOT EXISTS "payment_rows_paid_at_idx" ON "payment_rows" ("paid_at")`],
  ] as const;

  for (const [label, createIndex] of indexes) {
    await run(label, createIndex);
  }

  console.log('Payment foundation migration complete');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
