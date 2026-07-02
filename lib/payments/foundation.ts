import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { checkoutRowTenderError } from '@/lib/payments/money-math';
import {
  paymentMethodAccounts,
  paymentMethods,
  paymentRows,
  payments,
  receivingAccounts,
  type Payment,
  type PaymentMethod,
  type ReceivingAccount,
} from '@/lib/db/schema';

export const DEFAULT_PAYMENT_METHODS = [
  {
    code: 'promptpay',
    name: 'QR PromptPay',
    type: 'promptpay' as const,
    requiresReference: false,
    allowOverpay: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    code: 'cash',
    name: 'เงินสด',
    type: 'cash' as const,
    requiresReference: false,
    allowOverpay: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    code: 'welfare',
    name: 'สวัสดิการรัฐ',
    type: 'welfare' as const,
    requiresReference: false,
    allowOverpay: false,
    isActive: true,
    sortOrder: 3,
  },
  {
    code: 'legacy_cash_qr',
    name: 'Legacy QR + Cash',
    type: 'mixed_legacy' as const,
    requiresReference: false,
    allowOverpay: false,
    isActive: false,
    sortOrder: 99,
  },
] as const;

export const DEFAULT_RECEIVING_ACCOUNTS = [
  {
    code: 'bank_cash_a',
    name: 'บัญชี A',
    type: 'bank_cash_group' as const,
    isActive: true,
    sortOrder: 1,
  },
  {
    code: 'bank_cash_b',
    name: 'บัญชี B',
    type: 'bank_cash_group' as const,
    isActive: true,
    sortOrder: 2,
  },
  {
    code: 'welfare_a',
    name: 'บัญชีสวัสดิการ A',
    type: 'welfare' as const,
    isActive: true,
    sortOrder: 3,
  },
  {
    code: 'welfare_b',
    name: 'บัญชีสวัสดิการ B',
    type: 'welfare' as const,
    isActive: true,
    sortOrder: 4,
  },
  {
    code: 'legacy_unknown',
    name: 'Legacy/Unknown Account',
    type: 'other' as const,
    isActive: false,
    sortOrder: 99,
  },
] as const;

const DEFAULT_MAPPINGS = [
  { methodCode: 'promptpay', accountCode: 'bank_cash_a', isDefault: true, isActive: true },
  { methodCode: 'promptpay', accountCode: 'bank_cash_b', isDefault: false, isActive: true },
  { methodCode: 'cash', accountCode: 'bank_cash_a', isDefault: true, isActive: true },
  { methodCode: 'cash', accountCode: 'bank_cash_b', isDefault: false, isActive: true },
  { methodCode: 'welfare', accountCode: 'welfare_a', isDefault: true, isActive: true },
  { methodCode: 'welfare', accountCode: 'welfare_b', isDefault: false, isActive: true },
  { methodCode: 'legacy_cash_qr', accountCode: 'legacy_unknown', isDefault: true, isActive: true },
] as const;

export type LegacyPaymentMethod = Payment['paymentMethod'];

let defaultFoundationPromise: Promise<void> | null = null;

type PaymentLike = Pick<
  Payment,
  | 'id'
  | 'sessionId'
  | 'total'
  | 'paymentMethod'
  | 'receivedAmount'
  | 'changeAmount'
  | 'paidAt'
  | 'processedBy'
  | 'shiftId'
  | 'notes'
  | 'status'
>;

