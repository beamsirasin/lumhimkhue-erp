export type PurchasePriceStatus = 'pending' | 'estimated' | 'confirmed';

export type PurchasePriceInput = {
  quantity: number;
  priceStatus: PurchasePriceStatus;
  estimatedUnitCost?: number | null;
  confirmedUnitCost?: number | null;
};

export type PurchaseTotals = {
  priceStatus: PurchasePriceStatus;
  pricedItemCount: number;
  pendingItemCount: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  isPartialEstimate: boolean;
};

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function resolvePlanningUnitCost(item: PurchasePriceInput): number | null {
  if (item.priceStatus === 'confirmed') return item.confirmedUnitCost ?? null;
  if (item.priceStatus === 'estimated') return item.estimatedUnitCost ?? null;
  return null;
}

export function calculatePurchaseTotals(items: PurchasePriceInput[], vatRate: number): PurchaseTotals {
  let subtotal = 0;
  let pricedItemCount = 0;
  let pendingItemCount = 0;
  let hasEstimated = false;

  for (const item of items) {
    const unitCost = resolvePlanningUnitCost(item);
    if (unitCost === null) {
      pendingItemCount += 1;
      continue;
    }
    pricedItemCount += 1;
    hasEstimated ||= item.priceStatus === 'estimated';
    subtotal += item.quantity * unitCost;
  }

  subtotal = roundMoney(subtotal);
  const vatAmount = roundMoney(subtotal * (vatRate / 100));
  const total = roundMoney(subtotal + vatAmount);
  const priceStatus: PurchasePriceStatus = pendingItemCount > 0
    ? 'pending'
    : hasEstimated
      ? 'estimated'
      : 'confirmed';

  return {
    priceStatus,
    pricedItemCount,
    pendingItemCount,
    subtotal,
    vatAmount,
    total,
    isPartialEstimate: pendingItemCount > 0 && pricedItemCount > 0,
  };
}

export type StockUsageInput = {
  openingQuantity: number;
  regularReceived: number;
  emergencyReceived: number;
  positiveAdjustment: number;
  physicalClosingQuantity: number;
  recordedWaste: number;
  otherOutboundAdjustment: number;
};

export function calculatePhysicalStockUsage(input: StockUsageInput) {
  const totalStockDepletion = roundMoney(
    input.openingQuantity
      + input.regularReceived
      + input.emergencyReceived
      + input.positiveAdjustment
      - input.physicalClosingQuantity,
  );
  const estimatedOperationalUsage = roundMoney(
    totalStockDepletion - input.recordedWaste - input.otherOutboundAdjustment,
  );
  return {
    totalStockDepletion,
    estimatedOperationalUsage,
    hasNegativeDepletion: totalStockDepletion < 0,
    hasNegativeOperationalUsage: estimatedOperationalUsage < 0,
  };
}

export function calculateReorderQuantity(
  physicalClosingQuantity: number,
  parLevel: number,
  minimumStock: number,
  openPoRemainingQuantity: number,
) {
  const target = parLevel > 0 ? parLevel : minimumStock;
  return Math.max(0, roundMoney(target - physicalClosingQuantity - openPoRemainingQuantity));
}

export function deriveDeliveryState(input: {
  expectedDate: string | null;
  asOfDate: string;
  orderedQuantity: number;
  receivedQuantity: number;
  status: string;
}) {
  const remainingQuantity = Math.max(0, roundMoney(input.orderedQuantity - input.receivedQuantity));
  const terminal = input.status === 'cancelled' || input.status === 'received';
  const isDelayed = Boolean(
    input.expectedDate
      && input.expectedDate < input.asOfDate
      && remainingQuantity > 0
      && !terminal,
  );
  const delayedDays = isDelayed && input.expectedDate
    ? Math.max(1, Math.floor(
        (Date.parse(`${input.asOfDate}T00:00:00Z`) - Date.parse(`${input.expectedDate}T00:00:00Z`))
          / 86_400_000,
      ))
    : 0;
  return { remainingQuantity, isDelayed, delayedDays };
}

export function calculatePriceVariance(estimatedUnitCost: number | null, actualUnitCost: number) {
  const amount = estimatedUnitCost === null ? null : roundMoney(actualUnitCost - estimatedUnitCost);
  const percentage = estimatedUnitCost && amount !== null
    ? roundMoney((amount / estimatedUnitCost) * 100)
    : null;
  return { amount, percentage };
}

