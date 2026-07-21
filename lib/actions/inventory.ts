'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getBangkokBusinessDate } from '@/lib/business-day';
import { db } from '@/lib/db';
import {
  auditLogs,
  goodsReceiptItems,
  goodsReceipts,
  ingredientCategories,
  ingredients,
  pricingTiles,
  purchaseOrderItems,
  purchaseOrders,
  purchasePriceConfirmations,
  sessionGuests,
  sessions,
  stockCountAdjustments,
  stockCountItems,
  stockCounts,
  storeBusinessDays,
  suppliers,
} from '@/lib/db/schema';
import {
  calculatePhysicalStockUsage,
  calculatePriceVariance,
  calculatePurchaseTotals,
  deriveDeliveryState,
  roundMoney,
} from '@/lib/inventory/procurement-math';
import {
  normalizePlanningPriceStatus,
  normalizePurchaseQuantity,
} from '@/lib/inventory/procurement-integrity';
import { prepareCostMetadataRecalculation } from '@/lib/inventory/stock-cost-metadata';
import { getOpenPoIncomingBreakdown } from '@/lib/inventory/reorder-db';
import {
  buildReorderRecommendation,
  partitionReorderSelection,
  reorderGenerationKeyForSupplier,
  type ReorderSelectionLine,
} from '@/lib/inventory/reorder-recommendation';
import {
  buildInitialSetupItemValues,
  evaluateInitialSetupGate,
  isCountedValue,
  INITIAL_SETUP_COUNT_TYPE,
} from '@/lib/inventory/initial-setup';
import {
  findReviewedCountUsingMovement,
  getInventoryIntervalBreakdown,
  recomputeIngredientLastCost,
  recomputePurchaseFinancialSummary,
} from '@/lib/inventory/procurement-db';
import {
  cancelPurchaseOrderSchema,
  confirmReceiptPriceSchema,
  createIngredientSchema,
  createPurchaseOrderSchema,
  createStockAdjustmentSchema,
  createSupplierSchema,
  emergencyPurchaseSchema,
  generateReorderDraftSchema,
  receivePurchaseOrderSchema,
  saveInitialSetupSchema,
  saveStockCountSchema,
  updateIngredientSchema,
  updatePurchaseOrderSchema,
  updateSupplierSchema,
  voidGoodsReceiptSchema,
} from '@/lib/validations/inventory';

const NO_PERMISSION = 'ไม่มีสิทธิ์ดำเนินการ';
const INVALID_DATA = 'ข้อมูลไม่ถูกต้อง';
const GENERAL_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่';

function qty(value: number) {
  return String(Math.round(value * 100) / 100);
}

function money(value: number | null | undefined) {
  return value == null ? null : String(roundMoney(value));
}

function audit(
  userId: string,
  role: string,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
) {
  return db.insert(auditLogs).values({
    userId,
    action,
    entity,
    entityId,
    metadata: {
      role,
      reason: reason ?? null,
      before: before ?? null,
      after: after ?? null,
    },
  });
}

function revalidateInventory(id?: string) {
  revalidatePath('/inventory');
  revalidatePath('/inventory/count');
  revalidatePath('/inventory/orders');
  revalidatePath('/inventory/ingredients');
  if (id) revalidatePath(`/inventory/orders/${id}`);
}

async function requireView() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'inventory:view')) return null;
  return session;
}

async function requireEdit() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'inventory:edit')) return null;
  return session;
}

async function requireStockCount() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'stock_count:create')) return null;
  return session;
}

async function requirePO() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'purchase_order:manage')) return null;
  return session;
}

async function requireApprove() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'purchase_order:approve')) return null;
  return session;
}

async function ensureOpenBusinessDay(businessDate: string) {
  await db
    .insert(storeBusinessDays)
    .values({ businessDate })
    .onConflictDoNothing({ target: storeBusinessDays.businessDate });
  const day = await db.query.storeBusinessDays.findFirst({
    where: eq(storeBusinessDays.businessDate, businessDate),
    columns: { id: true, status: true },
  });
  if (!day) throw new Error('BUSINESS_DAY_NOT_FOUND');
  if (day.status === 'closed') throw new Error('BUSINESS_DAY_CLOSED');
  return day;
}


function businessError(error: unknown) {
  if (error instanceof Error && error.message === 'BUSINESS_DAY_CLOSED') {
    return 'วันทำการนี้ปิดแล้ว ต้องเปิดวันทำการก่อนบันทึก';
  }
  return GENERAL_ERROR;
}

// Ingredients

