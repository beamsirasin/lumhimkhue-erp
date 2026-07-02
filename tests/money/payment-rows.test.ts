/**
 * Phase 16D — split tender / payment row math (golden behavior of
 * checkoutRowTenderError, extracted from validateCheckoutPaymentRowsForTotal,
 * plus toCents/fromCents used across the money path).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutRowTenderError, toCents, fromCents } from '../../lib/payments/money-math';

describe('toCents / fromCents', () => {
  it('round-trips whole baht', () => {
    assert.equal(toCents(266), 26600);
    assert.equal(fromCents(26600), 266);
  });

  it('handles satang', () => {
    assert.equal(toCents(48.37), 4837);
    assert.equal(fromCents(4837), 48.37);
  });

  it('absorbs float artifacts (0.1 + 0.2)', () => {
    assert.equal(toCents(0.1 + 0.2), 30);
  });

  it('accepts numeric strings and null/undefined (DB numeric columns)', () => {
    assert.equal(toCents('266.00'), 26600);
    assert.equal(toCents(null), 0);
    assert.equal(toCents(undefined), 0);
  });
});

describe('checkoutRowTenderError — cash rows', () => {
  it('exact cash: tendered == amount, change 0 → valid', () => {
    assert.equal(checkoutRowTenderError('cash', 60000, 60000, 0), null);
  });

  it('cash overpay with correct change → valid (e.g. bill 600, tendered 1000, change 400)', () => {
    assert.equal(checkoutRowTenderError('cash', 60000, 100000, 40000), null);
  });

  it('cash tendered below amount → rejected', () => {
    assert.equal(
      checkoutRowTenderError('cash', 60000, 50000, 0),
      'Cash tendered must be greater than or equal to the cash amount',
    );
  });

  it('cash without tendered → rejected', () => {
    assert.equal(
      checkoutRowTenderError('cash', 60000, null, 0),
      'Cash tendered must be greater than or equal to the cash amount',
    );
  });

  it('cash with wrong change → rejected', () => {
    assert.equal(
      checkoutRowTenderError('cash', 60000, 100000, 30000),
      'Cash change must equal tendered minus amount',
    );
  });
});

describe('checkoutRowTenderError — non-cash rows (QR / welfare / transfer)', () => {
  it('QR row with no tendered and no change → valid', () => {
    assert.equal(checkoutRowTenderError('promptpay', 40000, null, 0), null);
  });

  it('welfare row behaves like non-cash → valid without change', () => {
    assert.equal(checkoutRowTenderError('welfare', 30000, null, 0), null);
  });

  it('non-cash must not carry change (no cash-change behavior)', () => {
    assert.equal(
      checkoutRowTenderError('promptpay', 40000, null, 100),
      'Non-cash payment rows cannot have change',
    );
  });

  it('non-cash tendered, when sent, must equal the amount', () => {
    assert.equal(
      checkoutRowTenderError('promptpay', 40000, 50000, 0),
      'Non-cash tendered amount must equal the row amount',
    );
    assert.equal(checkoutRowTenderError('promptpay', 40000, 40000, 0), null);
  });
});

describe('split tender sums (QR + cash on one bill)', () => {
  it('rows summing exactly to the bill are the valid shape', () => {
    // Bill 600 = QR 400 + cash 200 (tendered 500, change 300)
    const rows = [
      { type: 'promptpay', amountCents: 40000, tenderedCents: null, changeCents: 0 },
      { type: 'cash', amountCents: 20000, tenderedCents: 50000, changeCents: 30000 },
    ];
    for (const r of rows) {
      assert.equal(checkoutRowTenderError(r.type, r.amountCents, r.tenderedCents, r.changeCents), null);
    }
    const sum = rows.reduce((s, r) => s + r.amountCents, 0);
    // validateCheckoutPaymentRowsForTotal enforces sum(rows) === total exactly
    assert.equal(sum, 60000);
  });
});
