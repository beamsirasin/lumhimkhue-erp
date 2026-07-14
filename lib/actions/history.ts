'use server';

import { eq, and, gte, not, lte, desc, asc, inArray, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { writeAuditLog } from '@/lib/actions/audit';
import { consumeManagerApprovalCode } from '@/lib/actions/manager-approval';
import { db } from '@/lib/db';
import {
  sessions,
  tables,
  payments,
  paymentRows,
  paymentLineItems,
  paymentAdjustments,
  orders,
  auditLogs,
  cashierShifts,
  users,
  buffetChargeLines,
  paymentAllocations,
  paymentMethods,
  receivingAccounts,
  storeSettings,
} from '@/lib/db/schema';
import type { ReceiptData } from '@/lib/printer/types';
import { resolveBillConfig } from '@/lib/utils/billConfig';
import type { BillTypeKey } from '@/lib/utils/billConfig';

const TZ = 'Asia/Bangkok';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  cash_qr: 'เงินสด + QR',
  qr_promptpay: 'QR PromptPay',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต',
};

function dayRange(dateStr: string): { from: Date; to: Date } {
  const from = fromZonedTime(startOfDay(toZonedTime(new Date(dateStr), TZ)), TZ);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export async function getSessionHistory(dateStr: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports') && !can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const { from, to } = dayRange(dateStr);

    const rows = await db
      .select({
        sessionId: sessions.id,
        sessionToken: sessions.sessionToken,
        parentSessionId: sessions.parentSessionId,
        tableLabel: tables.label,
        zone: tables.zone,
        startedAt: sessions.startedAt,
        closedAt: sessions.closedAt,
        status: sessions.status,
        notes: sessions.notes,
        totalRevenue: sql<number>`(
          SELECT coalesce(sum(p.total::numeric), 0)
          FROM payments p
          WHERE p.session_id = ${sessions.id} AND p.status = 'completed'
        )`,
        receivedAmount: sql<number>`(
          SELECT coalesce(sum(p.received_amount::numeric), 0)
          FROM payments p
          WHERE p.session_id = ${sessions.id} AND p.status = 'completed'
        )`,
        paymentMethod: sql<string | null>`(
          SELECT p.payment_method::text
          FROM payments p
          WHERE p.session_id = ${sessions.id} AND p.status = 'completed'
          ORDER BY p.paid_at DESC
          LIMIT 1
        )`,
        receiptNo: sql<string | null>`(
          SELECT p.receipt_no
          FROM payments p
          WHERE p.session_id = ${sessions.id} AND p.status = 'completed'
          ORDER BY p.paid_at DESC
          LIMIT 1
        )`,
        billTotal: sql<number>`(
          SELECT coalesce(p.bill_total_at_payment::numeric, 0)
          FROM payments p
          WHERE p.session_id = ${sessions.id} AND p.status = 'completed'
          ORDER BY p.paid_at DESC
          LIMIT 1
        )`,
        remaining: sql<number>`(
          SELECT coalesce(p.remaining_after::numeric, 0)
          FROM payments p
          WHERE p.session_id = ${sessions.id} AND p.status = 'completed'
          ORDER BY p.paid_at DESC
          LIMIT 1
        )`,
        guestCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          WHERE sg.session_id = ${sessions.id}
        )`,
        adultCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'adult'
        )`,
        childCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'child'
        )`,
        toddlerCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'toddler'
        )`,
        staffCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'staff'
        )`,
        staffGuestCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'staff_guest_first'
        )`,
      })
      .from(sessions)
      .innerJoin(tables, eq(sessions.tableId, tables.id))
      .where(
        and(
          gte(sessions.startedAt, from),
          not(gte(sessions.startedAt, to)),
        ),
      )
      .orderBy(desc(sessions.startedAt));

    const sessionIds = rows.map((r) => r.sessionId);
    const eventPayments = sessionIds.length > 0
      ? await db.query.payments.findMany({
          where: and(inArray(payments.sessionId, sessionIds), eq(payments.status, 'completed')),
          orderBy: [asc(payments.paidAt)],
        })
      : [];
    const paymentEventsBySession = new Map<string, Array<{
      id: string;
      settlementType: 'partial' | 'final';
      total: number;
      paidBefore: number;
      remainingAfter: number;
      paidAt: Date;
      methodSummary: string;
    }>>();
    for (const payment of eventPayments) {
      const list = paymentEventsBySession.get(payment.sessionId) ?? [];
      list.push({
        id: payment.id,
        settlementType: payment.settlementType,
        total: Number(payment.total),
        paidBefore: Number(payment.paidBefore),
        remainingAfter: Number(payment.remainingAfter),
        paidAt: payment.paidAt,
        methodSummary: payment.paymentMethod,
      });
      paymentEventsBySession.set(payment.sessionId, list);
    }

    return {
      ok: true as const,
      data: rows.map((r) => ({
        sessionId: r.sessionId,
        sessionToken: r.sessionToken,
        parentSessionId: r.parentSessionId,
        tableLabel: r.tableLabel,
        zone: r.zone,
        startedAt: r.startedAt,
        closedAt: r.closedAt,
        status: r.status,
        notes: r.notes,
        totalRevenue: Number(r.totalRevenue),
        receivedAmount: Number(r.receivedAmount),
        paymentMethod: r.paymentMethod,
        receiptNo: r.receiptNo,
        billTotal: Number(r.billTotal),
        paidTotal: Number(r.totalRevenue),
        remaining: Number(r.remaining),
        paymentEvents: paymentEventsBySession.get(r.sessionId) ?? [],
        guestCount: Number(r.guestCount),
        adultCount: Number(r.adultCount),
        childCount: Number(r.childCount),
        toddlerCount: Number(r.toddlerCount),
        staffCount: Number(r.staffCount),
        staffGuestCount: Number(r.staffGuestCount),
      })),
    };
  } catch (e) {
    console.error('[getSessionHistory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SessionHistoryRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionHistory>>, { ok: true }>['data']
>[number];

export async function getSessionDetail(sessionId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports') && !can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: {
        table: true,
        guests: { with: { pricingTile: true } },
      },
    });
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    const sessionOrders = await db.query.orders.findMany({
      where: eq(orders.sessionId, sessionId),
      orderBy: [asc(orders.createdAt)],
      with: {
        items: {
          with: { menuItem: true },
        },
      },
    });

    const eventPayments = await db.query.payments.findMany({
      where: eq(payments.sessionId, sessionId),
      orderBy: [asc(payments.paidAt)],
      with: {
        rows: {
          with: {
            paymentMethod: true,
            receivingAccount: true,
          },
        },
      },
    });
    const shiftIds = [...new Set(eventPayments.map((payment) => payment.shiftId).filter((id): id is string => id !== null))];
    const shiftRows = shiftIds.length > 0
      ? await db
          .select({ id: cashierShifts.id, status: cashierShifts.status, closedAt: cashierShifts.closedAt })
          .from(cashierShifts)
          .where(inArray(cashierShifts.id, shiftIds))
      : [];
    const shiftById = new Map(shiftRows.map((shift) => [shift.id, shift]));
    const eventPaymentsWithShift = eventPayments.map((payment) => ({
      ...payment,
      shift: payment.shiftId ? (shiftById.get(payment.shiftId) ?? null) : null,
    }));
    const legacyPayment = eventPaymentsWithShift[eventPaymentsWithShift.length - 1] ?? null;
    const paidTotal = eventPayments
      .filter((payment) => payment.status === 'completed')
      .reduce((sum, payment) => sum + Number(payment.total), 0);
    const computedBillTotal = session.guests.reduce(
      (sum, g) => sum + Number(g.pricingTile.price) * g.quantity,
      0,
    ) + sessionOrders
      .flatMap((o) => o.items)
      .filter((i) => i.status !== 'cancelled' && !i.menuItem?.isBuffet)
      .reduce((sum, i) => sum + Number(i.menuItem?.extraPrice ?? 0) * i.quantity, 0);
    const billTotal = legacyPayment ? Number(legacyPayment.billTotalAtPayment) : computedBillTotal;
    const remaining = Math.max(0, Math.round((billTotal - paidTotal) * 100) / 100);

    const paymentShiftRow = legacyPayment?.shift ?? null;
    return {
      ok: true as const,
      data: {
        session: {
          ...session,
          payment: legacyPayment,
          payments: eventPaymentsWithShift,
        },
        orders: sessionOrders,
        paymentShift: paymentShiftRow,
        billTotal,
        paidTotal,
        remaining,
        payments: eventPaymentsWithShift.map((payment) => ({
          ...payment,
          paymentRows: payment.rows,
        })),
      },
    };
  } catch (e) {
    console.error('[getSessionDetail]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SessionDetailData = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionDetail>>, { ok: true }>['data']
>;

function receiptDate(value: Date | string | null | undefined) {
  if (!value) return '';
  return new Date(value).toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: TZ,
  });
}

