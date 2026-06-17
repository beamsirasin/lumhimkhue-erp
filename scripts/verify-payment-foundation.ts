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

  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All checks passed.');
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
