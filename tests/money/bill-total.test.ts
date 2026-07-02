/**
 * Phase 16D — bill total / charge line math (golden behavior of
 * lib/payments/money-math.ts as used by processPayment and session flows).
 * Runner: node:test via tsx — `npm run test:money`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCanonicalSubtotal,
  computeBillTotal,
  chargeLineTotal,
  addonLineAmount,
} from '../../lib/payments/money-math';

describe('resolveCanonicalSubtotal', () => {
  it('uses saved charge-line total when present (authoritative)', () => {
    // 2 adults (266) + 1 child (159) saved as charge lines = 691
    assert.equal(resolveCanonicalSubtotal(691, 999, 999, 999), 691);
  });

  it('falls back to base + extra + addons for legacy sessions without charge lines', () => {
    assert.equal(resolveCanonicalSubtotal(0, 532, 40, 25), 597);
  });

  it('treats zero charge-line total as absent (fallback path)', () => {
    assert.equal(resolveCanonicalSubtotal(0, 266, 0, 0), 266);
  });
});

describe('computeBillTotal', () => {
  it('subtotal minus discount', () => {
    assert.equal(computeBillTotal(691, 0, 91), 600);
  });

  it('service charge is additive (currently always 0 in POS)', () => {
    assert.equal(computeBillTotal(600, 30, 0), 630);
  });

  it('floors at zero — a discount can never produce a negative bill', () => {
    assert.equal(computeBillTotal(266, 0, 500), 0);
  });

  it('exact-discount bill is zero, not negative zero weirdness', () => {
    assert.equal(computeBillTotal(266, 0, 266), 0);
  });
});

describe('chargeLineTotal (unitPrice × qty → numeric-column string)', () => {
  it('adult 266 × 2 = "532.00"', () => {
    assert.equal(chargeLineTotal(266, 2), '532.00');
  });

  it('child 159 × 3 = "477.00"', () => {
    assert.equal(chargeLineTotal(159, 3), '477.00');
  });

  it('free tile (small child / staff, price 0) contributes "0.00"', () => {
    assert.equal(chargeLineTotal(0, 4), '0.00');
  });

  it('penalty (ค่าปรับ) is a positive add-only line, e.g. 50 × 1 = "50.00"', () => {
    assert.equal(chargeLineTotal(50, 1), '50.00');
  });

  it('accepts numeric strings from the DB (numeric columns come back as strings)', () => {
    assert.equal(chargeLineTotal('266.00', 2), '532.00');
  });

  it('keeps satang precision', () => {
    assert.equal(chargeLineTotal('12.25', 3), '36.75');
  });
});

describe('addonLineAmount', () => {
  it('live tile price × quantity', () => {
    assert.equal(addonLineAmount('25.00', 3), 75);
  });

  it('zero quantity yields zero', () => {
    assert.equal(addonLineAmount('25.00', 0), 0);
  });
});
