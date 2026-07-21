import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  goodsReceiptItems,
  goodsReceipts,
  purchaseOrderItems,
  stockCountItems,
  stockCounts,
} from '@/lib/db/schema';
import { deriveLatestConfirmedCost, isInsideStockInterval } from '@/lib/inventory/procurement-integrity';
import { roundMoney } from '@/lib/inventory/procurement-math';

export type CostMetadataSnapshot = {
  usageCostStatus: string;
  usageUnitCost: number | null;
  estimatedUsageCost: number | null;
  costRecalculatedAt: Date | null;
};

export async function prepareCostMetadataRecalculation(input: {
  ingredientId: string;
  changedReceiptItemId: string;
  changedReceiptDate: string;
  changedActualUnitCost: number;
}) {
  const countItems = await db.select({
    itemId: stockCountItems.id,
    countId: stockCounts.id,
    countDate: stockCounts.countDate,
    openingSourceDate: stockCountItems.openingSourceDate,
    operationalUsageQuantity: stockCountItems.estimatedOperationalUsageQty,
    usageCostStatus: stockCountItems.usageCostStatus,
    usageUnitCost: stockCountItems.usageUnitCost,
    estimatedUsageCost: stockCountItems.estimatedUsageCost,
    costRecalculatedAt: stockCountItems.costRecalculatedAt,
  })
    .from(stockCountItems)
    .innerJoin(stockCounts, eq(stockCounts.id, stockCountItems.stockCountId))
    .where(and(
      eq(stockCountItems.ingredientId, input.ingredientId),
      eq(stockCounts.status, 'reviewed'),
      gte(stockCounts.countDate, input.changedReceiptDate),
    ))
    .orderBy(asc(stockCounts.countDate));

  const affected = countItems.filter((row) => isInsideStockInterval(
    input.changedReceiptDate,
    row.openingSourceDate,
    row.countDate,
  ));
  if (affected.length === 0) return [];

  const receiptRows = await db.select({
    receiptItemId: goodsReceiptItems.id,
    receivedBusinessDate: goodsReceipts.receivedDate,
    receivedAt: goodsReceipts.createdAt,
    actualUnitCost: goodsReceiptItems.actualUnitCost,
    priceStatus: goodsReceiptItems.priceStatus,
    estimatedUnitCost: goodsReceiptItems.estimatedUnitCost,
  })
    .from(goodsReceiptItems)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptItems.goodsReceiptId))
    .innerJoin(purchaseOrderItems, eq(purchaseOrderItems.id, goodsReceiptItems.purchaseOrderItemId))
    .where(and(
      eq(purchaseOrderItems.ingredientId, input.ingredientId),
      isNull(goodsReceipts.voidedAt),
    ));

  const recalculatedAt = new Date();
  return affected.map((countItem) => {
    const intervalRows = receiptRows
      .filter((row) => isInsideStockInterval(
        row.receivedBusinessDate,
        countItem.openingSourceDate,
        countItem.countDate,
      ))
      .map((row) => row.receiptItemId === input.changedReceiptItemId
        ? { ...row, priceStatus: 'confirmed', actualUnitCost: String(input.changedActualUnitCost) }
        : row);
    const confirmed = intervalRows.filter((row) => (
      row.priceStatus === 'confirmed' && Number(row.actualUnitCost ?? 0) > 0
    ));
    const unconfirmedCount = intervalRows.length - confirmed.length;
    const usageCostStatus = unconfirmedCount === 0
      ? 'confirmed'
      : confirmed.length > 0
        ? 'partial'
        : 'pending';
    const latestCost = deriveLatestConfirmedCost(intervalRows.map((row) => ({
      receiptItemId: row.receiptItemId,
      receivedBusinessDate: row.receivedBusinessDate,
      receivedAt: row.receivedAt,
      actualUnitCost: row.actualUnitCost == null ? null : Number(row.actualUnitCost),
      priceStatus: row.priceStatus as 'pending' | 'estimated' | 'confirmed',
      voided: false,
    })));
    const usageQuantity = Number(countItem.operationalUsageQuantity);
    const estimatedUsageCost = latestCost === null
      ? null
      : roundMoney(usageQuantity * latestCost);
    return {
      itemId: countItem.itemId,
      countId: countItem.countId,
      before: {
        usageCostStatus: countItem.usageCostStatus,
        usageUnitCost: countItem.usageUnitCost == null ? null : Number(countItem.usageUnitCost),
        estimatedUsageCost: countItem.estimatedUsageCost == null ? null : Number(countItem.estimatedUsageCost),
        costRecalculatedAt: countItem.costRecalculatedAt,
      } satisfies CostMetadataSnapshot,
      after: {
        usageCostStatus,
        usageUnitCost: latestCost,
        estimatedUsageCost,
        costRecalculatedAt: recalculatedAt,
      } satisfies CostMetadataSnapshot,
    };
  });
}
