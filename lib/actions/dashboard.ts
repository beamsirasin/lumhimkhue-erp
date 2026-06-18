'use server';

import { eq, gte, lt, and, not, desc, asc, inArray, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay, startOfISOWeek, startOfMonth, subDays, addDays, addMonths, subMonths, differenceInCalendarDays } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { payments, sessions, sessionGuests, pricingTiles, tables, orderItems, orders, menuItems, recipes, recipeIngredients, ingredients, payrollCycles, payrollItems } from '@/lib/db/schema';

// Pre-aggregated guest totals per session — used as a derived table to replace
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
        sessionCount: sql<number>`count(distinct ${sessions.id})`,
        guests: sql<number>`(
          select coalesce(sum(sg.quantity), 0)
          from session_guests sg
          where sg.session_id in (
            select distinct p2.session_id
            from payments p2
            where p2.paid_at >= ${todayStart}
          )
        )`,
      })
      .from(payments)
      .innerJoin(sessions, eq(payments.sessionId, sessions.id))
      .where(gte(payments.paidAt, todayStart));

    const revenueToday = Number(todayRevRow.revenue);
    const sessionsToday = Number(todayRevRow.sessionCount);
    const guestsToday = Number(todayRevRow.guests);
    const avgPerSession = sessionsToday > 0 ? revenueToday / sessionsToday : 0;

    // ─── Revenue by day (last 7 days) ────────────────────────────────────────
    const dbRevByDay = await db
      .select({
        date: sql<string>`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`,
        revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
        sessionCount: sql<number>`count(distinct ${sessions.id})`,
        guests: sql<number>`(
          select coalesce(sum(sg.quantity), 0)
          from session_guests sg
          where sg.session_id in (
            select distinct p2.session_id
            from payments p2
            where (p2.paid_at AT TIME ZONE 'Asia/Bangkok')::date =
              (${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date
          )
        )`,
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

export async function getReportSummary(
  fromDate: string,
  toDate: string,
  sessionType: 'all' | 'primary' | 'secondary' = 'all',
) {
  const session = await requireOwner();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const from = fromZonedTime(startOfDay(toZonedTime(new Date(fromDate), TZ)), TZ);
    const toEnd = fromZonedTime(startOfDay(toZonedTime(new Date(toDate), TZ)), TZ);
    toEnd.setDate(toEnd.getDate() + 1);

    const sessionFilter =
      sessionType === 'primary'
        ? isNull(sessions.parentSessionId)
        : sessionType === 'secondary'
        ? not(isNull(sessions.parentSessionId))
        : undefined;

    const dateFilter = and(gte(payments.paidAt, from), not(gte(payments.paidAt, toEnd)));
    const baseWhere = sessionFilter ? and(dateFilter, sessionFilter) : dateFilter;

    // ── Per-day rows ───────────────────────────────────────────────────────
    const rows = await db
      .select({
        date: sql<string>`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`,
        revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
        sessionCount: sql<number>`count(distinct ${sessions.id})`,
        guests: sql<number>`(
          select coalesce(sum(sg.quantity), 0)
          from session_guests sg
          where sg.session_id in (
            select distinct p2.session_id
            from payments p2
            where (p2.paid_at AT TIME ZONE 'Asia/Bangkok')::date =
              (${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date
          )
        )`,
      })
      .from(payments)
      .innerJoin(sessions, eq(payments.sessionId, sessions.id))
      .where(baseWhere)
      .groupBy(sql`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`)
      .orderBy(sql`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`);

    // ── Guest breakdown by pricing tile ────────────────────────────────────
    const guestBreakdown = await db
      .select({
        name: pricingTiles.name,
        sortOrder: pricingTiles.sortOrder,
        total: sql<number>`coalesce(sum(${sessionGuests.quantity}), 0)`,
      })
      .from(sessionGuests)
      .innerJoin(pricingTiles, eq(sessionGuests.pricingTileId, pricingTiles.id))
      .innerJoin(sessions, eq(sessionGuests.sessionId, sessions.id))
      .where(and(
        sessionFilter,
        eq(pricingTiles.category, 'guest'),
        sql`exists (
          select 1
          from payments p
          where p.session_id = ${sessions.id}
            and p.status = 'completed'
            and p.paid_at >= ${from}
            and not (p.paid_at >= ${toEnd})
        )`,
      ))
      .groupBy(pricingTiles.id, pricingTiles.name, pricingTiles.sortOrder)
      .orderBy(pricingTiles.sortOrder);

    // ── Payment method breakdown ───────────────────────────────────────────
    const paymentBreakdown = await db
      .select({
        method: payments.paymentMethod,
        revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(payments)
      .innerJoin(sessions, eq(payments.sessionId, sessions.id))
      .where(baseWhere)
      .groupBy(payments.paymentMethod)
      .orderBy(payments.paymentMethod);

    const data = rows.map((r) => ({
      date: r.date,
      sessions: Number(r.sessionCount),
      guests: Number(r.guests),
      revenue: Number(r.revenue),
      avgPerSession: Number(r.sessionCount) > 0 ? Number(r.revenue) / Number(r.sessionCount) : 0,
    }));

    const totals = data.reduce(
      (acc, r) => ({ sessions: acc.sessions + r.sessions, guests: acc.guests + r.guests, revenue: acc.revenue + r.revenue }),
      { sessions: 0, guests: 0, revenue: 0 },
    );

    return {
      ok: true as const,
      data: {
        rows: data,
        totals,
        guestBreakdown: guestBreakdown.map((r) => ({ name: r.name, total: Number(r.total) })),
        paymentBreakdown: paymentBreakdown.map((r) => ({
          method: r.method,
          revenue: Number(r.revenue),
          count: Number(r.count),
        })),
      },
    };
  } catch (e) {
    console.error('[getReportSummary]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type ReportSummary = NonNullable<
  Extract<Awaited<ReturnType<typeof getReportSummary>>, { ok: true }>['data']
>;

// ── Period KPIs ───────────────────────────────────────────────────────────────

export type KpiMetric = {
  value: number;
  prevValue: number;
  changePct: number | null;
  changeDir: 'up' | 'down' | 'flat';
};

export type PeriodKpis = {
  period: 'today' | 'week' | 'month';
  days: number;
  revenue: KpiMetric;
  sessions: KpiMetric;
  guests: KpiMetric;
  avgPerSession: KpiMetric;
  foodCostPct: KpiMetric & { available: boolean };
  laborCostPct: KpiMetric & { available: boolean };
  avgTableTurns: KpiMetric;
  revpash: KpiMetric;
};

function mkKpi(value: number, prevValue: number): KpiMetric {
  const changePct = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : null;
  const changeDir: KpiMetric['changeDir'] =
    changePct === null ? 'flat' : changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'flat';
  return { value, prevValue, changePct, changeDir };
}

function periodRanges(period: 'today' | 'week' | 'month') {
  const zonedNow = toZonedTime(new Date(), TZ);
  if (period === 'today') {
    const d = startOfDay(zonedNow);
    return {
      curStart: fromZonedTime(d, TZ),
      curEnd: fromZonedTime(addDays(d, 1), TZ),
      prevStart: fromZonedTime(subDays(d, 1), TZ),
      prevEnd: fromZonedTime(d, TZ),
      days: 1,
    };
  }
  if (period === 'week') {
    const w = startOfISOWeek(zonedNow);
    return {
      curStart: fromZonedTime(w, TZ),
      curEnd: fromZonedTime(addDays(w, 7), TZ),
      prevStart: fromZonedTime(subDays(w, 7), TZ),
      prevEnd: fromZonedTime(w, TZ),
      days: 7,
    };
  }
  const m = startOfMonth(zonedNow);
  const next = addMonths(m, 1);
  const prev = subMonths(m, 1);
  return {
    curStart: fromZonedTime(m, TZ),
    curEnd: fromZonedTime(next, TZ),
    prevStart: fromZonedTime(prev, TZ),
    prevEnd: fromZonedTime(m, TZ),
    days: differenceInCalendarDays(next, m),
  };
}

async function queryPeriodRevenue(start: Date, end: Date) {
  const [row] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
      sessionCount: sql<number>`count(distinct ${sessions.id})`,
      guests: sql<number>`(
        select coalesce(sum(sg.quantity), 0)
        from session_guests sg
        where sg.session_id in (
          select distinct p2.session_id
          from payments p2
          where p2.paid_at >= ${start}
            and p2.paid_at < ${end}
        )
      )`,
    })
    .from(payments)
    .innerJoin(sessions, eq(payments.sessionId, sessions.id))
    .where(and(gte(payments.paidAt, start), lt(payments.paidAt, end)));
  return { revenue: Number(row.revenue), sessions: Number(row.sessionCount), guests: Number(row.guests) };
}

async function queryPeriodFoodCost(start: Date, end: Date): Promise<number> {
  try {
    const served = await db
      .select({
        menuItemId: orderItems.menuItemId,
        qty: sql<string>`sum(${orderItems.quantity})`,
      })
      .from(orderItems)
      .where(and(
        eq(orderItems.status, 'served'),
        gte(orderItems.servedAt, start),
        lt(orderItems.servedAt, end),
        not(isNull(orderItems.menuItemId)),
      ))
      .groupBy(orderItems.menuItemId);

    if (!served.length) return 0;
    const ids = served.map((r) => r.menuItemId!).filter(Boolean);
    const activeRecipes = await db.query.recipes.findMany({
      where: and(inArray(recipes.menuItemId, ids), eq(recipes.isActive, true)),
      with: { ingredients: { with: { ingredient: { columns: { lastCost: true } } } } },
    });
    const costByItem = new Map<string, number>();
    for (const rec of activeRecipes) {
      if (!costByItem.has(rec.menuItemId)) {
        const raw = rec.ingredients.reduce((s, ri) => s + parseFloat(ri.ingredient.lastCost) * parseFloat(ri.quantity), 0);
        costByItem.set(rec.menuItemId, raw / rec.servingSize);
      }
    }
    return served.reduce((s, r) => s + (costByItem.get(r.menuItemId!) ?? 0) * parseFloat(r.qty), 0);
  } catch { return -1; }
}

async function queryPeriodLaborCost(start: Date, end: Date): Promise<number> {
  try {
    const startStr = format(toZonedTime(start, TZ), 'yyyy-MM-dd');
    const endStr = format(toZonedTime(end, TZ), 'yyyy-MM-dd');
    const cycles = await db
      .select({ id: payrollCycles.id })
      .from(payrollCycles)
      .where(and(gte(payrollCycles.payDate, startStr), lt(payrollCycles.payDate, endStr)));
    if (!cycles.length) return -1;
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${payrollItems.gross}::numeric), 0)` })
      .from(payrollItems)
      .where(inArray(payrollItems.payrollCycleId, cycles.map((c) => c.id)));
    return Number(row.total);
  } catch { return -1; }
}

export async function getDashboardKpisForPeriod(period: 'today' | 'week' | 'month') {
  const session = await requireOwner();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const { curStart, curEnd, prevStart, prevEnd, days } = periodRanges(period);

    const [cur, prev, totalCapacity, curFoodCost, prevFoodCost, curLabor, prevLabor] = await Promise.all([
      queryPeriodRevenue(curStart, curEnd),
      queryPeriodRevenue(prevStart, prevEnd),
      db.select({ cap: sql<number>`coalesce(sum(${tables.capacity}), 1)` })
        .from(tables)
        .where(isNull(tables.deletedAt)),
      queryPeriodFoodCost(curStart, curEnd),
      queryPeriodFoodCost(prevStart, prevEnd),
      queryPeriodLaborCost(curStart, curEnd),
      queryPeriodLaborCost(prevStart, prevEnd),
    ]);

    const totalSeats = Math.max(1, Number(totalCapacity[0].cap));

    const avgPerSession = cur.sessions > 0 ? cur.revenue / cur.sessions : 0;
    const prevAvgPerSession = prev.sessions > 0 ? prev.revenue / prev.sessions : 0;
    const avgTableTurns = days > 0 ? cur.sessions / days : 0;
    const prevAvgTableTurns = days > 0 ? prev.sessions / days : 0;
    const revpash = days > 0 ? cur.revenue / (totalSeats * days) : 0;
    const prevRevpash = days > 0 ? prev.revenue / (totalSeats * days) : 0;

    const foodCostPctVal = curFoodCost >= 0 && cur.revenue > 0 ? (curFoodCost / cur.revenue) * 100 : 0;
    const prevFoodCostPctVal = prevFoodCost >= 0 && prev.revenue > 0 ? (prevFoodCost / prev.revenue) * 100 : 0;
    const laborCostPctVal = curLabor >= 0 && cur.revenue > 0 ? (curLabor / cur.revenue) * 100 : 0;
    const prevLaborCostPctVal = prevLabor >= 0 && prev.revenue > 0 ? (prevLabor / prev.revenue) * 100 : 0;

    const kpis: PeriodKpis = {
      period,
      days,
      revenue: mkKpi(cur.revenue, prev.revenue),
      sessions: mkKpi(cur.sessions, prev.sessions),
      guests: mkKpi(cur.guests, prev.guests),
      avgPerSession: mkKpi(avgPerSession, prevAvgPerSession),
      foodCostPct: { ...mkKpi(foodCostPctVal, prevFoodCostPctVal), available: curFoodCost >= 0 },
      laborCostPct: { ...mkKpi(laborCostPctVal, prevLaborCostPctVal), available: curLabor >= 0 },
      avgTableTurns: mkKpi(avgTableTurns, prevAvgTableTurns),
      revpash: mkKpi(revpash, prevRevpash),
    };

    return { ok: true as const, data: kpis };
  } catch (e) {
    console.error('[getDashboardKpisForPeriod]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
