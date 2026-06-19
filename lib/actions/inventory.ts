'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc, desc, sql, and, lt, or, inArray, gte, lte } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { writeAuditLog } from '@/lib/actions/audit';
import {
  ingredientCategories,
  ingredients,
  suppliers,
  stockCounts,
  stockCountItems,
  stockCountAdjustments,
  purchaseOrders,
  purchaseOrderItems,
  goodsReceipts,
  goodsReceiptItems,
  sessions,
  sessionGuests,
  pricingTiles,
} from '@/lib/db/schema';
import {
  createIngredientSchema,
  updateIngredientSchema,
  createSupplierSchema,
  updateSupplierSchema,
  saveStockCountSchema,
  createStockAdjustmentSchema,
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  receivePurchaseOrderSchema,
} from '@/lib/validations/inventory';

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function requireView() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'inventory:view')) return null;
  return s;
}

async function requireEdit() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'inventory:edit')) return null;
  return s;
}

async function requireStockCount() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'stock_count:create')) return null;
  return s;
}

async function requirePO() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'purchase_order:manage')) return null;
  return s;
}

// ── Ingredients ───────────────────────────────────────────────────────────────

export async function getIngredientPageData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [cats, supps, ings] = await Promise.all([
      db.select().from(ingredientCategories).orderBy(asc(ingredientCategories.sortOrder)),
      db.select().from(suppliers).orderBy(asc(suppliers.name)),
      db.query.ingredients.findMany({
        orderBy: [asc(ingredients.name)],
        with: { category: true, defaultSupplier: true },
      }),
    ]);
    return { ok: true as const, data: { categories: cats, suppliers: supps, ingredients: ings } };
  } catch (e) {
    console.error('[getIngredientPageData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type IngredientPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getIngredientPageData>>, { ok: true }>['data']
>;
export type IngredientRow = IngredientPageData['ingredients'][number];

export async function createIngredient(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = createIngredientSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const {
    minStock, parLevel, lastCost, yieldPercent, orderUnitConversion,
    defaultSupplierId, orderUnit, storageLocation, notes, ...rest
  } = parsed.data;
  try {
    await db.insert(ingredients).values({
      ...rest,
      minStock: String(minStock),
      parLevel: String(parLevel),
      lastCost: String(lastCost),
      yieldPercent: String(yieldPercent),
      orderUnitConversion: String(orderUnitConversion),
      defaultSupplierId: defaultSupplierId ?? null,
      orderUnit: orderUnit ?? null,
      storageLocation: storageLocation ?? null,
      notes: notes ?? null,
    });
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[createIngredient]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateIngredient(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = updateIngredientSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const {
    id, minStock, parLevel, lastCost, yieldPercent, orderUnitConversion,
    defaultSupplierId, orderUnit, storageLocation, notes, ...rest
  } = parsed.data;
  try {
    await db.update(ingredients).set({
      ...rest,
      minStock: String(minStock),
      parLevel: String(parLevel),
      lastCost: String(lastCost),
      yieldPercent: String(yieldPercent),
      orderUnitConversion: String(orderUnitConversion),
      defaultSupplierId: defaultSupplierId ?? null,
      orderUnit: orderUnit ?? null,
      storageLocation: storageLocation ?? null,
      notes: notes ?? null,
      updatedAt: new Date(),
    }).where(eq(ingredients.id, id));
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateIngredient]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleIngredientActive(id: string) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [ing] = await db
      .select({ isActive: ingredients.isActive })
      .from(ingredients)
      .where(eq(ingredients.id, id))
      .limit(1);
    if (!ing) return { ok: false as const, error: 'ไม่พบวัตถุดิบ' };
    await db.update(ingredients)
      .set({ isActive: !ing.isActive, updatedAt: new Date() })
      .where(eq(ingredients.id, id));
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleIngredientActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

export async function getSupplierPageData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const supps = await db.query.suppliers.findMany({
      orderBy: [asc(suppliers.name)],
      with: { purchaseOrders: { columns: { id: true } } },
    });
    return { ok: true as const, data: supps };
  } catch (e) {
    console.error('[getSupplierPageData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SupplierRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getSupplierPageData>>, { ok: true }>['data']
>[number];

export async function createSupplier(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  try {
    await db.insert(suppliers).values({
      name: parsed.data.name,
      contactName: parsed.data.contactName ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      taxId: parsed.data.taxId ?? null,
      lineContact: parsed.data.lineContact ?? null,
      avgLeadTimeDays: parsed.data.avgLeadTimeDays,
      minOrderAmount: parsed.data.minOrderAmount != null ? String(parsed.data.minOrderAmount) : null,
      notes: parsed.data.notes ?? null,
    });
    revalidatePath('/inventory/suppliers');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[createSupplier]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateSupplier(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, ...data } = parsed.data;
  try {
    await db.update(suppliers).set({
      name: data.name,
      contactName: data.contactName ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      taxId: data.taxId ?? null,
      lineContact: data.lineContact ?? null,
      avgLeadTimeDays: data.avgLeadTimeDays,
      minOrderAmount: data.minOrderAmount != null ? String(data.minOrderAmount) : null,
      notes: data.notes ?? null,
    }).where(eq(suppliers.id, id));
    revalidatePath('/inventory/suppliers');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateSupplier]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleSupplierActive(id: string) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [s] = await db.select({ isActive: suppliers.isActive }).from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!s) return { ok: false as const, error: 'ไม่พบผู้ขาย' };
    await db.update(suppliers).set({ isActive: !s.isActive }).where(eq(suppliers.id, id));
    revalidatePath('/inventory/suppliers');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleSupplierActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Stock Count ───────────────────────────────────────────────────────────────

/** Sum received quantities per ingredient from goods receipts on a given date */
async function getTodayReceivedQty(dateStr: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  try {
    const receipts = await db
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.receivedDate, dateStr));

    if (receipts.length === 0) return result;

    const receiptIds = receipts.map((r) => r.id);
    const items = await db.query.goodsReceiptItems.findMany({
      where: inArray(goodsReceiptItems.goodsReceiptId, receiptIds),
      with: { purchaseOrderItem: { columns: { ingredientId: true } } },
    });

    for (const item of items) {
      const ingId = item.purchaseOrderItem.ingredientId;
      result[ingId] = (result[ingId] ?? 0) + Number(item.receivedQuantity);
    }
  } catch (e) {
    console.error('[getTodayReceivedQty]', e);
  }
  return result;
}

/** Guest count from POS sessions on a given date (Asia/Bangkok) */
async function getGuestCountForDate(dateStr: string): Promise<number> {
  try {
    const rows = await db
      .select({ total: sql<number>`cast(coalesce(sum(${sessionGuests.quantity}), 0) as int)` })
      .from(sessionGuests)
      .innerJoin(sessions, eq(sessions.id, sessionGuests.sessionId))
      .innerJoin(pricingTiles, and(
        eq(pricingTiles.id, sessionGuests.pricingTileId),
        eq(pricingTiles.category, 'guest'),
      ))
      .where(sql`DATE(${sessions.startedAt} AT TIME ZONE 'Asia/Bangkok') = ${dateStr}`);
    return rows[0]?.total ?? 0;
  } catch {
    return 0;
  }
}

export async function getStockCountPageData(dateStr: string) {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [cats, ings, existingCount, recentCounts, todayReceivedQty, todayGuestCount] = await Promise.all([
      db.select().from(ingredientCategories).where(eq(ingredientCategories.isActive, true)).orderBy(asc(ingredientCategories.sortOrder)),
      db.query.ingredients.findMany({
        where: eq(ingredients.isActive, true),
        orderBy: [asc(ingredients.name)],
        with: { category: true },
      }),
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.countDate, dateStr),
        with: { items: true, countedByUser: { columns: { id: true, name: true } } },
      }),
      // Look back 14 days so weekly items always find their last count
      db.query.stockCounts.findMany({
        where: and(
          eq(stockCounts.status, 'submitted'),
          lt(stockCounts.countDate, dateStr),
        ),
        orderBy: [desc(stockCounts.countDate)],
        limit: 14,
        with: { items: { columns: { ingredientId: true, quantityOnHand: true } } },
      }),
      getTodayReceivedQty(dateStr),
      getGuestCountForDate(dateStr),
    ]);

    // Per-ingredient: take the most recent count that actually recorded it
    const openingBalances: Record<string, string> = {};
    for (const count of recentCounts) {
      for (const item of count.items) {
        if (!openingBalances[item.ingredientId]) {
          openingBalances[item.ingredientId] = item.quantityOnHand;
        }
      }
    }

    return {
      ok: true as const,
      data: {
        categories: cats,
        ingredients: ings,
        existingCount: existingCount ?? null,
        openingBalances,
        todayReceivedQty,
        todayGuestCount,
      },
    };
  } catch (e) {
    console.error('[getStockCountPageData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type StockCountPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getStockCountPageData>>, { ok: true }>['data']
>;

export async function saveStockCount(input: unknown) {
  const session = await requireStockCount();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = saveStockCountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { countDate, asDraft, notes, items } = parsed.data;
  const userId = session.user.id as string;

  try {
    const existing = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.countDate, countDate),
    });

    if (existing?.status === 'submitted') {
      return { ok: false as const, error: 'ไม่สามารถแก้ไขการนับสต็อกที่ส่งแล้ว' };
    }

    let countId: string;

    if (existing) {
      await db.update(stockCounts).set({
        status: asDraft ? 'draft' : 'submitted',
        notes: notes ?? null,
        submittedAt: asDraft ? null : new Date(),
      }).where(eq(stockCounts.id, existing.id));
      countId = existing.id;
      // Selective delete: only remove rows we're about to re-insert.
      // Rows for weekly ingredients not in this payload stay intact.
      if (items.length > 0) {
        await db.delete(stockCountItems).where(
          and(
            eq(stockCountItems.stockCountId, existing.id),
            inArray(stockCountItems.ingredientId, items.map((i) => i.ingredientId)),
          ),
        );
      }
    } else {
      const [newCount] = await db.insert(stockCounts).values({
        countDate,
        countedBy: userId,
        status: asDraft ? 'draft' : 'submitted',
        notes: notes ?? null,
        submittedAt: asDraft ? null : new Date(),
      }).returning({ id: stockCounts.id });
      countId = newCount.id;
    }

    if (items.length > 0) {
      await db.insert(stockCountItems).values(
        items.map((item) => {
          // usedQty derived from physicalCount; physicalCount IS quantityOnHand
          const usedQty = Math.max(0, item.openingBalance + item.receivedQty - item.physicalCount);
          return {
            stockCountId: countId,
            ingredientId: item.ingredientId,
            openingBalance: String(item.openingBalance.toFixed(2)),
            receivedQty: String(item.receivedQty.toFixed(2)),
            usedQty: String(usedQty.toFixed(2)),
            quantityOnHand: String(item.physicalCount.toFixed(2)),
            unit: item.unit,
            notes: item.notes ?? null,
          };
        }),
      );
    }

    revalidatePath('/inventory/count');
    revalidatePath('/inventory');
    if (!asDraft) {
      writeAuditLog({
        userId,
        role: session.user.role,
        action: 'submit',
        entity: 'stock_counts',
        entityId: countId,
        after: { countDate, itemCount: items.length },
      });
    }
    return { ok: true as const, countId };
  } catch (e) {
    console.error('[saveStockCount]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getLowStockItems(countId: string) {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const items = await db.query.stockCountItems.findMany({
      where: eq(stockCountItems.stockCountId, countId),
      with: { ingredient: { with: { defaultSupplier: true, category: true } } },
    });
    const low = items.filter(
      (item) => Number(item.quantityOnHand) < Number(item.ingredient.minStock),
    );
    return { ok: true as const, data: low };
  } catch (e) {
    console.error('[getLowStockItems]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type LowStockItem = NonNullable<
  Extract<Awaited<ReturnType<typeof getLowStockItems>>, { ok: true }>['data']
>[number];

export async function createStockAdjustment(input: unknown) {
  const session = await requireStockCount();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = createStockAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  const { stockCountId, ingredientId, adjustmentQty, adjustmentType, reason } = parsed.data;
  const userId = session.user.id as string;

  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, stockCountId),
    });
    if (!count) return { ok: false as const, error: 'ไม่พบข้อมูลการนับ' };
    if (count.status !== 'submitted') return { ok: false as const, error: 'สามารถปรับปรุงได้เฉพาะการนับที่ส่งแล้ว' };

    const [adj] = await db.insert(stockCountAdjustments).values({
      stockCountId,
      ingredientId,
      adjustmentQty: String(adjustmentQty.toFixed(2)),
      adjustmentType,
      reason,
      createdBy: userId,
    }).returning({ id: stockCountAdjustments.id });

    revalidatePath('/inventory/count');
    writeAuditLog({
      userId,
      role: session.user.role,
      action: 'adjust',
      entity: 'stock_count_adjustments',
      entityId: adj.id,
      after: { stockCountId, ingredientId, adjustmentQty, adjustmentType, reason },
    });
    return { ok: true as const, data: { id: adj.id } };
  } catch (e) {
    console.error('[createStockAdjustment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getStockCountHistory() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const history = await db.query.stockCounts.findMany({
      orderBy: [desc(stockCounts.countDate)],
      limit: 7,
      with: {
        countedByUser: { columns: { id: true, name: true } },
        items: { columns: { id: true } },
      },
    });
    return { ok: true as const, data: history };
  } catch (e) {
    console.error('[getStockCountHistory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getStockCountList() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const counts = await db.query.stockCounts.findMany({
      orderBy: [desc(stockCounts.countDate)],
      with: {
        countedByUser: { columns: { id: true, name: true } },
        items: { columns: { id: true } },
      },
    });
    return { ok: true as const, data: counts };
  } catch (e) {
    console.error('[getStockCountList]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type StockCountListItem = NonNullable<
  Extract<Awaited<ReturnType<typeof getStockCountList>>, { ok: true }>['data']
>[number];

export async function getStockCountDetail(countId: string) {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, countId),
      with: {
        countedByUser: { columns: { id: true, name: true } },
        items: {
          with: {
            ingredient: {
              columns: { id: true, name: true, unit: true, minStock: true, parLevel: true },
              with: { category: { columns: { id: true, name: true, sortOrder: true } } },
            },
          },
        },
        adjustments: {
          with: {
            ingredient: { columns: { id: true, name: true, unit: true } },
            createdByUser: { columns: { id: true, name: true } },
          },
          orderBy: [asc(stockCountAdjustments.createdAt)],
        },
      },
    });
    if (!count) return { ok: false as const, error: 'ไม่พบข้อมูล' };
    return { ok: true as const, data: count };
  } catch (e) {
    console.error('[getStockCountDetail]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type StockCountDetail = NonNullable<
  Extract<Awaited<ReturnType<typeof getStockCountDetail>>, { ok: true }>['data']
>;

export async function deleteStockCount(id: string) {
  const session = await requireEdit();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    await db.delete(stockCountAdjustments).where(eq(stockCountAdjustments.stockCountId, id));
    await db.delete(stockCountItems).where(eq(stockCountItems.stockCountId, id));
    await db.delete(stockCounts).where(eq(stockCounts.id, id));
    revalidatePath('/inventory/count');
    revalidatePath('/inventory');
    writeAuditLog({
      userId: session.user.id as string,
      role: session.user.role,
      action: 'delete',
      entity: 'stock_counts',
      entityId: id,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[deleteStockCount]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function reviewStockCount(id: string) {
  const session = await requireEdit();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, id),
      columns: { id: true, status: true },
    });
    if (!count) return { ok: false as const, error: 'ไม่พบข้อมูล' };
    if (count.status !== 'submitted') return { ok: false as const, error: 'ยืนยันได้เฉพาะการนับที่ส่งแล้ว' };

    await db.update(stockCounts)
      .set({ status: 'reviewed' })
      .where(eq(stockCounts.id, id));

    revalidatePath('/inventory/count');
    revalidatePath('/inventory');
    writeAuditLog({
      userId: session.user.id as string,
      role: session.user.role,
      action: 'review',
      entity: 'stock_counts',
      entityId: id,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[reviewStockCount]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function unreviewStockCount(id: string) {
  const session = await requireEdit();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, id),
      columns: { id: true, status: true },
    });
    if (!count) return { ok: false as const, error: 'ไม่พบข้อมูล' };
    if (count.status !== 'reviewed') return { ok: false as const, error: 'ยกเลิกได้เฉพาะการนับที่ตรวจแล้ว' };

    await db.update(stockCounts)
      .set({ status: 'submitted' })
      .where(eq(stockCounts.id, id));

    revalidatePath('/inventory/count');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[unreviewStockCount]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type StockCountReorderItem = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantityOnHand: number;
  inTransitQty: number;
  minStock: number;
  parLevel: number;
  reorderQty: number;
  lastCost: number;
  defaultSupplierId: string | null;
  defaultSupplierName: string | null;
};

export async function getStockCountReorderItems() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    // Get latest reviewed count
    const latestCount = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.status, 'reviewed'),
      orderBy: [desc(stockCounts.countDate)],
      with: {
        items: {
          with: {
            ingredient: {
              columns: {
                id: true, name: true, unit: true, minStock: true,
                parLevel: true, lastCost: true, defaultSupplierId: true,
              },
              with: { defaultSupplier: { columns: { id: true, name: true } } },
            },
          },
        },
      },
    });

    if (!latestCount) {
      return { ok: true as const, data: { items: [] as StockCountReorderItem[], countDate: null as string | null } };
    }

    // In-transit: ordered (+ partial_received) POs not yet fully received
    const inTransitPOs = await db.query.purchaseOrders.findMany({
      where: or(
        eq(purchaseOrders.status, 'ordered'),
        eq(purchaseOrders.status, 'partial_received'),
      ),
      with: {
        items: {
          columns: { ingredientId: true, quantity: true, receivedQuantity: true },
        },
      },
    });

    // Sum remaining in-transit qty per ingredient
    const inTransit: Record<string, number> = {};
    for (const po of inTransitPOs) {
      for (const item of po.items) {
        const remaining = Math.max(0, Number(item.quantity) - Number(item.receivedQuantity ?? 0));
        inTransit[item.ingredientId] = (inTransit[item.ingredientId] ?? 0) + remaining;
      }
    }

    const items: StockCountReorderItem[] = latestCount.items
      .map((item) => {
        const qoh = Number(item.quantityOnHand);
        const transit = inTransit[item.ingredient.id] ?? 0;
        const effectiveStock = qoh + transit;
        const parLevel = Number(item.ingredient.parLevel);
        const minStock = Number(item.ingredient.minStock);
        const targetQty = parLevel > 0 ? parLevel : minStock;
        const reorderQty = Math.max(0, targetQty - effectiveStock);
        return {
          ingredientId: item.ingredient.id,
          ingredientName: item.ingredient.name,
          unit: item.unit,
          quantityOnHand: qoh,
          inTransitQty: transit,
          minStock,
          parLevel,
          reorderQty,
          lastCost: Number(item.ingredient.lastCost),
          defaultSupplierId: item.ingredient.defaultSupplierId ?? null,
          defaultSupplierName: item.ingredient.defaultSupplier?.name ?? null,
        };
      })
      .filter((item) => item.reorderQty > 0);

    return { ok: true as const, data: { items, countDate: latestCount.countDate } };
  } catch (e) {
    console.error('[getStockCountReorderItems]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

export async function getNextPoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const result = await db
    .select({ poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(sql`${purchaseOrders.poNumber} LIKE ${prefix + '%'}`)
    .orderBy(desc(purchaseOrders.poNumber))
    .limit(1);

  if (result.length === 0) return `${prefix}0001`;
  const last = result[0].poNumber;
  const seq = parseInt(last.replace(prefix, ''), 10);
  return `${prefix}${String(seq + 1).padStart(4, '0')}`;
}

export async function getPurchaseOrderListData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [pos, supps] = await Promise.all([
      db.query.purchaseOrders.findMany({
        orderBy: [desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt)],
        with: {
          supplier: { columns: { id: true, name: true } },
          createdByUser: { columns: { id: true, name: true } },
          items: { columns: { id: true } },
        },
      }),
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    ]);
    return { ok: true as const, data: { orders: pos, suppliers: supps } };
  } catch (e) {
    console.error('[getPurchaseOrderListData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type POListData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderListData>>, { ok: true }>['data']
>;
export type POListItem = POListData['orders'][number];

export async function getPurchaseOrderDetail(id: string) {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po, cats, supps] = await Promise.all([
      db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, id),
        with: {
          supplier: true,
          createdByUser: { columns: { id: true, name: true } },
          items: { with: { ingredient: { with: { category: true } } } },
          goodsReceipts: {
            orderBy: [desc(goodsReceipts.createdAt)],
            with: {
              receivedByUser: { columns: { id: true, name: true } },
              items: {
                with: { purchaseOrderItem: { columns: { ingredientId: true } } },
              },
            },
          },
        },
      }),
      db.select().from(ingredientCategories).orderBy(asc(ingredientCategories.sortOrder)),
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    ]);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    const ings = await db.query.ingredients.findMany({
      where: eq(ingredients.isActive, true),
      orderBy: [asc(ingredients.name)],
      with: { category: true },
    });
    return { ok: true as const, data: { po, categories: cats, suppliers: supps, ingredients: ings } };
  } catch (e) {
    console.error('[getPurchaseOrderDetail]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type PODetail = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderDetail>>, { ok: true }>['data']
>;

export async function getPurchaseOrderFormData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [supps, ings] = await Promise.all([
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
      db.query.ingredients.findMany({
        where: eq(ingredients.isActive, true),
        orderBy: [asc(ingredients.name)],
        with: { category: true },
      }),
    ]);
    return { ok: true as const, data: { suppliers: supps, ingredients: ings } };
  } catch (e) {
    console.error('[getPurchaseOrderFormData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type POFormData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderFormData>>, { ok: true }>['data']
>;

export async function createPurchaseOrder(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = createPurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  const userId = session.user.id as string;

  try {
    const poNumber = await getNextPoNumber();
    const { items, vatRate, ...poData } = parsed.data;

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;

    const [po] = await db.insert(purchaseOrders).values({
      poNumber,
      supplierId: poData.supplierId,
      status: 'draft',
      orderDate: poData.orderDate,
      expectedDate: poData.expectedDate ?? null,
      vatRate: String(vatRate),
      subtotal: String(subtotal.toFixed(2)),
      vatAmount: String(vatAmount.toFixed(2)),
      total: String(total.toFixed(2)),
      hasTaxInvoice: poData.hasTaxInvoice,
      taxInvoiceNumber: poData.taxInvoiceNumber ?? null,
      notes: poData.notes ?? null,
      createdBy: userId,
    }).returning({ id: purchaseOrders.id });

    await db.insert(purchaseOrderItems).values(
      items.map((item) => ({
        purchaseOrderId: po.id,
        ingredientId: item.ingredientId,
        quantity: String(item.quantity),
        unit: item.unit,
        unitCost: String(item.unitCost),
        lineTotal: String((item.quantity * item.unitCost).toFixed(2)),
      })),
    );

    const result = po.id;

    revalidatePath('/inventory/orders');
    revalidatePath('/inventory');
    return { ok: true as const, id: result };
  } catch (e) {
    console.error('[createPurchaseOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updatePurchaseOrder(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = updatePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  const { id, items, vatRate, ...poData } = parsed.data;

  try {
    const [existing] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!existing) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (existing.status !== 'draft') return { ok: false as const, error: 'แก้ไขได้เฉพาะ PO ที่ยังเป็น Draft' };

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;

    await db.update(purchaseOrders).set({
      supplierId: poData.supplierId,
      orderDate: poData.orderDate,
      expectedDate: poData.expectedDate ?? null,
      vatRate: String(vatRate),
      subtotal: String(subtotal.toFixed(2)),
      vatAmount: String(vatAmount.toFixed(2)),
      total: String(total.toFixed(2)),
      hasTaxInvoice: poData.hasTaxInvoice,
      taxInvoiceNumber: poData.taxInvoiceNumber ?? null,
      notes: poData.notes ?? null,
      updatedAt: new Date(),
    }).where(eq(purchaseOrders.id, id));

    await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
    await db.insert(purchaseOrderItems).values(
      items.map((item) => ({
        purchaseOrderId: id,
        ingredientId: item.ingredientId,
        quantity: String(item.quantity),
        unit: item.unit,
        unitCost: String(item.unitCost),
        lineTotal: String((item.quantity * item.unitCost).toFixed(2)),
      })),
    );

    revalidatePath('/inventory/orders');
    revalidatePath(`/inventory/orders/${id}`);
    return { ok: true as const };
  } catch (e) {
    console.error('[updatePurchaseOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function confirmOrder(id: string) {
  if (!await requirePO()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'draft') return { ok: false as const, error: 'ยืนยันได้เฉพาะ PO ที่เป็น Draft' };
    await db.update(purchaseOrders).set({ status: 'ordered', updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    revalidatePath('/inventory/orders');
    revalidatePath(`/inventory/orders/${id}`);
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[confirmOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function receiveOrder(input: unknown) {
  const poSession = await requirePO();
  if (!poSession) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = receivePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, receivedDate, items, hasTaxInvoice, taxInvoiceNumber, isPartial, notes } = parsed.data;
  const userId = poSession.user.id as string;

  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'ordered' && po.status !== 'partial_received') {
      return { ok: false as const, error: 'รับของได้เฉพาะ PO ที่ยืนยันแล้วหรือรับบางส่วนแล้ว' };
    }

    const poItems = await db.query.purchaseOrderItems.findMany({
      where: eq(purchaseOrderItems.purchaseOrderId, id),
    });

    // Create goods receipt record
    const [receipt] = await db.insert(goodsReceipts).values({
      purchaseOrderId: id,
      receivedDate,
      notes: notes ?? null,
      receivedBy: userId,
    }).returning({ id: goodsReceipts.id });

    // Create receipt items + update PO item received quantities + update lastCost
    for (const receivedItem of items) {
      if (receivedItem.receivedQuantity <= 0) continue;

      await db.insert(goodsReceiptItems).values({
        goodsReceiptId: receipt.id,
        purchaseOrderItemId: receivedItem.id,
        receivedQuantity: String(receivedItem.receivedQuantity),
        discrepancyType: receivedItem.discrepancyType,
        discrepancyNotes: receivedItem.discrepancyNotes ?? null,
      });

      // Accumulate receivedQuantity on PO item
      const poItem = poItems.find((p) => p.id === receivedItem.id);
      if (poItem) {
        const newReceivedQty = Number(poItem.receivedQuantity ?? 0) + receivedItem.receivedQuantity;
        await db.update(purchaseOrderItems)
          .set({ receivedQuantity: String(newReceivedQty) })
          .where(eq(purchaseOrderItems.id, receivedItem.id));

        // Update lastCost on ingredient
        await db.update(ingredients)
          .set({ lastCost: poItem.unitCost, updatedAt: new Date() })
          .where(eq(ingredients.id, poItem.ingredientId));
      }
    }

    // Determine new PO status
    const updatedPoItems = await db
      .select({ quantity: purchaseOrderItems.quantity, receivedQuantity: purchaseOrderItems.receivedQuantity })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, id));

    const allReceived = !isPartial && updatedPoItems.every(
      (item) => Number(item.receivedQuantity ?? 0) >= Number(item.quantity),
    );

    await db.update(purchaseOrders).set({
      status: allReceived ? 'received' : 'partial_received',
      receivedDate: allReceived ? receivedDate : null,
      hasTaxInvoice,
      taxInvoiceNumber: taxInvoiceNumber ?? null,
      updatedAt: new Date(),
    }).where(eq(purchaseOrders.id, id));

    revalidatePath('/inventory/orders');
    revalidatePath(`/inventory/orders/${id}`);
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    writeAuditLog({
      userId,
      role: poSession.user.role,
      action: 'receive',
      entity: 'purchase_orders',
      entityId: id,
      after: { hasTaxInvoice, taxInvoiceNumber: taxInvoiceNumber ?? null, isPartial, itemCount: items.length },
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[receiveOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function cancelOrder(id: string) {
  if (!await requirePO()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status === 'received') return { ok: false as const, error: 'ไม่สามารถยกเลิก PO ที่รับของแล้ว' };
    await db.update(purchaseOrders).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    revalidatePath('/inventory/orders');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[cancelOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function getInventoryDashboard() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';

    const [
      totalIngredients,
      pendingOrders,
      monthlySpend,
      latestCount,
      recentOrders,
      countHistory,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(ingredients).where(eq(ingredients.isActive, true)),
      db.select({ count: sql<number>`count(*)::int` }).from(purchaseOrders).where(eq(purchaseOrders.status, 'ordered')),
      db.select({ total: sql<string>`coalesce(sum(total),'0')` })
        .from(purchaseOrders)
        .where(sql`order_date >= ${monthStart} AND status != 'cancelled'`),
      db.query.stockCounts.findFirst({
        orderBy: [desc(stockCounts.countDate)],
        with: {
          items: {
            with: {
              ingredient: {
                columns: { id: true, minStock: true, name: true, unit: true },
                with: { defaultSupplier: { columns: { id: true, name: true } } },
              },
            },
          },
          countedByUser: { columns: { id: true, name: true } },
        },
      }),
      db.query.purchaseOrders.findMany({
        orderBy: [desc(purchaseOrders.createdAt)],
        limit: 5,
        with: { supplier: { columns: { id: true, name: true } } },
      }),
      db.query.stockCounts.findMany({
        orderBy: [desc(stockCounts.countDate)],
        limit: 7,
        with: {
          countedByUser: { columns: { id: true, name: true } },
          items: { columns: { id: true } },
        },
      }),
    ]);

    const lowStockItems = latestCount
      ? latestCount.items.filter(
          (item) => Number(item.quantityOnHand) < Number(item.ingredient.minStock),
        )
      : [];

    return {
      ok: true as const,
      data: {
        totalIngredients: totalIngredients[0].count,
        lowStockCount: lowStockItems.length,
        pendingOrders: pendingOrders[0].count,
        monthlySpend: Number(monthlySpend[0].total),
        latestCount: latestCount ?? null,
        lowStockItems,
        recentOrders,
        countHistory,
      },
    };
  } catch (e) {
    console.error('[getInventoryDashboard]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type InventoryDashboardData = NonNullable<
  Extract<Awaited<ReturnType<typeof getInventoryDashboard>>, { ok: true }>['data']
>;

// ── PO Approval Workflow ──────────────────────────────────────────────────────

async function requireApprove() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'purchase_order:approve')) return null;
  return s;
}

export async function submitForApproval(id: string) {
  if (!await requirePO()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'draft') return { ok: false as const, error: 'ส่งอนุมัติได้เฉพาะ PO ที่เป็น Draft' };
    await db.update(purchaseOrders).set({ status: 'pending_approval', updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    revalidatePath('/inventory/orders');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[submitForApproval]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function approveOrder(id: string) {
  if (!await requireApprove()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'pending_approval') return { ok: false as const, error: 'อนุมัติได้เฉพาะ PO ที่รอการอนุมัติ' };
    await db.update(purchaseOrders).set({ status: 'ordered', updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    revalidatePath('/inventory/orders');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[approveOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Alert Count (no auth check — called from server layout after auth) ────────

export async function getInventoryAlertCount(): Promise<{ lowStockCount: number; pendingApprovalCount: number }> {
  try {
    const [latestCount, pendingPoCount] = await Promise.all([
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.status, 'submitted'),
        orderBy: [desc(stockCounts.countDate)],
        with: {
          items: {
            with: { ingredient: { columns: { id: true, minStock: true } } },
          },
        },
      }),
      db.select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.status, 'pending_approval')),
    ]);

    const lowStockCount = latestCount
      ? latestCount.items.filter(
          (item) => Number(item.quantityOnHand) < Number(item.ingredient.minStock),
        ).length
      : 0;

    return { lowStockCount, pendingApprovalCount: pendingPoCount[0].count };
  } catch {
    return { lowStockCount: 0, pendingApprovalCount: 0 };
  }
}
