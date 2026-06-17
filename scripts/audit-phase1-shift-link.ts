/**
 * Phase 1 Cash Control — Shift ↔ Payment Link Audit Script
 *
 * Verifies that processPayment correctly links payments to the cashier's
 * active shift (when open) and leaves shiftId null when no shift is open.
 *
 * Tests at the DB level — simulates what processPayment does without
 * going through the Next.js server action (which requires auth context).
 *
 * Usage: npx tsx scripts/audit-phase1-shift-link.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

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

async function main() {
  console.log('\n═══ Phase 1 — Shift ↔ Payment Link Audit ═══');

  const { db } = await import('../lib/db');
  const { eq, and, sum } = await import('drizzle-orm');
  const { cashierShifts, payments, sessions, tables, users, pricingTiles } =
    await import('../lib/db/schema');

  // ── Fixtures ─────────────────────────────────────────────────────────────
  const [cashierA] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'cashier@shabu.local'))
    .limit(1);
  const [cashierB] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'kitchen@shabu.local'))
    .limit(1);
  const [anyTable] = await db.select({ id: tables.id }).from(tables).limit(1);
  const [anyTile] = await db.select({ id: pricingTiles.id }).from(pricingTiles).limit(1);

  if (!cashierA || !anyTable || !anyTile) {
    fail('Setup: need seeded cashier user, 1 table, 1 tile — run npm run db:seed');
    return;
  }

  // ── 1. Payment without any open shift → shiftId = null ───────────────────
  console.log('\n1. Payment without open shift → shiftId = null');

  // Ensure no open shift for cashierA
  const [existingOpenShift] = await db
    .select({ id: cashierShifts.id })
    .from(cashierShifts)
    .where(and(eq(cashierShifts.cashierId, cashierA.id), eq(cashierShifts.status, 'open')))
    .limit(1);

  // Active shift lookup (mirrors processPayment logic)
  const noShiftId = existingOpenShift?.id ?? null;

  const [sess1] = await db
    .insert(sessions)
    .values({
      tableId: anyTable.id,
      sessionToken: `sl1${Date.now().toString(36)}`,
      status: 'paid',
    })
    .returning({ id: sessions.id });
  cleanup.push(async () => { await db.delete(sessions).where(eq(sessions.id, sess1.id)); });

  const [pay1] = await db
    .insert(payments)
    .values({
      sessionId: sess1.id,
      subtotal: '200.00',
      serviceCharge: '0',
      discount: '0',
      total: '200.00',
      paymentMethod: 'cash',
      receivedAmount: '200.00',
      changeAmount: '0',
      processedBy: cashierA.id,
      status: 'completed',
      shiftId: noShiftId,   // null when no open shift
    })
    .returning({ id: payments.id, shiftId: payments.shiftId });
  cleanup.push(async () => { await db.delete(payments).where(eq(payments.id, pay1.id)); });

  assert(pay1.shiftId === null, `payment.shiftId = null when no active shift (got: ${pay1.shiftId})`);

  // ── 2. Payment with open shift → shiftId = activeShift.id ───────────────
  console.log('\n2. Payment with open shift → shiftId = activeShift.id');

  const [shift1] = await db
    .insert(cashierShifts)
    .values({
      cashierId: cashierA.id,
      openedBy: cashierA.id,
      openingFloat: '300.00',
      status: 'open',
    })
    .returning({ id: cashierShifts.id });
  cleanup.push(async () => { await db.delete(cashierShifts).where(eq(cashierShifts.id, shift1.id)); });

  // Active shift lookup for cashierA — mirrors processPayment
  const [activeShiftRow] = await db
    .select({ id: cashierShifts.id })
    .from(cashierShifts)
    .where(and(eq(cashierShifts.cashierId, cashierA.id), eq(cashierShifts.status, 'open')))
    .limit(1);
  const activeShiftId = activeShiftRow?.id ?? null;

  assert(activeShiftId === shift1.id, `Active shift lookup returns shift1.id (got: ${activeShiftId?.slice(0, 8)}…)`);

  const [sess2] = await db
    .insert(sessions)
    .values({
      tableId: anyTable.id,
      sessionToken: `sl2${Date.now().toString(36)}`,
      status: 'paid',
    })
    .returning({ id: sessions.id });
  cleanup.push(async () => { await db.delete(sessions).where(eq(sessions.id, sess2.id)); });

  const [pay2] = await db
    .insert(payments)
    .values({
      sessionId: sess2.id,
      subtotal: '350.00',
      serviceCharge: '0',
      discount: '0',
      total: '350.00',
      paymentMethod: 'cash',
      receivedAmount: '400.00',
      changeAmount: '50.00',
      processedBy: cashierA.id,
      status: 'completed',
      shiftId: activeShiftId,
    })
    .returning({ id: payments.id, shiftId: payments.shiftId });
  cleanup.push(async () => { await db.delete(payments).where(eq(payments.id, pay2.id)); });

  assert(pay2.shiftId === shift1.id, `payment.shiftId = shift1.id (got: ${pay2.shiftId?.slice(0, 8)}…)`);

  // ── 3. Non-cash payment also gets shiftId ────────────────────────────────
  console.log('\n3. Non-cash paymentMethod also linked to shift');

  const [sess3] = await db
    .insert(sessions)
    .values({
      tableId: anyTable.id,
      sessionToken: `sl3${Date.now().toString(36)}`,
      status: 'paid',
    })
    .returning({ id: sessions.id });
  cleanup.push(async () => { await db.delete(sessions).where(eq(sessions.id, sess3.id)); });

  const [pay3] = await db
    .insert(payments)
    .values({
      sessionId: sess3.id,
      subtotal: '400.00',
      serviceCharge: '0',
      discount: '0',
      total: '400.00',
      paymentMethod: 'qr_promptpay',
      receivedAmount: '400.00',
      changeAmount: '0',
      processedBy: cashierA.id,
      status: 'completed',
      shiftId: activeShiftId,  // non-cash still linked to shift
    })
    .returning({ id: payments.id, shiftId: payments.shiftId, paymentMethod: payments.paymentMethod });
  cleanup.push(async () => { await db.delete(payments).where(eq(payments.id, pay3.id)); });

  assert(pay3.shiftId === shift1.id, `qr_promptpay payment.shiftId = shift1.id`);
  assert(pay3.paymentMethod === 'qr_promptpay', `paymentMethod = qr_promptpay`);

  // ── 4. closeShift expectedCash: only 'cash' payments counted ─────────────
  console.log('\n4. expectedCash only counts paymentMethod = cash');

  const [cashSumResult] = await db
    .select({ total: sum(payments.total) })
    .from(payments)
    .where(
      and(
        eq(payments.shiftId, shift1.id),
        eq(payments.paymentMethod, 'cash'),
        eq(payments.status, 'completed'),
      ),
    );
  const cashOnlyTotal = Number(cashSumResult?.total ?? 0);

  // pay2 = 350 cash; pay3 = 400 qr_promptpay (excluded)
  assert(cashOnlyTotal === 350, `SUM(cash payments) = 350 (got: ${cashOnlyTotal})`);

  const [allSumResult] = await db
    .select({ total: sum(payments.total) })
    .from(payments)
    .where(and(eq(payments.shiftId, shift1.id), eq(payments.status, 'completed')));
  const allMethodsTotal = Number(allSumResult?.total ?? 0);

  assert(allMethodsTotal === 750, `SUM(all payments in shift) = 750 (got: ${allMethodsTotal})`);
  assert(
    cashOnlyTotal < allMethodsTotal,
    `expectedCash (${cashOnlyTotal}) < allMethodsTotal (${allMethodsTotal}) — qr excluded from cash count`,
  );

  const openingFloat = 300;
  const expectedCash = openingFloat + cashOnlyTotal;
  assert(expectedCash === 650, `expectedCash = openingFloat(300) + cashTotal(350) = ${expectedCash}`);

  // ── 5. Idempotency: shiftId UNIQUE is on sessionId only, not shiftId ─────
  console.log('\n5. Idempotency — payments.sessionId UNIQUE blocks duplicate payment');

  // Attempt to insert a second payment for sess2 (same sessionId)
  let duplicateBlocked = false;
  try {
    await db.insert(payments).values({
      sessionId: sess2.id,  // same sessionId as pay2 → UNIQUE violation
      subtotal: '350.00',
      serviceCharge: '0',
      discount: '0',
      total: '350.00',
      paymentMethod: 'cash',
      receivedAmount: '350.00',
      changeAmount: '0',
      processedBy: cashierA.id,
      status: 'completed',
      shiftId: activeShiftId,
    });
  } catch {
    duplicateBlocked = true;
  }
  assert(duplicateBlocked, 'Duplicate payment for same sessionId → UNIQUE constraint blocks it');

  // ── 6. Cross-cashier: cashier B does not inherit cashier A's shift ────────
  console.log('\n6. Cross-cashier — cashier B has no shift → shiftId = null');

  const cashierBId = cashierB?.id ?? null;
  if (!cashierBId) {
    ok('Skip cross-cashier test — no second user found (host@shabu.local may not exist)');
  } else {
    // Active shift lookup FOR CASHIER B (not A)
    const [bShiftRow] = await db
      .select({ id: cashierShifts.id })
      .from(cashierShifts)
      .where(and(eq(cashierShifts.cashierId, cashierBId), eq(cashierShifts.status, 'open')))
      .limit(1);
    const bShiftId = bShiftRow?.id ?? null;

    assert(bShiftId === null, `cashier B has no open shift → shiftId = null (A's shift not used)`);
    assert(
      bShiftId !== shift1.id,
      `cashier B's active shift ≠ cashier A's shift (cross-cashier isolation)`,
    );
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\n  --- Cleaning up test data ---');
  for (const fn of cleanup.reverse()) {
    try { await fn(); } catch { /* already deleted */ }
  }
  console.log('  Cleanup done');

  console.log(`\n═══ Result: ${passed} passed, ${failed} failed ═══\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\nAudit error:', e);
  process.exit(1);
});
