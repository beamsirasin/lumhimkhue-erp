'use server';

import { eq, and, gte, lt, not, inArray, sql, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { orderItems, menuItems, categories, recipes, recipeIngredients, ingredients } from '@/lib/db/schema';

async function requireReports() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'view_reports')) return null;
  return s;
}

export type MenuPerformanceRow = {
  menuItemId: string;
  name: string;
  categoryName: string;
  isBuffet: boolean;
  extraPrice: number;
  qtySold: number;
  pctOfTotal: number;
  costPerUnit: number;
  theoreticalCostTotal: number;
  revenueContribution: number;
  marginPct: number | null;
  /** BCG quadrant: 'star' | 'cashcow' | 'question' | 'dog' */
  quadrant: string;
};

export async function getMenuPerformanceReport(fromDate: string, toDate: string) {
  if (!await requireReports()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const start = new Date(`${fromDate}T00:00:00+07:00`);
    const end = new Date(`${toDate}T23:59:59.999+07:00`);

    // All served order items in period
    const served = await db
      .select({
        menuItemId: orderItems.menuItemId,
        qty: sql<number>`sum(${orderItems.quantity})`,
      })
      .from(orderItems)
      .where(and(
        eq(orderItems.status, 'served'),
        gte(orderItems.servedAt, start),
        lt(orderItems.servedAt, end),
        not(isNull(orderItems.menuItemId)),
      ))
      .groupBy(orderItems.menuItemId);

    if (!served.length) return { ok: true as const, data: [] };

    const totalQty = served.reduce((s, r) => s + Number(r.qty), 0);
    const ids = served.map((r) => r.menuItemId!).filter(Boolean);

    // Menu item details
    const items = await db.query.menuItems.findMany({
      where: inArray(menuItems.id, ids),
      with: { category: { columns: { name: true } } },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    // Active recipes with costs
    const recs = await db.query.recipes.findMany({
      where: and(inArray(recipes.menuItemId, ids), eq(recipes.isActive, true)),
      with: { ingredients: { with: { ingredient: { columns: { lastCost: true } } } } },
    });
    const costMap = new Map<string, number>();
    for (const rec of recs) {
      if (!costMap.has(rec.menuItemId)) {
        const raw = rec.ingredients.reduce((s, ri) => s + parseFloat(ri.ingredient.lastCost) * parseFloat(ri.quantity), 0);
        costMap.set(rec.menuItemId, raw / rec.servingSize);
      }
    }

    const rows: MenuPerformanceRow[] = served.map((s) => {
      const item = itemMap.get(s.menuItemId!);
      if (!item) return null as unknown as MenuPerformanceRow;
      const qty = Number(s.qty);
      const extraPrice = parseFloat(item.extraPrice);
      const costPerUnit = costMap.get(s.menuItemId!) ?? 0;
      const theoreticalCostTotal = costPerUnit * qty;
      const revenueContribution = item.isBuffet ? 0 : extraPrice * qty;
      const marginPct = extraPrice > 0 && costPerUnit > 0
        ? ((extraPrice - costPerUnit) / extraPrice) * 100
        : extraPrice > 0 && costPerUnit === 0
          ? null
          : null;

      return {
        menuItemId: s.menuItemId!,
        name: item.name,
        categoryName: item.category.name,
        isBuffet: item.isBuffet,
        extraPrice,
        qtySold: qty,
        pctOfTotal: totalQty > 0 ? (qty / totalQty) * 100 : 0,
        costPerUnit,
        theoreticalCostTotal,
        revenueContribution,
        marginPct,
        quadrant: '', // filled below
      };
    }).filter(Boolean);

    if (!rows.length) return { ok: true as const, data: [] };

    // BCG quadrant assignment: split at median volume and 30% margin threshold
    const sortedQty = [...rows].sort((a, b) => a.qtySold - b.qtySold);
    const medianQty = sortedQty[Math.floor(sortedQty.length / 2)].qtySold;
    const MARGIN_THRESHOLD = 30; // 30% gross margin

    for (const row of rows) {
      const highVol = row.qtySold >= medianQty;
      const highMargin = row.marginPct !== null ? row.marginPct >= MARGIN_THRESHOLD : false;
      if (highVol && highMargin)       row.quadrant = 'star';
      else if (highVol && !highMargin) row.quadrant = 'cashcow';
      else if (!highVol && highMargin) row.quadrant = 'question';
      else                             row.quadrant = 'dog';
    }

    rows.sort((a, b) => b.qtySold - a.qtySold);
    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getMenuPerformanceReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
