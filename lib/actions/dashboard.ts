'use server';

import { eq, gte, and, not, desc, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay, subDays } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { payments, sessions, tables, orderItems, orders, menuItems } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

function bangkokDayStart(offsetDays = 0): Date {
  const zonedNow = toZonedTime(subDays(new Date(), offsetDays), TZ);
  return fromZonedTime(startOfDay(zonedNow), TZ);
}

async function requireOwner() {
  const authSession = await auth();
  if (!authSession?.user) return null;
  if (!can(authSession.user.role, 'view_reports')) return null;
  return authSession;
}

export async function getDashboardData() {
  const session = await requireOwner();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const todayStart = bangkokDayStart();
    const sevenDaysAgo = bangkokDayStart(6);

    // ─── Today KPIs ─────────────────────────────────────────────────────────
    const [todayRevRow] = await db
      .select({
        revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
        sessions: sql<number>`count(*)`,
        guests: sql<number>`coalesce(sum(${sessions.adults} + ${sessions.children} + ${sessions.seniors}), 0)`,
      })
      .from(payments)
      .innerJoin(sessions, eq(payments.sessionId, sessions.id))
      .where(gte(payments.paidAt, todayStart));

    const revenueToday = Number(todayRevRow.revenue);
    const sessionsToday = Number(todayRevRow.sessions);
    const guestsToday = Number(todayRevRow.guests);
    const avgPerSession = sessionsToday > 0 ? revenueToday / sessionsToday : 0;

    // ─── Revenue by day (last 7 days) ────────────────────────────────────────
    const dbRevByDay = await db
      .select({
        date: sql<string>`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`,
        revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
        sessionCount: sql<number>`count(*)`,
        guests: sql<number>`coalesce(sum(${sessions.adults} + ${sessions.children} + ${sessions.seniors}), 0)`,
      })
      .from(payments)
      .innerJoin(sessions, eq(payments.sessionId, sessions.id))
      .where(gte(payments.paidAt, sevenDaysAgo))
      .groupBy(sql`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`)
      .orderBy(sql`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`);

    const revMap = new Map(dbRevByDay.map((r) => [r.date, r]));
    const revenueByDay = Array.from({ length: 7 }, (_, i) => {
      const d = format(toZonedTime(subDays(new Date(), 6 - i), TZ), 'yyyy-MM-dd');
      const row = revMap.get(d);
      return {
        date: d,
        revenue: Number(row?.revenue ?? 0),
        sessions: Number(row?.sessionCount ?? 0),
        guests: Number(row?.guests ?? 0),
      };
    });

    // ─── Top menu items today ─────────────────────────────────────────────────
    const topMenuItems = await db
      .select({
        name: menuItems.name,
        quantity: sql<number>`sum(${orderItems.quantity})`,
      })
      .from(orderItems)
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          gte(orders.createdAt, todayStart),
          not(eq(orderItems.status, 'cancelled')),
        ),
      )
      .groupBy(menuItems.id, menuItems.name)
      .orderBy(desc(sql`sum(${orderItems.quantity})`))
      .limit(10);

    // ─── Payment methods today ────────────────────────────────────────────────
    const paymentMethods = await db
      .select({
        method: payments.paymentMethod,
        count: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
      })
      .from(payments)
      .where(gte(payments.paidAt, todayStart))
      .groupBy(payments.paymentMethod)
      .orderBy(desc(sql`sum(${payments.total}::numeric)`));

    // ─── Live table summary ───────────────────────────────────────────────────
    const tableSummary = await db
      .select({
        status: tables.status,
        count: sql<number>`count(*)`,
      })
      .from(tables)
      .groupBy(tables.status)
      .orderBy(asc(tables.status));

    return {
      ok: true as const,
      data: {
        kpis: { revenueToday, sessionsToday, guestsToday, avgPerSession },
        revenueByDay,
        topMenuItems: topMenuItems.map((i) => ({ name: i.name, quantity: Number(i.quantity) })),
        paymentMethods: paymentMethods.map((p) => ({
          method: p.method,
          count: Number(p.count),
          total: Number(p.total),
        })),
        tableSummary: tableSummary.map((t) => ({
          status: t.status,
          count: Number(t.count),
        })),
      },
    };
  } catch (e) {
    console.error('[getDashboardData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type DashboardData = NonNullable<
  Extract<Awaited<ReturnType<typeof getDashboardData>>, { ok: true }>['data']
>;

export async function getReportSummary(fromDate: string, toDate: string) {
  const session = await requireOwner();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const from = fromZonedTime(startOfDay(toZonedTime(new Date(fromDate), TZ)), TZ);
    const toEnd = fromZonedTime(
      startOfDay(toZonedTime(new Date(toDate), TZ)),
      TZ,
    );
    // include full toDate day
    toEnd.setDate(toEnd.getDate() + 1);

    const rows = await db
      .select({
        date: sql<string>`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`,
        revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
        sessionCount: sql<number>`count(*)`,
        guests: sql<number>`coalesce(sum(${sessions.adults} + ${sessions.children} + ${sessions.seniors}), 0)`,
      })
      .from(payments)
      .innerJoin(sessions, eq(payments.sessionId, sessions.id))
      .where(and(gte(payments.paidAt, from), not(gte(payments.paidAt, toEnd))))
      .groupBy(sql`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`)
      .orderBy(sql`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`);

    const data = rows.map((r) => ({
      date: r.date,
      sessions: Number(r.sessionCount),
      guests: Number(r.guests),
      revenue: Number(r.revenue),
      avgPerSession: Number(r.sessionCount) > 0 ? Number(r.revenue) / Number(r.sessionCount) : 0,
    }));

    const totals = data.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        guests: acc.guests + r.guests,
        revenue: acc.revenue + r.revenue,
      }),
      { sessions: 0, guests: 0, revenue: 0 },
    );

    return { ok: true as const, data: { rows: data, totals } };
  } catch (e) {
    console.error('[getReportSummary]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type ReportSummary = NonNullable<
  Extract<Awaited<ReturnType<typeof getReportSummary>>, { ok: true }>['data']
>;
