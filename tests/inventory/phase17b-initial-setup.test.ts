import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialSetupItemValues,
  evaluateInitialSetupGate,
  isCountedValue,
} from '../../lib/inventory/initial-setup';
import { calculatePhysicalStockUsage } from '../../lib/inventory/procurement-math';

describe('Phase 17B — initial setup semantics (Scenario A)', () => {
  it('quantity_on_hand = physical count with zero movement/usage', () => {
    const values = buildInitialSetupItemValues(25);
    assert.equal(values.quantityOnHand, 25);
    assert.equal(values.openingBalance, 0);
    assert.equal(values.regularReceivedQty, 0);
    assert.equal(values.emergencyReceivedQty, 0);
    assert.equal(values.positiveAdjustmentQty, 0);
    assert.equal(values.recordedWasteQty, 0);
    assert.equal(values.otherOutboundQty, 0);
    assert.equal(values.totalDepletionQty, 0);
    assert.equal(values.estimatedOperationalUsageQty, 0);
  });

  it('does not manufacture usage on the day the system is switched on', () => {
    // Guard: an initial setup must never be computed like a daily count, which
    // (opening 0 → closing 25) would report a fake -25 usage.
    const values = buildInitialSetupItemValues(25);
    assert.equal(values.totalDepletionQty, 0);
    assert.equal(values.estimatedOperationalUsageQty, 0);
  });

  it('a zero physical count is a real "none on hand", not uncounted', () => {
    const values = buildInitialSetupItemValues(0);
    assert.equal(values.quantityOnHand, 0);
    assert.equal(isCountedValue(0), true);
    assert.equal(isCountedValue(null), false);
    assert.equal(isCountedValue(undefined), false);
  });
});

describe('Phase 17B — initial setup gate (one reviewed setup per branch)', () => {
  it('allows creating when nothing exists yet', () => {
    const gate = evaluateInitialSetupGate({ hasReviewedCount: false, existingSetupStatus: null });
    assert.equal(gate.allowed, true);
    assert.equal(gate.mode, 'create');
  });

  it('allows editing a draft setup', () => {
    const gate = evaluateInitialSetupGate({ hasReviewedCount: false, existingSetupStatus: 'draft' });
    assert.equal(gate.allowed, true);
    assert.equal(gate.mode, 'edit');
  });

  it('blocks a second setup once a reviewed setup exists', () => {
    const gate = evaluateInitialSetupGate({ hasReviewedCount: false, existingSetupStatus: 'reviewed' });
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'already_reviewed');
  });

  it('blocks onboarding once any reviewed daily count exists', () => {
    const gate = evaluateInitialSetupGate({ hasReviewedCount: true, existingSetupStatus: null });
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'already_reviewed');
  });
});

describe('Phase 17B — first daily count after setup (Scenario B)', () => {
  it('opening 25, receipt 0, closing 18, waste 0 → depletion 7, usage 7', () => {
    const usage = calculatePhysicalStockUsage({
      openingQuantity: 25,
      regularReceived: 0,
      emergencyReceived: 0,
      positiveAdjustment: 0,
      physicalClosingQuantity: 18,
      recordedWaste: 0,
      otherOutboundAdjustment: 0,
    });
    assert.equal(usage.totalStockDepletion, 7);
    assert.equal(usage.estimatedOperationalUsage, 7);
  });
});

describe('Phase 17B — second daily count with receipt + waste (Scenario G)', () => {
  it('opening 18, regular 15, closing 12, waste 2 → depletion 21, usage 19', () => {
    const usage = calculatePhysicalStockUsage({
      openingQuantity: 18,
      regularReceived: 15,
      emergencyReceived: 0,
      positiveAdjustment: 0,
      physicalClosingQuantity: 12,
      recordedWaste: 2,
      otherOutboundAdjustment: 0,
    });
    assert.equal(usage.totalStockDepletion, 21);
    assert.equal(usage.estimatedOperationalUsage, 19);
  });
});