function money(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function asMoney(value: string | number | null | undefined): string {
  return money(value).toFixed(2);
}

function accountCodeFromLegacyNote(note?: string | null): 'bank_cash_a' | 'bank_cash_b' {
  if (!note) return 'bank_cash_a';
  return /secondary|account\s*2|bank_cash_b/i.test(note) ? 'bank_cash_b' : 'bank_cash_a';
}

async function upsertDefaultPaymentFoundation() {
  for (const method of DEFAULT_PAYMENT_METHODS) {
    await db
      .insert(paymentMethods)
      .values(method)
      .onConflictDoUpdate({
        target: paymentMethods.code,
        set: { name: method.name },
      });
  }

  for (const account of DEFAULT_RECEIVING_ACCOUNTS) {
    await db
      .insert(receivingAccounts)
      .values(account)
      .onConflictDoUpdate({
        target: receivingAccounts.code,
        set: { name: account.name },
      });
  }

  const [methods, accounts] = await Promise.all([
    db.select().from(paymentMethods).where(inArray(paymentMethods.code, DEFAULT_PAYMENT_METHODS.map((m) => m.code))),
    db.select().from(receivingAccounts).where(inArray(receivingAccounts.code, DEFAULT_RECEIVING_ACCOUNTS.map((a) => a.code))),
  ]);
  const methodByCode = new Map(methods.map((m) => [m.code, m]));
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));

  for (const mapping of DEFAULT_MAPPINGS) {
    const method = methodByCode.get(mapping.methodCode);
    const account = accountByCode.get(mapping.accountCode);
    if (!method || !account) continue;
    await db
      .insert(paymentMethodAccounts)
      .values({
        paymentMethodId: method.id,
        receivingAccountId: account.id,
        isDefault: mapping.isDefault,
        isActive: mapping.isActive,
      })
      .onConflictDoNothing({
        target: [paymentMethodAccounts.paymentMethodId, paymentMethodAccounts.receivingAccountId],
      });
  }
}

export async function ensureDefaultPaymentFoundation() {
  defaultFoundationPromise ??= upsertDefaultPaymentFoundation();
  await defaultFoundationPromise;
}

export async function getActivePaymentMethodsWithAccounts() {
  await ensureDefaultPaymentFoundation();

  const methods = await db.query.paymentMethods.findMany({
    where: eq(paymentMethods.isActive, true),
    orderBy: [asc(paymentMethods.sortOrder), asc(paymentMethods.name)],
    with: {
      accounts: {
        where: eq(paymentMethodAccounts.isActive, true),
        with: { receivingAccount: true },
      },
    },
  });

  return methods.map((method) => {
    const accounts = method.accounts
      .map((mapping) => ({
        mappingId: mapping.id,
        isDefault: mapping.isDefault,
        account: mapping.receivingAccount,
      }))
      .filter((entry) => entry.account.isActive);
    return {
      ...method,
      accounts,
      defaultAccount: accounts.find((entry) => entry.isDefault)?.account ?? accounts[0]?.account ?? null,
    };
  });
}

export async function validatePaymentMethodAccount(
  paymentMethodId: string,
  receivingAccountId: string,
  options: { allowInactive?: boolean } = {},
) {
  const [mapping] = await db
    .select({
      method: paymentMethods,
      account: receivingAccounts,
      mapping: paymentMethodAccounts,
    })
    .from(paymentMethodAccounts)
    .innerJoin(paymentMethods, eq(paymentMethods.id, paymentMethodAccounts.paymentMethodId))
    .innerJoin(receivingAccounts, eq(receivingAccounts.id, paymentMethodAccounts.receivingAccountId))
    .where(
      and(
        eq(paymentMethodAccounts.paymentMethodId, paymentMethodId),
        eq(paymentMethodAccounts.receivingAccountId, receivingAccountId),
      ),
    )
    .limit(1);

  if (!mapping) return { ok: false as const, error: 'Payment method/account mapping not found' };
  if (!options.allowInactive) {
    if (!mapping.method.isActive) return { ok: false as const, error: 'Payment method is inactive' };
    if (!mapping.account.isActive) return { ok: false as const, error: 'Receiving account is inactive' };
    if (!mapping.mapping.isActive) return { ok: false as const, error: 'Payment method/account mapping is inactive' };
  }
  if (mapping.method.type === 'welfare' && mapping.account.type !== 'welfare') {
    return { ok: false as const, error: 'Welfare payments must use welfare receiving accounts' };
  }
  if ((mapping.method.type === 'cash' || mapping.method.type === 'promptpay') && mapping.account.type === 'welfare') {
    return { ok: false as const, error: 'Cash and PromptPay cannot use welfare receiving accounts' };
  }
  return { ok: true as const, data: mapping };
}

export type CheckoutPaymentRowDraft = {
  paymentMethodId: string;
  receivingAccountId: string;
  amount: number;
  amountTendered?: number | null;
  changeAmount?: number | null;
  referenceNo?: string | null;
  payerLabel?: string | null;
  note?: string | null;
};

export type ValidatedCheckoutPaymentRow = CheckoutPaymentRowDraft & {
  method: PaymentMethod;
  account: ReceivingAccount;
  amountCents: number;
  tenderedCents: number | null;
  changeCents: number;
};

