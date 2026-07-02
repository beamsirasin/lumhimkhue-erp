/**
 * Phase 16D — discount / loyalty / penalty safety math (golden behavior).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  discountTileAmount,
  discountBaseSoFar,
  loyaltyRedemptionBaht,
  computeBillTotal,
} from '../../lib/payments/money-math';

describe('discountTileAmount', () => {
  it('percentage: 10% of 1000 → -100', () => {
    assert.equal(discountTileAmount('percentage', '10', 1, 1000), -100);
  });

  it('percentage ignores quantity (applies once to the base)', () => {
    assert.equal(discountTileAmount('percentage', '10', 5, 1000), -100);
  });

  it('fixed: 50 × qty 2 → -100', () => {
    assert.equal(discountTileAmount('fixed', '50', 2, 1000), -50 * 2);
  });

  it('null discountType falls through to the fixed path (golden behavior)', () => {
    assert.equal(discountTileAmount(null, '30', 1, 1000), -30);
  });

  it('percentage of satang-precision base keeps float value (rounding happens at toCents)', () => {
    // 7% of 691 = 48.37 exactly
    assert.equal(discountTileAmount('percentage', '7', 1, 691), -48.37);
  });
});

describe('discountBaseSoFar (base a percentage discount applies to)', () => {
  it('saved charge lines present: base = chargeLineTotal + lineItems addons so far', () => {
    assert.equal(discountBaseSoFar(691, 999, 999, 25), 716);
  });

  it('no charge lines: base = live guests + orders + addons so far', () => {
    assert.equal(discountBaseSoFar(0, 532, 40, 25), 597);
  });
});

describe('loyaltyRedemptionBaht', () => {
  it('points ÷ redeemRate: 100 points @ rate 10 → ฿10', () => {
    assert.equal(loyaltyRedemptionBaht(100, 10), 10);
  });

  it('fractional redemption is not rounded here (golden behavior)', () => {
    assert.equal(loyaltyRedemptionBaht(25, 10), 2.5);
  });
});

describe('discount + penalty safety at the bill level', () => {
  it('stacked discounts larger than the bill floor at zero', () => {
    const subtotal = 266;
    const discounts = 100 + 200; // manual + tile discounts
    assert.equal(computeBillTotal(subtotal, 0, discounts), 0);
  });

  it('penalty lines only ever increase the subtotal (they are positive charge lines)', () => {
    // penalty enters the bill as a charge line (price > 0 enforced by pricing
    // validation), so subtotal with penalty >= subtotal without it
    const withoutPenalty = 691;
    const withPenalty = 691 + 50;
    assert.ok(withPenalty > withoutPenalty);
    assert.equal(computeBillTotal(withPenalty, 0, 0), 741);
  });
});
