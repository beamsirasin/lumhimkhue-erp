/**
 * Phase 1 Cash Control — Flow Audit Script
 *
 * Tests permission rules and Approach C DB flow without a running Next.js server.
 * Uses real DB but creates + cleans up isolated test data.
 *
 * Usage: npx tsx scripts/audit-phase1-flow.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

// can() has no DB dependency — safe to import statically
import { can } from '../lib/auth/permissions';

// DB modules use process.env.DATABASE_URL at init time — must be dynamic imports
// (called inside main() after dotenv has populated the env)

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
  console.log('\n1. Permission Matrix');

  // payment:delete — owner only
  assert(can('owner', 'payment:delete'), 'owner can payment:delete');
  assert(!can('manager', 'payment:delete'), 'manager cannot payment:delete');
  assert(!can('cashier', 'payment:delete'), 'cashier cannot payment:delete');
  assert(!can('kitchen', 'payment:delete'), 'kitchen cannot payment:delete');

  // payment:reopen — owner + manager
  assert(can('owner', 'payment:reopen'), 'owner can payment:reopen');
  assert(can('manager', 'payment:reopen'), 'manager can payment:reopen');
  assert(!can('cashier', 'payment:reopen'), 'cashier cannot payment:reopen');
  assert(!can('kitchen', 'payment:reopen'), 'kitchen cannot payment:reopen');

  // payment:void — owner + manager (reserved for future soft-void)
  assert(can('owner', 'payment:void'), 'owner can payment:void');
  assert(can('manager', 'payment:void'), 'manager can payment:void');
  assert(!can('cashier', 'payment:void'), 'cashier cannot payment:void');

  // process_payment — cashier, owner, manager (not kitchen)
  assert(can('cashier', 'process_payment'), 'cashier can process_payment');
  assert(can('owner', 'process_payment'), 'owner can process_payment');
  assert(!can('kitchen', 'process_payment'), 'kitchen cannot process_payment');

  // printer:network_print
  assert(can('cashier', 'printer:network_print'), 'cashier can printer:network_print');
  assert(can('owner', 'printer:network_print'), 'owner can printer:network_print');
  assert(!can('kitchen', 'printer:network_print'), 'kitchen cannot printer:network_print');

  // view_kds — all roles
  assert(can('kitchen', 'view_kds'), 'kitchen can view_kds');
  assert(can('cashier', 'view_kds'), 'cashier can view_kds');
  assert(can('owner', 'view_kds'), 'owner can view_kds');
}

// ── 2. Approach C: DB Flow Simulation ──────────────────────────────────────

async function auditApproachCFlow() {
  console.log('\n2. Approach C — DB Flow Simulation');

  // Dynamic imports — DATABASE_URL is now set from dotenv
  const { db } = await import('../lib/db');
  const { eq } = await import('drizzle-orm');
  const { sessions, tables, payments, paymentLineItems, paymentAdjustments, pricingTiles, users } =
    await import('../lib/db/schema');

  // Look up real data to use as FK anchors
  const [anyTable] = await db.select({ id: tables.id }).from(tables).limit(1);
  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  const [anyTile] = await db.select({ id: pricingTiles.id }).from(pricingTiles).limit(1);

  if (!anyTable || !anyUser || !anyTile) {
    fail('Setup: need at least 1 table, 1 user, 1 pricing_tile in DB to run flow test');
    return;
  }

  // Create an isolated test session
  const [testSession] = await db
    .insert(sessions)
    .values({
      tableId: anyTable.id,
      sessionToken: `p1t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      status: 'paid',
    })
    .returning({ id: sessions.id });
  cleanup.push(async () => {
    await db.delete(sessions).where(eq(sessions.id, testSession.id));
  });
  ok(`Created test session ${testSession.id.slice(0, 8)}…`);

  // Create a test payment (simulates processPayment result)
  const [testPayment] = await db
    .insert(payments)
    .values({
      sessionId: testSession.id,
      subtotal: '350.00',
      serviceCharge: '0',
      discount: '0',
      total: '350.00',
      paymentMethod: 'cash',
      receivedAmount: '400.00',
      changeAmount: '50.00',
      processedBy: anyUser.id,
      receiptNo: 'TEST-001',
      status: 'completed',
    })
    .returning({ id: payments.id, sessionId: payments.sessionId, total: payments.total });
  cleanup.push(async () => {
    await db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, testPayment.id));
    await db.delete(payments).where(eq(payments.id, testPayment.id));
  });
  ok(`Created test payment ${testPayment.id.slice(0, 8)}… total=350`);

  // Create test line item
  const [testLineItem] = await db
    .insert(paymentLineItems)
    .values({
      paymentId: testPayment.id,
      pricingTileId: anyTile.id,
      quantity: 2,
      amount: '350.00',
    })
    .returning({ id: paymentLineItems.id });
  ok(`Created test line item ${testLineItem.id.slice(0, 8)}…`);

  // ── Simulate Approach C — sequential ops (neon-http has no transaction support) ──
  console.log('\n  --- Simulating Approach C (delete flow) ---');

  const FAKE_USER_ID = anyUser.id;
  const REASON = 'audit test void';

  // Step 1: fetch line items
  const lineItems = await db
    .select({
      id: paymentLineItems.id,
      pricingTileId: paymentLineItems.pricingTileId,
      quantity: paymentLineItems.quantity,
      amount: paymentLineItems.amount,
    })
    .from(paymentLineItems)
    .where(eq(paymentLineItems.paymentId, testPayment.id));

  // Step 2: INSERT payment_adjustments BEFORE delete (Approach C guarantee)
  await db.insert(paymentAdjustments).values({
    paymentId: testPayment.id,    // raw UUID, no FK (Approach C)
    sessionId: testSession.id,    // FK → sessions (stays after payment deleted)
    type: 'void',
    amount: testPayment.total,
    reason: REASON,
    requestedBy: FAKE_USER_ID,
    approvedBy: FAKE_USER_ID,
    approvedAt: new Date(),
    status: 'approved',
    paymentSnapshot: {
      payment: {
        id: testPayment.id,
        sessionId: testSession.id,
        total: testPayment.total,
        status: 'completed',
      },
      lineItems,
      context: {
        action: 'delete_payment',
        performedBy: FAKE_USER_ID,
        performedAt: new Date().toISOString(),
      },
    },
  });

  // Step 3: delete line items
  await db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, testPayment.id));

  // Step 4: delete payment — must NOT fail (no FK on paymentAdjustments.paymentId)
  await db.delete(payments).where(eq(payments.id, testPayment.id));

  // Step 5: revert session status
  await db.update(sessions)
    .set({ status: 'closing' })
    .where(eq(sessions.id, testSession.id));

  ok('Transaction committed without FK error');

  // ── Verify audit trail ─────────────────────────────────────────────────────
  console.log('\n  --- Verifying audit trail ---');

  const [adj] = await db
    .select()
    .from(paymentAdjustments)
    .where(eq(paymentAdjustments.sessionId, testSession.id));
  cleanup.push(async () => {
    await db.delete(paymentAdjustments).where(eq(paymentAdjustments.sessionId, testSession.id));
  });

  assert(!!adj, 'payment_adjustments row exists after delete');
  assert(adj?.type === 'void', `type = 'void' (got: ${adj?.type})`);
  assert(adj?.status === 'approved', `status = 'approved' (got: ${adj?.status})`);
  assert(String(adj?.amount) === '350.00', `amount = 350.00 (got: ${adj?.amount})`);
  assert(adj?.paymentId === testPayment.id, 'paymentId matches original payment UUID');
  assert(adj?.sessionId === testSession.id, 'sessionId FK set correctly');
  assert(adj?.paymentSnapshot !== null, 'paymentSnapshot jsonb is not null');

  const snapshot = adj?.paymentSnapshot as Record<string, unknown> | null;
  assert(
    !!(snapshot && typeof snapshot === 'object' && 'payment' in snapshot && 'lineItems' in snapshot && 'context' in snapshot),
    'paymentSnapshot has payment + lineItems + context keys',
  );

  // ── Verify payment row is gone ─────────────────────────────────────────────
  console.log('\n  --- Verifying payment deletion ---');

  const [deletedPayment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.id, testPayment.id));
  assert(!deletedPayment, 'payment row is deleted');

  const remainingLineItems = await db
    .select({ id: paymentLineItems.id })
    .from(paymentLineItems)
    .where(eq(paymentLineItems.paymentId, testPayment.id));
  assert(remainingLineItems.length === 0, 'paymentLineItems deleted');

  const [updatedSession] = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, testSession.id));
  assert(updatedSession?.status === 'closing', `session status = 'closing' (got: ${updatedSession?.status})`);

  // ── Verify payments.session_id UNIQUE allows new payment after delete ──────
  console.log('\n  --- Verifying re-payment after reopen (processPayment flow) ---');

  const [newPayment] = await db
    .insert(payments)
    .values({
      sessionId: testSession.id,   // same session, same UNIQUE constraint
      subtotal: '350.00',
      serviceCharge: '0',
      discount: '0',
      total: '350.00',
      paymentMethod: 'qr_promptpay',
      receivedAmount: '350.00',
      changeAmount: '0',
      processedBy: anyUser.id,
      receiptNo: 'TEST-002',
      status: 'completed',
    })
    .returning({ id: payments.id });
  cleanup.push(async () => {
    await db.delete(payments).where(eq(payments.id, newPayment.id));
  });
  assert(!!newPayment, 'New payment can be inserted for same sessionId after delete — UNIQUE not violated');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══ Phase 1 — Flow Audit ═══');

  try {
    auditPermissions();
    await auditApproachCFlow();
  } finally {
    // Cleanup in reverse order
    console.log('\n  --- Cleaning up test data ---');
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch { /* already deleted by tx */ }
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
