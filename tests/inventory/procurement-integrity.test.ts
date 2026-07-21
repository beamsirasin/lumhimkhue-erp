import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateStockInterval,
  calculateReceiptFinancialSummary,
  calculateReorderBreakdown,
  deriveLatestConfirmedCost,
  isInsideStockInterval,
  normalizePlanningPriceStatus,
  normalizePurchaseQuantity,
} from '../../lib/inventory/procurement-integrity';
import {
  classifyLegacyPlanningPrice,
  classifyLegacyReceiptPrice,
  deriveLegacyHeaderPriceStatus,
} from '../../lib/inventory/migration-backfill';
import { calculatePhysicalStockUsage } from '../../lib/inventory/procurement-math';

describe('Phase 17A.1 skipped-day stock interval', () => {
  it('includes one skipped day and current day but excludes opening day', () => {
    const result = aggregateStockInterval([
      { effectiveDate: '2026-07-20', regularReceived: 99 },
      { effectiveDate: '2026-07-21', regularReceived: 15 },
      { effectiveDate: '2026-07-22', regularReceived: 5 },
    ], '2026-07-20', '2026-07-22');
    assert.equal(result.regularReceived, 20);
  });

  it('includes every movement across multiple skipped days and excludes future rows', () => {
    const result = aggregateStockInterval([
      { effectiveDate: '2026-07-21', regularReceived: 2 },
      { effectiveDate: '2026-07-22', emergencyReceived: 3 },
      { effectiveDate: '2026-07-23', positiveAdjustment: 4 },
      { effectiveDate: '2026-07-24', recordedWaste: 1, otherOutbound: 2 },
      { effectiveDate: '2026-07-25', regularReceived: 100 },
    ], '2026-07-20', '2026-07-24');
    assert.deepEqual(result, {
      regularReceived: 2,
      emergencyReceived: 3,
      positiveAdjustment: 4,
      recordedWaste: 1,
      otherOutbound: 2,
      confirmedMovementCount: 0,
      unconfirmedMovementCount: 0,
    });
  });

  it('uses only current-day movements when no reviewed opening exists', () => {
    assert.equal(isInsideStockInterval('2026-07-20', null, '2026-07-22'), false);
    assert.equal(isInsideStockInterval('2026-07-22', null, '2026-07-22'), true);
  });
});

describe('Phase 17A.1 last-cost chronology', () => {
  const candidate = (overrides: Partial<Parameters<typeof deriveLatestConfirmedCost>[0][number]> = {}) => ({
    receiptItemId: 'a',
    receivedBusinessDate: '2026-07-20',
    receivedAt: '2026-07-20T10:00:00Z',
    actualUnitCost: 150,
    priceStatus: 'confirmed' as const,
    voided: false,
    ...overrides,
  });

  it('keeps the later receipt cost when an older receipt is confirmed late', () => {
    assert.equal(deriveLatestConfirmedCost([
      candidate({ receiptItemId: 'old', actualUnitCost: 150 }),
      candidate({ receiptItemId: 'new', receivedBusinessDate: '2026-07-22', actualUnitCost: 160 }),
    ]), 160);
  });

  it('falls back after void and ignores pending receipts', () => {
    assert.equal(deriveLatestConfirmedCost([
      candidate({ receiptItemId: 'latest', receivedBusinessDate: '2026-07-22', actualUnitCost: 160, voided: true }),
      candidate({ receiptItemId: 'pending', receivedBusinessDate: '2026-07-21', actualUnitCost: null, priceStatus: 'pending' }),
      candidate({ receiptItemId: 'previous', actualUnitCost: 150 }),
    ]), 150);
  });

  it('uses timestamp then receipt item id as deterministic tie breakers across POs', () => {
    assert.equal(deriveLatestConfirmedCost([
      candidate({ receiptItemId: 'a', receivedAt: '2026-07-20T11:00:00Z', actualUnitCost: 151 }),
      candidate({ receiptItemId: 'b', receivedAt: '2026-07-20T12:00:00Z', actualUnitCost: 152 }),
    ]), 152);
    assert.equal(deriveLatestConfirmedCost([
      candidate({ receiptItemId: 'a', actualUnitCost: 151 }),
      candidate({ receiptItemId: 'b', actualUnitCost: 152 }),
    ]), 152);
  });
});