export async function getIngredientPageData() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const [categories, supplierRows, ingredientRows] = await Promise.all([
      db.select().from(ingredientCategories).orderBy(asc(ingredientCategories.sortOrder)),
      db.select().from(suppliers).orderBy(asc(suppliers.name)),
      db.query.ingredients.findMany({
        orderBy: [asc(ingredients.name)],
        with: { category: true, defaultSupplier: true },
      }),
    ]);
    return {
      ok: true as const,
      data: { categories, suppliers: supplierRows, ingredients: ingredientRows },
    };
  } catch (error) {
    console.error('[getIngredientPageData]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type IngredientPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getIngredientPageData>>, { ok: true }>['data']
>;
export type IngredientRow = IngredientPageData['ingredients'][number];

export async function createIngredient(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: NO_PERMISSION };
  const parsed = createIngredientSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const {
    minStock,
    parLevel,
    lastCost,
    yieldPercent,
    orderUnitConversion,
    defaultSupplierId,
    orderUnit,
    storageLocation,
    notes,
    ...rest
  } = parsed.data;
  try {
    await db.insert(ingredients).values({
      ...rest,
      minStock: qty(minStock),
      parLevel: qty(parLevel),
      lastCost: money(lastCost)!,
      yieldPercent: qty(yieldPercent),
      orderUnitConversion: String(orderUnitConversion),
      defaultSupplierId: defaultSupplierId ?? null,
      orderUnit: orderUnit ?? null,
      storageLocation: storageLocation ?? null,
      notes: notes ?? null,
    });
    revalidateInventory();
    return { ok: true as const };
  } catch (error) {
    console.error('[createIngredient]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function updateIngredient(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: NO_PERMISSION };
  const parsed = updateIngredientSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const {
    id,
    minStock,
    parLevel,
    lastCost,
    yieldPercent,
    orderUnitConversion,
    defaultSupplierId,
    orderUnit,
    storageLocation,
    notes,
    ...rest
  } = parsed.data;
  try {
    await db.update(ingredients).set({
      ...rest,
      minStock: qty(minStock),
      parLevel: qty(parLevel),
      lastCost: money(lastCost)!,
      yieldPercent: qty(yieldPercent),
      orderUnitConversion: String(orderUnitConversion),
      defaultSupplierId: defaultSupplierId ?? null,
      orderUnit: orderUnit ?? null,
      storageLocation: storageLocation ?? null,
      notes: notes ?? null,
      updatedAt: new Date(),
    }).where(eq(ingredients.id, id));
    revalidateInventory();
    return { ok: true as const };
  } catch (error) {
    console.error('[updateIngredient]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function toggleIngredientActive(id: string) {
  if (!await requireEdit()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const row = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, id),
      columns: { isActive: true },
    });
    if (!row) return { ok: false as const, error: 'ไม่พบวัตถุดิบ' };
    await db.update(ingredients)
      .set({ isActive: !row.isActive, updatedAt: new Date() })
      .where(eq(ingredients.id, id));
    revalidateInventory();
    return { ok: true as const };
  } catch (error) {
    console.error('[toggleIngredientActive]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

// Suppliers

export async function getSupplierPageData() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const rows = await db.query.suppliers.findMany({
      orderBy: [asc(suppliers.name)],
      with: { purchaseOrders: { columns: { id: true } } },
    });
    return { ok: true as const, data: rows };
  } catch (error) {
    console.error('[getSupplierPageData]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type SupplierPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getSupplierPageData>>, { ok: true }>['data']
>;
export type SupplierRow = SupplierPageData[number];

export async function createSupplier(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: NO_PERMISSION };
  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  try {
    await db.insert(suppliers).values({
      ...parsed.data,
      contactName: parsed.data.contactName ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      taxId: parsed.data.taxId ?? null,
      lineContact: parsed.data.lineContact ?? null,
      minOrderAmount: parsed.data.minOrderAmount == null ? null : money(parsed.data.minOrderAmount),
      notes: parsed.data.notes ?? null,
    });
    revalidatePath('/inventory/suppliers');
    return { ok: true as const };
  } catch (error) {
    console.error('[createSupplier]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function updateSupplier(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: NO_PERMISSION };
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const { id, ...data } = parsed.data;
  try {
    await db.update(suppliers).set({
      ...data,
      contactName: data.contactName ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      taxId: data.taxId ?? null,
      lineContact: data.lineContact ?? null,
      minOrderAmount: data.minOrderAmount == null ? null : money(data.minOrderAmount),
      notes: data.notes ?? null,
    }).where(eq(suppliers.id, id));
    revalidatePath('/inventory/suppliers');
    return { ok: true as const };
  } catch (error) {
    console.error('[updateSupplier]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function toggleSupplierActive(id: string) {
  if (!await requireEdit()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const row = await db.query.suppliers.findFirst({
      where: eq(suppliers.id, id),
      columns: { isActive: true },
    });
    if (!row) return { ok: false as const, error: 'ไม่พบผู้ขาย' };
    await db.update(suppliers)
      .set({ isActive: !row.isActive })
      .where(eq(suppliers.id, id));
    revalidatePath('/inventory/suppliers');
    return { ok: true as const };
  } catch (error) {
    console.error('[toggleSupplierActive]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

// Stock count

async function getGuestCountForDate(date: string) {
  try {
    const [row] = await db
      .select({ total: sql<number>`cast(coalesce(sum(${sessionGuests.quantity}), 0) as int)` })
      .from(sessionGuests)
      .innerJoin(sessions, eq(sessions.id, sessionGuests.sessionId))
      .innerJoin(pricingTiles, and(
        eq(pricingTiles.id, sessionGuests.pricingTileId),
        eq(pricingTiles.category, 'guest'),
      ))
      .where(sql`DATE(${sessions.startedAt} AT TIME ZONE 'Asia/Bangkok') = ${date}`);
    return row?.total ?? 0;
  } catch {
    return 0;
  }
}

async function priorReviewedCounts(date: string) {
  return db.query.stockCounts.findMany({
    where: and(eq(stockCounts.status, 'reviewed'), lt(stockCounts.countDate, date)),
    orderBy: [desc(stockCounts.countDate)],
    with: {
      items: {
        columns: { ingredientId: true, quantityOnHand: true, isCounted: true },
      },
    },
  });
}

function openingMaps(
  counts: Awaited<ReturnType<typeof priorReviewedCounts>>,
) {
  const balances: Record<string, string> = {};
  const sources: Record<string, { stockCountId: string; countDate: string }> = {};
  for (const count of counts) {
    for (const item of count.items) {
      if (item.isCounted && balances[item.ingredientId] == null) {
        balances[item.ingredientId] = item.quantityOnHand;
        sources[item.ingredientId] = { stockCountId: count.id, countDate: count.countDate };
      }
    }
  }
  return { balances, sources };
}

export async function getStockCountPageData(date: string) {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const [categories, ingredientRows, existingCount, previousCounts, todayGuestCount] =
      await Promise.all([
        db.select().from(ingredientCategories)
          .where(eq(ingredientCategories.isActive, true))
          .orderBy(asc(ingredientCategories.sortOrder)),
        db.query.ingredients.findMany({
          where: eq(ingredients.isActive, true),
          orderBy: [asc(ingredients.name)],
          with: { category: true },
        }),
        db.query.stockCounts.findFirst({
          where: eq(stockCounts.countDate, date),
          with: {
            items: true,
            adjustments: true,
            countedByUser: { columns: { id: true, name: true } },
          },
        }),
        priorReviewedCounts(date),
        getGuestCountForDate(date),
      ]);
    const opening = openingMaps(previousCounts);
    const [receiptBreakdown, incomingPo] = await Promise.all([
      getInventoryIntervalBreakdown(
        date,
        opening.sources,
        ingredientRows.map((ingredient) => ingredient.id),
      ),
      getOpenPoIncomingBreakdown(date, ingredientRows.map((ingredient) => ingredient.id)),
    ]);
    return {
      ok: true as const,
      data: {
        categories,
        ingredients: ingredientRows,
        existingCount: existingCount ?? null,
        openingBalances: opening.balances,
        openingSources: opening.sources,
        todayReceivedQty: receiptBreakdown.total,
        regularReceivedQty: receiptBreakdown.regular,
        emergencyReceivedQty: receiptBreakdown.emergency,
        positiveAdjustmentQty: receiptBreakdown.positiveAdjustments,
        recordedWasteQty: receiptBreakdown.waste,
        otherOutboundQty: receiptBreakdown.otherOutbound,
        intervalPriceStatus: receiptBreakdown.priceStatus,
        guaranteedIncomingQty: incomingPo.guaranteed,
        delayedIncomingQty: incomingPo.delayed,
        pendingPriceIngredientIds: receiptBreakdown.pendingPriceIngredientIds,
        todayGuestCount,
      },
    };
  } catch (error) {
    console.error('[getStockCountPageData]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type StockCountPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getStockCountPageData>>, { ok: true }>['data']
>;

export async function saveStockCount(input: unknown) {
  const session = await requireStockCount();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  const parsed = saveStockCountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const { countDate, asDraft, notes, items } = parsed.data;
  if (!asDraft && items.some((item) => !item.isCounted || item.physicalCount == null)) {
    return { ok: false as const, error: 'ยังมีรายการที่ยังไม่ได้นับ กรุณานับหรือระบุ “หมด” ก่อนส่ง' };
  }

  const userId = session.user.id as string;
  try {
    const [existing, businessDay, previousCounts, ingredientRows] = await Promise.all([
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.countDate, countDate),
        with: { adjustments: true },
      }),
      ensureOpenBusinessDay(countDate),
      priorReviewedCounts(countDate),
      db.select({
        id: ingredients.id,
        lastCost: ingredients.lastCost,
      }).from(ingredients).where(inArray(ingredients.id, items.map((item) => item.ingredientId))),
    ]);
    if (existing && existing.status !== 'draft') {
      return { ok: false as const, error: 'แก้ไขได้เฉพาะรายการนับที่ยังเป็นแบบร่าง' };
    }

    const opening = openingMaps(previousCounts);
    const receiptBreakdown = await getInventoryIntervalBreakdown(
      countDate,
      opening.sources,
      items.map((item) => item.ingredientId),
    );
    const ingredientMap = new Map(ingredientRows.map((row) => [row.id, row]));
    const pendingPriceIds = new Set(receiptBreakdown.pendingPriceIngredientIds);
    const countId = existing?.id ?? randomUUID();
    const selectedIds = items.map((item) => item.ingredientId);
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      existing
        ? db.update(stockCounts).set({
            status: asDraft ? 'draft' : 'submitted',
            businessDayId: businessDay.id,
            notes: notes ?? null,
            submittedAt: asDraft ? null : new Date(),
          }).where(eq(stockCounts.id, countId))
        : db.insert(stockCounts).values({
            id: countId,
            countDate,
            countedBy: userId,
            status: asDraft ? 'draft' : 'submitted',
            businessDayId: businessDay.id,
            notes: notes ?? null,
            submittedAt: asDraft ? null : new Date(),
          }),
    ];

    if (selectedIds.length > 0) {
      operations.push(
        db.delete(stockCountItems).where(and(
          eq(stockCountItems.stockCountId, countId),
          inArray(stockCountItems.ingredientId, selectedIds),
        )),
      );
    }

    const itemValues = [];
    const overrideAuditRows: Array<{
      ingredientId: string;
      before: number | null;
      after: number;
      reason: string;
    }> = [];

    for (const item of items) {
      const openingSource = opening.sources[item.ingredientId];
      const authoritativeOpening = Number(opening.balances[item.ingredientId] ?? 0);
      const manualOpening = !openingSource;
      const openingChanged = Math.abs(item.openingBalance - authoritativeOpening) >= 0.005;
      if (manualOpening || openingChanged) {
        if (!can(session.user.role, 'stock_count:override_opening')) {
          return { ok: false as const, error: 'ไม่มีสิทธิ์กำหนดหรือแก้ยอดยกมา' };
        }
        if (!item.openingOverrideReason?.trim()) {
          return {
            ok: false as const,
            error: manualOpening
              ? 'กรุณาระบุเหตุผลสำหรับยอดยกมาเริ่มต้น'
              : 'กรุณาระบุเหตุผลเมื่อแก้ยอดยกมา',
          };
        }
        overrideAuditRows.push({
          ingredientId: item.ingredientId,
          before: manualOpening ? null : authoritativeOpening,
          after: item.openingBalance,
          reason: item.openingOverrideReason.trim(),
        });
      }

      const positiveAdjustment = receiptBreakdown.positiveAdjustments[item.ingredientId] ?? 0;
      const recordedWaste = receiptBreakdown.waste[item.ingredientId] ?? 0;
      const otherOutbound = receiptBreakdown.otherOutbound[item.ingredientId] ?? 0;
      const regularReceived = receiptBreakdown.regular[item.ingredientId] ?? 0;
      const emergencyReceived = receiptBreakdown.emergency[item.ingredientId] ?? 0;
      const openingBalance = manualOpening || openingChanged ? item.openingBalance : authoritativeOpening;
      const physicalCount = item.isCounted && item.physicalCount != null ? item.physicalCount : 0;
      const usage = calculatePhysicalStockUsage({
        openingQuantity: openingBalance,
        regularReceived,
        emergencyReceived,
        positiveAdjustment,
        physicalClosingQuantity: physicalCount,
        recordedWaste,
        otherOutboundAdjustment: otherOutbound,
      });
      const unitCost = Number(ingredientMap.get(item.ingredientId)?.lastCost ?? 0);
      const intervalPriceStatus = receiptBreakdown.priceStatus[item.ingredientId] ?? 'confirmed';
      const costIncomplete = pendingPriceIds.has(item.ingredientId) || intervalPriceStatus !== 'confirmed';
      itemValues.push({
        stockCountId: countId,
        ingredientId: item.ingredientId,
        openingBalance: qty(openingBalance),
        receivedQty: qty(regularReceived + emergencyReceived),
        usedQty: qty(usage.totalStockDepletion),
        quantityOnHand: qty(physicalCount),
        isCounted: item.isCounted,
        openingSourceCountId: openingSource?.stockCountId ?? null,
        openingSourceDate: openingSource?.countDate ?? null,
        openingOverrideReason: manualOpening || openingChanged ? item.openingOverrideReason?.trim() : null,
        regularReceivedQty: qty(regularReceived),
        emergencyReceivedQty: qty(emergencyReceived),
        positiveAdjustmentQty: qty(positiveAdjustment),
        recordedWasteQty: qty(recordedWaste),
        otherOutboundQty: qty(otherOutbound),
        totalDepletionQty: qty(usage.totalStockDepletion),
        estimatedOperationalUsageQty: qty(usage.estimatedOperationalUsage),
        usageUnitCost: money(unitCost),
        usageCostStatus: intervalPriceStatus,
        estimatedUsageCost: costIncomplete ? null : money(usage.estimatedOperationalUsage * unitCost),
        costRecalculatedAt: new Date(),
        unit: item.unit,
        notes: item.notes ?? null,
      });
    }

    if (itemValues.length > 0) operations.push(db.insert(stockCountItems).values(itemValues));
    for (const row of overrideAuditRows) {
      operations.push(audit(
        userId,
        session.user.role,
        'override_opening_balance',
        'stock_count_items',
        `${countId}:${row.ingredientId}`,
        { openingBalance: row.before },
        { openingBalance: row.after },
        row.reason,
      ));
    }
    if (!asDraft) {
      operations.push(audit(
        userId,
        session.user.role,
        'submit',
        'stock_counts',
        countId,
        existing ? { status: existing.status } : null,
        { status: 'submitted', countDate, itemCount: items.length },
      ));
    }

    await db.batch(operations);
    revalidateInventory();
    return { ok: true as const, countId };
  } catch (error) {
    console.error('[saveStockCount]', error);
    return { ok: false as const, error: businessError(error) };
  }
}

export async function getLowStockItems(countId: string) {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const items = await db.query.stockCountItems.findMany({
      where: eq(stockCountItems.stockCountId, countId),
      with: { ingredient: { with: { defaultSupplier: true, category: true } } },
    });
    return {
      ok: true as const,
      data: items.filter((item) => (
        item.isCounted && Number(item.quantityOnHand) < Number(item.ingredient.minStock)
      )),
    };
  } catch (error) {
    console.error('[getLowStockItems]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type LowStockItem = NonNullable<
  Extract<Awaited<ReturnType<typeof getLowStockItems>>, { ok: true }>['data']
>[number];

export async function createStockAdjustment(input: unknown) {
  const session = await requireStockCount();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  const parsed = createStockAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const userId = session.user.id as string;
  const { stockCountId, ingredientId, adjustmentType, reason } = parsed.data;
  const adjustmentQty = adjustmentType === 'waste'
    ? Math.abs(parsed.data.adjustmentQty)
    : parsed.data.adjustmentQty;
  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, stockCountId),
      columns: { id: true, status: true, countDate: true, businessDayId: true },
    });
    if (!count) return { ok: false as const, error: 'ไม่พบรายการนับสต็อก' };
    if (count.status !== 'submitted') {
      return { ok: false as const, error: 'ผลนับที่ตรวจรับแล้วต้อง unreview ก่อนปรับ quantity' };
    }
    const item = await db.query.stockCountItems.findFirst({
      where: and(
        eq(stockCountItems.stockCountId, stockCountId),
        eq(stockCountItems.ingredientId, ingredientId),
      ),
    });
    if (!item) return { ok: false as const, error: 'ไม่พบวัตถุดิบในผลนับนี้' };

    const positive = Number(item.positiveAdjustmentQty) +
      (adjustmentType === 'adjustment' && adjustmentQty > 0 ? adjustmentQty : 0);
    const waste = Number(item.recordedWasteQty) +
      (adjustmentType === 'waste' ? Math.abs(adjustmentQty) : 0);
    const outbound = Number(item.otherOutboundQty) +
      (adjustmentType === 'adjustment' && adjustmentQty < 0 ? Math.abs(adjustmentQty) : 0);
    const usage = calculatePhysicalStockUsage({
      openingQuantity: Number(item.openingBalance),
      regularReceived: Number(item.regularReceivedQty),
      emergencyReceived: Number(item.emergencyReceivedQty),
      positiveAdjustment: positive,
      physicalClosingQuantity: Number(item.quantityOnHand),
      recordedWaste: waste,
      otherOutboundAdjustment: outbound,
    });
    const adjustmentId = randomUUID();
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(stockCountAdjustments).values({
        id: adjustmentId,
        stockCountId,
        ingredientId,
        adjustmentQty: qty(adjustmentQty),
        adjustmentType,
        businessDayId: count.businessDayId,
        effectiveDate: count.countDate,
        reason,
        createdBy: userId,
      }),
      db.update(stockCountItems).set({
        positiveAdjustmentQty: qty(positive),
        recordedWasteQty: qty(waste),
        otherOutboundQty: qty(outbound),
        usedQty: qty(usage.totalStockDepletion),
        totalDepletionQty: qty(usage.totalStockDepletion),
        estimatedOperationalUsageQty: qty(usage.estimatedOperationalUsage),
        estimatedUsageCost: item.usageCostStatus === 'incomplete' || item.usageUnitCost == null
          ? null
          : money(usage.estimatedOperationalUsage * Number(item.usageUnitCost)),
      }).where(eq(stockCountItems.id, item.id)),
      audit(
        userId,
        session.user.role,
        'adjust',
        'stock_count_adjustments',
        adjustmentId,
        {
          positiveAdjustmentQty: item.positiveAdjustmentQty,
          recordedWasteQty: item.recordedWasteQty,
          otherOutboundQty: item.otherOutboundQty,
        },
        { ingredientId, adjustmentQty, adjustmentType, reason },
        reason,
      ),
    ];
    await db.batch(operations);
    revalidateInventory();
    return { ok: true as const, data: { id: adjustmentId } };
  } catch (error) {
    console.error('[createStockAdjustment]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function getStockCountHistory() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const data = await db.query.stockCounts.findMany({
      orderBy: [desc(stockCounts.countDate)],
      limit: 7,
      with: {
        countedByUser: { columns: { id: true, name: true } },
        items: { columns: { id: true, isCounted: true } },
      },
    });
    return { ok: true as const, data };
  } catch (error) {
    console.error('[getStockCountHistory]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function getStockCountList() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const data = await db.query.stockCounts.findMany({
      orderBy: [desc(stockCounts.countDate)],
      with: {
        countedByUser: { columns: { id: true, name: true } },
        items: { columns: { id: true, isCounted: true } },
      },
    });
    return { ok: true as const, data };
  } catch (error) {
    console.error('[getStockCountList]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type StockCountListItem = NonNullable<
  Extract<Awaited<ReturnType<typeof getStockCountList>>, { ok: true }>['data']
>[number];

export async function getStockCountDetail(countId: string) {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const data = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, countId),
      with: {
        countedByUser: { columns: { id: true, name: true } },
        items: {
          with: {
            ingredient: {
              columns: {
                id: true,
                name: true,
                unit: true,
                minStock: true,
                parLevel: true,
              },
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
    if (!data) return { ok: false as const, error: 'ไม่พบรายการนับสต็อก' };
    return { ok: true as const, data };
  } catch (error) {
    console.error('[getStockCountDetail]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type StockCountDetail = NonNullable<
  Extract<Awaited<ReturnType<typeof getStockCountDetail>>, { ok: true }>['data']
>;

export async function deleteStockCount(id: string) {
  const session = await requireEdit();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, id),
      columns: { id: true, countDate: true, status: true },
    });
    if (!count) return { ok: false as const, error: 'ไม่พบรายการนับสต็อก' };
    if (count.status !== 'draft') {
      return { ok: false as const, error: 'ลบได้เฉพาะแบบร่าง ประวัติที่ส่งแล้วต้องแก้ด้วยรายการปรับปรุง' };
    }
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.delete(stockCountItems).where(eq(stockCountItems.stockCountId, id)),
      db.delete(stockCounts).where(eq(stockCounts.id, id)),
      audit(
        session.user.id as string,
        session.user.role,
        'delete_draft',
        'stock_counts',
        id,
        count,
        { deleted: true },
      ),
    ];
    await db.batch(operations);
    revalidateInventory();
    return { ok: true as const };
  } catch (error) {
    console.error('[deleteStockCount]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function reviewStockCount(id: string, reason = '') {
  const session = await requireEdit();
  if (!session || !can(session.user.role, 'stock_count:review')) return { ok: false as const, error: NO_PERMISSION };
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3) return { ok: false as const, error: 'กรุณาระบุเหตุผลตรวจรับอย่างน้อย 3 ตัวอักษร' };
  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, id),
      with: { items: { columns: { isCounted: true } } },
    });
    if (!count) return { ok: false as const, error: 'ไม่พบรายการนับสต็อก' };
    if (count.status !== 'submitted') {
      return { ok: false as const, error: 'ตรวจรับได้เฉพาะรายการที่ส่งแล้ว' };
    }
    if (count.items.some((item) => !item.isCounted)) {
      return { ok: false as const, error: 'ยังมีรายการที่ยังไม่ได้นับ' };
    }
    const reviewedAt = new Date();
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.update(stockCounts).set({
        status: 'reviewed',
        reviewedAt,
        reviewedBy: session.user.id as string,
      }).where(and(eq(stockCounts.id, id), eq(stockCounts.status, 'submitted'))),
      audit(
        session.user.id as string,
        session.user.role,
        'review',
        'stock_counts',
        id,
        { status: count.status },
        { status: 'reviewed', reviewedAt: reviewedAt.toISOString(), businessDay: count.countDate },
        normalizedReason,
      ),
    ];
    await db.batch(operations);
    revalidateInventory();
    return { ok: true as const };
  } catch (error) {
    console.error('[reviewStockCount]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function unreviewStockCount(id: string, reason = '') {
  const session = await requireEdit();
  if (!session || !can(session.user.role, 'stock_count:unreview')) return { ok: false as const, error: NO_PERMISSION };
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3) {
    return { ok: false as const, error: 'กรุณาระบุเหตุผลยกเลิกการตรวจรับอย่างน้อย 3 ตัวอักษร' };
  }
  try {
    const count = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.id, id),
      columns: { id: true, status: true, reviewedAt: true, reviewedBy: true },
    });
    if (!count) return { ok: false as const, error: 'ไม่พบรายการนับสต็อก' };
    if (count.status !== 'reviewed') {
      return { ok: false as const, error: 'ยกเลิกได้เฉพาะรายการที่ตรวจรับแล้ว' };
    }
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.update(stockCounts).set({
        status: 'submitted',
        reviewedAt: null,
        reviewedBy: null,
      }).where(and(eq(stockCounts.id, id), eq(stockCounts.status, 'reviewed'))),
      audit(
        session.user.id as string,
        session.user.role,
        'unreview',
        'stock_counts',
        id,
        count,
        { status: 'submitted', reviewedAt: null, reviewedBy: null },
        normalizedReason,
      ),
    ];
    await db.batch(operations);
    revalidateInventory();
    return { ok: true as const };
  } catch (error) {
    console.error('[unreviewStockCount]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type StockCountReorderItem = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantityOnHand: number;
  inTransitQty: number;
  delayedIncomingQty: number;
  minStock: number;
  parLevel: number;
  reorderQty: number;
  lastCost: number;
  defaultSupplierId: string | null;
  defaultSupplierName: string | null;
  hasDelayedOrder: boolean;
  // Phase 17B — purchase-unit recommendation
  purchaseUnit: string | null;
  conversion: number | null;
  canRecommend: boolean;
  blockedReason: 'missing_conversion' | null;
  recommendedPurchaseQty: number;
  normalizedStockQty: number;
  projectedStock: number;
};

export async function getStockCountReorderItems() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const [latestCount, openOrders] = await Promise.all([
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.status, 'reviewed'),
        orderBy: [desc(stockCounts.countDate)],
        with: {
          items: {
            with: {
              ingredient: {
                columns: {
                  id: true,
                  name: true,
                  unit: true,
                  minStock: true,
                  parLevel: true,
                  lastCost: true,
                  defaultSupplierId: true,
                  orderUnit: true,
                  orderUnitConversion: true,
                },
                with: { defaultSupplier: { columns: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      db.query.purchaseOrders.findMany({
        where: or(
          eq(purchaseOrders.status, 'ordered'),
          eq(purchaseOrders.status, 'partial_received'),
        ),
        with: {
          items: {
            columns: { ingredientId: true, quantity: true, receivedQuantity: true },
          },
        },
      }),
    ]);
    if (!latestCount) {
      return {
        ok: true as const,
        data: { items: [] as StockCountReorderItem[], countDate: null as string | null },
      };
    }
    const today = getBangkokBusinessDate();
    const guaranteedIncoming: Record<string, number> = {};
    const delayedIncoming: Record<string, number> = {};
    for (const order of openOrders) {
      const delivery = deriveDeliveryState({
        expectedDate: order.expectedDate,
        asOfDate: today,
        orderedQuantity: order.items.reduce((sum, item) => sum + Number(item.quantity), 0),
        receivedQuantity: order.items.reduce((sum, item) => sum + Number(item.receivedQuantity ?? 0), 0),
        status: order.status,
      });
      for (const item of order.items) {
        const remaining = Math.max(0, Number(item.quantity) - Number(item.receivedQuantity ?? 0));
        const bucket = delivery.isDelayed ? delayedIncoming : guaranteedIncoming;
        bucket[item.ingredientId] = (bucket[item.ingredientId] ?? 0) + remaining;
      }
    }
    const result = latestCount.items
      .map((item) => {
        const quantityOnHand = Number(item.quantityOnHand);
        const inTransitQty = guaranteedIncoming[item.ingredient.id] ?? 0;
        const delayedIncomingQty = delayedIncoming[item.ingredient.id] ?? 0;
        const parLevel = Number(item.ingredient.parLevel);
        const minStock = Number(item.ingredient.minStock);
        const rawConversion = Number(item.ingredient.orderUnitConversion);
        const orderUnit = item.ingredient.orderUnit;
        // A conversion of exactly 1 with no distinct order unit means the
        // purchase unit is the stock unit itself — a valid 1:1 recommendation.
        const conversion = Number.isFinite(rawConversion) && rawConversion > 0 ? rawConversion : null;
        const recommendation = buildReorderRecommendation({
          physicalStock: quantityOnHand,
          parLevel,
          minimumStock: minStock,
          onTimeIncoming: inTransitQty,
          delayedIncoming: delayedIncomingQty,
          conversion,
          purchaseUnit: orderUnit ?? item.unit,
          stockUnit: item.unit,
        });
        return {
          ingredientId: item.ingredient.id,
          ingredientName: item.ingredient.name,
          unit: item.unit,
          quantityOnHand,
          inTransitQty,
          delayedIncomingQty,
          minStock,
          parLevel,
          reorderQty: recommendation.shortageStockQty,
          lastCost: Number(item.ingredient.lastCost),
          defaultSupplierId: item.ingredient.defaultSupplierId ?? null,
          defaultSupplierName: item.ingredient.defaultSupplier?.name ?? null,
          hasDelayedOrder: delayedIncomingQty > 0,
          purchaseUnit: recommendation.purchaseUnit,
          conversion: recommendation.conversion,
          canRecommend: recommendation.canRecommend,
          blockedReason: recommendation.blockedReason,
          recommendedPurchaseQty: recommendation.recommendedPurchaseQty,
          normalizedStockQty: recommendation.normalizedStockQty,
          projectedStock: recommendation.projectedStock,
        };
      })
      .filter((item) => item.reorderQty > 0);
    return { ok: true as const, data: { items: result, countDate: latestCount.countDate } };
  } catch (error) {
    console.error('[getStockCountReorderItems]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

// Purchase orders and receipts

export async function getNextPoNumber() {
  const year = Number(getBangkokBusinessDate().slice(0, 4));
  const prefix = `PO-${year}-`;
  const [row] = await db
    .select({ poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(sql`${purchaseOrders.poNumber} LIKE ${prefix + '%'}`)
    .orderBy(desc(purchaseOrders.poNumber))
    .limit(1);
  if (!row) return `${prefix}0001`;
  const sequence = Number.parseInt(row.poNumber.replace(prefix, ''), 10);
  return `${prefix}${String(sequence + 1).padStart(4, '0')}`;
}

export async function getPurchaseOrderListData() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const [orders, supplierRows] = await Promise.all([
      db.query.purchaseOrders.findMany({
        orderBy: [desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt)],
        with: {
          supplier: { columns: { id: true, name: true } },
          createdByUser: { columns: { id: true, name: true } },
          items: {
            columns: {
              id: true,
              quantity: true,
              receivedQuantity: true,
              priceStatus: true,
            },
          },
          goodsReceipts: {
            columns: { id: true, voidedAt: true },
            with: { items: { columns: { priceStatus: true } } },
          },
        },
      }),
      db.select().from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(asc(suppliers.name)),
    ]);
    const businessDate = getBangkokBusinessDate();
    const enriched = orders.map((order) => {
      const remainingQuantity = order.items.reduce(
        (sum, item) => sum + Math.max(0, Number(item.quantity) - Number(item.receivedQuantity ?? 0)),
        0,
      );
      const delivery = deriveDeliveryState({
        expectedDate: order.expectedDate,
        asOfDate: businessDate,
        orderedQuantity: order.items.reduce((sum, item) => sum + Number(item.quantity), 0),
        receivedQuantity: order.items.reduce((sum, item) => sum + Number(item.receivedQuantity ?? 0), 0),
        status: order.status,
      });
      const activeReceipts = order.goodsReceipts.filter((receipt) => !receipt.voidedAt);
      const receiptHasPendingPrice = activeReceipts.some((receipt) =>
        receipt.items.some((item) => item.priceStatus !== 'confirmed'),
      );
      return {
        ...order,
        displaySupplierName: order.supplier?.name ?? order.vendorName ?? 'ไม่ระบุผู้ขาย',
        remainingQuantity,
        isDelayed: delivery.isDelayed,
        delayedDays: delivery.delayedDays,
        deliveryState: order.status === 'received' || order.status === 'cancelled'
          ? order.status
          : delivery.isDelayed
            ? 'delayed'
            : delivery.remainingQuantity < order.items.reduce((sum, item) => sum + Number(item.quantity), 0)
              ? 'partial'
              : 'shipping',
        hasPendingPrices: order.hasPendingPrices || receiptHasPendingPrice,
      };
    });
    return { ok: true as const, data: { orders: enriched, suppliers: supplierRows } };
  } catch (error) {
    console.error('[getPurchaseOrderListData]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type POListData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderListData>>, { ok: true }>['data']
>;
export type POListItem = POListData['orders'][number];

export async function getPurchaseOrderDetail(id: string) {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const [po, categories, supplierRows, ingredientRows] = await Promise.all([
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
                with: {
                  purchaseOrderItem: {
                    columns: { ingredientId: true },
                    with: { ingredient: { columns: { id: true, name: true, unit: true } } },
                  },
                  priceConfirmations: {
                    orderBy: [desc(purchasePriceConfirmations.confirmedAt)],
                    with: { confirmedByUser: { columns: { id: true, name: true } } },
                  },
                },
              },
            },
          },
        },
      }),
      db.select().from(ingredientCategories).orderBy(asc(ingredientCategories.sortOrder)),
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
      db.query.ingredients.findMany({
        where: eq(ingredients.isActive, true),
        orderBy: [asc(ingredients.name)],
        with: { category: true },
      }),
    ]);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    return {
      ok: true as const,
      data: { po, categories, suppliers: supplierRows, ingredients: ingredientRows },
    };
  } catch (error) {
    console.error('[getPurchaseOrderDetail]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type PODetail = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderDetail>>, { ok: true }>['data']
>;

export async function getPurchaseOrderFormData() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const [supplierRows, ingredientRows] = await Promise.all([
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
      db.query.ingredients.findMany({
        where: eq(ingredients.isActive, true),
        orderBy: [asc(ingredients.name)],
        with: { category: true },
      }),
    ]);
    return { ok: true as const, data: { suppliers: supplierRows, ingredients: ingredientRows } };
  } catch (error) {
    console.error('[getPurchaseOrderFormData]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type POFormData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderFormData>>, { ok: true }>['data']
>;

async function ingredientCostMap(ids: string[]) {
  const rows = ids.length === 0
    ? []
    : await db.select({ id: ingredients.id, lastCost: ingredients.lastCost })
        .from(ingredients)
        .where(inArray(ingredients.id, ids));
  return new Map(rows.map((row) => [row.id, Number(row.lastCost)]));
}

export async function createPurchaseOrder(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  const parsed = createPurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  try {
    const poId = randomUUID();
    const poNumber = await getNextPoNumber();
    const businessDay = await ensureOpenBusinessDay(parsed.data.orderDate);
    const costs = await ingredientCostMap(parsed.data.items.map((item) => item.ingredientId));
    const normalizedItems = parsed.data.items.map((item) => {
      const purchaseQuantity = item.purchaseQuantity ?? item.quantity;
      const conversionFactor = item.purchaseQuantity == null ? 1 : item.conversionFactor;
      return {
        ...item,
        purchaseQuantity,
        conversionFactor,
        priceStatus: normalizePlanningPriceStatus(item.priceStatus),
        normalizedStockQuantity: normalizePurchaseQuantity(purchaseQuantity, conversionFactor),
      };
    });
    const totals = calculatePurchaseTotals(normalizedItems.map((item) => ({
      quantity: item.normalizedStockQuantity,
      priceStatus: item.priceStatus,
      estimatedUnitCost: item.priceStatus === 'estimated' ? item.unitCost : null,
      confirmedUnitCost: null,
    })), parsed.data.vatRate);
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(purchaseOrders).values({
        id: poId,
        poNumber,
        supplierId: parsed.data.supplierId,
        status: 'draft',
        businessDayId: businessDay.id,
        purchaseType: 'supplier_order',
        orderDate: parsed.data.orderDate,
        expectedDate: parsed.data.expectedDate ?? null,
        subtotal: money(totals.subtotal)!,
        vatRate: money(parsed.data.vatRate)!,
        vatAmount: money(totals.vatAmount)!,
        total: money(totals.total)!,
        priceStatus: totals.priceStatus,
        hasPendingPrices: totals.priceStatus !== 'confirmed',
        confirmedSubtotal: '0',
        confirmedVatAmount: '0',
        confirmedTotal: '0',
        estimatedSubtotal: money(totals.subtotal),
        estimatedVatAmount: money(totals.vatAmount),
        estimatedTotal: money(totals.total),
        pendingPriceItemCount: totals.pendingItemCount,
        hasTaxInvoice: parsed.data.hasTaxInvoice,
        taxInvoiceNumber: parsed.data.taxInvoiceNumber ?? null,
        notes: parsed.data.notes ?? null,
        createdBy: session.user.id as string,
      }),
      db.insert(purchaseOrderItems).values(normalizedItems.map((item) => {
        const unitCost = item.priceStatus === 'pending' ? null : item.unitCost;
        return {
          purchaseOrderId: poId,
          ingredientId: item.ingredientId,
          quantity: qty(item.normalizedStockQuantity),
          unit: item.unit,
          purchaseQuantity: qty(item.purchaseQuantity),
          purchaseUnit: item.purchaseUnit ?? item.unit,
          purchaseUnitConversion: String(item.conversionFactor),
          unitCost: money(unitCost),
          lineTotal: unitCost == null ? null : money(item.normalizedStockQuantity * unitCost),
          lastCostSnapshot: money(costs.get(item.ingredientId) ?? 0),
          estimatedUnitCost: item.priceStatus === 'estimated' ? money(unitCost) : null,
          confirmedUnitCost: null,
          priceStatus: item.priceStatus,
        };
      })),
    ];
    await db.batch(operations);
    revalidateInventory(poId);
    return { ok: true as const, id: poId };
  } catch (error) {
    console.error('[createPurchaseOrder]', error);
    return { ok: false as const, error: businessError(error) };
  }
}

export async function updatePurchaseOrder(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  const parsed = updatePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  try {
    const existing = await db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, parsed.data.id),
      columns: { id: true, status: true },
    });
    if (!existing) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (existing.status !== 'draft') return { ok: false as const, error: 'แก้ไขได้เฉพาะใบสั่งซื้อแบบร่าง' };
    const businessDay = await ensureOpenBusinessDay(parsed.data.orderDate);
    const costs = await ingredientCostMap(parsed.data.items.map((item) => item.ingredientId));
    const normalizedItems = parsed.data.items.map((item) => {
      const purchaseQuantity = item.purchaseQuantity ?? item.quantity;
      const conversionFactor = item.purchaseQuantity == null ? 1 : item.conversionFactor;
      return {
        ...item,
        purchaseQuantity,
        conversionFactor,
        priceStatus: normalizePlanningPriceStatus(item.priceStatus),
        normalizedStockQuantity: normalizePurchaseQuantity(purchaseQuantity, conversionFactor),
      };
    });
    const totals = calculatePurchaseTotals(normalizedItems.map((item) => ({
      quantity: item.normalizedStockQuantity,
      priceStatus: item.priceStatus,
      estimatedUnitCost: item.priceStatus === 'estimated' ? item.unitCost : null,
      confirmedUnitCost: null,
    })), parsed.data.vatRate);
    const { id } = parsed.data;
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.update(purchaseOrders).set({
        supplierId: parsed.data.supplierId,
        businessDayId: businessDay.id,
        orderDate: parsed.data.orderDate,
        expectedDate: parsed.data.expectedDate ?? null,
        subtotal: money(totals.subtotal)!,
        vatRate: money(parsed.data.vatRate)!,
        vatAmount: money(totals.vatAmount)!,
        total: money(totals.total)!,
        priceStatus: totals.priceStatus,
        hasPendingPrices: totals.priceStatus !== 'confirmed',
        confirmedSubtotal: '0',
        confirmedVatAmount: '0',
        confirmedTotal: '0',
        estimatedSubtotal: money(totals.subtotal),
        estimatedVatAmount: money(totals.vatAmount),
        estimatedTotal: money(totals.total),
        pendingPriceItemCount: totals.pendingItemCount,
        hasTaxInvoice: parsed.data.hasTaxInvoice,
        taxInvoiceNumber: parsed.data.taxInvoiceNumber ?? null,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      }).where(eq(purchaseOrders.id, id)),
      db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id)),
      db.insert(purchaseOrderItems).values(normalizedItems.map((item) => {
        const unitCost = item.priceStatus === 'pending' ? null : item.unitCost;
        return {
          purchaseOrderId: id,
          ingredientId: item.ingredientId,
          quantity: qty(item.normalizedStockQuantity),
          unit: item.unit,
          purchaseQuantity: qty(item.purchaseQuantity),
          purchaseUnit: item.purchaseUnit ?? item.unit,
          purchaseUnitConversion: String(item.conversionFactor),
          unitCost: money(unitCost),
          lineTotal: unitCost == null ? null : money(item.normalizedStockQuantity * unitCost),
          lastCostSnapshot: money(costs.get(item.ingredientId) ?? 0),
          estimatedUnitCost: item.priceStatus === 'estimated' ? money(unitCost) : null,
          confirmedUnitCost: null,
          priceStatus: item.priceStatus,
        };
      })),
    ];
    await db.batch(operations);
    revalidateInventory(id);
    return { ok: true as const };
  } catch (error) {
    console.error('[updatePurchaseOrder]', error);
    return { ok: false as const, error: businessError(error) };
  }
}

export async function confirmOrder(id: string) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  try {
    const po = await db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, id),
      columns: { id: true, status: true },
    });
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'draft') return { ok: false as const, error: 'ยืนยันได้เฉพาะใบสั่งซื้อแบบร่าง' };
    await db.update(purchaseOrders)
      .set({ status: 'ordered', updatedAt: new Date() })
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.status, 'draft')));
    revalidateInventory(id);
    return { ok: true as const };
  } catch (error) {
    console.error('[confirmOrder]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function receiveOrder(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  const parsed = receivePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const data = parsed.data;
  try {
    const duplicate = await db.query.goodsReceipts.findFirst({
      where: eq(goodsReceipts.idempotencyKey, data.idempotencyKey),
      columns: { id: true, purchaseOrderId: true },
    });
    if (duplicate) {
      if (duplicate.purchaseOrderId !== data.id) {
        return { ok: false as const, error: 'รหัสการรับของนี้ถูกใช้กับใบสั่งซื้ออื่นแล้ว' };
      }
      return { ok: true as const, duplicate: true as const, receiptId: duplicate.id };
    }
    const [po, businessDay] = await Promise.all([
      db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, data.id),
        with: { items: true },
      }),
      ensureOpenBusinessDay(data.receivedDate),
    ]);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'ordered' && po.status !== 'partial_received') {
      return { ok: false as const, error: 'รับของได้เฉพาะใบสั่งซื้อที่ยืนยันแล้วหรือรับบางส่วน' };
    }
    const itemMap = new Map(po.items.map((item) => [item.id, item]));
    const normalizedItems = data.items.map((item) => {
      const poItem = itemMap.get(item.id);
      if (!poItem) return null;
      const conversionFactor = item.receivedPurchaseQuantity == null
        ? 1
        : item.conversionFactor || Number(poItem.purchaseUnitConversion ?? 1);
      const receivedPurchaseQuantity = item.receivedPurchaseQuantity == null
        ? item.receivedQuantity
        : item.receivedPurchaseQuantity;
      const receivedQuantity = item.receivedPurchaseQuantity == null
        ? item.receivedQuantity
        : normalizePurchaseQuantity(receivedPurchaseQuantity, conversionFactor);
      return { ...item, receivedPurchaseQuantity, conversionFactor, receivedQuantity, poItem };
    });
    if (normalizedItems.some((item) => item === null)) {
      return { ok: false as const, error: 'มีรายการรับของที่ไม่อยู่ในใบสั่งซื้อ' };
    }
    const positiveItems = normalizedItems
      .filter((item): item is NonNullable<typeof item> => item !== null && item.receivedQuantity > 0);
    if (positiveItems.length === 0) return { ok: false as const, error: 'กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ' };
    for (const item of positiveItems) {
      if (item.priceStatus === 'confirmed' && (!item.actualUnitCost || item.actualUnitCost <= 0)) {
        return { ok: false as const, error: 'รายการราคายืนยันต้องระบุราคาจริง' };
      }
    }
    const reviewedBlocker = await findReviewedCountUsingMovement(
      data.receivedDate,
      [...new Set(positiveItems.map((item) => item.poItem.ingredientId))],
    );
    if (reviewedBlocker) {
      return {
        ok: false as const,
        error: 'รายการนี้อยู่ในช่วงผลนับวันที่ ' + reviewedBlocker.countDate + ' ที่ตรวจรับแล้ว ต้อง unreview ก่อน',
      };
    }
    const overReceiveAuthorized = Boolean(
      data.overReceiveConfirmed
      && data.overReceiveReason?.trim()
      && can(session.user.role, 'goods_receipt:over_receive'),
    );
    const preflightOver = positiveItems.some((item) => (
      Number(item.poItem.receivedQuantity ?? 0) + item.receivedQuantity
        > Number(item.poItem.quantity) + 0.005
    ));
    if (preflightOver && !overReceiveAuthorized) {
      return { ok: false as const, error: 'จำนวนรับเกิน PO ต้องมีสิทธิ์ ยืนยัน และระบุเหตุผล' };
    }

    const receiptId = randomUUID();
    const receiptItemIds = positiveItems.map(() => randomUUID());
    // Lock every item in the PO so concurrent receipts for different lines also
    // serialize before the shared PO status is recomputed.
    const sortedIds = po.items.map((item) => item.id).sort();
    const overConditions = positiveItems.map((item) => and(
      eq(purchaseOrderItems.id, item.id),
      sql`COALESCE(${purchaseOrderItems.receivedQuantity}, 0) + ${item.receivedQuantity} > ${purchaseOrderItems.quantity} + 0.005`,
    ));
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.select({ id: purchaseOrderItems.id })
        .from(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.id, sortedIds))
        .orderBy(asc(purchaseOrderItems.id))
        .for('update'),
      overReceiveAuthorized
        ? db.select({ guard: sql<number>`1` }).from(purchaseOrderItems).limit(1)
        : db.select({
            guard: sql<number>`1 / CASE WHEN COUNT(*) > 0 THEN 0 ELSE 1 END`,
          }).from(purchaseOrderItems).where(or(...overConditions)),
      db.insert(goodsReceipts).values({
        id: receiptId,
        purchaseOrderId: data.id,
        businessDayId: businessDay.id,
        receivedDate: data.receivedDate,
        idempotencyKey: data.idempotencyKey,
        notes: data.notes ?? null,
        receivedBy: session.user.id as string,
      }),
      db.insert(goodsReceiptItems).values(positiveItems.map((item, index) => {
        const estimated = item.actualUnitCost ?? (
          item.poItem.estimatedUnitCost == null
            ? (item.poItem.unitCost == null ? item.poItem.lastCostSnapshot : item.poItem.unitCost)
            : item.poItem.estimatedUnitCost
        );
        const actual = item.priceStatus === 'confirmed' ? item.actualUnitCost : null;
        return {
          id: receiptItemIds[index],
          goodsReceiptId: receiptId,
          purchaseOrderItemId: item.id,
          receivedQuantity: qty(item.receivedQuantity),
          receivedPurchaseQuantity: qty(item.receivedPurchaseQuantity),
          purchaseUnit: item.purchaseUnit ?? item.poItem.purchaseUnit ?? item.poItem.unit,
          purchaseUnitConversion: String(item.conversionFactor),
          stockUnit: item.stockUnit ?? item.poItem.unit,
          discrepancyType: item.discrepancyType,
          discrepancyNotes: item.discrepancyNotes ?? null,
          estimatedUnitCost: money(estimated == null ? null : Number(estimated)),
          actualUnitCost: money(actual),
          priceStatus: item.priceStatus,
          priceConfirmedAt: actual == null ? null : new Date(),
          priceConfirmedBy: actual == null ? null : session.user.id as string,
        };
      })),
    ];
    for (const item of positiveItems) {
      operations.push(
        db.update(purchaseOrderItems).set({
          receivedQuantity: sql`COALESCE(${purchaseOrderItems.receivedQuantity}, 0) + ${qty(item.receivedQuantity)}`,
        }).where(eq(purchaseOrderItems.id, item.id)),
      );
    }
    operations.push(
      db.update(purchaseOrders).set({
        status: sql`CASE WHEN NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          WHERE poi.purchase_order_id = ${data.id}
            AND COALESCE(poi.received_quantity, 0) < poi.quantity - 0.005
        ) THEN 'received'::purchase_order_status ELSE 'partial_received'::purchase_order_status END`,
        receivedDate: sql`CASE WHEN NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          WHERE poi.purchase_order_id = ${data.id}
            AND COALESCE(poi.received_quantity, 0) < poi.quantity - 0.005
        ) THEN ${data.receivedDate}::date ELSE NULL END`,
        hasTaxInvoice: data.hasTaxInvoice,
        taxInvoiceNumber: data.taxInvoiceNumber ?? null,
        updatedAt: new Date(),
      }).where(eq(purchaseOrders.id, data.id)),
      recomputePurchaseFinancialSummary(data.id),
    );
    for (const ingredientId of new Set(positiveItems.map((item) => item.poItem.ingredientId))) {
      operations.push(recomputeIngredientLastCost(ingredientId));
    }
    operations.push(audit(
      session.user.id as string,
      session.user.role,
      'receive',
      'goods_receipts',
      receiptId,
      { purchaseOrderStatus: po.status, businessDay: data.receivedDate },
      {
        purchaseOrderId: data.id,
        receivedDate: data.receivedDate,
        idempotencyKey: data.idempotencyKey,
        itemCount: positiveItems.length,
        normalizedStockQuantity: positiveItems.reduce((sum, item) => sum + item.receivedQuantity, 0),
        overReceiveApproved: overReceiveAuthorized,
      },
      data.overReceiveReason ?? data.notes ?? 'รับสินค้าตาม PO',
    ));

    try {
      await db.batch(operations);
    } catch (error) {
      const winner = await db.query.goodsReceipts.findFirst({
        where: eq(goodsReceipts.idempotencyKey, data.idempotencyKey),
        columns: { id: true, purchaseOrderId: true },
      });
      if (winner?.purchaseOrderId === data.id) {
        return { ok: true as const, duplicate: true as const, receiptId: winner.id };
      }
      if (error instanceof Error && /division by zero|22012/.test(error.message)) {
        return { ok: false as const, error: 'จำนวนรับเกินยอดคงเหลือหลังตรวจพร้อมกัน กรุณารีเฟรชและตรวจสอบใหม่' };
      }
      throw error;
    }
    revalidateInventory(data.id);
    return { ok: true as const, duplicate: false as const, receiptId };
  } catch (error) {
    console.error('[receiveOrder]', error);
    return { ok: false as const, error: businessError(error) };
  }
}

