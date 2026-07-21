import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePhysicalStockUsage,
  calculatePriceVariance,
  calculatePurchaseTotals,
  calculateReorderQuantity,
  deriveDeliveryState,
  resolvePlanningUnitCost,
} from '../../lib/inventory/procurement-math';

describe('Phase 17A purchase price truth', () => {
  it('does not turn a pending supplier price into a fake zero-price line', () => {
    assert.equal(resolvePlanningUnitCost({
      quantity: 10,
      priceStatus: 'pending',
      estimatedUnitCost: 0,
      confirmedUnitCost: 0,
    }), null);
  });

  it('marks a mixed priced/pending PO as a partial estimate', () => {
    const totals = calculatePurchaseTotals([
      { quantity: 2, priceStatus: 'estimated', estimatedUnitCost: 50 },
      { quantity: 3, priceStatus: 'pending' },
    ], 7);
    assert.deepEqual(totals, {
      priceStatus: 'pending',
      pricedItemCount: 1,
      pendingItemCount: 1,
      subtotal: 100,
      vatAmount: 7,
      total: 107,
      isPartialEstimate: true,
    });
  });

  it('uses confirmed prices for a final PO total', () => {
    const totals = calculatePurchaseTotals([
      { quantity: 2, priceStatus: 'confirmed', confirmedUnitCost: 49.5 },
      { quantity: 1, priceStatus: 'confirmed', confirmedUnitCost: 100 },
    ], 7);
    assert.equal(totals.priceStatus, 'confirmed');
    assert.equal(totals.subtotal, 199);
    assert.equal(totals.total, 212.93);
  });

  it('calculates price variance against the receipt estimate', () => {
    assert.deepEqual(calculatePriceVariance(80, 100), { amount: 20, percentage: 25 });
    assert.deepEqual(calculatePriceVariance(null, 100), { amount: null, percentage: null });
  });
});

describe('Phase 17A daily physical stock truth', () => {
  it('calculates physical depletion from opening + both receipt types + positive adjustment - closing', () => {
    const result = calculatePhysicalStockUsage({
      openingQuantity: 100,
      regularReceived: 20,
      emergencyReceived: 5,
      positiveAdjustment: 2,
      physicalClosingQuantity: 67,
      recordedWaste: 4,
      otherOutboundAdjustment: 3,
    });
    assert.equal(result.totalStockDepletion, 60);
    assert.equal(result.estimatedOperationalUsage, 53);
  });

  it('keeps explicit zero closing stock as a real count', () => {
    const result = calculatePhysicalStockUsage({
      openingQuantity: 10,
      regularReceived: 0,
      emergencyReceived: 0,
      positiveAdjustment: 0,
      physicalClosingQuantity: 0,
      recordedWaste: 0,
      otherOutboundAdjustment: 0,
    });
    assert.equal(result.totalStockDepletion, 10);
  });

  it('flags impossible negative depletion instead of silently clamping it', () => {
    const result = calculatePhysicalStockUsage({
      openingQuantity: 5,
      regularReceived: 0,
      emergencyReceived: 0,
      positiveAdjustment: 0,
      physicalClosingQuantity: 8,
      recordedWaste: 0,
      otherOutboundAdjustment: 0,
    });
    assert.equal(result.totalStockDepletion, -3);
    assert.equal(result.hasNegativeDepletion, true);
  });
});

describe('Phase 17A reorder and delivery state', () => {
  it('subtracts open PO remaining quantity from reorder advice', () => {
    assert.equal(calculateReorderQuantity(10, 30, 15, 8), 12);
  });

  it('never recommends a negative reorder quantity', () => {
    assert.equal(calculateReorderQuantity(25, 30, 15, 10), 0);
  });

  it('marks an overdue PO with remaining quantity as delayed', () => {
    const result = deriveDeliveryState({
      expectedDate: '2026-07-18',
      asOfDate: '2026-07-21',
      orderedQuantity: 20,
      receivedQuantity: 5,
      status: 'partial_received',
    });
    assert.deepEqual(result, { remainingQuantity: 15, isDelayed: true, delayedDays: 3 });
  });

  it('does not mark completed or cancelled orders as delayed', () => {
    for (const status of ['received', 'cancelled']) {
      assert.equal(deriveDeliveryState({
        expectedDate: '2026-07-01',
        asOfDate: '2026-07-21',
        orderedQuantity: 20,
        receivedQuantity: 0,
        status,
      }).isDelayed, false);
    }
  });
});
