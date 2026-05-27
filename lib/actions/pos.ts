'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, asc } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, orders, orderItems, tables, payments } from '@/lib/db/schema';
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
      with: { table: true, package: true },
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
      with: { table: true, package: true },
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

    const pkg = session.package;
    const baseAmount =
      Number(pkg.priceAdult) * session.adults +
      Number(pkg.priceChild) * session.children +
      Number(pkg.priceSenior) * session.seniors;

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

export async function processPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = processPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, paymentMethod, receivedAmount, discount, wasteCharge, notes } = parsed.data;

  try {
    // Verify session + no duplicate payment
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { table: true, package: true },
    });
    if (!session || session.status === 'closed')
      return { ok: false as const, error: 'session ไม่ถูกต้องหรือชำระเงินแล้ว' };

    const [existingPayment] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.sessionId, sessionId))
      .limit(1);
    if (existingPayment)
      return { ok: false as const, error: 'session นี้ชำระเงินแล้ว' };

    // Compute totals server-side
    const sessionOrders = await db.query.orders.findMany({
      where: eq(orders.sessionId, sessionId),
      with: {
        items: {
          with: { menuItem: true },
        },
      },
    });

    const pkg = session.package;
    const baseAmount =
      Number(pkg.priceAdult) * session.adults +
      Number(pkg.priceChild) * session.children +
      Number(pkg.priceSenior) * session.seniors;

    const extraAmount = sessionOrders
      .flatMap((o) => o.items)
      .filter((i) => i.status !== 'cancelled' && !i.menuItem.isBuffet)
      .reduce((sum, i) => sum + Number(i.menuItem.extraPrice) * i.quantity, 0);

    const subtotal = baseAmount + extraAmount;
    const serviceCharge = 0;
    const total = subtotal + serviceCharge - discount + wasteCharge;

    if (paymentMethod === 'cash' && receivedAmount < total)
      return { ok: false as const, error: 'จำนวนเงินที่รับไม่เพียงพอ' };

    const changeAmount = paymentMethod === 'cash' ? receivedAmount - total : 0;

    await db.insert(payments).values({
      sessionId,
      subtotal: String(subtotal),
      serviceCharge: String(serviceCharge),
      discount: String(discount),
      wasteCharge: String(wasteCharge),
      total: String(total),
      paymentMethod,
      receivedAmount: String(receivedAmount),
      changeAmount: String(changeAmount),
      processedBy: authSession.user.id,
      notes,
    });

    await db
      .update(sessions)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    await db
      .update(tables)
      .set({ status: 'cleaning' })
      .where(eq(tables.id, session.tableId));

    revalidatePath('/pos');
    revalidatePath('/tables');
    return { ok: true as const, data: { total, changeAmount } };
  } catch (e) {
    console.error('[processPayment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