export async function confirmReceiptPrice(input: unknown) {
  const session = await requirePO();
  if (!session || !can(session.user.role, 'purchase_price:confirm')) {
    return { ok: false as const, error: NO_PERMISSION };
  }
  const parsed = confirmReceiptPriceSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  try {
    const target = await db.query.goodsReceiptItems.findFirst({
      where: eq(goodsReceiptItems.id, parsed.data.goodsReceiptItemId),
      with: {
        goodsReceipt: true,
        purchaseOrderItem: {
          with: { ingredient: { columns: { id: true, lastCost: true } } },
        },
      },
    });
    if (!target) return { ok: false as const, error: 'ไม่พบรายการรับของ' };
    if (target.goodsReceipt.voidedAt) return { ok: false as const, error: 'ใบรับของนี้ถูกยกเลิกแล้ว' };
    if (target.priceStatus === 'confirmed' || Number(target.actualUnitCost ?? 0) > 0) {
      return { ok: false as const, error: 'ราคาของรายการนี้ถูกยืนยันแล้วและแก้ซ้ำไม่ได้' };
    }
    const poId = target.purchaseOrderItem.purchaseOrderId;
    const variance = calculatePriceVariance(
      target.estimatedUnitCost == null ? null : Number(target.estimatedUnitCost),
      parsed.data.actualUnitCost,
    );
    const costRecalculations = await prepareCostMetadataRecalculation({
      ingredientId: target.purchaseOrderItem.ingredientId,
      changedReceiptItemId: target.id,
      changedReceiptDate: target.goodsReceipt.receivedDate,
      changedActualUnitCost: parsed.data.actualUnitCost,
    });
    const confirmationId = randomUUID();
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.update(goodsReceiptItems).set({
        actualUnitCost: money(parsed.data.actualUnitCost),
        priceStatus: 'confirmed',
        priceConfirmedAt: new Date(),
        priceConfirmedBy: session.user.id as string,
      }).where(and(
        eq(goodsReceiptItems.id, target.id),
        ne(goodsReceiptItems.priceStatus, 'confirmed'),
      )),
      db.insert(purchasePriceConfirmations).values({
        id: confirmationId,
        goodsReceiptItemId: target.id,
        estimatedUnitCost: target.estimatedUnitCost,
        previousActualUnitCost: target.actualUnitCost,
        actualUnitCost: money(parsed.data.actualUnitCost)!,
        varianceAmount: money(variance.amount),
        variancePercent: variance.percentage == null ? null : money(variance.percentage),
        reason: parsed.data.reason,
        confirmedBy: session.user.id as string,
      }),
      recomputePurchaseFinancialSummary(poId),
      recomputeIngredientLastCost(target.purchaseOrderItem.ingredientId),
    ];
    for (const recalculation of costRecalculations) {
      operations.push(
        db.update(stockCountItems).set({
          usageCostStatus: recalculation.after.usageCostStatus,
          usageUnitCost: money(recalculation.after.usageUnitCost),
          estimatedUsageCost: money(recalculation.after.estimatedUsageCost),
          costRecalculatedAt: recalculation.after.costRecalculatedAt,
        }).where(eq(stockCountItems.id, recalculation.itemId)),
        audit(
          session.user.id as string,
          session.user.role,
          'recalculate_stock_count_cost',
          'stock_count_items',
          recalculation.itemId,
          recalculation.before,
          { ...recalculation.after, stockCountId: recalculation.countId, quantityColumnsChanged: false },
          parsed.data.reason,
        ),
      );
    }
    operations.push(audit(
      session.user.id as string,
      session.user.role,
      'confirm_receipt_price',
      'goods_receipt_items',
      target.id,
      {
        priceStatus: target.priceStatus,
        estimatedUnitCost: target.estimatedUnitCost,
        actualUnitCost: target.actualUnitCost,
        receivedBusinessDate: target.goodsReceipt.receivedDate,
      },
      {
        priceStatus: 'confirmed',
        actualUnitCost: parsed.data.actualUnitCost,
        variance,
        confirmationId,
        costMetadataRowsUpdated: costRecalculations.length,
        quantityColumnsChanged: false,
      },
      parsed.data.reason,
    ));
    await db.batch(operations);
    revalidateInventory(poId);
    return { ok: true as const, confirmationId, variance };
  } catch (error) {
    if (error instanceof Error && /purchase_price_confirmations_receipt_item_uq|23505/.test(error.message)) {
      return { ok: false as const, error: 'ราคาของรายการนี้ถูกยืนยันแล้วและแก้ซ้ำไม่ได้' };
    }
    console.error('[confirmReceiptPrice]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function createEmergencyPurchase(input: unknown) {
  const session = await requirePO();
  if (!session || !can(session.user.role, 'purchase_emergency:create')) {
    return { ok: false as const, error: NO_PERMISSION };
  }
  const parsed = emergencyPurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const data = parsed.data;
  try {
    const duplicate = await db.query.goodsReceipts.findFirst({
      where: eq(goodsReceipts.idempotencyKey, data.idempotencyKey),
      columns: { id: true, purchaseOrderId: true },
      with: { purchaseOrder: { columns: { purchaseType: true } } },
    });
    if (duplicate) {
      if (duplicate.purchaseOrder.purchaseType !== 'emergency_direct') {
        return { ok: false as const, error: 'Idempotency key นี้เป็นของการรับสินค้าประเภทอื่น' };
      }
      return {
        ok: true as const,
        duplicate: true as const,
        id: duplicate.purchaseOrderId,
        receiptId: duplicate.id,
      };
    }
    const reviewedBlocker = await findReviewedCountUsingMovement(
      data.businessDate,
      [...new Set(data.items.map((item) => item.ingredientId))],
    );
    if (reviewedBlocker) {
      return { ok: false as const, error: `รายการนี้อยู่ในช่วงผลนับวันที่ ${reviewedBlocker.countDate} ที่ตรวจรับแล้ว ต้อง unreview ก่อน` };
    }
    const [businessDay, costs, poNumber] = await Promise.all([
      ensureOpenBusinessDay(data.businessDate),
      ingredientCostMap(data.items.map((item) => item.ingredientId)),
      getNextPoNumber(),
    ]);
    const poId = randomUUID();
    const receiptId = randomUUID();
    const poItemIds = data.items.map(() => randomUUID());
    const receiptItemIds = data.items.map(() => randomUUID());
    const confirmedSubtotal = roundMoney(data.items.reduce((sum, item) => (
      sum + (item.priceStatus === 'confirmed' && item.actualUnitCost != null
        ? item.quantity * item.conversion * item.actualUnitCost
        : 0)
    ), 0));
    const hasPending = data.items.some((item) => item.priceStatus === 'pending');
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(purchaseOrders).values({
        id: poId,
        poNumber,
        supplierId: data.supplierId ?? null,
        status: 'received',
        businessDayId: businessDay.id,
        purchaseType: 'emergency_direct',
        vendorName: data.vendorName,
        purchasedAt: data.purchasedAt ? new Date(data.purchasedAt) : new Date(),
        sourcePurchaseOrderId: data.sourcePurchaseOrderId ?? null,
        orderDate: data.businessDate,
        receivedDate: data.businessDate,
        subtotal: money(confirmedSubtotal)!,
        vatRate: '0',
        vatAmount: '0',
        total: money(confirmedSubtotal)!,
        priceStatus: hasPending ? 'pending' : 'confirmed',
        hasPendingPrices: hasPending,
        confirmedSubtotal: money(confirmedSubtotal),
        confirmedVatAmount: '0',
        confirmedTotal: money(confirmedSubtotal),
        notes: [data.reason, data.notes].filter(Boolean).join('\n'),
        createdBy: session.user.id as string,
      }),
      db.insert(purchaseOrderItems).values(data.items.map((item, index) => {
        const stockQuantity = item.quantity * item.conversion;
        return {
          id: poItemIds[index],
          purchaseOrderId: poId,
          ingredientId: item.ingredientId,
          quantity: qty(stockQuantity),
          unit: item.unit,
          unitCost: item.priceStatus === 'confirmed' ? money(item.actualUnitCost) : null,
          lineTotal: item.priceStatus === 'confirmed' && item.actualUnitCost != null
            ? money(stockQuantity * item.actualUnitCost)
            : null,
          lastCostSnapshot: money(costs.get(item.ingredientId) ?? 0),
          confirmedUnitCost: item.priceStatus === 'confirmed' ? money(item.actualUnitCost) : null,
          priceStatus: item.priceStatus,
          purchaseQuantity: qty(item.quantity),
          purchaseUnit: item.purchaseUnit ?? item.unit,
          purchaseUnitConversion: String(item.conversion),
          receivedQuantity: qty(stockQuantity),
        };
      })),
      db.insert(goodsReceipts).values({
        id: receiptId,
        purchaseOrderId: poId,
        businessDayId: businessDay.id,
        receivedDate: data.businessDate,
        idempotencyKey: data.idempotencyKey,
        notes: data.notes ?? data.reason,
        receivedBy: session.user.id as string,
      }),
      db.insert(goodsReceiptItems).values(data.items.map((item, index) => ({
        id: receiptItemIds[index],
        goodsReceiptId: receiptId,
        purchaseOrderItemId: poItemIds[index],
        receivedQuantity: qty(item.quantity * item.conversion),
        receivedPurchaseQuantity: qty(item.quantity),
        purchaseUnit: item.purchaseUnit ?? item.unit,
        purchaseUnitConversion: String(item.conversion),
        stockUnit: item.unit,
        discrepancyType: 'none' as const,
        estimatedUnitCost: item.priceStatus === 'pending'
          ? money(costs.get(item.ingredientId) ?? 0)
          : money(item.actualUnitCost),
        actualUnitCost: item.priceStatus === 'confirmed' ? money(item.actualUnitCost) : null,
        priceStatus: item.priceStatus,
        priceConfirmedAt: item.priceStatus === 'confirmed' ? new Date() : null,
        priceConfirmedBy: item.priceStatus === 'confirmed' ? session.user.id as string : null,
      }))),
    ];
    operations.push(recomputePurchaseFinancialSummary(poId));
    for (const ingredientId of new Set(data.items.map((item) => item.ingredientId))) {
      operations.push(recomputeIngredientLastCost(ingredientId));
    }
    operations.push(audit(
      session.user.id as string,
      session.user.role,
      'emergency_purchase',
      'purchase_orders',
      poId,
      null,
      {
        receiptId,
        businessDate: data.businessDate,
        vendorName: data.vendorName,
        sourcePurchaseOrderId: data.sourcePurchaseOrderId ?? null,
        itemCount: data.items.length,
        hasPendingPrices: hasPending,
      },
      data.reason,
    ));
    try {
      await db.batch(operations);
    } catch (error) {
      const winner = await db.query.goodsReceipts.findFirst({
        where: eq(goodsReceipts.idempotencyKey, data.idempotencyKey),
        columns: { id: true, purchaseOrderId: true },
        with: { purchaseOrder: { columns: { purchaseType: true } } },
      });
      if (winner?.purchaseOrder.purchaseType === 'emergency_direct') {
        return {
          ok: true as const,
          duplicate: true as const,
          id: winner.purchaseOrderId,
          receiptId: winner.id,
        };
      }
      throw error;
    }
    revalidateInventory(poId);
    return { ok: true as const, duplicate: false as const, id: poId, receiptId };
  } catch (error) {
    console.error('[createEmergencyPurchase]', error);
    return { ok: false as const, error: businessError(error) };
  }
}