describe('Phase 17A.1 receipt financial truth', () => {
  it('totals 12 x 150 plus 8 x 158 at receipt level', () => {
    const result = calculateReceiptFinancialSummary([
      { normalizedQuantity: 12, priceStatus: 'confirmed', actualUnitCost: 150, estimatedUnitCost: null },
      { normalizedQuantity: 8, priceStatus: 'confirmed', actualUnitCost: 158, estimatedUnitCost: null },
    ], 0);
    assert.equal(result.confirmedSubtotal, 3064);
    assert.equal(result.priceStatus, 'confirmed');
  });

  it('derives mixed confirmed, estimated and pending state without stale header flags', () => {
    const result = calculateReceiptFinancialSummary([
      { normalizedQuantity: 2, priceStatus: 'confirmed', actualUnitCost: 100, estimatedUnitCost: null },
      { normalizedQuantity: 3, priceStatus: 'estimated', actualUnitCost: null, estimatedUnitCost: 90 },
      { normalizedQuantity: 1, priceStatus: 'pending', actualUnitCost: null, estimatedUnitCost: null },
    ], 7);
    assert.equal(result.confirmedSubtotal, 200);
    assert.equal(result.estimatedSubtotal, 270);
    assert.equal(result.pendingItemCount, 1);
    assert.equal(result.priceStatus, 'pending');
    assert.equal(result.hasPendingPrices, true);
  });

  it('drops a voided receipt when callers recompute from valid lines', () => {
    const before = calculateReceiptFinancialSummary([
      { normalizedQuantity: 12, priceStatus: 'confirmed', actualUnitCost: 150, estimatedUnitCost: null },
      { normalizedQuantity: 8, priceStatus: 'confirmed', actualUnitCost: 158, estimatedUnitCost: null },
    ], 0);
    const after = calculateReceiptFinancialSummary([
      { normalizedQuantity: 12, priceStatus: 'confirmed', actualUnitCost: 150, estimatedUnitCost: null },
    ], 0);
    assert.equal(before.confirmedSubtotal, 3064);
    assert.equal(after.confirmedSubtotal, 1800);
  });
});

describe('Phase 17A.1 normal PO planning-price semantics', () => {
  it('never treats a planning-only price as receipt-confirmed', () => {
    assert.equal(normalizePlanningPriceStatus('pending'), 'pending');
    assert.equal(normalizePlanningPriceStatus('estimated'), 'estimated');
    assert.equal(normalizePlanningPriceStatus('confirmed'), 'estimated');
  });
});

describe('Phase 17A.1 quantity conversion and stock semantics', () => {
  it('normalizes 2 packs x 5 kg once and supports partial/decimal conversion', () => {
    assert.equal(normalizePurchaseQuantity(2, 5), 10);
    assert.equal(normalizePurchaseQuantity(1, 5) + normalizePurchaseQuantity(1, 5), 10);
    assert.equal(normalizePurchaseQuantity(2.5, 0.4), 1);
  });

  it('rejects zero and negative conversion factors', () => {
    assert.throws(() => normalizePurchaseQuantity(2, 0), /CONVERSION_FACTOR/);
    assert.throws(() => normalizePurchaseQuantity(2, -1), /CONVERSION_FACTOR/);
  });

  it('calculates the exact waste/outbound case without double subtraction', () => {
    const result = calculatePhysicalStockUsage({
      openingQuantity: 30,
      regularReceived: 12,
      emergencyReceived: 5,
      positiveAdjustment: 0,
      physicalClosingQuantity: 10,
      recordedWaste: 2,
      otherOutboundAdjustment: 1,
    });
    assert.equal(result.totalStockDepletion, 37);
    assert.equal(result.estimatedOperationalUsage, 34);
  });
});

describe('Phase 17A.1 reorder policy', () => {
  it('subtracts on-time incoming but reports delayed incoming separately', () => {
    assert.deepEqual(calculateReorderBreakdown({
      physicalStock: 10,
      parLevel: 30,
      minimumStock: 15,
      onTimeIncoming: 8,
      delayedIncoming: 7,
    }), { target: 30, guaranteedIncoming: 8, delayedIncoming: 7, recommendedQuantity: 12 });
  });

  it('supports no PO, delayed-only PO, and par fallback to minimum stock', () => {
    assert.equal(calculateReorderBreakdown({ physicalStock: 10, parLevel: 30, minimumStock: 15, onTimeIncoming: 0, delayedIncoming: 0 }).recommendedQuantity, 20);
    assert.equal(calculateReorderBreakdown({ physicalStock: 10, parLevel: 30, minimumStock: 15, onTimeIncoming: 0, delayedIncoming: 8 }).recommendedQuantity, 20);
    assert.equal(calculateReorderBreakdown({ physicalStock: 10, parLevel: 0, minimumStock: 15, onTimeIncoming: 2, delayedIncoming: 0 }).recommendedQuantity, 3);
  });
});

describe('Phase 17A.1 migration fixture semantics', () => {
  it('maps null and zero planning prices to pending and positive planning to estimated', () => {
    assert.equal(classifyLegacyPlanningPrice(null), 'pending');
    assert.equal(classifyLegacyPlanningPrice(0), 'pending');
    assert.equal(classifyLegacyPlanningPrice(50), 'estimated');
  });

  it('confirms only proven positive receipt actual cost', () => {
    assert.equal(classifyLegacyReceiptPrice({ actualUnitCost: 50, estimatedUnitCost: 45 }), 'confirmed');
    assert.equal(classifyLegacyReceiptPrice({ actualUnitCost: 0, estimatedUnitCost: 45 }), 'estimated');
    assert.equal(classifyLegacyReceiptPrice({ actualUnitCost: null, estimatedUnitCost: null }), 'pending');
  });

  it('derives partial/cancelled/received PO price state from valid receipt and remaining-item truth', () => {
    assert.equal(deriveLegacyHeaderPriceStatus({ receiptStatuses: ['confirmed'], remainingItemStatuses: ['pending'] }), 'pending');
    assert.equal(deriveLegacyHeaderPriceStatus({ receiptStatuses: ['confirmed'], remainingItemStatuses: ['estimated'] }), 'estimated');
    assert.equal(deriveLegacyHeaderPriceStatus({ receiptStatuses: ['confirmed', 'confirmed'], remainingItemStatuses: [] }), 'confirmed');
  });
});