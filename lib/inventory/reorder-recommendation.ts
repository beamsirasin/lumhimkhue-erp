/**
 * Phase 17B — Reorder Recommendation + Purchase-Unit Rounding (pure)
 *
 * Business truth (do not change):
 *  - Recommendation is advisory only. A human reviews/edits before a PO is sent.
 *  - recommended_stock_qty = max(0, par - latest_reviewed_physical - on_time_incoming)
 *  - Delayed incoming is shown separately and is NEVER subtracted from the need.
 *  - Purchase quantity is ROUNDED UP to whole purchase units so the projected
 *    stock never lands below par. Rounding down is forbidden.
 *  - A missing/invalid purchase-unit conversion blocks the recommendation
 *    instead of silently producing a number.
 */

import { roundMoney } from './procurement-math';

export type ReorderBlockReason = 'missing_conversion' | null;

export type ReorderRecommendationInput = {
  physicalStock: number;
  parLevel: number;
  minimumStock: number;
  onTimeIncoming: number;
  delayedIncoming: number;
  /** Stock units contained in one purchase unit (e.g. 1 pack = 5 kg → 5). */
  conversion: number | null | undefined;
  purchaseUnit: string | null | undefined;
  stockUnit: string;
};

export type ReorderRecommendation = {
  physicalStock: number;
  parLevel: number;
  minimumStock: number;
  onTimeIncoming: number;
  delayedIncoming: number;
  /** Target = par when > 0, otherwise minimum stock. */
  target: number;
  /** max(0, target - physical - onTime). Delayed is not included. */
  shortageStockQty: number;
  conversion: number | null;
  purchaseUnit: string | null;
  stockUnit: string;
  canRecommend: boolean;
  blockedReason: ReorderBlockReason;
  /** Whole purchase units, rounded up. 0 when blocked or no shortage. */
  recommendedPurchaseQty: number;
  /** recommendedPurchaseQty * conversion (stock units). */
  normalizedStockQty: number;
  /** physical + onTime + normalizedStockQty once the recommendation is received. */
  projectedStock: number;
};

const EPSILON = 1e-9;

/** Whole purchase units needed to cover a stock shortage, always rounded up. */
export function roundUpToPurchaseUnit(shortageStockQty: number, conversion: number): number {
  if (!Number.isFinite(conversion) || conversion <= 0) {
    throw new Error('CONVERSION_MUST_BE_POSITIVE');
  }
  if (!Number.isFinite(shortageStockQty) || shortageStockQty <= 0) return 0;
  // Subtract a tiny epsilon so an exact multiple (e.g. 10/5 = 2) is not pushed
  // to the next unit by binary float error, while any real remainder rounds up.
  return Math.ceil(shortageStockQty / conversion - EPSILON);
}

function isValidConversion(conversion: number | null | undefined): conversion is number {
  return typeof conversion === 'number' && Number.isFinite(conversion) && conversion > 0;
}

export function buildReorderRecommendation(input: ReorderRecommendationInput): ReorderRecommendation {
  const target = input.parLevel > 0 ? input.parLevel : input.minimumStock;
  const shortageStockQty = Math.max(
    0,
    roundMoney(target - input.physicalStock - input.onTimeIncoming),
  );
  const purchaseUnit = input.purchaseUnit ?? null;
  const base = {
    physicalStock: input.physicalStock,
    parLevel: input.parLevel,
    minimumStock: input.minimumStock,
    onTimeIncoming: input.onTimeIncoming,
    delayedIncoming: input.delayedIncoming,
    target,
    shortageStockQty,
    purchaseUnit,
    stockUnit: input.stockUnit,
  };

  if (!isValidConversion(input.conversion)) {
    return {
      ...base,
      conversion: null,
      canRecommend: false,
      blockedReason: 'missing_conversion',
      recommendedPurchaseQty: 0,
      normalizedStockQty: 0,
      projectedStock: roundMoney(input.physicalStock + input.onTimeIncoming),
    };
  }

  const recommendedPurchaseQty = roundUpToPurchaseUnit(shortageStockQty, input.conversion);
  const normalizedStockQty = roundMoney(recommendedPurchaseQty * input.conversion);
  const projectedStock = roundMoney(
    input.physicalStock + input.onTimeIncoming + normalizedStockQty,
  );

  return {
    ...base,
    conversion: input.conversion,
    canRecommend: true,
    blockedReason: null,
    recommendedPurchaseQty,
    normalizedStockQty,
    projectedStock,
  };
}

// ── Draft-PO generation helpers (pure) ───────────────────────────────────────

export type ReorderSelectionLine = {
  ingredientId: string;
  supplierId: string | null;
  /** User-adjusted whole purchase-unit quantity to order. */
  purchaseQuantity: number;
  conversion: number | null;
};

export type PartitionedSelection<T extends ReorderSelectionLine> = {
  missingSupplier: T[];
  invalidConversion: T[];
  invalidQuantity: T[];
  /** Deterministic order: supplier groups sorted by supplierId. */
  groups: Array<{ supplierId: string; lines: T[] }>;
};

/**
 * Split a reorder selection into per-supplier groups, surfacing the lines that
 * cannot be safely turned into a PO (no supplier, bad conversion, bad quantity)
 * rather than silently dropping or guessing them.
 */
export function partitionReorderSelection<T extends ReorderSelectionLine>(
  lines: T[],
): PartitionedSelection<T> {
  const missingSupplier: T[] = [];
  const invalidConversion: T[] = [];
  const invalidQuantity: T[] = [];
  const bySupplier = new Map<string, T[]>();

  for (const line of lines) {
    if (!Number.isFinite(line.purchaseQuantity) || line.purchaseQuantity <= 0) {
      invalidQuantity.push(line);
      continue;
    }
    if (!isValidConversion(line.conversion)) {
      invalidConversion.push(line);
      continue;
    }
    if (!line.supplierId) {
      missingSupplier.push(line);
      continue;
    }
    const group = bySupplier.get(line.supplierId) ?? [];
    group.push(line);
    bySupplier.set(line.supplierId, group);
  }

  const groups = [...bySupplier.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplierId, groupLines]) => ({ supplierId, lines: groupLines }));

  return { missingSupplier, invalidConversion, invalidQuantity, groups };
}

/**
 * Per-supplier idempotency key. One "generate" click carries a single base key;
 * each supplier draft is keyed by base+supplier so a double-submit resolves to
 * the already-created drafts instead of making duplicates.
 */
export function reorderGenerationKeyForSupplier(baseKey: string, supplierId: string): string {
  return `${baseKey}:${supplierId}`;
}
