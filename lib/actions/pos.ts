'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray, asc, sql, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { writeAuditLog } from '@/lib/actions/audit';
import { awardLoyaltyPoints } from '@/lib/actions/customers';
import { generateTaxInvoiceNumber } from '@/lib/actions/tax-invoice';
import {
  sessions,
  tables,
  orders,
  payments,
  paymentLineItems,
  paymentRows,
  paymentMethods,
  receivingAccounts,
  pricingTiles,
  storeSettings,
  cashierShifts,
  buffetChargeLines,
  paymentAllocations,
} from '@/lib/db/schema';
import { processPaymentSchema } from '@/lib/validations/pos';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  ensurePaymentRowsForLegacyPayment,
  getActivePaymentMethodsWithAccounts,
  resolveLegacyPaymentMethodAccount,
  validateCheckoutPaymentRowsForTotal,
} from '@/lib/payments/foundation';
import { hasMixedAccountGroups } from '@/lib/payments/account-group';
import {
  toCents,
  fromCents,
  addonLineAmount,
  discountTileAmount,
  loyaltyRedemptionBaht,
  discountBaseSoFar,
  resolveCanonicalSubtotal,
  computeBillTotal,
  paidBeforeError,
  settlementAmountError,
  legacyCashChange,
} from '@/lib/payments/money-math';