function toCents(value: number) {
  return Math.round(value * 100);
}

function fromCents(value: number) {
  return (value / 100).toFixed(2);
}

function legacyMethodForRows(rows: ValidatedCheckoutPaymentRow[]): LegacyPaymentMethod {
  const types = new Set(rows.map((row) => row.method.type));
  if (types.size === 1) {
    if (types.has('cash')) return 'cash';
    if (types.has('promptpay')) return 'qr_promptpay';
    if (types.has('welfare')) return 'transfer';
  }
  if (types.has('cash') || types.has('promptpay') || types.has('welfare')) return 'cash_qr';
  return 'transfer';
}

function buildPaymentRowsNote(rows: ValidatedCheckoutPaymentRow[]) {
  return [
    'Payment rows:',
    ...rows.map((row, index) => {
      const payer = row.payerLabel ? ` / ${row.payerLabel}` : '';
      return `${index + 1}) ${row.method.name} / ${row.account.name} / ${fromCents(row.amountCents)}${payer}`;
    }),
  ].join('\n');
}

export async function validateCheckoutPaymentRowsForTotal(
  drafts: CheckoutPaymentRowDraft[],
  targetTotal: number,
) {
  await ensureDefaultPaymentFoundation();

  if (drafts.length === 0) {
    return { ok: false as const, error: 'Add at least one payment row' };
  }

  const totalCents = toCents(targetTotal);
  const rows: ValidatedCheckoutPaymentRow[] = [];

  for (const draft of drafts) {
    const amountCents = toCents(draft.amount);
    if (amountCents <= 0) return { ok: false as const, error: 'Payment row amount must be greater than zero' };

    const validation = await validatePaymentMethodAccount(draft.paymentMethodId, draft.receivingAccountId);
    if (!validation.ok) return validation;

    const { method, account } = validation.data;
    if (method.type === 'mixed_legacy') {
      return { ok: false as const, error: 'Legacy payment methods cannot be used for new checkout rows' };
    }
    if (method.requiresReference && !draft.referenceNo?.trim()) {
      return { ok: false as const, error: `${method.name} requires a reference number` };
    }

    const tenderedCents = draft.amountTendered == null ? null : toCents(draft.amountTendered);
    const changeCents = draft.changeAmount == null ? 0 : toCents(draft.changeAmount);

    // Phase 16D: cash/non-cash tender rules extracted to money-math (golden copy, tested)
    const tenderError = checkoutRowTenderError(method.type, amountCents, tenderedCents, changeCents);
    if (tenderError) return { ok: false as const, error: tenderError };

    rows.push({
      ...draft,
      method,
      account,
      amountCents,
      tenderedCents,
      changeCents,
    });
  }

  const paidCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  if (paidCents !== totalCents) {
    return { ok: false as const, error: 'Payment rows must equal the amount due exactly' };
  }

  const cashTenderedCents = rows.reduce(
    (sum, row) => sum + (row.method.type === 'cash' ? row.tenderedCents ?? row.amountCents : 0),
    0,
  );
  const changeCents = rows.reduce((sum, row) => sum + row.changeCents, 0);

  return {
    ok: true as const,
    data: {
      rows,
      legacyPaymentMethod: legacyMethodForRows(rows),
      receivedAmount: cashTenderedCents > 0 ? fromCents(cashTenderedCents) : fromCents(totalCents),
      changeAmount: fromCents(changeCents),
      notesSummary: buildPaymentRowsNote(rows),
    },
  };
}

export async function resolveLegacyPaymentMethodAccount(
  legacyPaymentMethod: LegacyPaymentMethod,
  maybeAccountNote?: string | null,
) {
  await ensureDefaultPaymentFoundation();

  const methodCode =
    legacyPaymentMethod === 'cash'
      ? 'cash'
      : legacyPaymentMethod === 'qr_promptpay' || legacyPaymentMethod === 'transfer' || legacyPaymentMethod === 'card'
        ? 'promptpay'
        : 'legacy_cash_qr';

  const accountCode =
    methodCode === 'legacy_cash_qr'
      ? 'legacy_unknown'
      : methodCode === 'cash' || methodCode === 'promptpay'
        ? accountCodeFromLegacyNote(maybeAccountNote)
        : 'legacy_unknown';

  const [method] = await db.select().from(paymentMethods).where(eq(paymentMethods.code, methodCode)).limit(1);
  const [account] = await db.select().from(receivingAccounts).where(eq(receivingAccounts.code, accountCode)).limit(1);

  if (!method || !account) {
    throw new Error(`Payment foundation defaults missing for ${methodCode}/${accountCode}`);
  }

  return { method, account };
}

