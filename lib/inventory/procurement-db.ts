import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  goodsReceiptItems,
  goodsReceipts,
  ingredients,
  purchaseOrderItems,
  purchaseOrders,
  stockCountAdjustments,
  stockCountItems,
  stockCounts,
} from '@/lib/db/schema';
import { aggregateStockInterval, type EffectiveStockMovement } from '@/lib/inventory/procurement-integrity';

export type OpeningSourceMap = Record<string, { stockCountId: string; countDate: string }>;

export type InventoryIntervalBreakdown = {
  regular: Record<string, number>;
  emergency: Record<string, number>;
  total: Record<string, number>;
  positiveAdjustments: Record<string, number>;
  waste: Record<string, number>;
  otherOutbound: Record<string, number>;
  priceStatus: Record<string, 'pending' | 'partial' | 'confirmed'>;
  pendingPriceIngredientIds: string[];
};

export async function getInventoryIntervalBreakdown(
  currentBusinessDate: string,
  openingSources: OpeningSourceMap,
  ingredientIds: string[],
): Promise<InventoryIntervalBreakdown> {
  if (ingredientIds.length === 0) {
    return {
      regular: {}, emergency: {}, total: {}, positiveAdjustments: {}, waste: {}, otherOutbound: {},
      priceStatus: {}, pendingPriceIngredientIds: [],
    };
  }
  const [receiptRows, adjustmentRows] = await Promise.all([
    db.select({
      ingredientId: purchaseOrderItems.ingredientId,
      effectiveDate: goodsReceipts.receivedDate,
      receivedQuantity: goodsReceiptItems.receivedQuantity,
      purchaseType: purchaseOrders.purchaseType,
      priceStatus: goodsReceiptItems.priceStatus,
    })
      .from(goodsReceiptItems)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptItems.goodsReceiptId))
      .innerJoin(purchaseOrderItems, eq(purchaseOrderItems.id, goodsReceiptItems.purchaseOrderItemId))
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(and(
        inArray(purchaseOrderItems.ingredientId, ingredientIds),
        lte(goodsReceipts.receivedDate, currentBusinessDate),
        isNull(goodsReceipts.voidedAt),
      )),
    db.select({
      ingredientId: stockCountAdjustments.ingredientId,
      effectiveDate: stockCountAdjustments.effectiveDate,
      fallbackDate: stockCounts.countDate,
      adjustmentQuantity: stockCountAdjustments.adjustmentQty,
      adjustmentType: stockCountAdjustments.adjustmentType,
    })
      .from(stockCountAdjustments)
      .innerJoin(stockCounts, eq(stockCounts.id, stockCountAdjustments.stockCountId))
      .where(and(
        inArray(stockCountAdjustments.ingredientId, ingredientIds),
        lte(stockCounts.countDate, currentBusinessDate),
      )),
  ]);

  const movements = new Map<string, EffectiveStockMovement[]>();
  for (const ingredientId of ingredientIds) movements.set(ingredientId, []);
  for (const row of receiptRows) {
    movements.get(row.ingredientId)?.push({
      effectiveDate: row.effectiveDate,
      regularReceived: row.purchaseType === 'emergency_direct' ? 0 : Number(row.receivedQuantity),
      emergencyReceived: row.purchaseType === 'emergency_direct' ? Number(row.receivedQuantity) : 0,
      priceStatus: row.priceStatus as 'pending' | 'estimated' | 'confirmed',
    });
  }
  for (const row of adjustmentRows) {
    const amount = Number(row.adjustmentQuantity);
    movements.get(row.ingredientId)?.push({
      effectiveDate: row.effectiveDate ?? row.fallbackDate,
      positiveAdjustment: row.adjustmentType === 'adjustment' && amount > 0 ? amount : 0,
      recordedWaste: row.adjustmentType === 'waste' ? Math.abs(amount) : 0,
      otherOutbound: row.adjustmentType === 'adjustment' && amount < 0 ? Math.abs(amount) : 0,
    });
  }

  const result: InventoryIntervalBreakdown = {
    regular: {}, emergency: {}, total: {}, positiveAdjustments: {}, waste: {}, otherOutbound: {},
    priceStatus: {}, pendingPriceIngredientIds: [],
  };
  for (const ingredientId of ingredientIds) {
    const sourceDate = openingSources[ingredientId]?.countDate ?? null;
    const totals = aggregateStockInterval(movements.get(ingredientId) ?? [], sourceDate, currentBusinessDate);
    result.regular[ingredientId] = totals.regularReceived;
    result.emergency[ingredientId] = totals.emergencyReceived;
    result.total[ingredientId] = totals.regularReceived + totals.emergencyReceived;
    result.positiveAdjustments[ingredientId] = totals.positiveAdjustment;
    result.waste[ingredientId] = totals.recordedWaste;
    result.otherOutbound[ingredientId] = totals.otherOutbound;
    const status = totals.unconfirmedMovementCount === 0
      ? 'confirmed'
      : totals.confirmedMovementCount > 0
        ? 'partial'
        : 'pending';
    result.priceStatus[ingredientId] = status;
    if (status !== 'confirmed') result.pendingPriceIngredientIds.push(ingredientId);
  }
  return result;
}