export async function voidGoodsReceipt(input: unknown) {
  const session = await requirePO();
  if (!session || !can(session.user.role, 'goods_receipt:void')) {
    return { ok: false as const, error: NO_PERMISSION };
  }
  const parsed = voidGoodsReceiptSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  try {
    const receipt = await db.query.goodsReceipts.findFirst({
      where: eq(goodsReceipts.id, parsed.data.goodsReceiptId),
      with: {
        purchaseOrder: { with: { items: true } },
        items: { with: { purchaseOrderItem: true } },
      },
    });
    if (!receipt) return { ok: false as const, error: 'ไม่พบใบรับของ' };
    if (receipt.voidedAt) return { ok: false as const, error: 'ใบรับของนี้ถูกยกเลิกแล้ว' };
    const reviewedBlocker = await findReviewedCountUsingMovement(
      receipt.receivedDate,
      [...new Set(receipt.items.map((item) => item.purchaseOrderItem.ingredientId))],
    );
    if (reviewedBlocker) {
      return {
        ok: false as const,
        error: `ใบรับของถูกใช้ในผลนับวันที่ ${reviewedBlocker.countDate} ที่ตรวจรับแล้ว ต้อง unreview ก่อน`,
      };
    }
    const decrements = new Map<string, number>();
    for (const item of receipt.items) {
      decrements.set(
        item.purchaseOrderItemId,
        (decrements.get(item.purchaseOrderItemId) ?? 0) + Number(item.receivedQuantity),
      );
    }
    // Use the same deterministic PO-item lock order as receivePurchaseOrder so
    // void and receive cannot overwrite each other's cached quantities/status.
    const sortedPurchaseItems = [...receipt.purchaseOrder.items]
      .sort((a, b) => a.id.localeCompare(b.id));
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.select({ id: goodsReceipts.id })
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, receipt.id), isNull(goodsReceipts.voidedAt)))
        .for('update'),
      // A concurrent void may have won while the preflight query was running.
      // Force the whole batch to roll back instead of applying decrements twice.
      db.select({
        guard: sql<number>`1 / CASE WHEN EXISTS (
          SELECT 1 FROM goods_receipts gr
          WHERE gr.id = ${receipt.id} AND gr.voided_at IS NULL
        ) THEN 1 ELSE 0 END`,
      }).from(goodsReceipts)
        .where(eq(goodsReceipts.id, receipt.id))
        .limit(1),
      db.select({ id: purchaseOrderItems.id })
        .from(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.id, sortedPurchaseItems.map((item) => item.id)))
        .orderBy(asc(purchaseOrderItems.id))
        .for('update'),
      db.update(goodsReceipts).set({
        voidedAt: new Date(),
        voidedBy: session.user.id as string,
        voidReason: parsed.data.reason,
      }).where(and(eq(goodsReceipts.id, receipt.id), isNull(goodsReceipts.voidedAt))),
    ];
    for (const item of sortedPurchaseItems) {
      const decrement = decrements.get(item.id) ?? 0;
      operations.push(
        db.update(purchaseOrderItems)
          .set({
            receivedQuantity: sql`GREATEST(
              COALESCE(${purchaseOrderItems.receivedQuantity}, 0) - ${qty(decrement)},
              0
            )`,
          })
          .where(eq(purchaseOrderItems.id, item.id)),
      );
    }

    operations.push(
      db.update(purchaseOrders).set({
        status: sql`CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM purchase_order_items poi
            WHERE poi.purchase_order_id = ${receipt.purchaseOrderId}
              AND COALESCE(poi.received_quantity, 0) < poi.quantity - 0.005
          ) THEN 'received'::purchase_order_status
          WHEN EXISTS (
            SELECT 1 FROM purchase_order_items poi
            WHERE poi.purchase_order_id = ${receipt.purchaseOrderId}
              AND COALESCE(poi.received_quantity, 0) > 0.005
          ) THEN 'partial_received'::purchase_order_status
          ELSE 'ordered'::purchase_order_status
        END`,
        receivedDate: sql`CASE WHEN NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          WHERE poi.purchase_order_id = ${receipt.purchaseOrderId}
            AND COALESCE(poi.received_quantity, 0) < poi.quantity - 0.005
        ) THEN (
          SELECT MAX(gr.received_date) FROM goods_receipts gr
          WHERE gr.purchase_order_id = ${receipt.purchaseOrderId}
            AND gr.voided_at IS NULL
        ) ELSE NULL END`,
        updatedAt: new Date(),
      }).where(eq(purchaseOrders.id, receipt.purchaseOrderId)),
      recomputePurchaseFinancialSummary(receipt.purchaseOrderId),
    );
    const affectedIngredients = new Set(receipt.items.map((item) => item.purchaseOrderItem.ingredientId));
    for (const ingredientId of affectedIngredients) {
      operations.push(recomputeIngredientLastCost(ingredientId));
    }
    operations.push(audit(
      session.user.id as string,
      session.user.role,
      'void_receipt',
      'goods_receipts',
      receipt.id,
      {
        purchaseOrderId: receipt.purchaseOrderId,
        receivedDate: receipt.receivedDate,
        itemCount: receipt.items.length,
      },
      { voided: true, purchaseOrderStatus: 'recomputed_after_void' },
      parsed.data.reason,
    ));
    await db.batch(operations);
    revalidateInventory(receipt.purchaseOrderId);
    return { ok: true as const };
  } catch (error) {
    console.error('[voidGoodsReceipt]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function cancelOrder(idOrInput: string | unknown, reason = '') {
  const session = await requirePO();
  if (!session || !can(session.user.role, 'purchase_order:cancel_remaining')) {
    return { ok: false as const, error: NO_PERMISSION };
  }
  const parsed = cancelPurchaseOrderSchema.safeParse(
    typeof idOrInput === 'string' ? { id: idOrInput, reason } : idOrInput,
  );
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  try {
    const po = await db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, parsed.data.id),
      with: { items: true },
    });
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status === 'received' || po.purchaseType === 'emergency_direct') {
      return { ok: false as const, error: 'ใบสั่งซื้อที่รับครบแล้วต้องยกเลิกผ่านใบรับของ' };
    }
    if (po.status === 'cancelled') return { ok: false as const, error: 'ใบสั่งซื้อนี้ยกเลิกแล้ว' };
    const remainingQuantity = po.items.reduce(
      (sum, item) => sum + Math.max(0, Number(item.quantity) - Number(item.receivedQuantity ?? 0)),
      0,
    );
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.update(purchaseOrders).set({
        status: 'cancelled',
        cancelledRemainingReason: parsed.data.reason,
        updatedAt: new Date(),
      }).where(eq(purchaseOrders.id, po.id)),
      audit(
        session.user.id as string,
        session.user.role,
        'cancel',
        'purchase_orders',
        po.id,
        { status: po.status, remainingQuantity },
        { status: 'cancelled' },
        parsed.data.reason,
      ),
    ];
    await db.batch(operations);
    revalidateInventory(po.id);
    return { ok: true as const };
  } catch (error) {
    console.error('[cancelOrder]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

// Dashboard and approvals

export async function getInventoryDashboard() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const today = getBangkokBusinessDate();
    const monthStart = `${today.slice(0, 7)}-01`;
    const [
      totalIngredients,
      pendingOrders,
      monthlySpend,
      monthlyPendingPrices,
      latestCount,
      todayCount,
      recentOrders,
      countHistory,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(ingredients)
        .where(eq(ingredients.isActive, true)),
      db.select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(or(
          eq(purchaseOrders.status, 'ordered'),
          eq(purchaseOrders.status, 'partial_received'),
        )),
      db.select({ total: sql<string>`coalesce(sum(${purchaseOrders.confirmedTotal}), '0')` })
        .from(purchaseOrders)
        .where(sql`${purchaseOrders.orderDate} >= ${monthStart} AND ${purchaseOrders.status} != 'cancelled'`),
      db.select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(and(
          sql`${purchaseOrders.orderDate} >= ${monthStart}`,
          ne(purchaseOrders.status, 'cancelled'),
          eq(purchaseOrders.hasPendingPrices, true),
        )),
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.status, 'reviewed'),
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
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.countDate, today),
        columns: { id: true, status: true, countDate: true },
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
          items: { columns: { id: true, isCounted: true } },
        },
      }),
    ]);
    const lowStockItems = latestCount
      ? latestCount.items.filter((item) => (
          item.isCounted && Number(item.quantityOnHand) < Number(item.ingredient.minStock)
        ))
      : [];
    return {
      ok: true as const,
      data: {
        totalIngredients: totalIngredients[0]?.count ?? 0,
        lowStockCount: lowStockItems.length,
        pendingOrders: pendingOrders[0]?.count ?? 0,
        monthlySpend: Number(monthlySpend[0]?.total ?? 0),
        monthlyPendingPriceCount: monthlyPendingPrices[0]?.count ?? 0,
        latestCount: latestCount ?? null,
        todayCount: todayCount ?? null,
        lowStockItems,
        recentOrders,
        countHistory,
      },
    };
  } catch (error) {
    console.error('[getInventoryDashboard]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type InventoryDashboardData = NonNullable<
  Extract<Awaited<ReturnType<typeof getInventoryDashboard>>, { ok: true }>['data']
>;

export async function submitForApproval(id: string) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  try {
    const po = await db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, id),
      columns: { status: true },
    });
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'draft') return { ok: false as const, error: 'ส่งอนุมัติได้เฉพาะแบบร่าง' };
    await db.update(purchaseOrders)
      .set({ status: 'pending_approval', updatedAt: new Date() })
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.status, 'draft')));
    revalidateInventory(id);
    return { ok: true as const };
  } catch (error) {
    console.error('[submitForApproval]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function approveOrder(id: string) {
  const session = await requireApprove();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  try {
    const po = await db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, id),
      columns: { status: true },
    });
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'pending_approval') return { ok: false as const, error: 'อนุมัติได้เฉพาะรายการรออนุมัติ' };
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.update(purchaseOrders)
        .set({ status: 'ordered', updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.status, 'pending_approval'))),
      audit(
        session.user.id as string,
        session.user.role,
        'approve',
        'purchase_orders',
        id,
        { status: 'pending_approval' },
        { status: 'ordered' },
      ),
    ];
    await db.batch(operations);
    revalidateInventory(id);
    return { ok: true as const };
  } catch (error) {
    console.error('[approveOrder]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export async function getInventoryAlertCount(): Promise<{
  lowStockCount: number;
  pendingApprovalCount: number;
}> {
  try {
    const [latestCount, pending] = await Promise.all([
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.status, 'reviewed'),
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
      ? latestCount.items.filter((item) => (
          item.isCounted && Number(item.quantityOnHand) < Number(item.ingredient.minStock)
        )).length
      : 0;
    return { lowStockCount, pendingApprovalCount: pending[0]?.count ?? 0 };
  } catch {
    return { lowStockCount: 0, pendingApprovalCount: 0 };
  }
}

// ── Phase 17B: Initial inventory setup ───────────────────────────────────────

export async function getInitialSetupState() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  try {
    const [reviewedCount, existingSetup, ingredientRows, categories] = await Promise.all([
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.status, 'reviewed'),
        columns: { id: true, countType: true, countDate: true },
      }),
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.countType, INITIAL_SETUP_COUNT_TYPE),
        orderBy: [desc(stockCounts.createdAt)],
        with: { items: true },
      }),
      db.query.ingredients.findMany({
        where: eq(ingredients.isActive, true),
        orderBy: [asc(ingredients.name)],
        with: { category: true },
      }),
      db.select().from(ingredientCategories)
        .where(eq(ingredientCategories.isActive, true))
        .orderBy(asc(ingredientCategories.sortOrder)),
    ]);
    const gate = evaluateInitialSetupGate({
      hasReviewedCount: Boolean(reviewedCount),
      existingSetupStatus: (existingSetup?.status ?? null) as 'draft' | 'submitted' | 'reviewed' | null,
    });
    return {
      ok: true as const,
      data: {
        gate,
        alreadyInitialized: Boolean(reviewedCount),
        existingSetup: existingSetup ?? null,
        ingredients: ingredientRows,
        categories,
      },
    };
  } catch (error) {
    console.error('[getInitialSetupState]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type InitialSetupState = NonNullable<
  Extract<Awaited<ReturnType<typeof getInitialSetupState>>, { ok: true }>['data']
>;

export async function saveInitialSetup(input: unknown) {
  const session = await requireStockCount();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  const parsed = saveInitialSetupSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  const { countDate, asDraft, notes, items } = parsed.data;
  if (!asDraft && items.some((item) => !item.isCounted || item.physicalCount == null)) {
    return { ok: false as const, error: 'กรุณานับให้ครบทุกวัตถุดิบก่อนยืนยันยอดเริ่มต้น' };
  }
  const userId = session.user.id as string;
  try {
    const [reviewedCount, existingSetup] = await Promise.all([
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.status, 'reviewed'),
        columns: { id: true },
      }),
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.countType, INITIAL_SETUP_COUNT_TYPE),
        columns: { id: true, status: true },
      }),
    ]);
    const gate = evaluateInitialSetupGate({
      hasReviewedCount: Boolean(reviewedCount),
      existingSetupStatus: (existingSetup?.status ?? null) as 'draft' | 'submitted' | 'reviewed' | null,
    });
    if (!gate.allowed) {
      return { ok: false as const, error: 'ร้านนี้มีผลนับที่ตรวจรับแล้ว ไม่สามารถตั้งยอดเริ่มต้นซ้ำได้' };
    }
    if (existingSetup && existingSetup.status !== 'draft') {
      return { ok: false as const, error: 'แก้ไขได้เฉพาะยอดเริ่มต้นที่ยังเป็นแบบร่าง' };
    }

    const businessDay = await ensureOpenBusinessDay(countDate);
    const countId = existingSetup?.id ?? randomUUID();
    const selectedIds = items.map((item) => item.ingredientId);
    const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      existingSetup
        ? db.update(stockCounts).set({
            status: asDraft ? 'draft' : 'submitted',
            countType: INITIAL_SETUP_COUNT_TYPE,
            countDate,
            businessDayId: businessDay.id,
            notes: notes ?? null,
            submittedAt: asDraft ? null : new Date(),
          }).where(eq(stockCounts.id, countId))
        : db.insert(stockCounts).values({
            id: countId,
            countDate,
            countedBy: userId,
            status: asDraft ? 'draft' : 'submitted',
            countType: INITIAL_SETUP_COUNT_TYPE,
            businessDayId: businessDay.id,
            notes: notes ?? null,
            submittedAt: asDraft ? null : new Date(),
          }),
    ];
    if (selectedIds.length > 0) {
      operations.push(db.delete(stockCountItems).where(and(
        eq(stockCountItems.stockCountId, countId),
        inArray(stockCountItems.ingredientId, selectedIds),
      )));
    }
    const itemValues = items.map((item) => {
      const counted = item.isCounted && isCountedValue(item.physicalCount);
      const values = buildInitialSetupItemValues(counted ? Number(item.physicalCount) : 0);
      return {
        stockCountId: countId,
        ingredientId: item.ingredientId,
        openingBalance: qty(values.openingBalance),
        receivedQty: qty(0),
        usedQty: qty(0),
        quantityOnHand: qty(values.quantityOnHand),
        isCounted: counted,
        regularReceivedQty: qty(values.regularReceivedQty),
        emergencyReceivedQty: qty(values.emergencyReceivedQty),
        positiveAdjustmentQty: qty(values.positiveAdjustmentQty),
        recordedWasteQty: qty(values.recordedWasteQty),
        otherOutboundQty: qty(values.otherOutboundQty),
        totalDepletionQty: qty(values.totalDepletionQty),
        estimatedOperationalUsageQty: qty(values.estimatedOperationalUsageQty),
        usageUnitCost: null,
        usageCostStatus: 'confirmed',
        estimatedUsageCost: null,
        costRecalculatedAt: new Date(),
        unit: item.unit,
        notes: item.notes ?? null,
      };
    });
    operations.push(db.insert(stockCountItems).values(itemValues));
    operations.push(audit(
      userId,
      session.user.role,
      asDraft ? 'initial_setup_draft' : 'initial_setup_submit',
      'stock_counts',
      countId,
      existingSetup ? { status: existingSetup.status } : null,
      { status: asDraft ? 'draft' : 'submitted', countType: INITIAL_SETUP_COUNT_TYPE, itemCount: items.length },
    ));

    await db.batch(operations);
    revalidateInventory();
    return { ok: true as const, countId };
  } catch (error) {
    console.error('[saveInitialSetup]', error);
    return { ok: false as const, error: businessError(error) };
  }
}

