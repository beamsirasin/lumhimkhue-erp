/**
 * TEMP — one-off cleanup of the Test Cashier8 test artifact chain, requested
 * by the owner. Deletes (in FK-safe order): 1 payment_row → 1 payment (฿400,
 * no receipt_no, no shift) → 1 empty closed test session (table T-TEST-8,
 * already soft-deleted) → the Test Cashier8 user. Writes an audit_logs entry
 * attributed to the owner. Delete this file after use.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const USER_ID = '8d264b3f-c046-4d6a-8f5a-5d551f0c4402'; // Test Cashier8
const PAYMENT_ID = '1774662e-948c-46b2-a306-7ab8ba847e67';
const SESSION_ID = '0e40516a-4db2-4001-bcc0-ecc71e302c86';
const OWNER_ID = '7b897c56-c99f-4985-a10d-ea585277d730';

async function main() {
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  // Safety re-checks: abort if anything unexpected appeared since inspection
  const guard = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM payments WHERE processed_by = ${USER_ID} AND id != ${PAYMENT_ID}) AS other_payments,
      (SELECT COUNT(*) FROM payment_line_items WHERE payment_id = ${PAYMENT_ID})              AS line_items,
      (SELECT COUNT(*) FROM payment_allocations WHERE session_id = ${SESSION_ID})             AS allocations,
      (SELECT COUNT(*) FROM payment_adjustments WHERE payment_id = ${PAYMENT_ID})             AS adjustments,
      (SELECT COUNT(*) FROM discount_approvals WHERE session_id = ${SESSION_ID})              AS discounts,
      (SELECT COUNT(*) FROM session_guests WHERE session_id = ${SESSION_ID})                  AS guests,
      (SELECT COUNT(*) FROM buffet_charge_lines WHERE session_id = ${SESSION_ID})             AS charge_lines,
      (SELECT COUNT(*) FROM orders WHERE session_id = ${SESSION_ID})                          AS orders,
      (SELECT COUNT(*) FROM audit_logs WHERE user_id = ${USER_ID})                            AS audit_rows
  `);
  const g = guard.rows[0] as Record<string, string>;
  const dirty = Object.entries(g).filter(([, v]) => v !== '0');
  if (dirty.length > 0) {
    console.error('ABORT — unexpected linked rows:', dirty);
    process.exit(1);
  }

  const r1 = await db.execute(sql`DELETE FROM payment_rows WHERE payment_id = ${PAYMENT_ID} RETURNING id`);
  console.log('deleted payment_rows:', r1.rows.length);

  const r2 = await db.execute(sql`DELETE FROM payments WHERE id = ${PAYMENT_ID} RETURNING id`);
  console.log('deleted payments:', r2.rows.length);

  const r3 = await db.execute(sql`DELETE FROM sessions WHERE id = ${SESSION_ID} RETURNING id`);
  console.log('deleted sessions:', r3.rows.length);

  const r4 = await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID} RETURNING id`);
  console.log('deleted users:', r4.rows.length);

  await db.execute(sql`
    INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
    VALUES (${OWNER_ID}, 'delete', 'users', ${USER_ID}, ${JSON.stringify({
      role: 'owner',
      before: { email: 'cash8.ph8mqhxm5ezq92@test.local', name: 'Test Cashier8', role: 'cashier' },
      note: 'test-artifact cleanup: removed test payment ฿400 (no receipt_no, no shift), empty closed test session on soft-deleted table T-TEST-8, and the test user itself',
    })}::jsonb)
  `);
  console.log('audit log written');

  const check = await db.execute(sql`SELECT 1 FROM users WHERE id = ${USER_ID}`);
  console.log('verify user gone:', check.rows.length === 0 ? 'YES' : 'NO');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