export async function findReviewedCountUsingMovement(
  effectiveBusinessDate: string,
  ingredientIds: string[],
) {
  if (ingredientIds.length === 0) return null;
  const candidates = await db.select({
    countId: stockCounts.id,
    countDate: stockCounts.countDate,
    ingredientId: stockCountItems.ingredientId,
    openingSourceDate: stockCountItems.openingSourceDate,
  })
    .from(stockCountItems)
    .innerJoin(stockCounts, eq(stockCounts.id, stockCountItems.stockCountId))
    .where(and(
      eq(stockCounts.status, 'reviewed'),
      inArray(stockCountItems.ingredientId, ingredientIds),
      sql`${stockCounts.countDate} >= ${effectiveBusinessDate}`,
    ))
    .orderBy(asc(stockCounts.countDate), asc(stockCounts.id));
  return candidates.find((row) => (
    row.openingSourceDate === null
      ? row.countDate === effectiveBusinessDate
      : row.openingSourceDate < effectiveBusinessDate
  )) ?? null;
}

export function recomputeIngredientLastCost(ingredientId: string) {
  return db.update(ingredients).set({
    lastCost: sql`COALESCE((
      SELECT gri.actual_unit_cost
      FROM goods_receipt_items gri
      INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      INNER JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
      WHERE poi.ingredient_id = ${ingredientId}
        AND gr.voided_at IS NULL
        AND gri.price_status = 'confirmed'
        AND gri.actual_unit_cost > 0
      ORDER BY gr.received_date DESC, gr.created_at DESC, gri.id DESC
      LIMIT 1
    ), 0)`,
    updatedAt: new Date(),
  }).where(eq(ingredients.id, ingredientId));
}

const confirmedSubtotalSql = (purchaseOrderId: string) => sql`COALESCE((
  SELECT SUM(gri.received_quantity * gri.actual_unit_cost)
  FROM goods_receipt_items gri
  INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
  WHERE gr.purchase_order_id = ${purchaseOrderId}
    AND gr.voided_at IS NULL
    AND gri.price_status = 'confirmed'
    AND gri.actual_unit_cost > 0
), 0)`;

const estimatedSubtotalSql = (purchaseOrderId: string) => sql`COALESCE((
  SELECT SUM(gri.received_quantity * COALESCE(gri.estimated_unit_cost, poi.estimated_unit_cost, poi.unit_cost, poi.last_cost_snapshot))
  FROM goods_receipt_items gri
  INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
  INNER JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
  WHERE gr.purchase_order_id = ${purchaseOrderId}
    AND gr.voided_at IS NULL
    AND gri.price_status <> 'confirmed'
    AND COALESCE(gri.estimated_unit_cost, poi.estimated_unit_cost, poi.unit_cost, poi.last_cost_snapshot) > 0
), 0) + COALESCE((
  SELECT SUM(GREATEST(poi.quantity - COALESCE(received.received_quantity, 0), 0)
    * COALESCE(poi.estimated_unit_cost, poi.unit_cost, poi.last_cost_snapshot))
  FROM purchase_order_items poi
  LEFT JOIN (
    SELECT gri.purchase_order_item_id, SUM(gri.received_quantity) AS received_quantity
    FROM goods_receipt_items gri
    INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
    WHERE gr.purchase_order_id = ${purchaseOrderId} AND gr.voided_at IS NULL
    GROUP BY gri.purchase_order_item_id
  ) received ON received.purchase_order_item_id = poi.id
  WHERE poi.purchase_order_id = ${purchaseOrderId}
    AND GREATEST(poi.quantity - COALESCE(received.received_quantity, 0), 0) > 0
    AND COALESCE(poi.estimated_unit_cost, poi.unit_cost, poi.last_cost_snapshot) > 0
), 0)`;

