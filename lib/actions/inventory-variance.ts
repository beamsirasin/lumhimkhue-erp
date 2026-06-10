'use server';

import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import {
  stockCounts,
  stockCountItems,
  orderItems,
  orders,
  recipes,
  recipeIngredients,
} from '@/lib/db/schema';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VarianceRow = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  theoreticalUsage: number;
  actualUsage: number;
  variance: number;
  variancePct: number;
  varianceCost: number;
  lastCost: number;
  investigationNeeded: boolean;
};

// ── Internal: calculate theoretical usage for a UTC date range ────────────────

async function calcTheoreticalUsageMap(dayStart: Date, dayEnd: Date): Promise<Map<string, number>> {
  const servedItems = await db
    .select({
      menuItemId: orderItems.menuItemId,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orderItems.status, 'served'),
        gte(orderItems.servedAt, dayStart),
        lte(orderItems.servedAt, dayEnd),
      ),
    );

  const menuItemQty = new Map<string, number>();
  for (const item of servedItems) {
    if (!item.menuItemId) continue;
    menuItemQty.set(item.menuItemId, (menuItemQty.get(item.menuItemId) ?? 0) + item.quantity);
  }

  if (menuItemQty.size === 0) return new Map();

  const uniqueMenuItemIds = [...menuItemQty.keys()];
  const activeRecipes = await db.query.recipes.findMany({
    where: and(inArray(recipes.menuItemId, uniqueMenuItemIds), eq(recipes.isActive, true)),
    with: {
      ingredients: {
        with: { ingredient: { columns: { id: true, lastCost: true } } },
      },
    },
  });

  const recipeByMenuItem = new Map<string, typeof activeRecipes[0]>();
  for (const recipe of activeRecipes) {
    if (!recipeByMenuItem.has(recipe.menuItemId)) {
      recipeByMenuItem.set(recipe.menuItemId, recipe);
    }
  }

  const theoreticalUsageMap = new Map<string, number>();
  for (const [menuItemId, qty] of menuItemQty) {
    const recipe = recipeByMenuItem.get(menuItemId);
    if (!recipe) continue;
    for (const ri of recipe.ingredients) {
      const usage = (parseFloat(ri.quantity) / recipe.servingSize) * qty;
      theoreticalUsageMap.set(
        ri.ingredientId,
        (theoreticalUsageMap.get(ri.ingredientId) ?? 0) + usage,
      );
    }
  }

  return theoreticalUsageMap;
}

// ── Public actions ────────────────────────────────────────────────────────────

export async function getDailyVariance(dateStr: string) {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'inventory:view')) {
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  }

  try {
    const [stockCount] = await db
      .select()
      .from(stockCounts)
      .where(and(eq(stockCounts.countDate, dateStr), eq(stockCounts.status, 'submitted')))
      .limit(1);

    if (!stockCount) return { ok: true as const, data: [] as VarianceRow[] };

    const countItems = await db.query.stockCountItems.findMany({
      where: eq(stockCountItems.stockCountId, stockCount.id),
      with: { ingredient: { columns: { id: true, name: true, unit: true, lastCost: true } } },
    });

    if (!countItems.length) return { ok: true as const, data: [] as VarianceRow[] };

    const dayStart = new Date(`${dateStr}T00:00:00+07:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999+07:00`);
    const theoreticalUsageMap = await calcTheoreticalUsageMap(dayStart, dayEnd);

    const rows: VarianceRow[] = countItems.map((ci) => {
      const theoretical = theoreticalUsageMap.get(ci.ingredientId) ?? 0;
      const actual = parseFloat(ci.usedQty);
      const variance = actual - theoretical;
      const variancePct = theoretical > 0 ? (variance / theoretical) * 100 : 0;
      const lastCost = parseFloat(ci.ingredient.lastCost);
      return {
        ingredientId: ci.ingredientId,
        ingredientName: ci.ingredient.name,
        unit: ci.unit,
        theoreticalUsage: Math.round(theoretical * 100) / 100,
        actualUsage: actual,
        variance: Math.round(variance * 100) / 100,
        variancePct: Math.round(variancePct * 10) / 10,
        varianceCost: Math.round(Math.abs(variance) * lastCost * 100) / 100,
        lastCost,
        investigationNeeded: Math.abs(variancePct) > 10,
      };
    });

    return {
      ok: true as const,
      data: rows.sort((a, b) => b.varianceCost - a.varianceCost),
    };
  } catch (e) {
    console.error('[getDailyVariance]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type VarianceSummaryRow = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  totalTheoretical: number;
  totalActual: number;
  variance: number;
  variancePct: number;
  varianceCost: number;
  investigationNeeded: boolean;
};

export async function getVarianceSummary(startDate: string, endDate: string) {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'inventory:view')) {
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  }

  try {
    const counts = await db
      .select({ id: stockCounts.id, countDate: stockCounts.countDate })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.status, 'submitted'),
          gte(stockCounts.countDate, startDate),
          lte(stockCounts.countDate, endDate),
        ),
      );

    if (!counts.length) return { ok: true as const, data: [] as VarianceSummaryRow[] };

    const summaryMap = new Map<string, {
      ingredientName: string;
      unit: string;
      lastCost: number;
      totalTheoretical: number;
      totalActual: number;
    }>();

    for (const count of counts) {
      const dayStart = new Date(`${count.countDate}T00:00:00+07:00`);
      const dayEnd = new Date(`${count.countDate}T23:59:59.999+07:00`);

      const [countItemsResult, theoreticalUsageMap] = await Promise.all([
        db.query.stockCountItems.findMany({
          where: eq(stockCountItems.stockCountId, count.id),
          with: { ingredient: { columns: { id: true, name: true, unit: true, lastCost: true } } },
        }),
        calcTheoreticalUsageMap(dayStart, dayEnd),
      ]);

      for (const ci of countItemsResult) {
        const theoretical = theoreticalUsageMap.get(ci.ingredientId) ?? 0;
        const actual = parseFloat(ci.usedQty);
        const existing = summaryMap.get(ci.ingredientId);
        if (existing) {
          existing.totalTheoretical += theoretical;
          existing.totalActual += actual;
        } else {
          summaryMap.set(ci.ingredientId, {
            ingredientName: ci.ingredient.name,
            unit: ci.unit,
            lastCost: parseFloat(ci.ingredient.lastCost),
            totalTheoretical: theoretical,
            totalActual: actual,
          });
        }
      }
    }

    const summary: VarianceSummaryRow[] = [...summaryMap.entries()].map(([ingredientId, d]) => {
      const variance = d.totalActual - d.totalTheoretical;
      const variancePct = d.totalTheoretical > 0 ? (variance / d.totalTheoretical) * 100 : 0;
      return {
        ingredientId,
        ingredientName: d.ingredientName,
        unit: d.unit,
        totalTheoretical: Math.round(d.totalTheoretical * 100) / 100,
        totalActual: Math.round(d.totalActual * 100) / 100,
        variance: Math.round(variance * 100) / 100,
        variancePct: Math.round(variancePct * 10) / 10,
        varianceCost: Math.round(Math.abs(variance) * d.lastCost * 100) / 100,
        investigationNeeded: Math.abs(variancePct) > 10,
      };
    });

    return {
      ok: true as const,
      data: summary.sort((a, b) => b.varianceCost - a.varianceCost),
    };
  } catch (e) {
    console.error('[getVarianceSummary]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
