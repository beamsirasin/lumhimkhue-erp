'use server';

import { and, eq, gte, lt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay, addDays } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { paymentRows, paymentMethods, receivingAccounts } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PaymentMethodSummary = {
  methodId: string;
  methodCode: string;
  methodName: string;
  methodType: string;
  amount: number;
  rowCount: number;
};

export type ReceivingAccountSummary = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  amount: number;
  rowCount: number;
};

export type PaymentAccountMatrixMethod = {
  methodId: string;
  methodCode: string;
  methodName: string;
  methodType: string;
  amount: number;
};

export type PaymentAccountMatrixRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  methods: PaymentAccountMatrixMethod[];
  total: number;
};

export type PaymentCollectionReport = {
  fromDate: string;
  toDate: string;
  totalCollected: number;
  cashTotal: number;
  promptpayTotal: number;
  welfareTotal: number;
  legacyTotal: number;
  methodSummary: PaymentMethodSummary[];
  accountSummary: ReceivingAccountSummary[];
  matrix: PaymentAccountMatrixRow[];
};

// ─── Action ──────────────────────────────────────────────────────────────────

export async function getPaymentCollectionReport(fromDate: string, toDate: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    // Bangkok-aware half-open day range: [start of fromDate, start of day after toDate)
    const from        = fromZonedTime(startOfDay(toZonedTime(new Date(fromDate), TZ)), TZ);
    const toExclusive = fromZonedTime(addDays(startOfDay(toZonedTime(new Date(toDate), TZ)), 1), TZ);

    const dateAndStatus = and(
      eq(paymentRows.status, 'completed'),
      gte(paymentRows.paidAt, from),
      lt(paymentRows.paidAt, toExclusive),
    );

    // ── Query 1: method summary ──────────────────────────────────────────────
    const methodRows = await db
      .select({
        methodId:   paymentMethods.id,
        methodCode: paymentMethods.code,
        methodName: paymentMethods.name,
        methodType: paymentMethods.type,
        amount:     sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)`,
        rowCount:   sql<number>`count(*)::int`,
      })
      .from(paymentRows)
      .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
      .where(dateAndStatus)
      .groupBy(
        paymentMethods.id,
        paymentMethods.code,
        paymentMethods.name,
        paymentMethods.type,
      )
      .orderBy(paymentMethods.sortOrder, paymentMethods.name);

    // ── Query 2: account summary ─────────────────────────────────────────────
    const accountRows = await db
      .select({
        accountId:   receivingAccounts.id,
        accountCode: receivingAccounts.code,
        accountName: receivingAccounts.name,
        accountType: receivingAccounts.type,
        amount:      sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)`,
        rowCount:    sql<number>`count(*)::int`,
      })
      .from(paymentRows)
      .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
      .where(dateAndStatus)
      .groupBy(
        receivingAccounts.id,
        receivingAccounts.code,
        receivingAccounts.name,
        receivingAccounts.type,
      )
      .orderBy(receivingAccounts.sortOrder, receivingAccounts.name);

    // ── Query 3: account × method matrix raw rows ────────────────────────────
    const matrixRaw = await db
      .select({
        accountId:   receivingAccounts.id,
        accountCode: receivingAccounts.code,
        accountName: receivingAccounts.name,
        accountType: receivingAccounts.type,
        methodId:    paymentMethods.id,
        methodCode:  paymentMethods.code,
        methodName:  paymentMethods.name,
        methodType:  paymentMethods.type,
        amount:      sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)`,
      })
      .from(paymentRows)
      .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
      .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
      .where(dateAndStatus)
      .groupBy(
        receivingAccounts.id,
        receivingAccounts.code,
        receivingAccounts.name,
        receivingAccounts.type,
        paymentMethods.id,
        paymentMethods.code,
        paymentMethods.name,
        paymentMethods.type,
      )
      .orderBy(
        receivingAccounts.sortOrder,
        receivingAccounts.name,
        paymentMethods.sortOrder,
        paymentMethods.name,
      );

    // ── Assemble method summary ──────────────────────────────────────────────
    const methodSummary: PaymentMethodSummary[] = methodRows.map((r) => ({
      methodId:   r.methodId,
      methodCode: r.methodCode,
      methodName: r.methodName,
      methodType: r.methodType,
      amount:     roundMoney(Number(r.amount)),
      rowCount:   r.rowCount,
    }));

    // ── Assemble account summary ─────────────────────────────────────────────
    const accountSummary: ReceivingAccountSummary[] = accountRows.map((r) => ({
      accountId:   r.accountId,
      accountCode: r.accountCode,
      accountName: r.accountName,
      accountType: r.accountType,
      amount:      roundMoney(Number(r.amount)),
      rowCount:    r.rowCount,
    }));

    // ── Build matrix in JS: group raw rows by account, nest methods ──────────
    const matrixMap = new Map<string, PaymentAccountMatrixRow>();
    for (const r of matrixRaw) {
      if (!matrixMap.has(r.accountId)) {
        matrixMap.set(r.accountId, {
          accountId:   r.accountId,
          accountCode: r.accountCode,
          accountName: r.accountName,
          accountType: r.accountType,
          methods: [],
          total:   0,
        });
      }
      const entry = matrixMap.get(r.accountId)!;
      const methodAmount = roundMoney(Number(r.amount));
      entry.methods.push({
        methodId:   r.methodId,
        methodCode: r.methodCode,
        methodName: r.methodName,
        methodType: r.methodType,
        amount:     methodAmount,
      });
      entry.total = roundMoney(entry.total + methodAmount);
    }
    const matrix = Array.from(matrixMap.values());

    // ── Compute collection totals from method summary ────────────────────────
    const totalCollected  = roundMoney(methodSummary.reduce((s, m) => s + m.amount, 0));
    const cashTotal       = roundMoney(methodSummary.filter((m) => m.methodType === 'cash').reduce((s, m) => s + m.amount, 0));
    const promptpayTotal  = roundMoney(methodSummary.filter((m) => m.methodType === 'promptpay').reduce((s, m) => s + m.amount, 0));
    const welfareTotal    = roundMoney(methodSummary.filter((m) => m.methodType === 'welfare').reduce((s, m) => s + m.amount, 0));
    const legacyTotal     = roundMoney(methodSummary.filter((m) => m.methodType === 'mixed_legacy').reduce((s, m) => s + m.amount, 0));

    return {
      ok: true as const,
      data: {
        fromDate,
        toDate,
        totalCollected,
        cashTotal,
        promptpayTotal,
        welfareTotal,
        legacyTotal,
        methodSummary,
        accountSummary,
        matrix,
      } satisfies PaymentCollectionReport,
    };
  } catch (e) {
    console.error('[getPaymentCollectionReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type PaymentCollectionReportResult = NonNullable<
  Extract<Awaited<ReturnType<typeof getPaymentCollectionReport>>, { ok: true }>['data']
>;
