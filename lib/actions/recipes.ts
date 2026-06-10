'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, asc, inArray, gte, lte, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { recipes, recipeIngredients, menuItems, ingredients, categories, orderItems, payments } from '@/lib/db/schema';
import { z } from 'zod';

// ── Auth helper ───────────────────────────────────────────────────────────────

async function requireRecipe() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'recipe:manage')) return null;
  return s;
}

// ── Validation ────────────────────────────────────────────────────────────────

const upsertRecipeSchema = z.object({
  id: z.string().uuid().optional(),
  menuItemId: z.string().uuid(),
  name: z.string().min(1, 'กรุณากรอกชื่อสูตร').max(100),
  servingSize: z.coerce.number().int().min(1).default(1),
  ingredients: z.array(
    z.object({
      ingredientId: z.string().uuid(),
      quantity: z.coerce.number().positive('ปริมาณต้องมากกว่า 0'),
      unit: z.string().min(1).max(20),
      notes: z.string().max(200).optional().nullable(),
    }),
  ),
});

export type UpsertRecipeInput = z.infer<typeof upsertRecipeSchema>;

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getRecipesByMenuItem(menuItemId: string) {
  if (!await requireRecipe()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const rows = await db.query.recipes.findMany({
      where: and(eq(recipes.menuItemId, menuItemId), eq(recipes.isActive, true)),
      with: {
        ingredients: {
          with: { ingredient: true },
          orderBy: asc(recipeIngredients.id),
        },
      },
      orderBy: asc(recipes.createdAt),
    });
    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getRecipesByMenuItem]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type RecipeWithIngredients = NonNullable<
  Extract<Awaited<ReturnType<typeof getRecipesByMenuItem>>, { ok: true }>['data']
>[number];

export async function getMenuItemCostMatrix() {
  if (!await requireRecipe()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const allMenuItems = await db.query.menuItems.findMany({
      with: {
        category: { columns: { name: true } },
        recipes: {
          where: eq(recipes.isActive, true),
          with: {
            ingredients: {
              with: { ingredient: { columns: { lastCost: true, name: true } } },
            },
          },
          limit: 1,
        },
      },
      orderBy: [asc(menuItems.sortOrder), asc(menuItems.name)],
    });

    const matrix = allMenuItems.map((item) => {
      const recipe = item.recipes[0];
      let theoreticalCost = 0;
      if (recipe && recipe.ingredients.length > 0) {
        const rawCost = recipe.ingredients.reduce((sum, ri) => {
          return sum + parseFloat(ri.ingredient.lastCost) * parseFloat(ri.quantity);
        }, 0);
        theoreticalCost = rawCost / recipe.servingSize;
      }

      const price = parseFloat(item.extraPrice);
      const margin = price > 0 ? ((price - theoreticalCost) / price) * 100 : null;

      return {
        id: item.id,
        name: item.name,
        categoryName: item.category.name,
        isBuffet: item.isBuffet,
        price,
        theoreticalCost: Math.round(theoreticalCost * 100) / 100,
        margin: margin !== null ? Math.round(margin * 10) / 10 : null,
        hasRecipe: !!recipe,
        recipeId: recipe?.id ?? null,
      };
    });

    return { ok: true as const, data: matrix };
  } catch (e) {
    console.error('[getMenuItemCostMatrix]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type MenuItemCostRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getMenuItemCostMatrix>>, { ok: true }>['data']
>[number];

export async function getIngredientsForRecipe() {
  if (!await requireRecipe()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const rows = await db.query.ingredients.findMany({
      where: eq(ingredients.isActive, true),
      with: { category: { columns: { name: true } } },
      orderBy: [asc(ingredients.name)],
    });
    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getIngredientsForRecipe]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function upsertRecipe(input: unknown) {
  if (!await requireRecipe()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = upsertRecipeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const data = parsed.data;

  try {
    await db.transaction(async (tx) => {
      let recipeId = data.id;

      if (recipeId) {
        await tx.update(recipes)
          .set({ name: data.name, servingSize: data.servingSize, updatedAt: new Date() })
          .where(eq(recipes.id, recipeId));
        await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
      } else {
        const [newRecipe] = await tx
          .insert(recipes)
          .values({ menuItemId: data.menuItemId, name: data.name, servingSize: data.servingSize, isActive: true })
          .returning({ id: recipes.id });
        recipeId = newRecipe.id;
      }

      if (data.ingredients.length > 0) {
        await tx.insert(recipeIngredients).values(
          data.ingredients.map((ing) => ({
            recipeId: recipeId!,
            ingredientId: ing.ingredientId,
            quantity: ing.quantity.toString(),
            unit: ing.unit,
            notes: ing.notes ?? null,
          })),
        );
      }
    });

    revalidatePath('/recipes');
    return { ok: true as const };
  } catch (e) {
    console.error('[upsertRecipe]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function deleteRecipe(id: string) {
  if (!await requireRecipe()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    await db.update(recipes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(recipes.id, id));
    revalidatePath('/recipes');
    return { ok: true as const };
  } catch (e) {
    console.error('[deleteRecipe]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Food Cost Report ──────────────────────────────────────────────────────────

export type FoodCostRow = {
  date: string;
  revenue: number;
  theoreticalCost: number;
  foodCostPct: number;
  targetMet: boolean;
};

const FOOD_COST_TARGET_PCT = 35;

export async function getFoodCostReport(startDate: string, endDate: string) {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'view_reports')) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const dayStart = new Date(`${startDate}T00:00:00+07:00`);
    const dayEnd = new Date(`${endDate}T23:59:59.999+07:00`);

    const [revenueRows, servedItems] = await Promise.all([
      db
        .select({
          date: sql<string>`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date::text`,
          revenue: sql<string>`coalesce(sum(${payments.total}::numeric), 0)`,
        })
        .from(payments)
        .where(and(gte(payments.paidAt, dayStart), lte(payments.paidAt, dayEnd)))
        .groupBy(sql`(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')::date`)
        .orderBy(sql`1`),
      db
        .select({
          date: sql<string>`(${orderItems.servedAt} AT TIME ZONE 'Asia/Bangkok')::date::text`,
          menuItemId: orderItems.menuItemId,
          totalQty: sql<string>`sum(${orderItems.quantity})`,
        })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.status, 'served'),
            gte(orderItems.servedAt, dayStart),
            lte(orderItems.servedAt, dayEnd),
          ),
        )
        .groupBy(
          sql`(${orderItems.servedAt} AT TIME ZONE 'Asia/Bangkok')::date`,
          orderItems.menuItemId,
        ),
    ]);

    const uniqueMenuItemIds = [...new Set(
      servedItems.map((i) => i.menuItemId).filter((id): id is string => id !== null),
    )];

    const activeRecipes = uniqueMenuItemIds.length > 0
      ? await db.query.recipes.findMany({
          where: and(inArray(recipes.menuItemId, uniqueMenuItemIds), eq(recipes.isActive, true)),
          with: {
            ingredients: {
              with: { ingredient: { columns: { lastCost: true } } },
            },
          },
        })
      : [];

    const recipeCostByMenuItem = new Map<string, number>();
    for (const recipe of activeRecipes) {
      if (recipeCostByMenuItem.has(recipe.menuItemId)) continue;
      const raw = recipe.ingredients.reduce(
        (s, ri) => s + parseFloat(ri.ingredient.lastCost) * parseFloat(ri.quantity),
        0,
      );
      recipeCostByMenuItem.set(recipe.menuItemId, raw / recipe.servingSize);
    }

    const theoreticalByDate = new Map<string, number>();
    for (const item of servedItems) {
      if (!item.menuItemId || !item.date) continue;
      const cost = (recipeCostByMenuItem.get(item.menuItemId) ?? 0) * parseFloat(item.totalQty);
      theoreticalByDate.set(item.date, (theoreticalByDate.get(item.date) ?? 0) + cost);
    }

    const revenueByDate = new Map(revenueRows.map((r) => [r.date, parseFloat(r.revenue)]));
    const allDates = new Set([...revenueByDate.keys(), ...theoreticalByDate.keys()]);

    const rows: FoodCostRow[] = [...allDates].sort().map((date) => {
      const revenue = revenueByDate.get(date) ?? 0;
      const theoreticalCost = theoreticalByDate.get(date) ?? 0;
      const foodCostPct = revenue > 0 ? (theoreticalCost / revenue) * 100 : 0;
      return {
        date,
        revenue: Math.round(revenue * 100) / 100,
        theoreticalCost: Math.round(theoreticalCost * 100) / 100,
        foodCostPct: Math.round(foodCostPct * 10) / 10,
        targetMet: foodCostPct <= FOOD_COST_TARGET_PCT || foodCostPct === 0,
      };
    });

    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getFoodCostReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Internal cost helper (no auth — used from other actions) ──────────────────

export async function calcTheoreticalCost(menuItemId: string): Promise<number> {
  const rows = await db.query.recipes.findMany({
    where: and(eq(recipes.menuItemId, menuItemId), eq(recipes.isActive, true)),
    with: {
      ingredients: {
        with: { ingredient: { columns: { lastCost: true } } },
      },
    },
    limit: 1,
  });
  if (!rows.length) return 0;
  const recipe = rows[0];
  const raw = recipe.ingredients.reduce((s, ri) => {
    return s + parseFloat(ri.ingredient.lastCost) * parseFloat(ri.quantity);
  }, 0);
  return Math.round((raw / recipe.servingSize) * 100) / 100;
}