// ── Phase 17B: Reorder recommendation page + draft generation ────────────────

export async function getReorderRecommendationPageData() {
  if (!await requireView()) return { ok: false as const, error: NO_PERMISSION };
  const reco = await getStockCountReorderItems();
  if (!reco.ok) return reco;
  try {
    const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name));
    return {
      ok: true as const,
      data: {
        items: reco.data.items,
        countDate: reco.data.countDate,
        suppliers: supplierRows,
      },
    };
  } catch (error) {
    console.error('[getReorderRecommendationPageData]', error);
    return { ok: false as const, error: GENERAL_ERROR };
  }
}

export type ReorderRecommendationPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getReorderRecommendationPageData>>, { ok: true }>['data']
>;

export async function generateReorderDraft(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: NO_PERMISSION };
  const parsed = generateReorderDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? INVALID_DATA };
  try {
    const reco = await getStockCountReorderItems();
    if (!reco.ok) return reco;
    const recoMap = new Map(reco.data.items.map((item) => [item.ingredientId, item]));
    const reviewedCountDate = reco.data.countDate;

    type SelectionLine = ReorderSelectionLine & { reco: StockCountReorderItem };
    const unknownItems: string[] = [];
    const lines: SelectionLine[] = [];
    for (const line of parsed.data.lines) {
      const item = recoMap.get(line.ingredientId);
      if (!item) { unknownItems.push(line.ingredientId); continue; }
      lines.push({
        ingredientId: line.ingredientId,
        supplierId: (line.supplierId ?? item.defaultSupplierId) ?? null,
        purchaseQuantity: line.purchaseQuantity,
        conversion: item.conversion,
        reco: item,
      });
    }
    if (unknownItems.length > 0) {
      return { ok: false as const, error: 'บางรายการไม่อยู่ในคำแนะนำล่าสุดแล้ว กรุณารีเฟรชหน้าคำแนะนำ' };
    }
    const partition = partitionReorderSelection(lines);
    if (partition.invalidQuantity.length > 0) {
      return { ok: false as const, error: 'มีจำนวนสั่งซื้อไม่ถูกต้อง' };
    }
    if (partition.invalidConversion.length > 0) {
      return { ok: false as const, error: 'มีรายการที่ยังไม่ได้ตั้งค่าหน่วยสั่งซื้อ (conversion) กรุณาตั้งค่าก่อนสร้างใบสั่งซื้อ' };
    }
    if (partition.missingSupplier.length > 0) {
      return { ok: false as const, error: 'มีรายการที่ยังไม่ได้เลือก Supplier กรุณาเลือก Supplier ก่อน' };
    }

    const orderDate = getBangkokBusinessDate();
    const businessDay = await ensureOpenBusinessDay(orderDate);
    const costs = await ingredientCostMap(lines.map((line) => line.ingredientId));

    let created = 0;
    let duplicated = 0;
    const poIds: string[] = [];
    for (const group of partition.groups) {
      const genKey = reorderGenerationKeyForSupplier(parsed.data.idempotencyKey, group.supplierId);
      const existing = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.reorderGenerationKey, genKey),
        columns: { id: true },
      });
      if (existing) { duplicated += 1; poIds.push(existing.id); continue; }

      const poId = randomUUID();
      const poNumber = await getNextPoNumber();
      const groupItems = group.lines.map((line) => {
        const conversion = line.conversion as number;
        const normalized = normalizePurchaseQuantity(line.purchaseQuantity, conversion);
        const lastCost = costs.get(line.ingredientId) ?? 0;
        const priceStatus = lastCost > 0 ? ('estimated' as const) : ('pending' as const);
        return { line, conversion, normalized, lastCost, priceStatus };
      });
      const totals = calculatePurchaseTotals(groupItems.map((gi) => ({
        quantity: gi.normalized,
        priceStatus: gi.priceStatus,
        estimatedUnitCost: gi.priceStatus === 'estimated' ? gi.lastCost : null,
        confirmedUnitCost: null,
      })), 7);
      const operations: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
        db.insert(purchaseOrders).values({
          id: poId,
          poNumber,
          supplierId: group.supplierId,
          status: 'draft',
          businessDayId: businessDay.id,
          purchaseType: 'supplier_order',
          orderDate,
          expectedDate: null,
          subtotal: money(totals.subtotal)!,
          vatRate: '7.00',
          vatAmount: money(totals.vatAmount)!,
          total: money(totals.total)!,
          priceStatus: totals.priceStatus,
          hasPendingPrices: totals.priceStatus !== 'confirmed',
          confirmedSubtotal: '0',
          confirmedVatAmount: '0',
          confirmedTotal: '0',
          estimatedSubtotal: money(totals.subtotal),
          estimatedVatAmount: money(totals.vatAmount),
          estimatedTotal: money(totals.total),
          pendingPriceItemCount: totals.pendingItemCount,
          hasTaxInvoice: false,
          taxInvoiceNumber: null,
          reorderGenerationKey: genKey,
          notes: 'สร้างจากคำแนะนำสั่งซื้อของผลนับที่ตรวจรับแล้ว',
          createdBy: session.user.id as string,
        }),
        db.insert(purchaseOrderItems).values(groupItems.map((gi) => {
          const item = gi.line.reco;
          const unitCost = gi.priceStatus === 'pending' ? null : gi.lastCost;
          return {
            purchaseOrderId: poId,
            ingredientId: gi.line.ingredientId,
            quantity: qty(gi.normalized),
            unit: item.unit,
            purchaseQuantity: qty(gi.line.purchaseQuantity),
            purchaseUnit: item.purchaseUnit ?? item.unit,
            purchaseUnitConversion: String(gi.conversion),
            unitCost: money(unitCost),
            lineTotal: unitCost == null ? null : money(gi.normalized * unitCost),
            lastCostSnapshot: money(gi.lastCost),
            estimatedUnitCost: gi.priceStatus === 'estimated' ? money(unitCost) : null,
            confirmedUnitCost: null,
            priceStatus: gi.priceStatus,
            reorderReviewedCountDate: reviewedCountDate,
            reorderPhysicalStock: qty(item.quantityOnHand),
            reorderParLevel: qty(item.parLevel),
            reorderOnTimeIncoming: qty(item.inTransitQty),
            reorderDelayedIncoming: qty(item.delayedIncomingQty),
            reorderRecommendedStockQty: qty(item.reorderQty),
            reorderRecommendedPurchaseQty: qty(item.recommendedPurchaseQty),
          };
        })),
      ];
      await db.batch(operations);
      created += 1;
      poIds.push(poId);
    }
    revalidateInventory();
    return {
      ok: true as const,
      data: { created, duplicated, supplierCount: partition.groups.length, poIds },
    };
  } catch (error) {
    console.error('[generateReorderDraft]', error);
    return { ok: false as const, error: businessError(error) };
  }
}
