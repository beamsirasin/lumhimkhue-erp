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
  pricingTiles,
  storeSettings,
  cashierShifts,
  buffetChargeLines,
  paymentAllocations,
} from '@/lib/db/schema';
import { processPaymentSchema } from '@/lib/validations/pos';
import {
  ensurePaymentRowsForLegacyPayment,
  getActivePaymentMethodsWithAccounts,
  validateCheckoutPaymentRowsForTotal,
} from '@/lib/payments/foundation';

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
    return { ok: true as const, data: result };
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

function toCents(value: number | string | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

function fromCents(value: number) {
  return value / 100;
}

export async function processPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = processPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, settlementMode, paymentMethod, receivedAmount, discount, notes, receiptNo, lineItems, paymentRows: submittedPaymentRows, allocations } = parsed.data;

  try {
    // Parallel: session fetch + store settings + active shift lookup
    const [session, [settings], activeShiftRows] = await Promise.all([
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
    ]);
    const activeShiftId = activeShiftRows[0]?.id ?? null;

    if (!session) return { ok: false as const, error: 'session ไม่ถูกต้อง' };

    // Strict mode: block cash payments when no shift is open (default off — set STRICT_SHIFT_CASH=true to enable)
    // cash_qr contains a cash component and must also be blocked
    const duplicateReceiptBeforeStatus = receiptNo
      ? await db.query.payments.findFirst({
          where: and(eq(payments.sessionId, sessionId), eq(payments.receiptNo, receiptNo), eq(payments.status, 'completed')),
        })
      : null;
    if (duplicateReceiptBeforeStatus) {
      await ensurePaymentRowsForLegacyPayment(duplicateReceiptBeforeStatus);
      return {
        ok: true as const,
        data: {
          paymentId: duplicateReceiptBeforeStatus.id,
          total: Number(duplicateReceiptBeforeStatus.total),
          changeAmount: Number(duplicateReceiptBeforeStatus.changeAmount),
          receiptNo: duplicateReceiptBeforeStatus.receiptNo ?? undefined,
          settlementType: duplicateReceiptBeforeStatus.settlementType,
          billTotal: Number(duplicateReceiptBeforeStatus.billTotalAtPayment),
          paidBefore: Number(duplicateReceiptBeforeStatus.paidBefore),
          paidThisTime: Number(duplicateReceiptBeforeStatus.total),
          paidTotal: Number(duplicateReceiptBeforeStatus.paidBefore) + Number(duplicateReceiptBeforeStatus.total),
          remainingAfter: Number(duplicateReceiptBeforeStatus.remainingAfter),
          shiftWarning: !duplicateReceiptBeforeStatus.shiftId,
        },
      };
    }

    const legacyHasCash =
      parsed.data.paymentMethod === 'cash' || parsed.data.paymentMethod === 'cash_qr';
    if (STRICT_SHIFT_CASH && !activeShiftId && legacyHasCash) {
      return { ok: false as const, error: 'ต้องเปิดรอบแคชเชียร์ก่อนรับเงินสด' };
    }

    if (session.status === 'closed' || session.status === 'paid')
      return { ok: false as const, error: 'session ปิดแล้ว' };

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
          const amount = Number(tile.price) * li.quantity;
          addonTotal += amount;
          resolvedLineItems.push({ pricingTileId: li.pricingTileId, quantity: li.quantity, amount });
        } else if (tile.category === 'discount') {
          let amount = 0;
          const subtotalSoFar = baseAmount + extraAmount + addonTotal;
          if (tile.discountType === 'percentage') {
            amount = -(subtotalSoFar * Number(tile.discountValue) / 100);
          } else {
            amount = -(Number(tile.discountValue) * li.quantity);
          }
          discountFromTiles += Math.abs(amount);
          resolvedLineItems.push({ pricingTileId: li.pricingTileId, quantity: li.quantity, amount });
        } else if (tile.category === 'loyalty') {
          // quantity = points to redeem; amount = -(points / redeemRate)
          const pointsToRedeem = li.quantity;
          const bahtDiscount = pointsToRedeem / redeemRate;
          loyaltyPointsRedeemed += pointsToRedeem;
          discountFromTiles += bahtDiscount;
          resolvedLineItems.push({ pricingTileId: li.pricingTileId, quantity: li.quantity, amount: -bahtDiscount });
        }
      }
    }

    const subtotal = baseAmount + extraAmount + addonTotal;
    const serviceCharge = 0;
    const discountAmount = (discount ?? 0) + discountFromTiles;
    const billTotal = Math.max(0, subtotal + serviceCharge - discountAmount);
    const billTotalCents = toCents(billTotal);

    const [paidBeforeRow] = await db
      .select({ total: sql<number>`coalesce(sum(${payments.total}::numeric), 0)` })
      .from(payments)
      .where(and(inArray(payments.sessionId, allSessionIds), eq(payments.status, 'completed')));
    const paidBeforeCents = toCents(paidBeforeRow?.total ?? 0);

    if (paidBeforeCents > billTotalCents) {
      return {
        ok: false as const,
        error: 'ยอดบิลต่ำกว่ายอดที่ชำระไปแล้ว กรุณาตรวจสอบส่วนลดหรือรายการก่อนรับชำระเพิ่ม',
      };
    }

    const remainingBeforeCents = billTotalCents - paidBeforeCents;
    if (remainingBeforeCents <= 0) {
      return { ok: false as const, error: 'บิลนี้ชำระครบแล้ว' };
    }

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

    if (paidThisTimeCents <= 0) {
      return { ok: false as const, error: 'ยอดชำระต้องมากกว่า 0' };
    }
    if (paidThisTimeCents > remainingBeforeCents) {
      return { ok: false as const, error: 'ยอดชำระมากกว่ายอดคงเหลือ' };
    }
    if (settlementMode === 'partial' && paidThisTimeCents >= remainingBeforeCents) {
      return { ok: false as const, error: 'ยอดชำระบางส่วนต้องน้อยกว่ายอดคงเหลือ' };
    }
    if (settlementMode === 'final' && paidThisTimeCents !== remainingBeforeCents) {
      return { ok: false as const, error: 'ยอดปิดบิลต้องเท่ากับยอดคงเหลือ' };
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
      await ensurePaymentRowsForLegacyPayment(duplicateReceiptPayment);
      return {
        ok: true as const,
        data: {
          paymentId: duplicateReceiptPayment.id,
          total: Number(duplicateReceiptPayment.total),
          changeAmount: Number(duplicateReceiptPayment.changeAmount),
          receiptNo: duplicateReceiptPayment.receiptNo ?? undefined,
          settlementType: duplicateReceiptPayment.settlementType,
          billTotal: Number(duplicateReceiptPayment.billTotalAtPayment),
          paidBefore: Number(duplicateReceiptPayment.paidBefore),
          paidThisTime: Number(duplicateReceiptPayment.total),
          paidTotal: Number(duplicateReceiptPayment.paidBefore) + Number(duplicateReceiptPayment.total),
          remainingAfter: Number(duplicateReceiptPayment.remainingAfter),
          shiftWarning: !duplicateReceiptPayment.shiftId,
        },
      };
    }

    const summaryPaymentMethod = rowValidation?.ok ? rowValidation.data.legacyPaymentMethod : paymentMethod;
    const summaryReceivedAmount = rowValidation?.ok ? rowValidation.data.receivedAmount : String(receivedAmount);
    const summaryChangeAmount = rowValidation?.ok
      ? rowValidation.data.changeAmount
      : String(paymentMethod === 'cash' ? receivedAmount - paidThisTime : 0);
    const summaryNotes = rowValidation?.ok
      ? [notes, rowValidation.data.notesSummary].filter(Boolean).join('\n\n')
      : notes;

    if (!rowValidation && paymentMethod === 'cash' && toCents(receivedAmount) < paidThisTimeCents)
      return { ok: false as const, error: 'จำนวนเงินที่รับไม่เพียงพอ' };

    const changeAmount = Number(summaryChangeAmount);

    // Insert payment — shiftId linked if cashier has an open shift, null otherwise
    const [payment] = await db.insert(payments).values({
      sessionId,
      subtotal: String(subtotal),
      serviceCharge: String(serviceCharge),
      discount: String(discountAmount),
      total: paidThisTime.toFixed(2),
      paymentMethod: summaryPaymentMethod,
      receivedAmount: summaryReceivedAmount,
      changeAmount: summaryChangeAmount,
      processedBy: authSession.user.id,
      receiptNo: receiptNo ?? null,
      notes: summaryNotes,
      shiftId: activeShiftId,
      settlementType: settlementMode,
      billTotalAtPayment: billTotal.toFixed(2),
      paidBefore: paidBefore.toFixed(2),
      remainingAfter: remainingAfter.toFixed(2),
    }).returning({
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
    });

    if (rowValidation?.ok) {
      await db.insert(paymentRows).values(
        rowValidation.data.rows.map((row) => ({
          paymentId: payment.id,
          sessionId: payment.sessionId,
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
          paidAt: payment.paidAt,
        })),
      );
    } else {
      await ensurePaymentRowsForLegacyPayment(payment);
    }

    // Insert payment allocations (allocation-aware path only)
    const allocationsSummary: Array<{ id: string; chargeLineId: string; label: string; quantity: number; amount: number }> = [];
    if (pendingAllocations && pendingAllocations.length > 0) {
      const inserted = await db.insert(paymentAllocations).values(
        pendingAllocations.map((a) => ({
          paymentId: payment.id,
          sessionId,
          chargeLineId: a.chargeLineId,
          quantity: a.quantity,
          amount: a.amount.toFixed(2),
          note: a.note ?? null,
        })),
      ).returning({ id: paymentAllocations.id, chargeLineId: paymentAllocations.chargeLineId });

      const insertedMap = new Map(inserted.map((i) => [i.chargeLineId, i.id]));
      for (const a of pendingAllocations) {
        allocationsSummary.push({
          id: insertedMap.get(a.chargeLineId) ?? '',
          chargeLineId: a.chargeLineId,
          label: allocLabelMap.get(a.chargeLineId) ?? '',
          quantity: a.quantity,
          amount: a.amount,
        });
      }
    }

    // Insert payment line items
    if (resolvedLineItems.length > 0) {
      await db.insert(paymentLineItems).values(
        resolvedLineItems.map((li) => ({
          paymentId: payment.id,
          pricingTileId: li.pricingTileId,
          quantity: li.quantity,
          amount: String(li.amount),
        })),
      );
    }

    // Generate tax invoice number only once the bill is fully settled.
    let taxInvoiceNumber: string | undefined;
    if (session.taxInvoiceRequested && settlementMode === 'final' && remainingAfterCents === 0) {
      taxInvoiceNumber = await generateTaxInvoiceNumber();
      await db.update(sessions)
        .set({ taxInvoiceNumber })
        .where(eq(sessions.id, sessionId));
    }

    if (settlementMode === 'final' && remainingAfterCents === 0) {
      await db
        .update(sessions)
        .set({ status: 'paid', closedAt: new Date() })
        .where(inArray(sessions.id, allSessionIds));

      const allTableIds = [session.tableId, ...session.linkedSessions.map((s) => s.tableId)];
      await db
        .update(tables)
        .set({ status: 'paid' })
        .where(inArray(tables.id, allTableIds));
    }

    // Award loyalty points once for the original bill when fully settled.
    if (session.customerId && settlementMode === 'final' && remainingAfterCents === 0) {
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
      entityId: payment.id,
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
        entityId: payment.id,
        after: {
          sessionId,
          paymentId: payment.id,
          allocationCount: allocationsSummary.length,
          paidThisTime,
          allocations: allocationsSummary.map((a) => ({ chargeLineId: a.chargeLineId, label: a.label, quantity: a.quantity, amount: a.amount })),
        },
      });
    }
    return {
      ok: true as const,
      data: {
        paymentId: payment.id,
        total: paidThisTime,
        changeAmount,
        receiptNo: receiptNo ?? undefined,
        taxInvoiceNumber,
        settlementType: payment.settlementType,
        billTotal,
        paidBefore,
        paidThisTime,
        paidTotal,
        remainingAfter,
        shiftWarning: !activeShiftId, // true = payment saved without a linked shift
        ...(allocationsSummary.length > 0 && { allocations: allocationsSummary }),
      },
    };
  } catch (e) {
    console.error('[processPayment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
