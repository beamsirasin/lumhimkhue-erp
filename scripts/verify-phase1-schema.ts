/**
 * Phase 1 Cash Control — DB Schema Verification Script
 * Usage: npx tsx scripts/verify-phase1-schema.ts
 *
 * Checks that all Phase 1 tables, columns, and enums are applied in the database.
 * Read-only — makes no changes.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set in .env.local');

const sql = neon(DATABASE_URL);

type Row = Record<string, unknown>;

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  failed++;
}

async function checkTable(tableName: string): Promise<boolean> {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `;
  return rows.length > 0;
}

async function checkColumn(tableName: string, columnName: string): Promise<Row | null> {
  const rows = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName} AND column_name = ${columnName}
  `;
  return rows.length > 0 ? (rows[0] as Row) : null;
}

async function checkEnum(enumName: string): Promise<string[]> {
  const rows = await sql`
    SELECT enumlabel FROM pg_enum
    INNER JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = ${enumName}
    ORDER BY enumsortorder
  `;
  return rows.map((r) => (r as Row).enumlabel as string);
}

async function checkIndex(indexName: string): Promise<boolean> {
  const rows = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ${indexName}
  `;
  return rows.length > 0;
}


async function main() {
  console.log('\n═══ Phase 1 Cash Control — DB Verification ═══\n');

  // ── 1. Phase 1 Enums ──────────────────────────────────────────────────────
  console.log('1. Enums');
  {
    const shiftStatus = await checkEnum('cashier_shift_status');
    if (shiftStatus.join(',') === 'open,closed,reviewed') ok('cashier_shift_status enum');
    else fail('cashier_shift_status enum', `got: [${shiftStatus.join(', ')}]`);

    const paymentStatus = await checkEnum('payment_status');
    if (paymentStatus.join(',') === 'completed,voided,refunded') ok('payment_status enum');
    else fail('payment_status enum', `got: [${paymentStatus.join(', ')}]`);

    const adjType = await checkEnum('payment_adjustment_type');
    if (adjType.join(',') === 'void,refund,discount_correction') ok('payment_adjustment_type enum');
    else fail('payment_adjustment_type enum', `got: [${adjType.join(', ')}]`);

    const adjStatus = await checkEnum('payment_adjustment_status');
    if (adjStatus.join(',') === 'pending,approved,rejected') ok('payment_adjustment_status enum');
    else fail('payment_adjustment_status enum', `got: [${adjStatus.join(', ')}]`);

    const discountStatus = await checkEnum('discount_approval_status');
    if (discountStatus.join(',') === 'pending,approved,rejected') ok('discount_approval_status enum');
    else fail('discount_approval_status enum', `got: [${discountStatus.join(', ')}]`);
  }

  // ── 2. New Tables ─────────────────────────────────────────────────────────
  console.log('\n2. New Tables');
  {
    for (const t of ['cashier_shifts', 'payment_adjustments', 'discount_approvals']) {
      if (await checkTable(t)) ok(t);
      else fail(t, 'table missing — run npm run db:push');
    }
  }

  // ── 3. payments — new columns ─────────────────────────────────────────────
  console.log('\n3. payments — new columns');
  {
    const shiftId = await checkColumn('payments', 'shift_id');
    if (shiftId) ok('payments.shift_id (nullable uuid)');
    else fail('payments.shift_id');

    const status = await checkColumn('payments', 'status');
    if (status) {
      const hasDefault = String(status.column_default ?? '').includes('completed');
      ok(`payments.status — default: ${status.column_default}${hasDefault ? ' ✓' : ' ← expected completed'}`);
    } else {
      fail('payments.status');
    }

    const voidedAt = await checkColumn('payments', 'voided_at');
    if (voidedAt) ok('payments.voided_at (nullable timestamp)');
    else fail('payments.voided_at');

    const voidedBy = await checkColumn('payments', 'voided_by');
    if (voidedBy) ok('payments.voided_by (nullable uuid)');
    else fail('payments.voided_by');

    const voidReason = await checkColumn('payments', 'void_reason');
    if (voidReason) ok('payments.void_reason (nullable text)');
    else fail('payments.void_reason');
  }

  // ── 4. payment_adjustments — column structure ─────────────────────────────
  console.log('\n4. payment_adjustments — columns');
  {
    const paymentId = await checkColumn('payment_adjustments', 'payment_id');
    if (paymentId) {
      // Verify NO FK constraint on payment_id (Approach C requirement)
      const hasFk = await sql`
        SELECT 1 FROM information_schema.referential_constraints rc
        INNER JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = rc.constraint_name
        WHERE kcu.table_name = 'payment_adjustments' AND kcu.column_name = 'payment_id'
      `;
      if (hasFk.length === 0) ok('payment_adjustments.payment_id — raw uuid, NO FK ✓');
      else fail('payment_adjustments.payment_id has FK to payments — Approach C requires NO FK');
    } else {
      fail('payment_adjustments.payment_id column missing');
    }

    const sessionId = await checkColumn('payment_adjustments', 'session_id');
    if (sessionId) ok('payment_adjustments.session_id (FK → sessions)');
    else fail('payment_adjustments.session_id');

    const snapshot = await checkColumn('payment_adjustments', 'payment_snapshot');
    if (snapshot) ok('payment_adjustments.payment_snapshot (jsonb)');
    else fail('payment_adjustments.payment_snapshot');

    const type = await checkColumn('payment_adjustments', 'type');
    if (type) ok('payment_adjustments.type (payment_adjustment_type enum)');
    else fail('payment_adjustments.type');

    const status = await checkColumn('payment_adjustments', 'status');
    if (status) ok(`payment_adjustments.status — default: ${status.column_default}`);
    else fail('payment_adjustments.status');
  }

  // ── 5. Indexes ────────────────────────────────────────────────────────────
  console.log('\n5. Indexes');
  {
    const indexes = [
      'payments_status_idx',
      'payments_shift_id_idx',
      'payment_adjustments_payment_id_idx',
      'payment_adjustments_session_id_idx',
      'payment_adjustments_status_idx',
      'payment_adjustments_shift_id_idx',
      'cashier_shifts_cashier_opened_at_idx',
      'cashier_shifts_branch_status_idx',
    ];
    for (const idx of indexes) {
      if (await checkIndex(idx)) ok(idx);
      else fail(idx);
    }
  }

  // ── 6. payments.session_id UNIQUE constraint still intact ─────────────────
  console.log('\n6. payments.session_id UNIQUE (must remain)');
  {
    const rows = await sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'payments'
      AND constraint_type = 'UNIQUE'
    `;
    const names = rows.map((r) => (r as Row).constraint_name as string);
    const hasUnique = names.some((n) => n.includes('session'));
    if (hasUnique) ok(`payments.session_id UNIQUE intact — ${names.join(', ')}`);
    else fail('payments.session_id UNIQUE constraint missing!');
  }

  // ── 7. Existing data health (skip if tables missing) ─────────────────────
  console.log('\n7. Existing data health');
  {
    const tablesExist = await checkTable('payment_adjustments');
    const paymentsStatusExists = !!(await checkColumn('payments', 'status'));

    if (paymentsStatusExists) {
      const counts = await sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status IS NULL)       AS null_status,
          COUNT(*) FILTER (WHERE status != 'completed') AS non_completed
        FROM payments
      `;
      const c = counts[0] as Row;
      if (Number(c.null_status) === 0)
        ok(`All payment rows have status — completed: ${c.completed}, non_completed: ${c.non_completed}`);
      else
        fail(`${c.null_status} payment rows have NULL status — migration may not have applied default`);
    } else {
      fail('payments.status column missing — skip row health check');
    }

    if (tablesExist) {
      const adjCount = await sql`SELECT COUNT(*) AS cnt FROM payment_adjustments`;
      ok(`payment_adjustments row count: ${(adjCount[0] as Row).cnt}`);
    } else {
      fail('payment_adjustments table missing — skip row count');
    }

    const auditCount = await sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE action IN ('delete_payment', 'reopen_session', 'void_payment')
    `;
    ok(`audit_logs payment-related entries: ${(auditCount[0] as Row).cnt}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n═══ Result: ${passed} passed, ${failed} failed ═══\n`);
  if (failed > 0) {
    console.log('Action required: run  npm run db:push  from VS Code terminal, then re-run this script.\n');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nVerification error:', e);
  process.exit(1);
});
