'use server';

import { and, gte, lt, eq, isNotNull, sql } from 'drizzle-orm';
import { format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfMonth, addMonths, parse } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { payments, purchaseOrders, storeSettings } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

export type VatReportRow = {
  type: 'output' | 'input';
  date: string;
  refNo: string;
  counterparty: string;
  baseAmount: number;
  vatAmount: number;
  total: number;
};

export type VatReport = {
  month: string;
  vatRate: number;
  // Output VAT (from sales)
  outputRows: VatReportRow[];
  outputBase: number;
  outputVat: number;
  // Input VAT (from tax-invoice POs)
  inputRows: VatReportRow[];
  inputBase: number;
  inputVat: number;
  // Net
  netVat: number;
};

export async function getVatReport(month: string) {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'view_reports'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const parsed = parse(`${month}-01`, 'yyyy-MM-dd', new Date());
    const mStart = fromZonedTime(startOfMonth(toZonedTime(parsed, TZ)), TZ);
    const mEnd = fromZonedTime(addMonths(startOfMonth(toZonedTime(parsed, TZ)), 1), TZ);
    const mStartStr = format(toZonedTime(mStart, TZ), 'yyyy-MM-dd');
    const mEndStr = format(toZonedTime(mEnd, TZ), 'yyyy-MM-dd');

    const [[settingsRow], outputRows, inputRows] = await Promise.all([
      db.select({ vatPercent: storeSettings.vatPercent }).from(storeSettings).limit(1),

      // Output VAT: all payments in month
      db.select({
        id: payments.id,
        receiptNo: payments.receiptNo,
        paidAt: payments.paidAt,
        total: payments.total,
        subtotal: payments.subtotal,
      }).from(payments)
        .where(and(gte(payments.paidAt, mStart), lt(payments.paidAt, mEnd), eq(payments.status, 'completed'))),

      // Input VAT: POs with tax invoice, received in month
      db.select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        taxInvoiceNumber: purchaseOrders.taxInvoiceNumber,
        receivedDate: purchaseOrders.receivedDate,
        total: purchaseOrders.total,
        subtotal: purchaseOrders.subtotal,
        vatAmount: purchaseOrders.vatAmount,
        vatRate: purchaseOrders.vatRate,
      }).from(purchaseOrders)
        .where(and(
          eq(purchaseOrders.hasTaxInvoice, true),
          isNotNull(purchaseOrders.receivedDate),
          gte(purchaseOrders.receivedDate, mStartStr),
          lt(purchaseOrders.receivedDate, mEndStr),
        )),
    ]);

    const vatRate = settingsRow?.vatPercent ?? 7;
    const vatFactor = vatRate / (100 + vatRate);

    const outputVatRows: VatReportRow[] = outputRows.map((r) => {
      const total = Number(r.total);
      const vatAmount = total * vatFactor;
      const baseAmount = total - vatAmount;
      return {
        type: 'output' as const,
        date: format(toZonedTime(r.paidAt, TZ), 'dd/MM/yyyy'),
        refNo: r.receiptNo ?? r.id.slice(0, 8),
        counterparty: 'ลูกค้า',
        baseAmount,
        vatAmount,
        total,
      };
    });

    const inputVatRows: VatReportRow[] = inputRows.map((r) => {
      const total = Number(r.total);
      const vatAmount = Number(r.vatAmount);
      const baseAmount = Number(r.subtotal);
      return {
        type: 'input' as const,
        date: r.receivedDate ?? mStartStr,
        refNo: r.taxInvoiceNumber ?? r.poNumber,
        counterparty: 'ผู้ขาย',
        baseAmount,
        vatAmount,
        total,
      };
    });

    const outputBase = outputVatRows.reduce((s, r) => s + r.baseAmount, 0);
    const outputVat = outputVatRows.reduce((s, r) => s + r.vatAmount, 0);
    const inputBase = inputVatRows.reduce((s, r) => s + r.baseAmount, 0);
    const inputVat = inputVatRows.reduce((s, r) => s + r.vatAmount, 0);

    const report: VatReport = {
      month,
      vatRate,
      outputRows: outputVatRows,
      outputBase,
      outputVat,
      inputRows: inputVatRows,
      inputBase,
      inputVat,
      netVat: outputVat - inputVat,
    };

    return { ok: true as const, data: report };
  } catch (e) {
    console.error('[getVatReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
