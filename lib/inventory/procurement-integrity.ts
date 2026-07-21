import { roundMoney, type PurchasePriceStatus } from '@/lib/inventory/procurement-math';

export type EffectiveStockMovement = {
  effectiveDate: string;
  regularReceived?: number;
  emergencyReceived?: number;
  positiveAdjustment?: number;
  recordedWaste?: number;
  otherOutbound?: number;
  priceStatus?: PurchasePriceStatus;
};

export type StockIntervalTotals = {
  regularReceived: number;
  emergencyReceived: number;
  positiveAdjustment: number;
  recordedWaste: number;
  otherOutbound: number;
  confirmedMovementCount: number;
  unconfirmedMovementCount: number;
};

export function isInsideStockInterval(
  effectiveDate: string,
  openingSourceBusinessDate: string | null,
  currentBusinessDate: string,
) {
  if (effectiveDate > currentBusinessDate) return false;
  // With no reviewed opening source, the manual opening represents the start
  // of the current business day. Older movements must not be counted again.
  if (openingSourceBusinessDate === null) return effectiveDate === currentBusinessDate;
  return effectiveDate > openingSourceBusinessDate;
}

export function aggregateStockInterval(
  rows: EffectiveStockMovement[],
  openingSourceBusinessDate: string | null,
  currentBusinessDate: string,
): StockIntervalTotals {
  const result: StockIntervalTotals = {
    regularReceived: 0,
    emergencyReceived: 0,
    positiveAdjustment: 0,
    recordedWaste: 0,
    otherOutbound: 0,
    confirmedMovementCount: 0,
    unconfirmedMovementCount: 0,
  };
  for (const row of rows) {
    if (!isInsideStockInterval(row.effectiveDate, openingSourceBusinessDate, currentBusinessDate)) continue;
    result.regularReceived += row.regularReceived ?? 0;
    result.emergencyReceived += row.emergencyReceived ?? 0;
    result.positiveAdjustment += row.positiveAdjustment ?? 0;
    result.recordedWaste += row.recordedWaste ?? 0;
    result.otherOutbound += row.otherOutbound ?? 0;
    if (row.priceStatus) {
      if (row.priceStatus === 'confirmed') result.confirmedMovementCount += 1;
      else result.unconfirmedMovementCount += 1;
    }
  }
  result.regularReceived = roundMoney(result.regularReceived);
  result.emergencyReceived = roundMoney(result.emergencyReceived);
  result.positiveAdjustment = roundMoney(result.positiveAdjustment);
  result.recordedWaste = roundMoney(result.recordedWaste);
  result.otherOutbound = roundMoney(result.otherOutbound);
  return result;
}

export type ConfirmedCostCandidate = {
  receiptItemId: string;
  receivedBusinessDate: string;
  receivedAt: Date | string;
  actualUnitCost: number | null;
  priceStatus: PurchasePriceStatus;
  voided: boolean;
};

function timestamp(value: Date | string) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function deriveLatestConfirmedCost(rows: ConfirmedCostCandidate[]) {
  return rows
    .filter((row) => (
      !row.voided
      && row.priceStatus === 'confirmed'
      && row.actualUnitCost !== null
      && row.actualUnitCost > 0
    ))
    .sort((a, b) => (
      b.receivedBusinessDate.localeCompare(a.receivedBusinessDate)
      || timestamp(b.receivedAt) - timestamp(a.receivedAt)
      || b.receiptItemId.localeCompare(a.receiptItemId)
    ))[0]?.actualUnitCost ?? null;
}

export type ReceiptFinancialLine = {
  normalizedQuantity: number;
  priceStatus: PurchasePriceStatus;
  actualUnitCost: number | null;
  estimatedUnitCost: number | null;
};

export function calculateReceiptFinancialSummary(
  lines: ReceiptFinancialLine[],
  vatRate: number,
) {
  let confirmedSubtotal = 0;
  let estimatedSubtotal = 0;
  let pendingItemCount = 0;
  let estimatedItemCount = 0;
  for (const line of lines) {
    if (line.priceStatus === 'confirmed' && line.actualUnitCost !== null && line.actualUnitCost > 0) {
      confirmedSubtotal += line.normalizedQuantity * line.actualUnitCost;
      continue;
    }
    if (line.estimatedUnitCost !== null && line.estimatedUnitCost > 0) {
      estimatedSubtotal += line.normalizedQuantity * line.estimatedUnitCost;
      estimatedItemCount += 1;
    } else {
      pendingItemCount += 1;
    }
  }
  confirmedSubtotal = roundMoney(confirmedSubtotal);
  estimatedSubtotal = roundMoney(estimatedSubtotal);
  const confirmedVatAmount = roundMoney(confirmedSubtotal * vatRate / 100);
  const estimatedVatAmount = roundMoney(estimatedSubtotal * vatRate / 100);
  const priceStatus: PurchasePriceStatus = pendingItemCount > 0
    ? 'pending'
    : estimatedItemCount > 0
      ? 'estimated'
      : 'confirmed';
  return {
    confirmedSubtotal,
    estimatedSubtotal,
    pendingItemCount,
    confirmedVatAmount,
    estimatedVatAmount,
    confirmedTotal: roundMoney(confirmedSubtotal + confirmedVatAmount),
    estimatedTotal: roundMoney(estimatedSubtotal + estimatedVatAmount),
    hasPendingPrices: pendingItemCount > 0 || estimatedItemCount > 0,
    priceStatus,
  };
}

export function normalizePlanningPriceStatus(
  status: PurchasePriceStatus,
): Exclude<PurchasePriceStatus, 'confirmed'> {
  return status === 'pending' ? 'pending' : 'estimated';
}

export function normalizePurchaseQuantity(purchaseQuantity: number, conversionFactor: number) {
  if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) {
    throw new Error('PURCHASE_QUANTITY_MUST_BE_POSITIVE');
  }
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    throw new Error('CONVERSION_FACTOR_MUST_BE_POSITIVE');
  }
  return roundMoney(purchaseQuantity * conversionFactor);
}

export function calculateReorderBreakdown(input: {
  physicalStock: number;
  parLevel: number;
  minimumStock: number;
  onTimeIncoming: number;
  delayedIncoming: number;
}) {
  const target = input.parLevel > 0 ? input.parLevel : input.minimumStock;
  return {
    target,
    guaranteedIncoming: roundMoney(input.onTimeIncoming),
    delayedIncoming: roundMoney(input.delayedIncoming),
    recommendedQuantity: Math.max(
      0,
      roundMoney(target - input.physicalStock - input.onTimeIncoming),
    ),
  };
}
