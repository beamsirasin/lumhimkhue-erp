'use server';

import { eq, and, gte, lt, not, desc, sql, isNull } from 'drizzle-orm';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay, subDays, addDays } from 'date-fns';
import { db } from '@/lib/db';
import {
  payments, sessions, sessionGuests, orderItems, menuItems,
  orders, stockCounts, stockCountItems, ingredients, recipes,
} from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

export type DailyClosingReport = {
  date: string;
  dateLabel: string;
  // Revenue
  revenue: number;
  revenuePrev: number;
  revenueChangePct: number | null;
  // Operations
  sessions: number;
  guests: number;
  avgPerSession: number;
  // Food cost
  foodCostPct: number | null;
  // Stock
  lowStockCount: number;
  // Top menu
  topMenuItems: Array<{ name: string; qty: number }>;
  // Payment breakdown
  paymentBreakdown: Array<{ method: string; total: number; count: number }>;
};

const guestSums = db
  .select({
    sessionId: sessionGuests.sessionId,
    total: sql<number>`sum(${sessionGuests.quantity})`.as('total'),
  })
  .from(sessionGuests)
  .groupBy(sessionGuests.sessionId)
  .as('guest_sums');

export async function generateDailyClosingReport(dateStr: string): Promise<DailyClosingReport> {
  const zonedDate = toZonedTime(new Date(`${dateStr}T12:00:00+07:00`), TZ);
  const dayStart = fromZonedTime(startOfDay(zonedDate), TZ);
  const dayEnd = fromZonedTime(addDays(startOfDay(zonedDate), 1), TZ);
  const prevDayStart = fromZonedTime(startOfDay(subDays(zonedDate, 1)), TZ);

  const [todayRevRow, prevRevRow, topItems, payBreakdown, servedItems, latestCount] = await Promise.all([
    // Today revenue + sessions + guests
    db.select({
      revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
      sessionCount: sql<number>`count(*)`,
      guests: sql<number>`coalesce(sum("guest_sums"."total"), 0)`,
    })
    .from(payments)
    .innerJoin(sessions, eq(payments.sessionId, sessions.id))
    .leftJoin(guestSums, eq(guestSums.sessionId, sessions.id))
    .where(and(gte(payments.paidAt, dayStart), lt(payments.paidAt, dayEnd))),

    // Yesterday revenue
    db.select({ revenue: sql<number>`coalesce(sum(${payments.total}::numeric), 0)` })
      .from(payments)
      .where(and(gte(payments.paidAt, prevDayStart), lt(payments.paidAt, dayStart))),

    // Top 5 menu items
    db.select({
      name: menuItems.name,
      qty: sql<number>`sum(${orderItems.quantity})`,
    })
    .from(orderItems)
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(gte(orders.createdAt, dayStart), lt(orders.createdAt, dayEnd), not(eq(orderItems.status, 'cancelled'))))
    .groupBy(menuItems.id, menuItems.name)
    .orderBy(desc(sql`sum(${orderItems.quantity})`))
    .limit(5),

    // Payment breakdown
    db.select({
      method: payments.paymentMethod,
      total: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(payments)
    .where(and(gte(payments.paidAt, dayStart), lt(payments.paidAt, dayEnd)))
    .groupBy(payments.paymentMethod)
    .orderBy(desc(sql`sum(${payments.total}::numeric)`)),

    // Served items for food cost
    db.select({
      menuItemId: orderItems.menuItemId,
      qty: sql<string>`sum(${orderItems.quantity})`,
    })
    .from(orderItems)
    .where(and(
      eq(orderItems.status, 'served'),
      gte(orderItems.servedAt, dayStart),
      lt(orderItems.servedAt, dayEnd),
      not(isNull(orderItems.menuItemId)),
    ))
    .groupBy(orderItems.menuItemId),

    // Latest submitted stock count for low stock
    db.query.stockCounts.findFirst({
      where: eq(stockCounts.status, 'submitted'),
      orderBy: [desc(stockCounts.countDate)],
      with: { items: { with: { ingredient: { columns: { minStock: true } } } } },
    }),
  ]);

  const revenue = Number(todayRevRow[0].revenue);
  const revenuePrev = Number(prevRevRow[0].revenue);
  const sessionCount = Number(todayRevRow[0].sessionCount);
  const guests = Number(todayRevRow[0].guests);
  const avgPerSession = sessionCount > 0 ? revenue / sessionCount : 0;
  const revenueChangePct = revenuePrev > 0 ? ((revenue - revenuePrev) / revenuePrev) * 100 : null;

  // Food cost
  let foodCostPct: number | null = null;
  try {
    const ids = servedItems.map((r) => r.menuItemId).filter((id): id is string => id !== null);
    if (ids.length > 0) {
      const recs = await db.query.recipes.findMany({
        where: and(
          // inArray needs import — just query all active recipes for these items
          sql`${recipes.menuItemId} = ANY(${ids})`,
          eq(recipes.isActive, true),
        ),
        with: { ingredients: { with: { ingredient: { columns: { lastCost: true } } } } },
      });
      if (recs.length > 0 && revenue > 0) {
        const costMap = new Map<string, number>();
        for (const rec of recs) {
          if (!costMap.has(rec.menuItemId)) {
            const raw = rec.ingredients.reduce((s, ri) => s + parseFloat(ri.ingredient.lastCost) * parseFloat(ri.quantity), 0);
            costMap.set(rec.menuItemId, raw / rec.servingSize);
          }
        }
        const totalCost = servedItems.reduce((s, r) => s + (costMap.get(r.menuItemId!) ?? 0) * parseFloat(r.qty), 0);
        foodCostPct = (totalCost / revenue) * 100;
      }
    }
  } catch { /* non-critical */ }

  // Low stock
  const lowStockCount = latestCount
    ? latestCount.items.filter((item) =>
        parseFloat(String(item.quantityOnHand)) < parseFloat(String(item.ingredient.minStock))
      ).length
    : 0;

  return {
    date: dateStr,
    dateLabel: format(toZonedTime(dayStart, TZ), 'd MMMM yyyy', { locale: th }),
    revenue,
    revenuePrev,
    revenueChangePct,
    sessions: sessionCount,
    guests,
    avgPerSession,
    foodCostPct: foodCostPct !== null ? Math.round(foodCostPct * 10) / 10 : null,
    lowStockCount,
    topMenuItems: topItems.map((i) => ({ name: i.name, qty: Number(i.qty) })),
    paymentBreakdown: payBreakdown.map((p) => ({ method: p.method, total: Number(p.total), count: Number(p.count) })),
  };
}