async function getReceiptShopInfo(kind: BillTypeKey = 'main') {
  const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.id, 1)).limit(1);
  const cfg = settings ? resolveBillConfig(settings, kind) : null;
  const hidden = new Set(cfg?.hiddenFields ?? []);
  return {
    hidden,
    paperWidth: (settings?.billPaperWidth as 58 | 80 | undefined) ?? 80,
    logoUrl: cfg?.logoUrl,
    logoHeight: cfg?.logoHeight,
    shopNameTh: cfg?.shopNameTh ?? settings?.shopNameTh ?? 'ร้านชาบู',
    shopNameEn: cfg?.shopNameEn,
    companyName: cfg?.companyName,
    shopAddress: cfg?.address,
    phone: cfg?.phone,
    taxId: cfg?.taxId,
    branch: cfg?.branch,
    registerNo: cfg?.registerNo,
    footerNote: cfg?.footerNote,
    vatPercent: cfg?.vatPercent ?? settings?.vatPercent ?? 7,
    billTypeLabel: cfg?.billTypeLabel ?? 'receipt_short',
  };
}

type ReceiptPaymentRow = NonNullable<ReceiptData['paymentRows']>[number];
type ReceiptAllocation = NonNullable<ReceiptData['allocations']>[number];

async function getReceiptPaymentRows(paymentIds: string[]) {
  if (paymentIds.length === 0) return new Map<string, ReceiptPaymentRow[]>();
  const rows = await db
    .select({
      paymentId: paymentRows.paymentId,
      label: paymentMethods.name,
      accountName: receivingAccounts.name,
      amount: paymentRows.amount,
      amountTendered: paymentRows.amountTendered,
      changeAmount: paymentRows.changeAmount,
      payerLabel: paymentRows.payerLabel,
    })
    .from(paymentRows)
    .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
    .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
    .where(and(inArray(paymentRows.paymentId, paymentIds), eq(paymentRows.status, 'completed')));

  const map = new Map<string, ReceiptPaymentRow[]>();
  for (const row of rows) {
    const list = map.get(row.paymentId) ?? [];
    list.push({
      label: row.label,
      accountName: row.accountName,
      amount: Number(row.amount),
      amountTendered: row.amountTendered == null ? null : Number(row.amountTendered),
      changeAmount: row.changeAmount == null ? null : Number(row.changeAmount),
      payerLabel: row.payerLabel,
    });
    map.set(row.paymentId, list);
  }
  return map;
}

async function getReceiptAllocations(paymentIds: string[]) {
  if (paymentIds.length === 0) return new Map<string, ReceiptAllocation[]>();
  const rows = await db
    .select({
      paymentId: paymentAllocations.paymentId,
      chargeLineId: paymentAllocations.chargeLineId,
      chargeType: buffetChargeLines.chargeType,
      label: buffetChargeLines.label,
      quantity: paymentAllocations.quantity,
      unitPrice: buffetChargeLines.unitPrice,
      amount: paymentAllocations.amount,
    })
    .from(paymentAllocations)
    .innerJoin(buffetChargeLines, eq(paymentAllocations.chargeLineId, buffetChargeLines.id))
    .where(inArray(paymentAllocations.paymentId, paymentIds));

  const map = new Map<string, ReceiptAllocation[]>();
  for (const row of rows) {
    const list = map.get(row.paymentId) ?? [];
    list.push({
      chargeLineId: row.chargeLineId,
      chargeType: row.chargeType,
      label: row.label,
      quantity: row.quantity,
      unitPrice: Number(row.unitPrice),
      total: Number(row.amount),
    });
    map.set(row.paymentId, list);
  }
  return map;
}

function paymentMethodLabel(method: string) {
  return METHOD_LABEL[method] ?? method;
}

