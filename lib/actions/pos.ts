'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray, asc } from 'drizzle-orm';
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
  pricingTiles,
  storeSettings,
  cashierShifts,
} from '@/lib/db/schema';
import { processPaymentSchema } from '@/lib/validations/pos';

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

    // Group bill: include orders from linked sessions
    const linkedSessionIds = session.linkedSessions.map((s) => s.id);
    const allSessionIds = [sessionId, ...linkedSessionIds];
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
    const isGroupBill = linkedSessionIds.length > 0;
    const linkedTableLabels = session.linkedSessions.map((s) => s.table.label);

    return {
      ok: true as const,
      data: {
        session,
        orders: sessionOrders,
        totals: { baseAmount, extraAmount, subtotal, total: subtotal },
        isGroupBill,
        linkedTableLabels,
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

// TODO Phase 1 Step 5E: move to store_settings.require_shift_for_cash when schema field is ready.
// Set env STRICT_SHIFT_CASH=true to block cash payments without an open shift.
const STRICT_SHIFT_CASH = process.env.STRICT_SHIFT_CASH === 'true';

export async function processPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = processPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, paymentMethod, receivedAmount, discount, notes, receiptNo, lineItems } = parsed.data;

  try {
    // Parallel: session fetch + idempotency check + store settings + active shift lookup
    const [session, existingPayment, [settings], activeShiftRows] = await Promise.all([
      db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
        with: {
          table: true,
          guests: { with: { pricingTile: true } },
          linkedSessions: true,
        },
      }),
      db.query.payments.findFirst({
        where: eq(payments.sessionId, sessionId),
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
    if (STRICT_SHIFT_CASH && !activeShiftId && parsed.data.paymentMethod === 'cash') {
      return { ok: false as const, error: 'ต้องเปิดรอบแคชเชียร์ก่อนรับเงินสด' };
    }

    // Idempotency: if payment already exists (e.g. previous attempt succeeded in DB but threw before returning), return it
    if (existingPayment) {
      return {
        ok: true as const,
        data: {
          total: Number(existingPayment.total),
          changeAmount: Number(existingPayment.changeAmount),
          receiptNo: existingPayment.receiptNo ?? undefined,
        },
      };
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
    const total = Math.max(0, subtotal + serviceCharge - discountAmount);

    if (paymentMethod === 'cash' && receivedAmount < total)
      return { ok: false as const, error: 'จำนวนเงินที่รับไม่เพียงพอ' };

    const changeAmount = paymentMethod === 'cash' ? receivedAmount - total : 0;

    // Insert payment — shiftId linked if cashier has an open shift, null otherwise
    const [payment] = await db.insert(payments).values({
      sessionId,
      subtotal: String(subtotal),
      serviceCharge: String(serviceCharge),
      discount: String(discountAmount),
      total: String(total),
      paymentMethod,
      receivedAmount: String(receivedAmount),
      changeAmount: String(changeAmount),
      processedBy: authSession.user.id,
      receiptNo: receiptNo ?? null,
      notes,
      shiftId: activeShiftId,
    }).returning({ id: payments.id });

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

    // Generate tax invoice number if requested
    let taxInvoiceNumber: string | undefined;
    if (session.taxInvoiceRequested) {
      taxInvoiceNumber = await generateTaxInvoiceNumber();
      await db.update(sessions)
        .set({ taxInvoiceNumber })
        .where(eq(sessions.id, sessionId));
    }

    // Mark session as paid (table cleared by staff separately)
    await db
      .update(sessions)
      .set({ status: 'paid', closedAt: new Date() })
      .where(inArray(sessions.id, allSessionIds));

    const allTableIds = [session.tableId, ...session.linkedSessions.map((s) => s.tableId)];
    await db
      .update(tables)
      .set({ status: 'paid' })
      .where(inArray(tables.id, allTableIds));

    // Award loyalty points if session linked to a customer
    if (session.customerId) {
      await awardLoyaltyPoints({
        customerId: session.customerId,
        sessionId,
        totalAmount: total,
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
      after: { sessionId, total, paymentMethod, receiptNo: receiptNo ?? null, shiftId: activeShiftId },
    });
    return {
      ok: true as const,
      data: {
        total,
        changeAmount,
        receiptNo: receiptNo ?? undefined,
        taxInvoiceNumber,
        shiftWarning: !activeShiftId, // true = payment saved without a linked shift
      },
    };
  } catch (e) {
    console.error('[processPayment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