export async function ensurePaymentRowsForLegacyPayment(payment: PaymentLike) {
  const existingRows = await db
    .select({ id: paymentRows.id })
    .from(paymentRows)
    .where(eq(paymentRows.paymentId, payment.id))
    .limit(1);

  if (existingRows.length > 0) {
    return { created: 0, skipped: 1, legacyFallback: 0 };
  }

  if (payment.status !== 'completed') {
    return { created: 0, skipped: 1, legacyFallback: 0 };
  }

  const { method, account } = await resolveLegacyPaymentMethodAccount(payment.paymentMethod, payment.notes);
  const total = money(payment.total);
  const isCash = method.type === 'cash';
  const isLegacyMixed = method.type === 'mixed_legacy';
  const amountTendered = isCash ? money(payment.receivedAmount) : null;
  const changeAmount = isCash ? money(payment.changeAmount) : 0;

  await db.insert(paymentRows).values({
    paymentId: payment.id,
    sessionId: payment.sessionId,
    paymentMethodId: method.id,
    receivingAccountId: account.id,
    amount: total.toFixed(2),
    amountTendered: amountTendered == null ? null : amountTendered.toFixed(2),
    changeAmount: changeAmount.toFixed(2),
    note: isLegacyMixed ? payment.notes ?? 'Backfilled from legacy cash_qr payment' : payment.notes ?? null,
    status: 'completed',
    cashierId: payment.processedBy,
    shiftId: payment.shiftId,
    paidAt: payment.paidAt,
  });

  return { created: 1, skipped: 0, legacyFallback: isLegacyMixed ? 1 : 0 };
}

export async function backfillMissingPaymentRows() {
  await ensureDefaultPaymentFoundation();

  const rows = await db
    .select({
      payment: payments,
      rowCount: sql<number>`count(${paymentRows.id})::int`,
    })
    .from(payments)
    .leftJoin(paymentRows, eq(paymentRows.paymentId, payments.id))
    .where(eq(payments.status, 'completed'))
    .groupBy(payments.id)
    .orderBy(asc(payments.paidAt));

  let created = 0;
  let skipped = 0;
  let legacyFallback = 0;
  let scanned = 0;
  let oldTotal = 0;

  for (const row of rows) {
    scanned++;
    oldTotal += money(row.payment.total);
    if (Number(row.rowCount) > 0) {
      skipped++;
      continue;
    }
    const result = await ensurePaymentRowsForLegacyPayment(row.payment);
    created += result.created;
    skipped += result.skipped;
    legacyFallback += result.legacyFallback;
  }

  const [newTotalRow] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)` })
    .from(paymentRows)
    .where(eq(paymentRows.status, 'completed'));

  return {
    scanned,
    created,
    skipped,
    legacyFallback,
    oldTotal,
    newTotal: Number(newTotalRow?.total ?? 0),
    difference: Number((oldTotal - Number(newTotalRow?.total ?? 0)).toFixed(2)),
  };
}

export async function getPaymentFoundationDefaults() {
  const [methods, accounts, mappings] = await Promise.all([
    db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.name)),
    db.select().from(receivingAccounts).orderBy(asc(receivingAccounts.sortOrder), asc(receivingAccounts.name)),
    db
      .select({
        method: paymentMethods,
        account: receivingAccounts,
        mapping: paymentMethodAccounts,
      })
      .from(paymentMethodAccounts)
      .innerJoin(paymentMethods, eq(paymentMethods.id, paymentMethodAccounts.paymentMethodId))
      .innerJoin(receivingAccounts, eq(receivingAccounts.id, paymentMethodAccounts.receivingAccountId)),
  ]);

  return { methods, accounts, mappings };
}

export function legacyPaymentUsesFallback(method: LegacyPaymentMethod) {
  return method === 'cash_qr';
}

export function toPaymentRowMoney(value: string | number | null | undefined) {
  return asMoney(value);
}
