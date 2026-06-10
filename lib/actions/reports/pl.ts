'use server';

import { eq, and, gte, lt, inArray, sql } from 'drizzle-orm';
import { format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfMonth, addMonths, subMonths, parse } from 'date-fns';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import {
  payments, sessions, sessionGuests, orderItems, recipes, recipeIngredients, ingredients,
  payrollCycles, payrollItems, monthlyExpenses,
  paymentLineItems, pricingTiles,
} from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

async function requireReports() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'view_reports')) return null;
  return s;
}

const guestSums = db
  .select({
    sessionId: sessionGuests.sessionId,
    total: sql<number>`sum(${sessionGuests.quantity})`.as('total'),
  })
  .from(sessionGuests)
  .groupBy(sessionGuests.sessionId)
  .as('guest_sums');

export type PLReport = {
  month: string;
  // Revenue
  totalRevenue: number;
  buffetRevenue: number;
  addonRevenue: number;
  discountTotal: number;
  // COGS
  foodCost: number;
  foodCostAvailable: boolean;
  grossProfit: number;
  grossMarginPct: number;
  // Labor
  laborCost: number;
  laborCostAvailable: boolean;
  laborCostPct: number;
  // Other expenses
  rentCost: number;
  electricityCost: number;
  waterCost: number;
  otherCost: number;
  totalOtherCost: number;
  // Net
  totalCost: number;
  netProfit: number;
  netMarginPct: number;
};

export async function getProfitLossReport(month: string) {
  if (!await requireReports()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const parsed = parse(`${month}-01`, 'yyyy-MM-dd', new Date());
    const mStart = fromZonedTime(startOfMonth(toZonedTime(parsed, TZ)), TZ);
    const mEnd = fromZonedTime(addMonths(startOfMonth(toZonedTime(parsed, TZ)), 1), TZ);
    const mStartStr = format(toZonedTime(mStart, TZ), 'yyyy-MM-dd');
    const mEndStr = format(toZonedTime(mEnd, TZ), 'yyyy-MM-dd');

    const [revenueRows, lineItemRows, servedItems, laborData, expenseRows] = await Promise.all([
      // Total revenue
      db.select({
        total: sql<number>`coalesce(sum(${payments.total}::numeric), 0)`,
      })
      .from(payments)
      .where(and(gte(payments.paidAt, mStart), lt(payments.paidAt, mEnd))),

      // Revenue by tile category (buffet / addon / discount)
      db.select({
        category: pricingTiles.category,
        amount: sql<number>`coalesce(sum(${paymentLineItems.amount}::numeric), 0)`,
      })
      .from(paymentLineItems)
      .innerJoin(payments, eq(paymentLineItems.paymentId, payments.id))
      .innerJoin(pricingTiles, eq(paymentLineItems.pricingTileId, pricingTiles.id))
      .where(and(gte(payments.paidAt, mStart), lt(payments.paidAt, mEnd)))
      .groupBy(pricingTiles.category),

      // Served order items for food cost
      db.select({
        menuItemId: orderItems.menuItemId,
        qty: sql<string>`sum(${orderItems.quantity})`,
      })
      .from(orderItems)
      .where(and(
        eq(orderItems.status, 'served'),
        gte(orderItems.servedAt, mStart),
        lt(orderItems.servedAt, mEnd),
      ))
      .groupBy(orderItems.menuItemId),

      // Labor: payroll cycles with payDate in month
      (async () => {
        const cycles = await db
          .select({ id: payrollCycles.id })
          .from(payrollCycles)
          .where(and(gte(payrollCycles.payDate, mStartStr), lt(payrollCycles.payDate, mEndStr)));
        if (!cycles.length) return -1;
        const [row] = await db
          .select({ total: sql<number>`coalesce(sum(${payrollItems.gross}::numeric), 0)` })
          .from(payrollItems)
          .where(inArray(payrollItems.payrollCycleId, cycles.map((c) => c.id)));
        return Number(row.total);
      })(),

      // Monthly expenses
      db.select().from(monthlyExpenses).where(eq(monthlyExpenses.month, month)),
    ]);

    const totalRevenue = Number(revenueRows[0].total);
    let buffetRevenue = 0, addonRevenue = 0, discountTotal = 0;
    for (const row of lineItemRows) {
      const amt = Number(row.amount);
      if (row.category === 'guest') buffetRevenue += amt;
      else if (row.category === 'addon') addonRevenue += amt;
      else if (row.category === 'discount') discountTotal += amt;
    }

    // Food cost
    let foodCost = 0;
    let foodCostAvailable = false;
    const ids = servedItems.map((r) => r.menuItemId).filter((id): id is string => id !== null);
    if (ids.length > 0) {
      const recs = await db.query.recipes.findMany({
        where: and(inArray(recipes.menuItemId, ids), eq(recipes.isActive, true)),
        with: { ingredients: { with: { ingredient: { columns: { lastCost: true } } } } },
      });
      if (recs.length > 0) {
        const costMap = new Map<string, number>();
        for (const rec of recs) {
          if (!costMap.has(rec.menuItemId)) {
            const raw = rec.ingredients.reduce((s, ri) => s + parseFloat(ri.ingredient.lastCost) * parseFloat(ri.quantity), 0);
            costMap.set(rec.menuItemId, raw / rec.servingSize);
          }
        }
        foodCost = servedItems.reduce((s, r) => s + (costMap.get(r.menuItemId!) ?? 0) * parseFloat(r.qty), 0);
        foodCostAvailable = true;
      }
    }

    const laborCost = laborData as number;
    const laborCostAvailable = laborCost >= 0;

    const expMap = new Map(expenseRows.map((r) => [r.category, Number(r.amount)]));
    const rentCost = expMap.get('rent') ?? 0;
    const electricityCost = expMap.get('electricity') ?? 0;
    const waterCost = expMap.get('water') ?? 0;
    const otherCost = expMap.get('other') ?? 0;
    const totalOtherCost = rentCost + electricityCost + waterCost + otherCost;

    const grossProfit = totalRevenue - foodCost;
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const laborPct = laborCostAvailable && totalRevenue > 0 ? (laborCost / totalRevenue) * 100 : 0;
    const totalCost = (foodCostAvailable ? foodCost : 0) + (laborCostAvailable ? laborCost : 0) + totalOtherCost;
    const netProfit = totalRevenue - totalCost;
    const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    const report: PLReport = {
      month,
      totalRevenue, buffetRevenue, addonRevenue, discountTotal,
      foodCost, foodCostAvailable, grossProfit, grossMarginPct,
      laborCost: laborCostAvailable ? laborCost : 0, laborCostAvailable, laborCostPct: laborPct,
      rentCost, electricityCost, waterCost, otherCost, totalOtherCost,
      totalCost, netProfit, netMarginPct,
    };

    return { ok: true as const, data: report };
  } catch (e) {
    console.error('[getProfitLossReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

const upsertSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  category: z.enum(['rent', 'electricity', 'water', 'other']),
  amount: z.coerce.number().min(0),
  note: z.string().max(255).optional().nullable(),
});

export async function upsertMonthlyExpense(input: unknown) {
  if (!await requireReports()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { month, category, amount, note } = parsed.data;

  try {
    await db
      .insert(monthlyExpenses)
      .values({ month, category, amount: amount.toString(), note: note ?? null, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [monthlyExpenses.month, monthlyExpenses.category],
        set: { amount: amount.toString(), note: note ?? null, updatedAt: new Date() },
      });
    return { ok: true as const };
  } catch (e) {
    console.error('[upsertMonthlyExpense]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