export async function getPosSessionsForPos() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const result = await db.query.sessions.findMany({
      where: inArray(sessions.status, ['active', 'closing', 'paid']),
      orderBy: [asc(sessions.startedAt)],
      with: {
        table: true,
        guests: {
          with: { pricingTile: true },
        },
      },
    });

    // Sum non-voided charge lines per session — this is the canonical saved bill total
    // and includes guest tiles, addon tiles, and any other charge types.
    const sessionIds = result.map((s) => s.id);
    const chargeLineTotals = sessionIds.length > 0
      ? await db
          .select({
            sessionId: buffetChargeLines.sessionId,
            total: sql<number>`coalesce(sum(${buffetChargeLines.total}::numeric), 0)::float8`,
          })
          .from(buffetChargeLines)
          .where(
            and(
              inArray(buffetChargeLines.sessionId, sessionIds),
              isNull(buffetChargeLines.voidedAt),
            )
          )
          .groupBy(buffetChargeLines.sessionId)
      : [];

    const chargeTotalMap = new Map(chargeLineTotals.map((r) => [r.sessionId, Number(r.total)]));

    return {
      ok: true as const,
      data: result.map((s) => ({
        ...s,
        chargeLineTotal: chargeTotalMap.get(s.id) ?? 0,
      })),
    };
  } catch (e) {
    console.error('[getPosSessionsForPos]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type PosSession = NonNullable<
  Extract<Awaited<ReturnType<typeof getPosSessionsForPos>>, { ok: true }>['data']
>[number];

export async function getPosSessionDetail(sessionId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: {
        table: true,
        guests: { with: { pricingTile: true } },
        linkedSessions: { with: { table: true } },
      },
    });
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    const primarySessionId = session.parentSessionId ?? session.id;
    const billingSession = session.parentSessionId
      ? await db.query.sessions.findFirst({
          where: eq(sessions.id, primarySessionId),
          with: {
            table: true,
            guests: { with: { pricingTile: true } },
            linkedSessions: { with: { table: true } },
          },
        })
      : session;
    if (!billingSession) return { ok: false as const, error: 'ไม่พบ session หลักของบิล' };

    // Group bill: include orders from primary + linked sessions
    const linkedSessionIds = billingSession.linkedSessions.map((s) => s.id);
    const allSessionIds = [primarySessionId, ...linkedSessionIds];
    const sessionOrders = await db.query.orders.findMany({
      where: inArray(orders.sessionId, allSessionIds),
      orderBy: [asc(orders.createdAt)],
      with: { items: { with: { menuItem: true } } },
    });

    const baseAmount = session.guests.reduce(
      (sum, g) => sum + Number(g.pricingTile.price) * g.quantity,
      0,
    );

    const extraAmount = sessionOrders
      .flatMap((o) => o.items)
      .filter((i) => i.status !== 'cancelled' && !i.menuItem?.isBuffet)
      .reduce((sum, i) => sum + Number(i.menuItem?.extraPrice ?? 0) * i.quantity, 0);

    const subtotal = baseAmount + extraAmount;
    const completedPayments = await db.query.payments.findMany({
      where: and(inArray(payments.sessionId, allSessionIds), eq(payments.status, 'completed')),
      orderBy: [asc(payments.paidAt)],
    });
    const paymentIds = completedPayments.map((payment) => payment.id);
    const paymentRowDetails = paymentIds.length > 0
      ? await db.select({
          paymentId: paymentRows.paymentId,
          methodId: paymentRows.paymentMethodId,
          methodName: paymentMethods.name,
          methodType: paymentMethods.type,
          receivingAccountId: paymentRows.receivingAccountId,
          receivingAccountName: receivingAccounts.name,
          amount: paymentRows.amount,
          amountTendered: paymentRows.amountTendered,
          changeAmount: paymentRows.changeAmount,
          status: paymentRows.status,
          paidAt: paymentRows.paidAt,
        })
          .from(paymentRows)
          .innerJoin(paymentMethods, eq(paymentMethods.id, paymentRows.paymentMethodId))
          .innerJoin(receivingAccounts, eq(receivingAccounts.id, paymentRows.receivingAccountId))
          .where(and(
            inArray(paymentRows.paymentId, paymentIds),
            eq(paymentRows.status, 'completed'),
            isNull(paymentRows.voidedAt),
          ))
          .orderBy(asc(paymentRows.paidAt), asc(paymentRows.createdAt))
      : [];
    const paymentRowsByPaymentId = new Map<string, typeof paymentRowDetails>();
    for (const row of paymentRowDetails) {
      const rows = paymentRowsByPaymentId.get(row.paymentId) ?? [];
      rows.push(row);
      paymentRowsByPaymentId.set(row.paymentId, rows);
    }
    const paymentHistory = completedPayments.map((payment) => ({
      id: payment.id,
      amount: Number(payment.total),
      paidAt: payment.paidAt,
      settlementType: payment.settlementType,
      status: payment.status,
      rows: (paymentRowsByPaymentId.get(payment.id) ?? []).map((row) => ({
        methodId: row.methodId,
        methodName: row.methodName,
        methodType: row.methodType,
        receivingAccountId: row.receivingAccountId,
        receivingAccountName: row.receivingAccountName,
        amount: Number(row.amount),
        amountTendered: row.amountTendered == null ? null : Number(row.amountTendered),
        changeAmount: row.changeAmount == null ? null : Number(row.changeAmount),
        status: row.status,
        paidAt: row.paidAt,
      })),
    }));
    const paidTotal = completedPayments.reduce((sum, payment) => sum + Number(payment.total), 0);
    const latestPayment = completedPayments.at(-1);
    const billTotal = latestPayment ? Number(latestPayment.billTotalAtPayment) : subtotal;
    const remaining = Math.max(0, billTotal - paidTotal);
    const isGroupBill = linkedSessionIds.length > 0;
    const linkedTableLabels = session.linkedSessions.map((s) => s.table.label);

    // Charge lines live on the primary session; allocations may reference any session in the group
    const [chargeLineRows, allocationRows] = await Promise.all([
      db.select().from(buffetChargeLines).where(eq(buffetChargeLines.sessionId, primarySessionId)),
      db.select({
        chargeLineId: paymentAllocations.chargeLineId,
        allocatedQty: sql<number>`sum(${paymentAllocations.quantity})::int`,
      }).from(paymentAllocations)
        .where(inArray(paymentAllocations.sessionId, allSessionIds))
        .groupBy(paymentAllocations.chargeLineId),
    ]);

    const hasBillableGuests = billingSession.guests.some((guest) => guest.quantity > 0);
    if (hasBillableGuests && chargeLineRows.length === 0) {
      return { ok: false as const, error: 'กำลังโหลดรายการบิล กรุณารอสักครู่' };
    }

    const allocMap = new Map(allocationRows.map((r) => [r.chargeLineId, r.allocatedQty]));
    const chargeLines = chargeLineRows.map((l) => {
      const allocatedQuantity = allocMap.get(l.id) ?? 0;
      return {
        id: l.id,
        pricingTileId: l.pricingTileId,
        chargeType: l.chargeType,
        label: l.label,
        unitPrice: Number(l.unitPrice),
        quantity: l.quantity,
        allocatedQuantity,
        remainingQuantity: Math.max(0, l.quantity - allocatedQuantity),
        total: Number(l.total),
        voidedAt: l.voidedAt,
      };
    });

    return {
      ok: true as const,
      data: {
        session: billingSession,
        orders: sessionOrders,
        totals: { baseAmount, extraAmount, subtotal, total: subtotal },
        paymentSummary: { billTotal, paidTotal, remaining },
        paymentHistory,
        isGroupBill,
        linkedTableLabels,
        chargeLines,
      },
    };
  } catch (e) {
    console.error('[getPosSessionDetail]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type PosSessionDetail = NonNullable<
  Extract<Awaited<ReturnType<typeof getPosSessionDetail>>, { ok: true }>['data']
>;

export async function markBillPrinted(sessionId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db.update(sessions)
      .set({ billPrintedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[markBillPrinted]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getActiveTilesForPos() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const addonTiles = await db
      .select()
      .from(pricingTiles)
      .where(eq(pricingTiles.isActive, true))
      .orderBy(asc(pricingTiles.sortOrder));

    return {
      ok: true as const,
      data: {
        guests: addonTiles.filter((t) => t.category === 'guest'),
        addons: addonTiles.filter((t) => t.category === 'addon'),
        discounts: addonTiles.filter((t) => t.category === 'discount'),
        loyalty: addonTiles.filter((t) => t.category === 'loyalty'),
      },
    };
  } catch (e) {
    console.error('[getActiveTilesForPos]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getActivePaymentOptionsForPos() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const data = await getActivePaymentMethodsWithAccounts();
    return {
      ok: true as const,
      data: data
        .filter((method) => method.type !== 'mixed_legacy')
        .map((method) => ({
          id: method.id,
          code: method.code,
          name: method.name,
          type: method.type,
          requiresReference: method.requiresReference,
          allowOverpay: method.allowOverpay,
          sortOrder: method.sortOrder,
          defaultAccountId: method.defaultAccount?.id ?? null,
          accounts: method.accounts
            .filter((entry) => entry.account.code !== 'legacy_unknown')
            .map((entry) => ({
              mappingId: entry.mappingId,
              isDefault: entry.isDefault,
              id: entry.account.id,
              code: entry.account.code,
              name: entry.account.name,
              type: entry.account.type,
              bankName: entry.account.bankName,
              accountLabel: entry.account.accountLabel,
              accountLast4: entry.account.accountLast4,
            })),
        }))
        .filter((method) => method.accounts.length > 0),
    };
  } catch (e) {
    console.error('[getActivePaymentOptionsForPos]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// TODO Phase 1 Step 5E: move to store_settings.require_shift_for_cash when schema field is ready.
// Set env STRICT_SHIFT_CASH=true to block cash payments without an open shift.
const STRICT_SHIFT_CASH = process.env.STRICT_SHIFT_CASH === 'true';

// toCents/fromCents and all pure money formulas moved to lib/payments/money-math.ts
// (Phase 16D golden extraction — behavior identical, locked by tests/money/*).

/**
 * Phase 16B — shared "already processed" response for duplicate submissions
 * (same idempotency key, or same session+receiptNo for legacy dedupe).
 * repairRows backfills missing payment rows when the original attempt failed
 * after the payment insert (best-effort until Phase 16C makes writes atomic);
 * it is skipped in the concurrent-race path where the winning request may
 * still be inserting its own rows.
 */
async function alreadyProcessedPaymentResult(
  payment: typeof payments.$inferSelect,
  { repairRows = true }: { repairRows?: boolean } = {},
) {
  if (repairRows) await ensurePaymentRowsForLegacyPayment(payment);
  return {
    ok: true as const,
    data: {
      paymentId: payment.id,
      total: Number(payment.total),
      changeAmount: Number(payment.changeAmount),
      receiptNo: payment.receiptNo ?? undefined,
      settlementType: payment.settlementType,
      billTotal: Number(payment.billTotalAtPayment),
      paidBefore: Number(payment.paidBefore),
      paidThisTime: Number(payment.total),
      paidTotal: Number(payment.paidBefore) + Number(payment.total),
      remainingAfter: Number(payment.remainingAfter),
      shiftWarning: !payment.shiftId,
      /** true = this attempt was recorded earlier; client must not auto-print again */
      alreadyProcessed: true as const,
    },
  };
}

export async function processPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = processPaymentSchema.safeParse(input);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[processPayment] schema parse error', JSON.stringify(parsed.error.issues, null, 2));
    }
    return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  }

  const { sessionId, settlementMode, paymentMethod, receivedAmount, discount, notes, receiptNo, lineItems, paymentRows: submittedPaymentRows, allocations, paymentMode, idempotencyKey } = parsed.data;

  try {
    // ─── Phase 16B: idempotency — one checkout attempt can never pay twice ──
    // Runs before every other guard so retrying an attempt that already
    // succeeded returns the safe already-processed result instead of
    // "session ปิดแล้ว" / "บิลนี้ชำระครบแล้ว" errors.
    if (idempotencyKey) {
      const existingByKey = await db.query.payments.findFirst({
        where: eq(payments.idempotencyKey, idempotencyKey),
      });
      if (existingByKey) return alreadyProcessedPaymentResult(existingByKey);
    }

    // Parallel: session fetch + store settings + active shift + canonical saved bill
    const [session, [settings], activeShiftRows, savedChargeLineRows] = await Promise.all([
      db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
        with: {
          table: true,
          guests: { with: { pricingTile: true } },
          linkedSessions: true,
        },
      }),
      db.select({
        loyaltyPointsRedeemRate: storeSettings.loyaltyPointsRedeemRate,
      }).from(storeSettings).limit(1),
      // Soft-link: find open shift for current user — null if no shift open (never blocks payment)
      db.select({ id: cashierShifts.id })
        .from(cashierShifts)
        .where(and(eq(cashierShifts.cashierId, authSession.user.id), eq(cashierShifts.status, 'open')))
        .limit(1),
      // Canonical saved bill items — the authoritative pre-discount total for this session
      db.select({ total: buffetChargeLines.total })
        .from(buffetChargeLines)
        .where(and(
          eq(buffetChargeLines.sessionId, sessionId),
          isNull(buffetChargeLines.voidedAt),
        )),
    ]);
    const activeShiftId = activeShiftRows[0]?.id ?? null;
    // Sum of all non-voided charge lines: guests + addons — server source of truth
    const savedChargeLineTotal = savedChargeLineRows.reduce((sum, r) => sum + Number(r.total), 0);

    if (!session) return { ok: false as const, error: 'session ไม่ถูกต้อง' };

    // Strict mode: block cash payments when no shift is open (default off — set STRICT_SHIFT_CASH=true to enable)
    // cash_qr contains a cash component and must also be blocked
    const duplicateReceiptBeforeStatus = receiptNo
      ? await db.query.payments.findFirst({
          where: and(eq(payments.sessionId, sessionId), eq(payments.receiptNo, receiptNo), eq(payments.status, 'completed')),
        })
      : null;
    if (duplicateReceiptBeforeStatus) {
      return alreadyProcessedPaymentResult(duplicateReceiptBeforeStatus);
    }

    const legacyHasCash =
      parsed.data.paymentMethod === 'cash' || parsed.data.paymentMethod === 'cash_qr';
    if (STRICT_SHIFT_CASH && !activeShiftId && legacyHasCash) {
      return { ok: false as const, error: 'ต้องเปิดรอบแคชเชียร์ก่อนรับเงินสด' };
    }

    if (session.status === 'closed' || session.status === 'paid')
      return { ok: false as const, error: 'session ปิดแล้ว' };

    // Server-side guard: item-payment mode with no charge lines selected but bill has saved items
    if (paymentMode === 'items' && (!allocations || allocations.length === 0) && savedChargeLineTotal > 0) {
      return { ok: false as const, error: 'กรุณาเลือกรายการที่ต้องการรับชำระ' };
    }

    // Compute base + extra from all sessions in group (primary + linked)
    const linkedSessionIds = session.linkedSessions.map((s) => s.id);
    const allSessionIds = [sessionId, ...linkedSessionIds];
    const sessionOrders = await db.query.orders.findMany({
      where: inArray(orders.sessionId, allSessionIds),
      with: { items: { with: { menuItem: true } } },
    });

    const baseAmount = session.guests.reduce(
      (sum, g) => sum + Number(g.pricingTile.price) * g.quantity,
      0,
    );
    const extraAmount = sessionOrders
      .flatMap((o) => o.items)
      .filter((i) => i.status !== 'cancelled' && !i.menuItem?.isBuffet)
      .reduce((sum, i) => sum + Number(i.menuItem?.extraPrice ?? 0) * i.quantity, 0);

    const redeemRate = settings?.loyaltyPointsRedeemRate ?? 10;

    // Resolve line items: fetch tiles to re-derive amounts server-side
    let addonTotal = 0;
    let discountFromTiles = 0;
    let loyaltyPointsRedeemed = 0;
    const resolvedLineItems: Array<{ pricingTileId: string; quantity: number; amount: number }> = [];

    if (lineItems.length > 0) {
      const tileIds = lineItems.map((li) => li.pricingTileId);
      const tileFetch = await db
        .select({
          id: pricingTiles.id,
          category: pricingTiles.category,
          price: pricingTiles.price,
          discountType: pricingTiles.discountType,
          discountValue: pricingTiles.discountValue,
        })
        .from(pricingTiles)
        .where(inArray(pricingTiles.id, tileIds));
      const tileMap = new Map(tileFetch.map((t) => [t.id, t]));

      for (const li of lineItems) {
        const tile = tileMap.get(li.pricingTileId);
        if (!tile) continue;

        if (tile.category === 'addon') {
          const amount = addonLineAmount(tile.price, li.quantity);
          addonTotal += amount;
          resolvedLineItems.push({ pricingTileId: li.pricingTileId, quantity: li.quantity, amount });
        } else if (tile.category === 'discount') {
          // Base the percentage on chargeLines total when available; else on accumulated client amounts.
          // savedChargeLineTotal already includes addon chargeLines; addonTotal here is from lineItems only.
          const subtotalSoFar = discountBaseSoFar(savedChargeLineTotal, baseAmount, extraAmount, addonTotal);
          const amount = discountTileAmount(tile.discountType, tile.discountValue, li.quantity, subtotalSoFar);
          discountFromTiles += Math.abs(amount);
          resolvedLineItems.push({ pricingTileId: li.pricingTileId, quantity: li.quantity, amount });
        } else if (tile.category === 'loyalty') {
          // quantity = points to redeem; amount = -(points / redeemRate)
          const pointsToRedeem = li.quantity;
          const bahtDiscount = loyaltyRedemptionBaht(pointsToRedeem, redeemRate);
          loyaltyPointsRedeemed += pointsToRedeem;
          discountFromTiles += bahtDiscount;
          resolvedLineItems.push({ pricingTileId: li.pricingTileId, quantity: li.quantity, amount: -bahtDiscount });
        }
      }
    }

    // Canonical subtotal: saved chargeLines are the server-authoritative source when they exist.
    // chargeLines already capture guests + addon charge lines saved by updateSessionGuests.
    // lineItems addons are only used for legacy sessions without saved chargeLines.
    const subtotal = resolveCanonicalSubtotal(savedChargeLineTotal, baseAmount, extraAmount, addonTotal);
    const serviceCharge = 0;
    const discountAmount = (discount ?? 0) + discountFromTiles;
    const billTotal = computeBillTotal(subtotal, serviceCharge, discountAmount);
    const billTotalCents = toCents(billTotal);

    if (process.env.NODE_ENV !== 'production') {
      console.info('[processPayment]', {
        paymentMode,
        sessionId,
        savedChargeLineTotal,
        lineItemsAddonTotal: addonTotal,
        discountFromTiles,
        subtotal,
        billTotal,
        allocationsTotal: allocations?.reduce((s, a) => s + a.amount, 0) ?? 0,
        paymentRowsTotal: submittedPaymentRows?.reduce((s, r) => s + r.amount, 0) ?? 0,
      });
    }

    const [paidBeforeRow] = await db
      .select({ total: sql<number>`coalesce(sum(${payments.total}::numeric), 0)` })
      .from(payments)
      .where(and(inArray(payments.sessionId, allSessionIds), eq(payments.status, 'completed')));
    const paidBeforeCents = toCents(paidBeforeRow?.total ?? 0);

    const paidGuardError = paidBeforeError(paidBeforeCents, billTotalCents);
    if (paidGuardError) {
      return { ok: false as const, error: paidGuardError };
    }
    const remainingBeforeCents = billTotalCents - paidBeforeCents;

    const rowValidation = submittedPaymentRows
      ? await validateCheckoutPaymentRowsForTotal(
          submittedPaymentRows,
          settlementMode === 'final'
            ? fromCents(remainingBeforeCents)
            : submittedPaymentRows.reduce((sum, row) => sum + row.amount, 0),
        )
      : null;
    if (rowValidation && !rowValidation.ok) {
      return { ok: false as const, error: rowValidation.error };
    }

    // Cross-row receiving account group consistency: all rows in one payment
    // round must use the same account group (A or B). Accounts with no group
    // suffix (e.g. legacy_unknown) are exempt from this check.
    if (rowValidation?.ok && rowValidation.data.rows.length > 1) {
      if (hasMixedAccountGroups(rowValidation.data.rows.map((r) => r.account.code))) {
        return { ok: false as const, error: 'รอบชำระเดียวกันต้องใช้บัญชีรับเงินเดียวกัน' };
      }
    }

    if (
      STRICT_SHIFT_CASH &&
      !activeShiftId &&
      rowValidation?.ok &&
      rowValidation.data.rows.some((row) => row.method.type === 'cash')
    ) {
      return { ok: false as const, error: 'ต้องเปิดรอบแคชเชียร์ก่อนรับเงินสด' };
    }

    const paidThisTimeCents = rowValidation?.ok
      ? rowValidation.data.rows.reduce((sum, row) => sum + row.amountCents, 0)
      : remainingBeforeCents;
    const remainingAfterCents = remainingBeforeCents - paidThisTimeCents;

    const settlementError = settlementAmountError(settlementMode, paidThisTimeCents, remainingBeforeCents);
    if (settlementError) {
      return { ok: false as const, error: settlementError };
    }

    const paidThisTime = fromCents(paidThisTimeCents);
    const paidBefore = fromCents(paidBeforeCents);
    const remainingAfter = fromCents(remainingAfterCents);
    const paidTotal = fromCents(paidBeforeCents + paidThisTimeCents);

    // ─── Optional allocation validation (Phase 8B-3) ─────────────────────────
    // Set only when all checks pass; consumed after payment insert.
    let pendingAllocations: Array<{ chargeLineId: string; quantity: number; amount: number; note?: string | null }> | undefined;
    const allocLabelMap = new Map<string, string>();

    if (allocations && allocations.length > 0) {
      const inputLineIds = allocations.map((a) => a.chargeLineId);

      if (new Set(inputLineIds).size !== inputLineIds.length) {
        return { ok: false as const, error: 'พบรายการหัวซ้ำกัน กรุณาตรวจสอบ' };
      }

      const [allocLines, existingAllocRows] = await Promise.all([
        db.select({
          id: buffetChargeLines.id,
          sessionId: buffetChargeLines.sessionId,
          label: buffetChargeLines.label,
          unitPrice: buffetChargeLines.unitPrice,
          quantity: buffetChargeLines.quantity,
          voidedAt: buffetChargeLines.voidedAt,
        }).from(buffetChargeLines).where(inArray(buffetChargeLines.id, inputLineIds)),
        db.select({
          chargeLineId: paymentAllocations.chargeLineId,
          allocatedQty: sql<number>`sum(${paymentAllocations.quantity})::int`,
        }).from(paymentAllocations)
          .where(inArray(paymentAllocations.chargeLineId, inputLineIds))
          .groupBy(paymentAllocations.chargeLineId),
      ]);

      const lineMap = new Map(allocLines.map((l) => [l.id, l]));
      const existAllocMap = new Map(existingAllocRows.map((r) => [r.chargeLineId, r.allocatedQty]));

      for (const a of allocations) {
        const line = lineMap.get(a.chargeLineId);
        if (!line) return { ok: false as const, error: 'ไม่พบรายการหัว กรุณาตรวจสอบ' };
        if (line.sessionId !== sessionId)
          return { ok: false as const, error: 'รายการหัวไม่ตรงกับ session นี้' };
        if (line.voidedAt)
          return { ok: false as const, error: `รายการ ${line.label} ถูกยกเลิกแล้ว` };

        const expectedCents = Math.round(Number(line.unitPrice) * a.quantity * 100);
        const actualCents = toCents(a.amount);
        if (expectedCents !== actualCents) {
          return {
            ok: false as const,
            error: `ยอดชำระของหัวที่เลือกไม่ตรงกับราคาที่บันทึกไว้ (${line.label}: คาด ฿${(expectedCents / 100).toFixed(2)})`,
          };
        }

        const existingQty = existAllocMap.get(a.chargeLineId) ?? 0;
        if (existingQty + a.quantity > line.quantity) {
          return {
            ok: false as const,
            error: `จำนวนหัวที่เลือกเกินจำนวนคงเหลือ (${line.label}: คงเหลือ ${line.quantity - existingQty} หัว)`,
          };
        }
      }

      const allocTotalCents = allocations.reduce((s, a) => s + toCents(a.amount), 0);
      if (allocTotalCents !== paidThisTimeCents) {
        return { ok: false as const, error: 'ยอดรายการหัวที่เลือกไม่ตรงกับยอดรับชำระ' };
      }

      if (settlementMode === 'final') {
        const allActiveLines = await db.select({
          id: buffetChargeLines.id,
          label: buffetChargeLines.label,
          quantity: buffetChargeLines.quantity,
        }).from(buffetChargeLines).where(
          and(eq(buffetChargeLines.sessionId, sessionId), isNull(buffetChargeLines.voidedAt)),
        );
        if (allActiveLines.length > 0) {
          const allActiveIds = allActiveLines.map((l) => l.id);
          const allExistRows = await db.select({
            chargeLineId: paymentAllocations.chargeLineId,
            allocatedQty: sql<number>`sum(${paymentAllocations.quantity})::int`,
          }).from(paymentAllocations)
            .where(inArray(paymentAllocations.chargeLineId, allActiveIds))
            .groupBy(paymentAllocations.chargeLineId);
          const allExistMap = new Map(allExistRows.map((r) => [r.chargeLineId, r.allocatedQty]));
          const incomingByLineId = new Map(allocations.map((a) => [a.chargeLineId, a.quantity]));
          for (const line of allActiveLines) {
            const prevQty = allExistMap.get(line.id) ?? 0;
            const newQty = incomingByLineId.get(line.id) ?? 0;
            if (prevQty + newQty !== line.quantity) {
              return {
                ok: false as const,
                error: `ยังมีจำนวนหัวที่ยังไม่ได้รับการชำระ ไม่สามารถปิดบิลได้ (${line.label}: ชำระแล้ว ${prevQty + newQty}/${line.quantity})`,
              };
            }
          }
        }
      }

      allocLines.forEach((l) => allocLabelMap.set(l.id, l.label));
      pendingAllocations = allocations;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const duplicateReceiptPayment = receiptNo
      ? await db.query.payments.findFirst({
          where: and(eq(payments.sessionId, sessionId), eq(payments.receiptNo, receiptNo), eq(payments.status, 'completed')),
        })
      : null;
    if (duplicateReceiptPayment) {
      return alreadyProcessedPaymentResult(duplicateReceiptPayment);
    }

    const summaryPaymentMethod = rowValidation?.ok ? rowValidation.data.legacyPaymentMethod : paymentMethod;
    const summaryReceivedAmount = rowValidation?.ok ? rowValidation.data.receivedAmount : String(receivedAmount);
    const summaryChangeAmount = rowValidation?.ok
      ? rowValidation.data.changeAmount
      : String(legacyCashChange(paymentMethod, receivedAmount, paidThisTime));
    const summaryNotes = rowValidation?.ok
      ? [notes, rowValidation.data.notesSummary].filter(Boolean).join('\n\n')
      : notes;

    if (!rowValidation && paymentMethod === 'cash' && toCents(receivedAmount) < paidThisTimeCents)
      return { ok: false as const, error: 'จำนวนเงินที่รับไม่เพียงพอ' };

    const changeAmount = Number(summaryChangeAmount);

    // ─── Phase 16C-C1: batch-atomic write phase ─────────────────────────────
    // Every value is computed BEFORE any write so the whole write sequence runs
    // inside one db.batch() — a single atomic Neon HTTP transaction on the
    // current neon-http driver (docs/production/02_TRANSACTION_STRATEGY.md).
    // Either all statements commit or none do: a mid-write failure can no longer
    // leave a payment without rows, rows without allocations, or money recorded
    // on a session that never closes.
    const paymentId = crypto.randomUUID();
    const paidAt = new Date();

    // Legacy callers (no paymentRows submitted): resolve the summary method/
    // account BEFORE the batch so the single legacy tender row is written inside
    // it. Values mirror ensurePaymentRowsForLegacyPayment (payments/foundation).
    let legacyRowValues: typeof paymentRows.$inferInsert | null = null;
    if (!rowValidation) {
      const { method, account } = await resolveLegacyPaymentMethodAccount(summaryPaymentMethod, summaryNotes);
      const isLegacyCash = method.type === 'cash';
      const isLegacyMixed = method.type === 'mixed_legacy';
      legacyRowValues = {
        paymentId,
        sessionId,
        paymentMethodId: method.id,
        receivingAccountId: account.id,
        amount: paidThisTime.toFixed(2),
        amountTendered: isLegacyCash ? Number(summaryReceivedAmount).toFixed(2) : null,
        changeAmount: (isLegacyCash ? changeAmount : 0).toFixed(2),
        note: isLegacyMixed ? summaryNotes ?? 'Backfilled from legacy cash_qr payment' : summaryNotes ?? null,
        status: 'completed',
        cashierId: authSession.user.id,
        shiftId: activeShiftId,
        paidAt,
      };
    }

    // Allocation ids are pre-generated — batch statements cannot read each
    // other's RETURNING values — and the response summary is built from them.
    const preparedAllocations = (pendingAllocations ?? []).map((a) => ({
      id: crypto.randomUUID(),
      ...a,
    }));
    const allocationsSummary = preparedAllocations.map((a) => ({
      id: a.id,
      chargeLineId: a.chargeLineId,
      label: allocLabelMap.get(a.chargeLineId) ?? '',
      quantity: a.quantity,
      amount: a.amount,
    }));

    // Tax invoice number is generated BEFORE the batch (its counter is a
    // separate upsert). If the batch fails afterwards, that sequence number is
    // skipped — acceptable. The generator's own race is 16C-C3 scope.
    let taxInvoiceNumber: string | undefined;
    if (session.taxInvoiceRequested && settlementMode === 'final' && remainingAfterCents === 0) {
      taxInvoiceNumber = await generateTaxInvoiceNumber();
    }

    const isFinalSettled = settlementMode === 'final' && remainingAfterCents === 0;
    const allTableIds = [session.tableId, ...session.linkedSessions.map((s) => s.tableId)];

    // Statement 1 — payments insert. The 16B ON CONFLICT DO NOTHING is replaced
    // by letting the unique index raise (same duplicate-safe outcome, cleaner
    // mechanism): a concurrent duplicate key now aborts the WHOLE batch with a
    // 23505 on payments_idempotency_key_uq, so a losing request can never write
    // child rows or close the session. NULL keys (legacy callers) never conflict.
    const batchStatements: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(payments).values({
        id: paymentId,
        sessionId,
        subtotal: String(subtotal),
        serviceCharge: String(serviceCharge),
        discount: String(discountAmount),
        total: paidThisTime.toFixed(2),
        paymentMethod: summaryPaymentMethod,
        receivedAmount: summaryReceivedAmount,
        changeAmount: summaryChangeAmount,
        paidAt,
        processedBy: authSession.user.id,
        receiptNo: receiptNo ?? null,
        notes: summaryNotes,
        shiftId: activeShiftId,
        settlementType: settlementMode,
        billTotalAtPayment: billTotal.toFixed(2),
        paidBefore: paidBefore.toFixed(2),
        remainingAfter: remainingAfter.toFixed(2),
        idempotencyKey: idempotencyKey ?? null,
      }),
    ];

    // Statement 2 — tender rows (always present: draft rows or the legacy row).
    if (rowValidation?.ok) {
      batchStatements.push(
        db.insert(paymentRows).values(
          rowValidation.data.rows.map((row) => ({
            paymentId,
            sessionId,
            paymentMethodId: row.paymentMethodId,
            receivingAccountId: row.receivingAccountId,
            amount: (row.amountCents / 100).toFixed(2),
            amountTendered: row.tenderedCents == null ? null : (row.tenderedCents / 100).toFixed(2),
            changeAmount: (row.changeCents / 100).toFixed(2),
            referenceNo: row.referenceNo ?? null,
            payerLabel: row.payerLabel ?? null,
            note: row.note ?? null,
            status: 'completed' as const,
            cashierId: authSession.user.id,
            shiftId: activeShiftId,
            paidAt,
          })),
        ),
      );
    } else if (legacyRowValues) {
      batchStatements.push(db.insert(paymentRows).values(legacyRowValues));
    }

    if (preparedAllocations.length > 0) {
      batchStatements.push(
        db.insert(paymentAllocations).values(
          preparedAllocations.map((a) => ({
            id: a.id,
            paymentId,
            sessionId,
            chargeLineId: a.chargeLineId,
            quantity: a.quantity,
            amount: a.amount.toFixed(2),
            note: a.note ?? null,
          })),
        ),
      );
    }

    if (resolvedLineItems.length > 0) {
      batchStatements.push(
        db.insert(paymentLineItems).values(
          resolvedLineItems.map((li) => ({
            paymentId,
            pricingTileId: li.pricingTileId,
            quantity: li.quantity,
            amount: String(li.amount),
          })),
        ),
      );
    }

    if (taxInvoiceNumber) {
      batchStatements.push(
        db.update(sessions).set({ taxInvoiceNumber }).where(eq(sessions.id, sessionId)),
      );
    }

    if (isFinalSettled) {
      batchStatements.push(
        db.update(sessions)
          .set({ status: 'paid', closedAt: paidAt })
          .where(inArray(sessions.id, allSessionIds)),
      );
      batchStatements.push(
        db.update(tables).set({ status: 'paid' }).where(inArray(tables.id, allTableIds)),
      );
    }

    try {
      await db.batch(batchStatements);
    } catch (batchErr) {
      // A concurrent duplicate submit with the same idempotency key aborts the
      // batch atomically — this request wrote nothing. Return the winner's
      // result; skip row repair because the winner may still be writing its rows.
      if (idempotencyKey) {
        const winner = await db.query.payments.findFirst({
          where: eq(payments.idempotencyKey, idempotencyKey),
        });
        if (winner && winner.id !== paymentId) {
          return alreadyProcessedPaymentResult(winner, { repairRows: false });
        }
      }
      throw batchErr;
    }

    // Award loyalty points once for the original bill when fully settled.
    // Post-batch by design: it needs its own reads and is recoverable — a loss
    // here never affects payment integrity (02_TRANSACTION_STRATEGY.md).
    if (session.customerId && isFinalSettled) {
      await awardLoyaltyPoints({
        customerId: session.customerId,
        sessionId,
        totalAmount: billTotal,
        pointsRedeemed: loyaltyPointsRedeemed,
      });
    }

    revalidatePath('/pos');
    revalidatePath('/tables');
    revalidatePath('/dashboard');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'process_payment',
      entity: 'payments',
      entityId: paymentId,
      after: {
        sessionId,
        settlementType: settlementMode,
        billTotal,
        paidBefore,
        paidThisTime,
        paidTotal,
        remainingAfter,
        paymentMethod: summaryPaymentMethod,
        receiptNo: receiptNo ?? null,
        shiftId: activeShiftId,
        paymentRows: rowValidation?.ok ? rowValidation.data.rows.length : 1,
      },
    });
    if (allocationsSummary.length > 0) {
      writeAuditLog({
        userId: authSession.user.id,
        role: authSession.user.role,
        action: 'payment_allocation_created',
        entity: 'payment_allocations',
        entityId: paymentId,
        after: {
          sessionId,
          paymentId,
          allocationCount: allocationsSummary.length,
          paidThisTime,
          allocations: allocationsSummary.map((a) => ({ chargeLineId: a.chargeLineId, label: a.label, quantity: a.quantity, amount: a.amount })),
        },
      });
    }
    return {
      ok: true as const,
      data: {
        paymentId,
        total: paidThisTime,
        changeAmount,
        receiptNo: receiptNo ?? undefined,
        taxInvoiceNumber,
        settlementType: settlementMode,
        billTotal,
        paidBefore,
        paidThisTime,
        paidTotal,
        remainingAfter,
        shiftWarning: !activeShiftId, // true = payment saved without a linked shift
        alreadyProcessed: false as const, // Phase 16B — this call created the payment
        ...(allocationsSummary.length > 0 && { allocations: allocationsSummary }),
      },
    };
  } catch (e) {
    console.error('[processPayment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