export async function getPaymentReceiptData(paymentId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports') && !can(authSession.user.role, 'manage_tables') && !can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const payment = await db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
      with: {
        session: { with: { table: true } },
        processedByUser: true,
      },
    });
    if (!payment || payment.status !== 'completed') return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };

    const allPayments = await db.query.payments.findMany({
      where: and(eq(payments.sessionId, payment.sessionId), eq(payments.status, 'completed')),
      orderBy: [asc(payments.paidAt), asc(payments.id)],
    });
    const paymentEventNumber = Math.max(1, allPayments.findIndex((item) => item.id === payment.id) + 1);
    const [rowsByPayment, allocationsByPayment, primaryAccountRow] = await Promise.all([
      getReceiptPaymentRows([payment.id]),
      getReceiptAllocations([payment.id]),
      db.select({ code: receivingAccounts.code })
        .from(paymentRows)
        .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
        .where(and(eq(paymentRows.paymentId, payment.id), eq(paymentRows.status, 'completed')))
        .orderBy(asc(paymentRows.id))
        .limit(1),
    ]);
    const paymentRowsForReceipt = rowsByPayment.get(payment.id) ?? [];
    const allocations = allocationsByPayment.get(payment.id) ?? [];
    const isTaxInvoice = typeof payment.notes === 'string' && payment.notes.includes('[ใบกำกับภาษี:');
    const primaryCode = primaryAccountRow[0]?.code;
    const billType: BillTypeKey = isTaxInvoice ? 'taxInvoice' : primaryCode ? `account:${primaryCode}` : 'main';
    const shop = await getReceiptShopInfo(billType);
    const hidden = shop.hidden;
    const paidThisTime = Number(payment.total);
    const paidBefore = Number(payment.paidBefore);
    const remainingAfter = Number(payment.remainingAfter);
    const billTotal = Number(payment.billTotalAtPayment);
    const receiptData: ReceiptData = {
      receiptType: 'receipt',
      receiptKind: 'payment_event',
      billTypeLabel: shop.billTypeLabel,
      logoUrl: shop.logoUrl,
      logoHeight: shop.logoHeight,
      paperWidth: shop.paperWidth,
      shopNameTh: shop.shopNameTh,
      shopNameEn: shop.shopNameEn,
      companyName: shop.companyName,
      shopAddress: shop.shopAddress,
      phone: shop.phone,
      taxId: shop.taxId,
      branch: shop.branch,
      registerNo: shop.registerNo,
      footerNote: shop.footerNote,
      vatPercent: shop.vatPercent,
      receiptNo: hidden.has('receiptNo') ? undefined : payment.receiptNo ?? undefined,
      paymentId: payment.id,
      paymentEventNumber,
      tableNumber: hidden.has('tableNo') ? '' : payment.session.table.label,
      cashierName: hidden.has('cashier') ? '' : payment.processedByUser?.name ?? '',
      paidAt: hidden.has('date') ? '' : receiptDate(payment.paidAt),
      sessionId: payment.sessionId,
      items: allocations.length > 0
        ? allocations.map((allocation) => ({
            name: allocation.label,
            quantity: allocation.quantity,
            total: allocation.total,
          }))
        : [{ name: 'รายการชำระแบบไม่ได้ระบุหัว', quantity: 1, total: paidThisTime }],
      subtotal: allocations.length > 0
        ? allocations.reduce((sum, allocation) => sum + allocation.total, 0)
        : paidThisTime,
      discount: 0,
      serviceCharge: 0,
      total: paidThisTime,
      settlementType: payment.settlementType,
      billTotal,
      paidBefore,
      paidThisTime,
      paidTotal: paidBefore + paidThisTime,
      remainingAfter,
      receivedAmount: paymentRowsForReceipt.length > 0
        ? paymentRowsForReceipt.reduce((sum, row) => sum + (row.amountTendered ?? row.amount), 0)
        : Number(payment.receivedAmount),
      changeAmount: Number(payment.changeAmount),
      paymentMethod: paymentRowsForReceipt.length > 0
        ? paymentRowsForReceipt.map((row) => row.label).join(' + ')
        : paymentMethodLabel(payment.paymentMethod),
      paymentRows: paymentRowsForReceipt,
      allocations,
      allocationFallbackNote: allocations.length === 0 ? 'รายการชำระแบบไม่ได้ระบุหัว' : undefined,
    };

    void writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'receipt_reprinted',
      entity: 'payments',
      entityId: payment.id,
      after: { sessionId: payment.sessionId, paymentId: payment.id, receiptKind: 'payment_event', printedAt: new Date().toISOString() },
    });

    return { ok: true as const, data: receiptData };
  } catch (e) {
    console.error('[getPaymentReceiptData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getFullBillReceiptData(sessionId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports') && !can(authSession.user.role, 'manage_tables') && !can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { table: true },
    });
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    const [chargeLines, completedPayments] = await Promise.all([
      db.select().from(buffetChargeLines).where(and(eq(buffetChargeLines.sessionId, sessionId), isNull(buffetChargeLines.voidedAt))),
      db.query.payments.findMany({
        where: and(eq(payments.sessionId, sessionId), eq(payments.status, 'completed')),
        orderBy: [asc(payments.paidAt), asc(payments.id)],
        with: { processedByUser: true },
      }),
    ]);
    const paymentIds = completedPayments.map((payment) => payment.id);
    const [rowsByPayment, allocationsByPayment] = await Promise.all([
      getReceiptPaymentRows(paymentIds),
      getReceiptAllocations(paymentIds),
    ]);
    const latestPayment = completedPayments.at(-1);
    const isTaxInvoiceFullBill = typeof latestPayment?.notes === 'string' && latestPayment.notes.includes('[ใบกำกับภาษี:');
    let fullBillType: BillTypeKey = 'main';
    if (isTaxInvoiceFullBill) {
      fullBillType = 'taxInvoice';
    } else if (latestPayment) {
      const primaryAccountRow = await db
        .select({ code: receivingAccounts.code })
        .from(paymentRows)
        .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
        .where(and(eq(paymentRows.paymentId, latestPayment.id), eq(paymentRows.status, 'completed')))
        .orderBy(asc(paymentRows.id))
        .limit(1);
      const primaryCode = primaryAccountRow[0]?.code;
      if (primaryCode) fullBillType = `account:${primaryCode}`;
    }
    const shop = await getReceiptShopInfo(fullBillType);
    const hidden = shop.hidden;
    const billTotal = latestPayment
      ? Number(latestPayment.billTotalAtPayment)
      : chargeLines.reduce((sum, line) => sum + Number(line.total), 0);
    const paidTotal = completedPayments.reduce((sum, payment) => sum + Number(payment.total), 0);
    const remaining = latestPayment ? Number(latestPayment.remainingAfter) : Math.max(0, billTotal - paidTotal);
    const fullItems = chargeLines.map((line) => ({
      name: line.label,
      quantity: line.quantity,
      total: Number(line.total),
    }));
    const paymentEvents = completedPayments.map((payment, index) => {
      const allocations = allocationsByPayment.get(payment.id) ?? [];
      return {
        paymentId: payment.id,
        paymentEventNumber: index + 1,
        settlementType: payment.settlementType,
        paidAt: payment.paidAt,
        total: Number(payment.total),
        paymentRows: (rowsByPayment.get(payment.id) ?? []).map((row) => ({
          methodName: row.label,
          accountName: row.accountName,
          amount: row.amount,
        })),
        allocations: allocations.map((allocation) => ({
          label: allocation.label,
          quantity: allocation.quantity,
          unitPrice: allocation.unitPrice,
          total: allocation.total,
        })),
      };
    });
    const hasUnallocatedPayments = completedPayments.some((payment) => (allocationsByPayment.get(payment.id) ?? []).length === 0);
    const receiptData: ReceiptData = {
      receiptType: 'receipt',
      receiptKind: 'full_bill',
      billTypeLabel: shop.billTypeLabel,
      logoUrl: shop.logoUrl,
      logoHeight: shop.logoHeight,
      paperWidth: shop.paperWidth,
      shopNameTh: shop.shopNameTh,
      shopNameEn: shop.shopNameEn,
      companyName: shop.companyName,
      shopAddress: shop.shopAddress,
      phone: shop.phone,
      taxId: shop.taxId,
      branch: shop.branch,
      registerNo: shop.registerNo,
      footerNote: shop.footerNote,
      vatPercent: shop.vatPercent,
      receiptNo: hidden.has('receiptNo') ? undefined : latestPayment?.receiptNo ?? undefined,
      tableNumber: hidden.has('tableNo') ? '' : session.table.label,
      cashierName: hidden.has('cashier') ? '' : completedPayments.at(-1)?.processedByUser?.name ?? '',
      paidAt: hidden.has('date') ? '' : receiptDate(latestPayment?.paidAt ?? new Date()),
      sessionId,
      items: fullItems,
      subtotal: fullItems.reduce((sum, item) => sum + item.total, 0),
      discount: 0,
      serviceCharge: 0,
      total: billTotal,
      settlementType: latestPayment?.settlementType ?? 'final',
      billTotal,
      paidBefore: Math.max(0, paidTotal - Number(latestPayment?.total ?? 0)),
      paidThisTime: Number(latestPayment?.total ?? 0),
      paidTotal,
      remainingAfter: remaining,
      receivedAmount: paidTotal,
      changeAmount: 0,
      paymentMethod: paymentEvents.flatMap((event) => event.paymentRows.map((row) => row.methodName ?? '')).filter(Boolean).join(' + '),
      paymentEvents,
      fullBillSummary: {
        billTotal,
        paidTotal,
        remaining,
        totalHeads: chargeLines.reduce((sum, line) => sum + line.quantity, 0),
        hasUnallocatedPayments,
      },
      allocationFallbackNote: hasUnallocatedPayments ? 'มีการชำระบางรายการที่ไม่ได้ระบุหัว' : undefined,
    };

    void writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'full_bill_receipt_printed',
      entity: 'sessions',
      entityId: sessionId,
      after: { sessionId, receiptKind: 'full_bill', printedAt: new Date().toISOString() },
    });

    return { ok: true as const, data: receiptData };
  } catch (e) {
    console.error('[getFullBillReceiptData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getHistoryCalendarDates(year: number, month: number) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  try {
    const from = fromZonedTime(
      startOfDay(toZonedTime(new Date(year, month - 1, 1), TZ)),
      TZ,
    );
    const to = fromZonedTime(
      startOfDay(toZonedTime(new Date(year, month, 1), TZ)),
      TZ,
    );

    const rows = await db
      .select({
        date: sql<string>`(${sessions.startedAt} AT TIME ZONE 'Asia/Bangkok')::date`,
        count: sql<number>`count(*)`,
      })
      .from(sessions)
      .where(and(gte(sessions.startedAt, from), not(gte(sessions.startedAt, to))))
      .groupBy(sql`(${sessions.startedAt} AT TIME ZONE 'Asia/Bangkok')::date`);

    return {
      ok: true as const,
      data: Object.fromEntries(rows.map((r) => [r.date, Number(r.count)])),
    };
  } catch (e) {
    console.error('[getHistoryCalendarDates]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── deletePaymentRecord — ลบประวัติอย่างเดียว (ไม่เปิดโต๊ะใหม่) ──── */
//
// Phase 1 Step 4 (Approach C): INSERT payment_adjustments (immutable audit trail)
// inside same transaction before hard DELETE. If insert fails → rollback → payment kept.

export async function deletePaymentRecord(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  // Restricted to owner via payment:delete — cashier/manager ทำไม่ได้
  if (!can(authSession.user.role, 'payment:delete'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น owner เท่านั้น' };

  const parsed = z
    .object({
      paymentId: z.string().uuid(),
      reason: z.string().max(500).optional(),
      // Phase 17POS-AUTH-A3 — approval code is a second approval step, not a
      // permission grant. payment:delete is already owner-only above.
      approvalCode: z.string().trim().max(20).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { paymentId, reason, approvalCode } = parsed.data;

  // Fetch full payment for snapshot outside tx — early return gives clean error message
  const [payment] = await db
    .select({
      id: payments.id,
      sessionId: payments.sessionId,
      subtotal: payments.subtotal,
      serviceCharge: payments.serviceCharge,
      discount: payments.discount,
      total: payments.total,
      paymentMethod: payments.paymentMethod,
      receivedAmount: payments.receivedAmount,
      changeAmount: payments.changeAmount,
      paidAt: payments.paidAt,
      processedBy: payments.processedBy,
      receiptNo: payments.receiptNo,
      notes: payments.notes,
      shiftId: payments.shiftId,
      status: payments.status,
      settlementType: payments.settlementType,
      billTotalAtPayment: payments.billTotalAtPayment,
      paidBefore: payments.paidBefore,
      remainingAfter: payments.remainingAfter,
    })
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };

  const normalizedReason = (reason ?? '').trim();

  const shift = payment.shiftId
    ? await db
        .select({ status: cashierShifts.status, closedAt: cashierShifts.closedAt })
        .from(cashierShifts)
        .where(eq(cashierShifts.id, payment.shiftId))
        .then((rows) => rows[0] ?? null)
    : null;
  const shiftStatusAtMutation: string | null = shift?.status ?? null;

  const [mainSessionForDelete] = await db
    .select({ id: sessions.id, tableId: sessions.tableId })
    .from(sessions)
    .where(eq(sessions.id, payment.sessionId));
  if (!mainSessionForDelete) return { ok: false as const, error: 'à¹„à¸¡à¹ˆà¸žà¸š session' };

  if (shift?.status === 'reviewed') {
    return { ok: false as const, error: 'ไม่สามารถแก้ไขการชำระเงินในรอบที่ตรวจสอบแล้ว' };
  }

  // ─── Phase 17POS-AUTH-A3: manager approval gate ──────────────────────────
  // deletePaymentRecord is owner-only (payment:delete, checked above) and is
  // always a destructive hard-delete of a completed payment — unlike the
  // saved-guest-edit gate (A2B), there is no "unsaved/no-op" case here, so
  // the code + reason are unconditionally required once permission passes.
  // This replaces the old "reason required only if shift closed" rule with a
  // strictly stronger one (reason always required), so no Phase 16C
  // hardening around closed/reviewed shifts is weakened.
  // Self-approval (owner may use its own code) is enforced inside
  // consumeManagerApprovalCode via isSelfApprovalAllowed — unchanged from A2C.
  if (!approvalCode) {
    return {
      ok: false as const,
      error: 'ต้องใช้รหัสอนุมัติสำหรับการลบบิล/รายการชำระเงิน',
      requiresApproval: true as const,
    };
  }
  if (!normalizedReason) {
    return {
      ok: false as const,
      error: 'ต้องระบุเหตุผลสำหรับการลบรายการชำระเงิน',
      requiresApproval: true as const,
    };
  }
  const approval = await consumeManagerApprovalCode({
    code: approvalCode,
    action: 'pos_payment_delete',
    entityType: 'payment',
    entityId: paymentId,
    requestedByUserId: authSession.user.id,
    requestedByRole: authSession.user.role,
    requestedByBranchId: authSession.user.branchId ?? null,
    reason: normalizedReason,
  });
  if (!approval.ok) return { ok: false as const, error: approval.error, requiresApproval: true as const };

  try {
    // ─── Phase 16C-C2A: batch-atomic delete ──────────────────────────────────
    // All reads run BEFORE the batch; the adjustment insert, child deletes,
    // payment delete, and session/table updates commit together or not at all
    // (db.batch = one atomic Neon HTTP transaction). This also fixes the latent
    // FK defect: payment_allocations were never deleted, so DELETE payments
    // failed halfway and stripped the payment of its rows first.
    const lineItems = await db
      .select({
        id: paymentLineItems.id,
        pricingTileId: paymentLineItems.pricingTileId,
        quantity: paymentLineItems.quantity,
        amount: paymentLineItems.amount,
      })
      .from(paymentLineItems)
      .where(eq(paymentLineItems.paymentId, paymentId));
    const rowItems = await db
      .select()
      .from(paymentRows)
      .where(eq(paymentRows.paymentId, paymentId));
    const allocationRows = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));

    // Remaining balance is computed BEFORE the batch by excluding this payment —
    // identical to the old post-delete query (batch statements cannot read
    // post-delete state).
    const [remainingPaymentState] = await db
      .select({
        paidTotal: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
        billTotal: sql<number>`coalesce(max(${payments.billTotalAtPayment}::numeric), ${payment.billTotalAtPayment}::numeric)`,
      })
      .from(payments)
      .where(and(
        eq(payments.sessionId, payment.sessionId),
        eq(payments.status, 'completed'),
        not(eq(payments.id, paymentId)),
      ));
    const paidTotalAfterDelete = Number(remainingPaymentState?.paidTotal ?? 0);
    const billTotalAfterDelete = Number(remainingPaymentState?.billTotal ?? payment.billTotalAtPayment);
    const remainingAfterDelete = Math.round((billTotalAfterDelete - paidTotalAfterDelete) * 100) / 100;

    // Statement 1 — immutable adjustment ledger row (Approach C, now stronger:
    // atomicity means the ledger row exists if and only if the delete actually
    // committed — no more orphan adjustments from half-failed deletes).
    // paymentId has no FK: payment_adjustments survives after the hard delete.
    // The snapshot now also preserves allocations, since they are deleted below.
    const batchStatements: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(paymentAdjustments).values({
        paymentId: payment.id,
        sessionId: payment.sessionId,
        shiftId: payment.shiftId,
        type: 'void',
        amount: payment.total,
        reason: normalizedReason || 'ไม่ระบุ',
        requestedBy: authSession.user.id,
        approvedBy: authSession.user.id,
        approvedAt: new Date(),
        status: 'approved',
        paymentSnapshot: {
          payment: {
            id: payment.id,
            sessionId: payment.sessionId,
            subtotal: payment.subtotal,
            serviceCharge: payment.serviceCharge,
            discount: payment.discount,
            total: payment.total,
            paymentMethod: payment.paymentMethod,
            receivedAmount: payment.receivedAmount,
            changeAmount: payment.changeAmount,
            paidAt: payment.paidAt.toISOString(),
            processedBy: payment.processedBy,
            receiptNo: payment.receiptNo,
            notes: payment.notes,
            shiftId: payment.shiftId,
            status: payment.status,
            settlementType: payment.settlementType,
            billTotalAtPayment: payment.billTotalAtPayment,
            paidBefore: payment.paidBefore,
            remainingAfter: payment.remainingAfter,
          },
          lineItems,
          paymentRows: rowItems,
          allocations: allocationRows,
          context: {
            action: 'delete_payment',
            performedBy: authSession.user.id,
            performedAt: new Date().toISOString(),
            shiftStatusAtMutation,
            shiftClosedAt: shift?.closedAt ? new Date(shift.closedAt).toISOString() : null,
            mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
            reason: normalizedReason || 'ไม่ระบุ',
          },
        },
      }),
      // Children before parent — allocations/rows/line items all FK-reference
      // payments.id with no cascade (schema verified); allocations were the
      // missing delete that caused the FK failure.
      db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId)),
      db.delete(paymentRows).where(eq(paymentRows.paymentId, paymentId)),
      db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId)),
      db.delete(payments).where(eq(payments.id, paymentId)),
    ];

    if (payment.settlementType === 'partial' || remainingAfterDelete > 0) {
      batchStatements.push(
        db.update(sessions)
          .set({ status: 'closing', closedAt: null })
          .where(eq(sessions.id, payment.sessionId)),
      );
      batchStatements.push(
        db.update(tables)
          .set({ status: 'occupied' })
          .where(eq(tables.id, mainSessionForDelete.tableId)),
      );
    } else {
      batchStatements.push(
        db.update(sessions)
          .set({ status: 'closed' })
          .where(eq(sessions.id, payment.sessionId)),
      );
    }

    await db.batch(batchStatements);

    // Fire-and-forget secondary log (payment_adjustments is the primary audit trail)
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'delete_payment',
      entity: 'payments',
      entityId: paymentId,
      before: {
        sessionId: payment.sessionId,
        shiftId: payment.shiftId ?? null,
        shiftStatusAtMutation,
        mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
      },
      after: { deleted: true, reason: normalizedReason || 'ไม่ระบุ' },
    });
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'sensitive_action_approved_by_code',
      entity: 'payments',
      entityId: paymentId,
      before: null,
      after: {
        actorUserId: authSession.user.id,
        actorRole: authSession.user.role,
        approvalCodeId: approval.codeId,
        generatedByUserId: approval.generatedByUserId,
        // Owner is the only role that can reach this point AND have
        // generatedByUserId === actorUserId — isSelfApprovalAllowed already
        // rejected manager/cashier self-approval before the code was consumed.
        selfApproved: approval.generatedByUserId === authSession.user.id,
        reason: normalizedReason,
        actionKey: 'pos_payment_delete',
        sessionId: payment.sessionId,
      },
    });

    revalidatePath('/pos/history');
    revalidatePath('/tables/history');
    return { ok: true as const };
  } catch (e) {
    console.error('[deletePaymentRecord]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── reopenSessionForPayment — ยกเลิกการชำระ แล้วส่งกลับ POS ──────── */
//
// Phase 1 Step 4 (Approach C): INSERT payment_adjustments inside same transaction
// before hard DELETE. If insert fails → rollback → session NOT reopened.

export async function reopenSessionForPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  // Restricted to owner + manager via payment:reopen — cashier ทำไม่ได้
  if (!can(authSession.user.role, 'payment:reopen'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น owner หรือ manager' };

  const parsed = z
    .object({
      paymentId: z.string().uuid(),
      reason: z.string().max(500).optional(),
      // Phase 17POS-AUTH-A3 — approval code is a second approval step, not a
      // permission grant. payment:reopen is already owner+manager above.
      approvalCode: z.string().trim().max(20).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { paymentId, reason, approvalCode } = parsed.data;

  // Fetch full payment for snapshot outside tx — early return gives clean error message
  const [payment] = await db
    .select({
      id: payments.id,
      sessionId: payments.sessionId,
      subtotal: payments.subtotal,
      serviceCharge: payments.serviceCharge,
      discount: payments.discount,
      total: payments.total,
      paymentMethod: payments.paymentMethod,
      receivedAmount: payments.receivedAmount,
      changeAmount: payments.changeAmount,
      paidAt: payments.paidAt,
      processedBy: payments.processedBy,
      receiptNo: payments.receiptNo,
      notes: payments.notes,
      shiftId: payments.shiftId,
      status: payments.status,
      settlementType: payments.settlementType,
      billTotalAtPayment: payments.billTotalAtPayment,
      paidBefore: payments.paidBefore,
      remainingAfter: payments.remainingAfter,
    })
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };

  const normalizedReason = (reason ?? '').trim();

  const shift = payment.shiftId
    ? await db
        .select({ status: cashierShifts.status, closedAt: cashierShifts.closedAt })
        .from(cashierShifts)
        .where(eq(cashierShifts.id, payment.shiftId))
        .then((rows) => rows[0] ?? null)
    : null;
  const shiftStatusAtMutation: string | null = shift?.status ?? null;

  if (shift?.status === 'reviewed') {
    return { ok: false as const, error: 'ไม่สามารถแก้ไขการชำระเงินในรอบที่ตรวจสอบแล้ว' };
  }
  if (shift?.status === 'closed' && authSession.user.role === 'manager') {
    return { ok: false as const, error: 'เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขการชำระเงินในรอบที่ปิดแล้วได้' };
  }

  // ─── Phase 17POS-AUTH-A3: manager approval gate ──────────────────────────
  // reopenSessionForPayment is owner+manager only (payment:reopen, checked
  // above) and always cancels a completed payment for re-entry — like
  // deletePaymentRecord, code + reason are unconditionally required once
  // permission (and the shift-status checks above) pass. This replaces the
  // old "reason required only if shift closed" rule with a strictly stronger
  // one, so no Phase 16C hardening is weakened. Self-approval (owner may use
  // its own code; manager may not) is enforced inside
  // consumeManagerApprovalCode via isSelfApprovalAllowed — unchanged from A2C.
  if (!approvalCode) {
    return {
      ok: false as const,
      error: 'ต้องใช้รหัสอนุมัติสำหรับการยกเลิก/แก้ไขบิล',
      requiresApproval: true as const,
    };
  }
  if (!normalizedReason) {
    return {
      ok: false as const,
      error: 'ต้องระบุเหตุผลสำหรับการแก้ไขการชำระเงิน',
      requiresApproval: true as const,
    };
  }
  const approval = await consumeManagerApprovalCode({
    code: approvalCode,
    action: 'pos_payment_reopen',
    entityType: 'payment',
    entityId: paymentId,
    requestedByUserId: authSession.user.id,
    requestedByRole: authSession.user.role,
    requestedByBranchId: authSession.user.branchId ?? null,
    reason: normalizedReason,
  });
  if (!approval.ok) return { ok: false as const, error: approval.error, requiresApproval: true as const };

  const [mainSession] = await db
    .select({ id: sessions.id, tableId: sessions.tableId })
    .from(sessions)
    .where(eq(sessions.id, payment.sessionId));
  if (!mainSession) return { ok: false as const, error: 'ไม่พบ session' };

  // Include group-bill linked sessions (different table), not split children (same table)
  const childSessions = await db
    .select({ id: sessions.id, tableId: sessions.tableId })
    .from(sessions)
    .where(eq(sessions.parentSessionId, mainSession.id));
  const groupLinked = childSessions.filter((s) => s.tableId !== mainSession.tableId);

  const allSessionIds = [mainSession.id, ...groupLinked.map((s) => s.id)];
  const allTableIds = [...new Set([mainSession.tableId, ...groupLinked.map((s) => s.tableId)])];

  try {
    // ─── Phase 16C-C2A: batch-atomic reopen ──────────────────────────────────
    // All reads run BEFORE the batch; the adjustment insert, child deletes,
    // payment delete, and session/table reopen updates commit together or not
    // at all. Fixes the latent FK defect (payment_allocations never deleted).
    const lineItems = await db
      .select({
        id: paymentLineItems.id,
        pricingTileId: paymentLineItems.pricingTileId,
        quantity: paymentLineItems.quantity,
        amount: paymentLineItems.amount,
      })
      .from(paymentLineItems)
      .where(eq(paymentLineItems.paymentId, paymentId));
    const rowItems = await db
      .select()
      .from(paymentRows)
      .where(eq(paymentRows.paymentId, paymentId));
    const allocationRows = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));

    // Statement 1 — immutable adjustment ledger row (Approach C, now stronger:
    // the ledger row exists if and only if the reopen actually committed).
    // paymentId has no FK: payment_adjustments survives after the hard delete.
    // The snapshot now also preserves allocations, since they are deleted below.
    const batchStatements: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(paymentAdjustments).values({
        paymentId: payment.id,
        sessionId: payment.sessionId,
        shiftId: payment.shiftId,
        type: 'void',
        amount: payment.total,
        reason: normalizedReason || 'ไม่ระบุ',
        requestedBy: authSession.user.id,
        approvedBy: authSession.user.id,
        approvedAt: new Date(),
        status: 'approved',
        paymentSnapshot: {
          payment: {
            id: payment.id,
            sessionId: payment.sessionId,
            subtotal: payment.subtotal,
            serviceCharge: payment.serviceCharge,
            discount: payment.discount,
            total: payment.total,
            paymentMethod: payment.paymentMethod,
            receivedAmount: payment.receivedAmount,
            changeAmount: payment.changeAmount,
            paidAt: payment.paidAt.toISOString(),
            processedBy: payment.processedBy,
            receiptNo: payment.receiptNo,
            notes: payment.notes,
            shiftId: payment.shiftId,
            status: payment.status,
            settlementType: payment.settlementType,
            billTotalAtPayment: payment.billTotalAtPayment,
            paidBefore: payment.paidBefore,
            remainingAfter: payment.remainingAfter,
          },
          lineItems,
          paymentRows: rowItems,
          allocations: allocationRows,
          linkedSessions: groupLinked,
          context: {
            action: 'reopen_session',
            performedBy: authSession.user.id,
            performedAt: new Date().toISOString(),
            allSessionIds,
            allTableIds,
            shiftStatusAtMutation,
            shiftClosedAt: shift?.closedAt ? new Date(shift.closedAt).toISOString() : null,
            mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
            reason: normalizedReason || 'ไม่ระบุ',
          },
        },
      }),
      // Children before parent — allocations/rows/line items all FK-reference
      // payments.id with no cascade (schema verified).
      db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId)),
      db.delete(paymentRows).where(eq(paymentRows.paymentId, paymentId)),
      db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId)),
      db.delete(payments).where(eq(payments.id, paymentId)),
      db.update(sessions)
        .set({ status: 'closing', closedAt: null })
        .where(inArray(sessions.id, allSessionIds)),
      db.update(tables)
        .set({ status: 'occupied' })
        .where(inArray(tables.id, allTableIds)),
    ];

    await db.batch(batchStatements);

    // Fire-and-forget secondary log (payment_adjustments is the primary audit trail)
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'reopen_session',
      entity: 'payments',
      entityId: paymentId,
      before: {
        sessionId: mainSession.id,
        linkedSessionIds: groupLinked.map((s) => s.id),
        shiftId: payment.shiftId ?? null,
        shiftStatusAtMutation,
        mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
      },
      after: { sessionStatus: 'closing', reason: normalizedReason || 'ไม่ระบุ' },
    });
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'sensitive_action_approved_by_code',
      entity: 'payments',
      entityId: paymentId,
      before: null,
      after: {
        actorUserId: authSession.user.id,
        actorRole: authSession.user.role,
        approvalCodeId: approval.codeId,
        generatedByUserId: approval.generatedByUserId,
        // Owner is the only role that can reach this point AND have
        // generatedByUserId === actorUserId — isSelfApprovalAllowed already
        // rejected manager self-approval before the code was consumed.
        selfApproved: approval.generatedByUserId === authSession.user.id,
        reason: normalizedReason,
        actionKey: 'pos_payment_reopen',
        sessionId: mainSession.id,
      },
    });

    revalidatePath('/pos');
    revalidatePath('/pos/history');
    revalidatePath('/tables');
    revalidatePath('/tables/history');
    return { ok: true as const, sessionId: mainSession.id };
  } catch (e) {
    console.error('[reopenSessionForPayment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── Phase 1 Step 7: Audit / Fraud Report ─────────────────────────────────*/

const AUDIT_ACTIONS = [
  'delete_payment', 'void_payment', 'reopen_session', 'process_payment',
  'shift_open', 'shift_close', 'shift_review',
  'discount_request', 'discount_approve', 'discount_reject',
  'cancel_order',
  'manager_approval_code_generated', 'manager_approval_code_revoked',
  'manager_approval_code_used', 'manager_approval_code_failed_attempt',
  'sensitive_action_approved_by_code',
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

const auditReportSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo:   z.string().optional(),
  action:   z.enum(AUDIT_ACTIONS).optional(),
  userId:   z.string().uuid().optional(),
});

export async function getAuditReport(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const role = authSession.user.role;
  if (role !== 'owner' && role !== 'manager')
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = auditReportSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { dateFrom, dateTo, action, userId } = parsed.data;

  try {
    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        userId: auditLogs.userId,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(
        and(
          inArray(auditLogs.action, [...AUDIT_ACTIONS]),
          action   ? eq(auditLogs.action, action)              : undefined,
          userId   ? eq(auditLogs.userId, userId)              : undefined,
          dateFrom ? gte(auditLogs.createdAt, new Date(dateFrom)) : undefined,
          dateTo   ? lte(auditLogs.createdAt, new Date(dateTo))   : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(500);

    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getAuditReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type AuditReportRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getAuditReport>>, { ok: true }>['data']
>[number];

const shiftReportSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo:   z.string().optional(),
  cashierId: z.string().uuid().optional(),
});

export async function getShiftReport(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const role = authSession.user.role;
  if (role !== 'owner' && role !== 'manager')
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = shiftReportSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { dateFrom, dateTo, cashierId } = parsed.data;

  try {
    const rows = await db
      .select({
        id: cashierShifts.id,
        cashierId: cashierShifts.cashierId,
        cashierName: users.name,
        status: cashierShifts.status,
        openedAt: cashierShifts.openedAt,
        closedAt: cashierShifts.closedAt,
        openingFloat: cashierShifts.openingFloat,
        expectedCash: cashierShifts.expectedCash,
        actualCash: cashierShifts.actualCash,
        cashDifference: cashierShifts.cashDifference,
        differenceReason: cashierShifts.differenceReason,
        reviewNotes: cashierShifts.reviewNotes,
        reviewedAt: cashierShifts.reviewedAt,
      })
      .from(cashierShifts)
      .leftJoin(users, eq(cashierShifts.cashierId, users.id))
      .where(
        and(
          cashierId ? eq(cashierShifts.cashierId, cashierId)        : undefined,
          dateFrom  ? gte(cashierShifts.openedAt, new Date(dateFrom)) : undefined,
          dateTo    ? lte(cashierShifts.openedAt, new Date(dateTo))   : undefined,
        ),
      )
      .orderBy(desc(cashierShifts.openedAt))
      .limit(200);

    return {
      ok: true as const,
      data: rows.map((r) => ({
        ...r,
        openingFloat: Number(r.openingFloat),
        expectedCash: r.expectedCash != null ? Number(r.expectedCash) : null,
        actualCash:   r.actualCash   != null ? Number(r.actualCash)   : null,
        cashDifference: r.cashDifference != null ? Number(r.cashDifference) : null,
      })),
    };
  } catch (e) {
    console.error('[getShiftReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type ShiftReportRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getShiftReport>>, { ok: true }>['data']
>[number];

export async function getPaymentAdjustmentsReport(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const role = authSession.user.role;
  if (role !== 'owner' && role !== 'manager')
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = z.object({
    dateFrom: z.string().optional(),
    dateTo:   z.string().optional(),
  }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { dateFrom, dateTo } = parsed.data;

  try {
    const rows = await db
      .select({
        id: paymentAdjustments.id,
        paymentId: paymentAdjustments.paymentId,
        sessionId: paymentAdjustments.sessionId,
        shiftId: paymentAdjustments.shiftId,
        type: paymentAdjustments.type,
        amount: paymentAdjustments.amount,
        reason: paymentAdjustments.reason,
        status: paymentAdjustments.status,
        createdAt: paymentAdjustments.createdAt,
        requestedBy: paymentAdjustments.requestedBy,
        requesterName: users.name,
        paymentSnapshot: paymentAdjustments.paymentSnapshot,
      })
      .from(paymentAdjustments)
      .leftJoin(users, eq(paymentAdjustments.requestedBy, users.id))
      .where(
        and(
          dateFrom ? gte(paymentAdjustments.createdAt, new Date(dateFrom)) : undefined,
          dateTo   ? lte(paymentAdjustments.createdAt, new Date(dateTo))   : undefined,
        ),
      )
      .orderBy(desc(paymentAdjustments.createdAt))
      .limit(500);

    return {
      ok: true as const,
      data: rows.map((r) => {
        const snapshot = r.paymentSnapshot as Record<string, unknown> | null;
        const context =
          snapshot && typeof snapshot.context === 'object' && snapshot.context !== null
            ? (snapshot.context as Record<string, unknown>)
            : {};
        const snapshotPayment =
          snapshot && typeof snapshot.payment === 'object' && snapshot.payment !== null
            ? (snapshot.payment as Record<string, unknown>)
            : {};
        const rawRows: Array<Record<string, unknown>> = Array.isArray(snapshot?.paymentRows)
          ? (snapshot?.paymentRows as Array<Record<string, unknown>>)
          : [];

        const paymentRowsBefore = rawRows.map((pr) => ({
          paymentMethodId: String(pr.paymentMethodId ?? pr.payment_method_id ?? ''),
          receivingAccountId:
            (pr.receivingAccountId ?? pr.receiving_account_id) != null
              ? String(pr.receivingAccountId ?? pr.receiving_account_id)
              : null,
          amount: Number(pr.amount ?? 0),
          amountTendered:
            (pr.amountTendered ?? pr.amount_tendered) != null
              ? Number(pr.amountTendered ?? pr.amount_tendered)
              : null,
          changeAmount:
            (pr.changeAmount ?? pr.change_amount) != null
              ? Number(pr.changeAmount ?? pr.change_amount)
              : null,
          status: String(pr.status ?? ''),
        }));

        const collectionImpact =
          Math.round(paymentRowsBefore.reduce((s, row) => s + row.amount, 0) * 100) / 100;

        return {
          id: r.id,
          paymentId: r.paymentId,
          sessionId: r.sessionId,
          shiftId: r.shiftId ?? null,
          type: r.type,
          amount: Number(r.amount),
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
          requestedBy: r.requestedBy,
          requesterName: r.requesterName,
          mutationAction: typeof context.action === 'string' ? context.action : null,
          shiftStatusAtMutation:
            typeof context.shiftStatusAtMutation === 'string'
              ? context.shiftStatusAtMutation
              : null,
          shiftClosedAt:
            typeof context.shiftClosedAt === 'string' ? context.shiftClosedAt : null,
          mutationAfterClose: context.mutationAfterClose === true,
          mutationReason:
            typeof context.reason === 'string' ? context.reason : (r.reason ?? null),
          settlementType:
            snapshotPayment.settlementType === 'partial' || snapshotPayment.settlementType === 'final'
              ? snapshotPayment.settlementType
              : null,
          billTotalAtPayment:
            snapshotPayment.billTotalAtPayment != null ? Number(snapshotPayment.billTotalAtPayment) : null,
          paidBefore:
            snapshotPayment.paidBefore != null ? Number(snapshotPayment.paidBefore) : null,
          remainingAfter:
            snapshotPayment.remainingAfter != null ? Number(snapshotPayment.remainingAfter) : null,
          paymentTotal:
            snapshotPayment.total != null ? Number(snapshotPayment.total) : Number(r.amount),
          paymentRowsBefore,
          collectionImpact,
          paymentRowCount: paymentRowsBefore.length,
        };
      }),
    };
  } catch (e) {
    console.error('[getPaymentAdjustmentsReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
