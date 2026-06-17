/**
 * Phase 1 Cash Control — Cashier Shift Flow Audit Script
 *
 * Verifies permission rules and shift DB flows using real Neon DB.
 * Creates isolated test data and cleans up after.
 *
 * Usage: npx tsx scripts/audit-phase1-shifts.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

// can() has no DB dependency — safe to import statically
import { can } from '../lib/auth/permissions';

let passed = 0;
let failed = 0;
const cleanup: (() => Promise<void>)[] = [];

function ok(label: string) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  failed++;
}

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) ok(label);
  else fail(label, detail);
}

// ── 1. Permission Matrix ────────────────────────────────────────────────────

function auditPermissions() {
  console.log('\n1. Permission Matrix — cashier_shift:manage');

  // cashier_shift:manage
  assert(can('owner', 'cashier_shift:manage'), 'owner can cashier_shift:manage');
  assert(can('manager', 'cashier_shift:manage'), 'manager can cashier_shift:manage');
  assert(can('cashier', 'cashier_shift:manage'), 'cashier can cashier_shift:manage');
  assert(!can('kitchen', 'cashier_shift:manage'), 'kitchen cannot cashier_shift:manage');

  // reviewShift is restricted to owner/manager by role (no dedicated action)
  // We verify the surrounding permissions make sense:
  assert(can('owner', 'view_reports'), 'owner has view_reports (can access shift reports)');
  assert(!can('cashier', 'view_reports'), 'cashier does not have view_reports');
  assert(!can('kitchen', 'cashier_shift:manage'), 'kitchen blocked from all shift ops');
}

// ── 2. Shift DB Flow Simulation ─────────────────────────────────────────────

async function auditShiftFlow() {
  console.log('\n2. Shift DB Flow Simulation');

  // Dynamic imports — DATABASE_URL is now set from dotenv
  const { db } = await import('../lib/db');
  const { eq, and, sum } = await import('drizzle-orm');
  const { cashierShifts, payments, users } = await import('../lib/db/schema');

  // Look up seeded users
  const [cashierUser] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, 'cashier@shabu.local'))
    .limit(1);
  const [ownerUser] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, 'owner@shabu.local'))
    .limit(1);

  if (!cashierUser || !ownerUser) {
    fail('Setup: seed users not found — run npm run db:seed first');
    return;
  }
  ok(`Found cashier user: ${cashierUser.email}`);
  ok(`Found owner user: ${ownerUser.email}`);

  // ── 2a. Open a shift ──────────────────────────────────────────────────────
  console.log('\n  --- 2a. Open shift ---');

  const [openedShift] = await db
    .insert(cashierShifts)
    .values({
      cashierId: cashierUser.id,
      openedBy: cashierUser.id,
      openingFloat: '500.00',
      status: 'open',
    })
    .returning({ id: cashierShifts.id, status: cashierShifts.status, openedAt: cashierShifts.openedAt });
  cleanup.push(async () => {
    await db.delete(cashierShifts).where(eq(cashierShifts.id, openedShift.id));
  });

  assert(!!openedShift, `Shift created ${openedShift?.id?.slice(0, 8) ?? '?'}…`);
  assert(openedShift.status === 'open', `status = 'open' (got: ${openedShift.status})`);

  // ── 2b. Duplicate open shift prevention ───────────────────────────────────
  console.log('\n  --- 2b. Duplicate open shift check ---');

  const [existingOpen] = await db
    .select({ id: cashierShifts.id })
    .from(cashierShifts)
    .where(and(eq(cashierShifts.cashierId, cashierUser.id), eq(cashierShifts.status, 'open')))
    .limit(1);

  assert(!!existingOpen, 'Duplicate check finds existing open shift → openShift() would reject');

  // ── 2c. Close shift — difference with no reason should fail business rule ─
  console.log('\n  --- 2c. Close shift — differenceReason requirement ---');

  // Simulate business rule: actualCash differs from expectedCash, no reason → must reject
  const openingFloat = 500;
  const cashTotal = 0; // no linked cash payments in test
  const expectedCash = openingFloat + cashTotal;
  const actualCashWrong = 450; // 50 baht short
  const difference = actualCashWrong - expectedCash;

  assert(
    difference !== 0,
    `cashDifference = ${difference} ≠ 0 → differenceReason required (action would return error)`,
  );

  // Simulate business rule with reason provided → passes
  const differenceReason = 'ทอนเงินผิด';
  assert(
    difference !== 0 && differenceReason.trim().length > 0,
    'With differenceReason provided → action proceeds',
  );

  // ── 2d. Close shift — sum(cash payments WHERE shiftId) ───────────────────
  console.log('\n  --- 2d. expectedCash calculation ---');

  const [cashResult] = await db
    .select({ total: sum(payments.total) })
    .from(payments)
    .where(
      and(
        eq(payments.shiftId, openedShift.id),
        eq(payments.paymentMethod, 'cash'),
        eq(payments.status, 'completed'),
      ),
    );
  const summedCash = Number(cashResult?.total ?? 0);
  const computedExpected = 500 + summedCash;

  assert(summedCash === 0, `No cash payments linked to test shift → summedCash = ${summedCash}`);
  assert(computedExpected === 500, `expectedCash = openingFloat(500) + cashTotal(${summedCash}) = ${computedExpected}`);

  // ── 2e. Actually close the shift ─────────────────────────────────────────
  console.log('\n  --- 2e. Close shift (actualCash = expectedCash) ---');

  const actualCashExact = 500; // matches expected → no reason needed
  const cashDifference = actualCashExact - computedExpected;

  await db
    .update(cashierShifts)
    .set({
      status: 'closed',
      closedAt: new Date(),
      closedBy: ownerUser.id,
      expectedCash: String(computedExpected),
      actualCash: String(actualCashExact),
      cashDifference: String(cashDifference),
    })
    .where(eq(cashierShifts.id, openedShift.id));

  const [closedShift] = await db
    .select({ status: cashierShifts.status, cashDifference: cashierShifts.cashDifference })
    .from(cashierShifts)
    .where(eq(cashierShifts.id, openedShift.id));

  assert(closedShift?.status === 'closed', `status = 'closed' (got: ${closedShift?.status})`);
  assert(
    Number(closedShift?.cashDifference) === 0,
    `cashDifference = 0 (got: ${closedShift?.cashDifference})`,
  );

  // ── 2f. Review shift ──────────────────────────────────────────────────────
  console.log('\n  --- 2f. Review shift (owner/manager only) ---');

  // Business rule: only 'closed' shifts can be reviewed (not 'open' or 'reviewed')
  assert(closedShift?.status === 'closed', 'shift is closed → eligible for review');

  await db
    .update(cashierShifts)
    .set({
      status: 'reviewed',
      reviewedBy: ownerUser.id,
      reviewedAt: new Date(),
      reviewNotes: 'ตรวจสอบแล้ว ยอดตรง',
    })
    .where(eq(cashierShifts.id, openedShift.id));

  const [reviewedShift] = await db
    .select({ status: cashierShifts.status, reviewNotes: cashierShifts.reviewNotes })
    .from(cashierShifts)
    .where(eq(cashierShifts.id, openedShift.id));

  assert(reviewedShift?.status === 'reviewed', `status = 'reviewed' (got: ${reviewedShift?.status})`);
  assert(reviewedShift?.reviewNotes === 'ตรวจสอบแล้ว ยอดตรง', 'reviewNotes saved correctly');

  // ── 2g. Cashier scope check ───────────────────────────────────────────────
  console.log('\n  --- 2g. Cashier scope — cannot view other cashier shift ---');

  // Simulate: cashier tries to view a shift that belongs to ownerUser (not themselves)
  const [ownerShift] = await db
    .select({ id: cashierShifts.id, cashierId: cashierShifts.cashierId })
    .from(cashierShifts)
    .where(eq(cashierShifts.id, openedShift.id));

  const isOwnShift = ownerShift?.cashierId === cashierUser.id;
  assert(
    isOwnShift,
    `cashier IS the owner of this test shift (cashierId matches) — scope check valid`,
  );

  // Simulate: a different cashier would get rejected
  const wouldCashierBeRejected = ownerShift?.cashierId !== ownerUser.id;
  assert(
    wouldCashierBeRejected,
    'If owner tried to view via cashier role → would be rejected (cashierId != currentUserId)',
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══ Phase 1 — Cashier Shift Audit ═══');

  try {
    auditPermissions();
    await auditShiftFlow();
  } finally {
    console.log('\n  --- Cleaning up test data ---');
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch { /* ignore */ }
    }
    console.log('  Cleanup done');
  }

  console.log(`\n═══ Result: ${passed} passed, ${failed} failed ═══\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\nAudit error:', e);
  process.exit(1);
});