const pendingCountSql = (purchaseOrderId: string) => sql`(
  SELECT COUNT(*)::int
  FROM goods_receipt_items gri
  INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
  INNER JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
  WHERE gr.purchase_order_id = ${purchaseOrderId}
    AND gr.voided_at IS NULL
    AND gri.price_status <> 'confirmed'
    AND COALESCE(gri.estimated_unit_cost, poi.estimated_unit_cost, poi.unit_cost, poi.last_cost_snapshot, 0) <= 0
) + (
  SELECT COUNT(*)::int
  FROM purchase_order_items poi
  LEFT JOIN (
    SELECT gri.purchase_order_item_id, SUM(gri.received_quantity) AS received_quantity
    FROM goods_receipt_items gri
    INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
    WHERE gr.purchase_order_id = ${purchaseOrderId} AND gr.voided_at IS NULL
    GROUP BY gri.purchase_order_item_id
  ) received ON received.purchase_order_item_id = poi.id
  WHERE poi.purchase_order_id = ${purchaseOrderId}
    AND GREATEST(poi.quantity - COALESCE(received.received_quantity, 0), 0) > 0
    AND COALESCE(poi.estimated_unit_cost, poi.unit_cost, poi.last_cost_snapshot, 0) <= 0
)`;

const unconfirmedCountSql = (purchaseOrderId: string) => sql`(
  SELECT COUNT(*)::int
  FROM goods_receipt_items gri
  INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
  WHERE gr.purchase_order_id = ${purchaseOrderId}
    AND gr.voided_at IS NULL
    AND gri.price_status <> 'confirmed'
) + (
  SELECT COUNT(*)::int
  FROM purchase_order_items poi
  LEFT JOIN (
    SELECT gri.purchase_order_item_id, SUM(gri.received_quantity) AS received_quantity
    FROM goods_receipt_items gri
    INNER JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
    WHERE gr.purchase_order_id = ${purchaseOrderId} AND gr.voided_at IS NULL
    GROUP BY gri.purchase_order_item_id
  ) received ON received.purchase_order_item_id = poi.id
  WHERE poi.purchase_order_id = ${purchaseOrderId}
    AND GREATEST(poi.quantity - COALESCE(received.received_quantity, 0), 0) > 0
)`;

export function recomputePurchaseFinancialSummary(purchaseOrderId: string) {
  const confirmedSubtotal = confirmedSubtotalSql(purchaseOrderId);
  const estimatedSubtotal = estimatedSubtotalSql(purchaseOrderId);
  const pendingCount = pendingCountSql(purchaseOrderId);
  const unconfirmedCount = unconfirmedCountSql(purchaseOrderId);
  return db.update(purchaseOrders).set({
    confirmedSubtotal,
    confirmedVatAmount: sql`ROUND((${confirmedSubtotal}) * vat_rate / 100, 2)`,
    confirmedTotal: sql`ROUND((${confirmedSubtotal}) * (1 + vat_rate / 100), 2)`,
    estimatedSubtotal,
    estimatedVatAmount: sql`ROUND((${estimatedSubtotal}) * vat_rate / 100, 2)`,
    estimatedTotal: sql`ROUND((${estimatedSubtotal}) * (1 + vat_rate / 100), 2)`,
    pendingPriceItemCount: pendingCount,
    hasPendingPrices: sql`(${unconfirmedCount}) > 0`,
    priceStatus: sql`CASE
      WHEN (${pendingCount}) > 0 THEN 'pending'
      WHEN (${unconfirmedCount}) > 0 THEN 'estimated'
      ELSE 'confirmed'
    END`,
    updatedAt: new Date(),
  }).where(eq(purchaseOrders.id, purchaseOrderId));
}


