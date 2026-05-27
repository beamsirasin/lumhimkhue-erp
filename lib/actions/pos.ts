'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, asc } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import {
  sessions,
  orders,
  tables,
  payments,
  paymentLineItems,
  pricingTiles,
} from '@/lib/db/schema';
import { processPaymentSchema } from '@/lib/validations/pos';

export async function getPosSessionsForPos() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const result = await db.query.sessions.findMany({
      where: inArray(sessions.status, ['active', 'closing']),
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
        guests: {
          with: { pricingTile: true },
        },
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

    const baseAmount = session.guests.reduce(
      (sum, g) => sum + Number(g.pricingTile.price) * g.quantity,
      0,
    );

    const extraAmount = sessionOrders
      .flatMap((o) => o.items)
      .filter((i) => i.status !== 'cancelled' && !i.menuItem.isBuffet)
      .reduce((sum, i) => sum + Number(i.menuItem.extraPrice) * i.quantity, 0);

    const subtotal = baseAmount + extraAmount;

    return {
      ok: true as const,
      data: {
        session,
        orders: sessionOrders,
        totals: { baseAmount, extraAmount, subtotal, total: subtotal },
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
        addons: addonTiles.filter((t) => t.category === 'addon'),
        discounts: addonTiles.filter((t) => t.category === 'discount'),
      },
    };
  } catch (e) {
    console.error('[getActiveTilesForPos]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function processPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = processPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, paymentMethod, receivedAmount, discount, notes, lineItems } = parsed.data;

  try {
    // Verify session + no duplicate payment
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: {
        table: true,
        guests: { with: { pricingTile: true } },
        linkedSessions: true,
      },
    });
    if (!session || session.status === 'closed')
      return { ok: false as const, error: 'session ไม่ถูกต้องหรือชำระเงินแล้ว' };

    const [existingPayment] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.sessionId, sessionId))
      .limit(1);
    if (existingPayment) return { ok: false as const, error: 'session นี้ชำระเงินแล้ว' };

    // Compute base + extra from orders
    const sessionOrders = await db.query.orders.findMany({
      where: eq(orders.sessionId, sessionId),
      with: { items: { with: { menuItem: true } } },
    });

    const baseAmount = session.guests.reduce(
      (sum, g) => sum + Number(g.pricingTile.price) * g.quantity,
      0,
    );
    const extraAmount = sessionOrders
      .flatMap((o) => o.items)
      .filter((i) => i.status !== 'cancelled' && !i.menuItem.isBuffet)
      .reduce((sum, i) => sum + Number(i.menuItem.extraPrice) * i.quantity, 0);

    // Resolve line items: fetch tiles to re-derive amounts server-side
    let addonTotal = 0;
    let discountFromTiles = 0;
    const resolvedLineItems: Array<{ pricingTileId: string; quantity: number; amount: number }> = [];

    if (lineItems.length > 0) {
      const tileIds = lineItems.map((li) => li.pricingTileId);
      const tileFetch = await db
        .select()
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

    // Insert payment
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
      notes,
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

    // Close primary session + linked sessions
    const linkedSessionIds = session.linkedSessions.map((s) => s.id);
    const allSessionIds = [sessionId, ...linkedSessionIds];

    await db
      .update(sessions)
      .set({ status: 'closed', closedAt: new Date() })
      .where(inArray(sessions.id, allSessionIds));

    // Release all related tables
    const allTableIds = [session.table.id, ...session.linkedSessions.map((s) => s.tableId)];
    await db
      .update(tables)
      .set({ status: 'available' })
      .where(inArray(tables.id, allTableIds));

    revalidatePath('/pos');
    revalidatePath('/tables');
    return { ok: true as const, data: { total, changeAmount } };
  } catch (e) {
    console.error('[processPayment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
