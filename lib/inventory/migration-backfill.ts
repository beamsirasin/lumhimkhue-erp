import type { PurchasePriceStatus } from '@/lib/inventory/procurement-math';

export function classifyLegacyPlanningPrice(unitCost: number | null): PurchasePriceStatus {
  return unitCost !== null && unitCost > 0 ? 'estimated' : 'pending';
}

export function classifyLegacyReceiptPrice(input: {
  actualUnitCost: number | null;
  estimatedUnitCost: number | null;
}): PurchasePriceStatus {
  if (input.actualUnitCost !== null && input.actualUnitCost > 0) return 'confirmed';
  if (input.estimatedUnitCost !== null && input.estimatedUnitCost > 0) return 'estimated';
  return 'pending';
}

export function deriveLegacyHeaderPriceStatus(input: {
  receiptStatuses: PurchasePriceStatus[];
  remainingItemStatuses: PurchasePriceStatus[];
}): PurchasePriceStatus {
  const statuses = [...input.receiptStatuses, ...input.remainingItemStatuses];
  if (statuses.some((status) => status === 'pending')) return 'pending';
  if (statuses.some((status) => status === 'estimated')) return 'estimated';
  return 'confirmed';
}