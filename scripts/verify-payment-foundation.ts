import { config } from 'dotenv';
import { and, eq, inArray, sql } from 'drizzle-orm';

config({ path: '.env.local' });

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`OK ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.log(`FAIL ${label}${detail ? ` - ${detail}` : ''}`);
  failed++;
}

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) ok(label);
  else fail(label, detail);
}

async function main() {
  const {
    DEFAULT_PAYMENT_METHODS,
    DEFAULT_RECEIVING_ACCOUNTS,
  } = await import('../lib/payments/foundation');
  const { db } = await import('../lib/db');
  const {
    paymentMethodAccounts,
    paymentMethods,
    paymentRows,
    payments,
    receivingAccounts,
    paymentAdjustments,
    sessions,
    buffetChargeLines,
    paymentAllocations,
  } = await import('../lib/db/schema');

  console.log('Payment foundation verification');

  const requiredMethodCodes = DEFAULT_PAYMENT_METHODS.map((m) => m.code);
  const requiredAccountCodes = DEFAULT_RECEIVING_ACCOUNTS.map((a) => a.code);

  const [methods, accounts] = await Promise.all([
    db.select().from(paymentMethods).where(inArray(paymentMethods.code, requiredMethodCodes)),
    db.select().from(receivingAccounts).where(inArray(receivingAccounts.code, requiredAccountCodes)),
  ]);

  assert(
    methods.length === requiredMethodCodes.length,
    `payment methods exist: ${methods.length}/${requiredMethodCodes.length}`,
  );
  assert(
    accounts.length === requiredAccountCodes.length,
    `receiving accounts exist: ${accounts.length}/${requiredAccountCodes.length}`,
  );

  const methodByCode = new Map(methods.map((m) => [m.code, m]));
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));

  const requiredMappings = [
    ['promptpay', 'bank_cash_a'],
    ['promptpay', 'bank_cash_b'],
    ['cash', 'bank_cash_a'],
    ['cash', 'bank_cash_b'],
    ['welfare', 'welfare_a'],
    ['welfare', 'welfare_b'],
    ['legacy_cash_qr', 'legacy_unknown'],
  ] as const;

  let mappingCount = 0;
  for (const [methodCode, accountCode] of requiredMappings) {
    const method = methodByCode.get(methodCode);
    const account = accountByCode.get(accountCode);
    if (!method || !account) continue;
    const [mapping] = await db
      .select({ id: paymentMethodAccounts.id })
      .from(paymentMethodAccounts)
      .where(
        and(
          eq(paymentMethodAccounts.paymentMethodId, method.id),
          eq(paymentMethodAccounts.receivingAccountId, account.id),
        ),
      )
      .limit(1);
    if (mapping) mappingCount++;
  }
  assert(mappingCount === requiredMappings.length, `required mappings exist: ${mappingCount}/${requiredMappings.length}`);

  const [coverage] = await db
    .select({
      missing: sql<number>`count(*)::int`,
    })
    .from(payments)
    .where(sql`
      ${payments.status} = 'completed'
      and not exists (
        select 1 from payment_rows pr
        where pr.payment_id = ${payments.id}
          and pr.status = 'completed'
      )
    `);
  assert(Number(coverage?.missing ?? 0) === 0, 'completed payments covered by payment rows', `${coverage?.missing ?? 0} missing`);

  const [legacyTotal] = await db
    .select({ total: sql<number>`coalesce(sum(${payments.total}::numeric), 0)` })
    .from(payments)
    .where(eq(payments.status, 'completed'));

  const [rowTotal] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)` })
    .from(paymentRows)
    .where(eq(paymentRows.status, 'completed'));

  const totalDiff = Number((Number(legacyTotal?.total ?? 0) - Number(rowTotal?.total ?? 0)).toFixed(2));
  assert(Math.abs(totalDiff) < 0.01, 'legacy payment totals equal completed payment_rows totals', `diff ${totalDiff.toFixed(2)}`);

  const [eventMismatch] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sql`
      (
        select p.id
        from payments p
        left join payment_rows pr
          on pr.payment_id = p.id
          and pr.status = 'completed'
        where p.status = 'completed'
        group by p.id, p.total
        having abs(coalesce(sum(pr.amount::numeric), 0) - p.total::numeric) > 0.01
      ) payment_event_row_mismatches
    `);
  assert(
    Number(eventMismatch?.count ?? 0) === 0,
    'each payment event total equals its completed payment_rows sum',
    `${eventMismatch?.count ?? 0} mismatches`,
  );

  const [cashInvalid] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentRows)
    .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
    .where(sql`
      ${paymentRows.status} = 'completed'
      and ${paymentMethods.type} = 'cash'
      and (
        ${paymentRows.amountTendered} is null
        or ${paymentRows.amountTendered}::numeric < ${paymentRows.amount}::numeric
        or ${paymentRows.changeAmount}::numeric < 0
      )
    `);
  assert(Number(cashInvalid?.count ?? 0) === 0, 'cash tender/change valid', `${cashInvalid?.count ?? 0} invalid`);

  const [welfareInvalid] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentRows)
    .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
    .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
    .where(sql`
      ${paymentRows.status} = 'completed'
      and ${paymentMethods.type} = 'welfare'
      and ${receivingAccounts.type} <> 'welfare'
    `);
  assert(Number(welfareInvalid?.count ?? 0) === 0, 'welfare rows map only to welfare accounts', `${welfareInvalid?.count ?? 0} invalid`);

  const [bankCashInvalid] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentRows)
    .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
    .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
    .where(sql`
      ${paymentRows.status} = 'completed'
      and ${paymentMethods.type} in ('cash', 'promptpay')
      and ${receivingAccounts.type} <> 'bank_cash_group'
    `);
  assert(Number(bankCashInvalid?.count ?? 0) === 0, 'cash/promptpay rows map only to bank_cash_group accounts', `${bankCashInvalid?.count ?? 0} invalid`);

  // True duplicates: same payment + same method + same account + same amount.
  // Phase 2B-3 creates legitimate multi-row payments (different methods or accounts),
  // so we cannot flag every payment with >1 row — only exact-copy rows.
  const [duplicateRows] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sql`
      (
        select payment_id, payment_method_id, receiving_account_id, amount::numeric, status
        from payment_rows
        group by payment_id, payment_method_id, receiving_account_id, amount::numeric, status
        having count(*) > 1
      ) exact_duplicate_payment_rows
    `);
  assert(Number(duplicateRows?.count ?? 0) === 0, 'no exact-duplicate ledger rows (same method+account+amount per payment)', `${duplicateRows?.count ?? 0} duplicates`);

  const activeMethods = await db
    .select({
      code: paymentMethods.code,
      accountCount: sql<number>`count(${paymentMethodAccounts.id})::int`,
    })
    .from(paymentMethods)
    .leftJoin(
      paymentMethodAccounts,
      and(
        eq(paymentMethodAccounts.paymentMethodId, paymentMethods.id),
        eq(paymentMethodAccounts.isActive, true),
      ),
    )
    .where(eq(paymentMethods.isActive, true))
    .groupBy(paymentMethods.id, paymentMethods.code);

  const zeroAccountMethods = activeMethods.filter((m) => Number(m.accountCount) === 0);
  assert(zeroAccountMethods.length === 0, 'active methods have active receiving accounts', zeroAccountMethods.map((m) => m.code).join(', '));

  const [missingSettlementMetadata] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payments)
    .where(sql`
      ${payments.status} = 'completed'
      and (
        ${payments.settlementType} is null
        or ${payments.billTotalAtPayment} is null
        or ${payments.paidBefore} is null
        or ${payments.remainingAfter} is null
      )
    `);
  assert(
    Number(missingSettlementMetadata?.count ?? 0) === 0,
    'completed payments have settlement metadata',
    `${missingSettlementMetadata?.count ?? 0} missing`,
  );

  const [overpaidSessions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sql`
      (
        with completed as (
          select
            session_id,
            sum(total::numeric) as paid_total,
            max(bill_total_at_payment::numeric) as bill_total
          from payments
          where status = 'completed'
          group by session_id
        )
        select c.session_id
        from completed c
        where c.paid_total - c.bill_total > 0.01
      ) overpaid_sessions
    `);
  assert(
    Number(overpaidSessions?.count ?? 0) === 0,
    'sum of completed payments per session does not exceed bill total at payment',
    `${overpaidSessions?.count ?? 0} overpaid`,
  );

  const [paidSessionsWithRemaining] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(sql`
      ${sessions.status} = 'paid'
      and exists (
        select 1
        from payments p
        where p.session_id = ${sessions.id}
          and p.status = 'completed'
        group by p.session_id
        having abs(max(p.bill_total_at_payment::numeric) - sum(p.total::numeric)) > 0.01
      )
    `);
  assert(
    Number(paidSessionsWithRemaining?.count ?? 0) === 0,
    'paid sessions have zero remaining balance',
    `${paidSessionsWithRemaining?.count ?? 0} inconsistent`,
  );

  // ─── Allocation integrity checks (Phase 8B-3) ────────────────────────────
  // Skipped gracefully when the migration has not yet been applied.
  let buffetTablesExist = false;
  try {
    await db.select({ n: sql<number>`1` }).from(buffetChargeLines).limit(0);
    buffetTablesExist = true;
  } catch {
    // table not yet migrated
  }

  if (!buffetTablesExist) {
    console.log('INFO buffet_charge_lines not yet migrated — skipping allocation checks (run db:migrate-phase8b1)');
  } else {
    const [allocQtyOverflow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sql`
        (
          select bcl.id
          from buffet_charge_lines bcl
          left join payment_allocations pa on pa.charge_line_id = bcl.id
          group by bcl.id, bcl.quantity
          having coalesce(sum(pa.quantity), 0) > bcl.quantity
        ) over_allocated_lines
      `);
    assert(
      Number(allocQtyOverflow?.count ?? 0) === 0,
      'no over-allocated buffet charge lines',
      `${allocQtyOverflow?.count ?? 0} over-allocated`,
    );

    const [allocAmountMismatch] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sql`
        (
          select p.id
          from payments p
          where p.status = 'completed'
            and exists (select 1 from payment_allocations pa where pa.payment_id = p.id)
            and abs(
              coalesce(
                (select sum(pa2.amount::numeric) from payment_allocations pa2 where pa2.payment_id = p.id),
                0
              ) - p.total::numeric
            ) > 0.01
        ) alloc_amount_mismatch_payments
      `);
    assert(
      Number(allocAmountMismatch?.count ?? 0) === 0,
      'allocation-aware payment totals match payment_allocations sum',
      `${allocAmountMismatch?.count ?? 0} mismatches`,
    );

    const [voidedLineAllocs] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentAllocations)
      .innerJoin(buffetChargeLines, eq(paymentAllocations.chargeLineId, buffetChargeLines.id))
      .where(sql`${buffetChargeLines.voidedAt} is not null`);
    const voidedAllocCount = Number(voidedLineAllocs?.count ?? 0);
    if (voidedAllocCount > 0) {
      console.log(`WARN ${voidedAllocCount} allocation(s) reference voided charge lines — review payment_allocations table`);
    } else {
      console.log(`OK no allocations on voided charge lines`);
    }
  }

  // Warning-only: post-close payment mutations (does not affect pass/fail count)
  const [postCloseMutations] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentAdjustments)
    .where(sql`
      ${paymentAdjustments.shiftId} is not null
      and exists (
        select 1 from cashier_shifts cs
        where cs.id = ${paymentAdjustments.shiftId}
          and cs.status in ('closed', 'reviewed')
          and cs.closed_at is not null
          and ${paymentAdjustments.createdAt} > cs.closed_at
      )
    `);
  const postCloseCount = Number(postCloseMutations?.count ?? 0);
  if (postCloseCount > 0) {
    console.log(`WARN post-close payment mutations: ${postCloseCount} adjustment(s) created after shift close — review payment_adjustments table`);
  } else {
    console.log(`OK no post-close payment mutations detected`);
  }

  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All checks passed.');
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
