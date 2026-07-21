import { it } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePhysicalStockUsage } from '../../lib/inventory/procurement-math';

it('Test 8: opening 30 + regular 12 + emergency 5 - closing 10 = depletion 37', () => {
  const result = calculatePhysicalStockUsage({
    openingQuantity: 30,
    regularReceived: 12,
    emergencyReceived: 5,
    positiveAdjustment: 0,
    physicalClosingQuantity: 10,
    recordedWaste: 0,
    otherOutboundAdjustment: 0,
  });
  assert.equal(result.totalStockDepletion, 37);
  assert.equal(result.estimatedOperationalUsage, 37);
});
