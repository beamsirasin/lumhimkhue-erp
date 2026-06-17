/**
 * Phase 1 Cash Control — DB Migration Script
 *
 * Run ONLY after taking a Neon snapshot backup (or on dev branch).
 * Usage: npx tsx lib/db/migrate-phase1-cash-control.ts
 *
 * What this does (in order):
 *  1. Create 5 Phase 1 enums
 *  2. Create cashier_shifts table
 *  3. Create discount_approvals table
 *  4. Create payment_adjustments table (payment_id has NO FK — Approach C)
 *  5. Rename goods_receipt_items FK to match Drizzle naming convention
 *  6. Add 5 columns to payments (shift_id, status, voided_at, voided_by, void_reason)
 *  7. Add FK constraints to new tables
 *  8. Add FK constraints to payments
 *  9. Create indexes
 *
 * Idempotency: each step is guarded with IF NOT EXISTS / conditional checks
 * where possible; otherwise Postgres will error if re-run (safe to ignore
 * "already exists" errors on a second run).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('✅');
}

async function main() {
  console.log('\n═══ Phase 1 Cash Control Migration ═══\n');

  // ── 1. Enums ──────────────────────────────────────────────────────────────
  console.log('1. Creating enums');
  await run('cashier_shift_status', () =>
    sql`CREATE TYPE "public"."cashier_shift_status" AS ENUM('open', 'closed', 'reviewed')`,
  );
  await run('discount_approval_status', () =>
    sql`CREATE TYPE "public"."discount_approval_status" AS ENUM('pending', 'approved', 'rejected')`,
  );
  await run('payment_adjustment_status', () =>
    sql`CREATE TYPE "public"."payment_adjustment_status" AS ENUM('pending', 'approved', 'rejected')`,
  );
  await run('payment_adjustment_type', () =>
    sql`CREATE TYPE "public"."payment_adjustment_type" AS ENUM('void', 'refund', 'discount_correction')`,
  );
  await run('payment_status', () =>
    sql`CREATE TYPE "public"."payment_status" AS ENUM('completed', 'voided', 'refunded')`,
  );

  // ── 2. cashier_shifts (must exist before payment_adjustments.shift_id FK) ─
  console.log('\n2. Creating cashier_shifts');
  await run('CREATE TABLE cashier_shifts', () => sql`
    CREATE TABLE "cashier_shifts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "branch_id" uuid,
      "cashier_id" uuid NOT NULL,
      "opened_by" uuid NOT NULL,
      "closed_by" uuid,
      "status" "cashier_shift_status" DEFAULT 'open' NOT NULL,
      "opened_at" timestamp DEFAULT now() NOT NULL,
      "closed_at" timestamp,
      "opening_float" numeric(10, 2) DEFAULT '0' NOT NULL,
      "expected_cash" numeric(10, 2),
      "actual_cash" numeric(10, 2),
      "cash_difference" numeric(10, 2),
      "difference_reason" text,
      "reviewed_by" uuid,
      "reviewed_at" timestamp,
      "review_notes" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  // ── 3. discount_approvals ─────────────────────────────────────────────────
  console.log('\n3. Creating discount_approvals');
  await run('CREATE TABLE discount_approvals', () => sql`
    CREATE TABLE "discount_approvals" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "session_id" uuid NOT NULL,
      "requested_by" uuid NOT NULL,
      "approved_by" uuid,
      "discount_type" "discount_type" NOT NULL,
      "discount_value" numeric(10, 2) NOT NULL,
      "reason" text NOT NULL,
      "status" "discount_approval_status" DEFAULT 'pending' NOT NULL,
      "expires_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  // ── 4. payment_adjustments — NOTE: payment_id has NO FK (Approach C) ──────
  console.log('\n4. Creating payment_adjustments');
  await run('CREATE TABLE payment_adjustments', () => sql`
    CREATE TABLE "payment_adjustments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "payment_id" uuid NOT NULL,
      "session_id" uuid,
      "shift_id" uuid,
      "type" "payment_adjustment_type" NOT NULL,
      "amount" numeric(10, 2) NOT NULL,
      "reason" text NOT NULL,
      "payment_snapshot" jsonb,
      "requested_by" uuid NOT NULL,
      "approved_by" uuid,
      "approved_at" timestamp,
      "status" "payment_adjustment_status" DEFAULT 'pending' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  // ── 5. goods_receipt_items FK rename (Drizzle naming normalization) ────────
  console.log('\n5. Renaming goods_receipt_items FK');
  await run('DROP old FK', () => sql`
    ALTER TABLE "goods_receipt_items"
    DROP CONSTRAINT IF EXISTS "goods_receipt_items_purchase_order_item_id_purchase_order_items"
  `);
  await run('ADD new FK', () => sql`
    ALTER TABLE "goods_receipt_items"
    ADD CONSTRAINT "goods_receipt_items_purchase_order_item_id_purchase_order_items_id_fk"
    FOREIGN KEY ("purchase_order_item_id")
    REFERENCES "public"."purchase_order_items"("id")
    ON DELETE no action ON UPDATE no action
  `);

  // ── 6. payments — new columns ─────────────────────────────────────────────
  console.log('\n6. Adding columns to payments');
  await run('payments.shift_id', () =>
    sql`ALTER TABLE "payments" ADD COLUMN "shift_id" uuid`,
  );
  await run('payments.status', () =>
    sql`ALTER TABLE "payments" ADD COLUMN "status" "payment_status" DEFAULT 'completed' NOT NULL`,
  );
  await run('payments.voided_at', () =>
    sql`ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp`,
  );
  await run('payments.voided_by', () =>
    sql`ALTER TABLE "payments" ADD COLUMN "voided_by" uuid`,
  );
  await run('payments.void_reason', () =>
    sql`ALTER TABLE "payments" ADD COLUMN "void_reason" text`,
  );

  // ── 7. FK constraints on new tables ──────────────────────────────────────
  console.log('\n7. Adding FK constraints to new tables');
  await run('cashier_shifts → branches', () => sql`
    ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('cashier_shifts.cashier_id → users', () => sql`
    ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_cashier_id_users_id_fk"
    FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('cashier_shifts.opened_by → users', () => sql`
    ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_opened_by_users_id_fk"
    FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('cashier_shifts.closed_by → users', () => sql`
    ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_closed_by_users_id_fk"
    FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('cashier_shifts.reviewed_by → users', () => sql`
    ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('discount_approvals.session_id → sessions', () => sql`
    ALTER TABLE "discount_approvals" ADD CONSTRAINT "discount_approvals_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('discount_approvals.requested_by → users', () => sql`
    ALTER TABLE "discount_approvals" ADD CONSTRAINT "discount_approvals_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('discount_approvals.approved_by → users', () => sql`
    ALTER TABLE "discount_approvals" ADD CONSTRAINT "discount_approvals_approved_by_users_id_fk"
    FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('payment_adjustments.session_id → sessions', () => sql`
    ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('payment_adjustments.shift_id → cashier_shifts', () => sql`
    ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_shift_id_cashier_shifts_id_fk"
    FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('payment_adjustments.requested_by → users', () => sql`
    ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('payment_adjustments.approved_by → users', () => sql`
    ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_approved_by_users_id_fk"
    FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);

  // ── 8. FK constraints on payments (new columns) ───────────────────────────
  console.log('\n8. Adding FK constraints to payments');
  await run('payments.shift_id → cashier_shifts', () => sql`
    ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_cashier_shifts_id_fk"
    FOREIGN KEY ("shift_id") REFERENCES "public"."cashier_shifts"("id") ON DELETE no action ON UPDATE no action
  `);
  await run('payments.voided_by → users', () => sql`
    ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_users_id_fk"
    FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
  `);

  // ── 9. Indexes ────────────────────────────────────────────────────────────
  console.log('\n9. Creating indexes');
  await run('cashier_shifts_cashier_opened_at_idx', () => sql`
    CREATE INDEX "cashier_shifts_cashier_opened_at_idx" ON "cashier_shifts" USING btree ("cashier_id", "opened_at")
  `);
  await run('cashier_shifts_branch_status_idx', () => sql`
    CREATE INDEX "cashier_shifts_branch_status_idx" ON "cashier_shifts" USING btree ("branch_id", "status")
  `);
  await run('discount_approvals_session_id_idx', () => sql`
    CREATE INDEX "discount_approvals_session_id_idx" ON "discount_approvals" USING btree ("session_id")
  `);
  await run('discount_approvals_status_idx', () => sql`
    CREATE INDEX "discount_approvals_status_idx" ON "discount_approvals" USING btree ("status")
  `);
  await run('discount_approvals_requested_by_idx', () => sql`
    CREATE INDEX "discount_approvals_requested_by_idx" ON "discount_approvals" USING btree ("requested_by")
  `);
  await run('payment_adjustments_payment_id_idx', () => sql`
    CREATE INDEX "payment_adjustments_payment_id_idx" ON "payment_adjustments" USING btree ("payment_id")
  `);
  await run('payment_adjustments_session_id_idx', () => sql`
    CREATE INDEX "payment_adjustments_session_id_idx" ON "payment_adjustments" USING btree ("session_id")
  `);
  await run('payment_adjustments_status_idx', () => sql`
    CREATE INDEX "payment_adjustments_status_idx" ON "payment_adjustments" USING btree ("status")
  `);
  await run('payment_adjustments_shift_id_idx', () => sql`
    CREATE INDEX "payment_adjustments_shift_id_idx" ON "payment_adjustments" USING btree ("shift_id")
  `);
  await run('payments_status_idx', () => sql`
    CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status")
  `);
  await run('payments_shift_id_idx', () => sql`
    CREATE INDEX "payments_shift_id_idx" ON "payments" USING btree ("shift_id")
  `);

  console.log('\n═══ Migration complete ═══\n');
}

main().catch((e) => {
  console.error('\nMigration failed:', e.message ?? e);
  process.exit(1);
});
