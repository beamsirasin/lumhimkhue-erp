'use server';

import { eq, and, gte, not, desc, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, payments, orders, orderItems, menuItems } from '@/lib/db/schema';

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
        paymentMethod: payments.paymentMethod,
        guestCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          WHERE sg.session_id = ${sessions.id}
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
        paymentMethod: r.paymentMethod,
        guestCount: Number(r.guestCount),
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
