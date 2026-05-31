'use server';

import { eq, and, gte, not, desc, asc, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, payments, paymentLineItems, orders, orderItems, menuItems } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

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
        totalRevenue: sql<number>`coalesce(${payments.total}::numeric, 0)`,
        receivedAmount: sql<number>`coalesce(${payments.receivedAmount}::numeric, 0)`,
        paymentMethod: payments.paymentMethod,
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
      .leftJoin(payments, eq(payments.sessionId, sessions.id))
      .where(
        and(
          gte(sessions.startedAt, from),
          not(gte(sessions.startedAt, to)),
        ),
      )
      .orderBy(desc(sessions.startedAt));

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
        payment: true,
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

    return { ok: true as const, data: { session, orders: sessionOrders } };
  } catch (e) {
    console.error('[getSessionDetail]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SessionDetailData = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionDetail>>, { ok: true }>['data']
>;

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

export async function deletePaymentRecord(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = z.object({ paymentId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { paymentId } = parsed.data;
  try {
    const [payment] = await db
      .select({ id: payments.id, sessionId: payments.sessionId })
      .from(payments)
      .where(eq(payments.id, paymentId));
    if (!payment) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };

    await db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId));
    await db.delete(payments).where(eq(payments.id, paymentId));
    // Mark session closed (no payment) so it stays in history but doesn't re-appear in POS
    await db.update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, payment.sessionId));

    revalidatePath('/pos/history');
    revalidatePath('/tables/history');
    return { ok: true as const };
  } catch (e) {
    console.error('[deletePaymentRecord]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── reopenSessionForPayment — ยกเลิกการชำระ แล้วส่งกลับ POS ──────── */

export async function reopenSessionForPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = z.object({ paymentId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { paymentId } = parsed.data;
  try {
    const [payment] = await db
      .select({ id: payments.id, sessionId: payments.sessionId })
      .from(payments)
      .where(eq(payments.id, paymentId));
    if (!payment) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };

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

    await db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId));
    await db.delete(payments).where(eq(payments.id, paymentId));
    await db.update(sessions)
      .set({ status: 'closing', closedAt: null })
      .where(inArray(sessions.id, allSessionIds));
    await db.update(tables)
      .set({ status: 'occupied' })
      .where(inArray(tables.id, allTableIds));

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
