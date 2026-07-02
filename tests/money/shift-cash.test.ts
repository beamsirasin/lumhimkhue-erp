/**
 * Phase 16D — cashier shift expected-cash math (golden behavior of
 * computeShiftCashSummary from closeShift).
 *
 * Note: WHICH rows count as cash (completed cash-type payment_rows linked to
 * the shift) is decided by SQL in closeShift and is NOT covered here — only
 * the pure formula is. Non-cash exclusion and null-shift rows are validated
 * operationally by reconciliation checks R7a/R7b.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeShiftCashSummary } from '../../lib/payments/money-math';

describe('computeShiftCashSummary', () => {
  it('expected = opening float + cash rows; balanced drawer → difference 0', () => {
    const r = computeShiftCashSummary(1000, 5000, 6000);
    assert.equal(r.expectedCash, 6000);
    assert.equal(r.cashDifference, 0);
  });

  it('drawer over → positive difference', () => {
    const r = computeShiftCashSummary(1000, 5000, 6050);
    assert.equal(r.cashDifference, 50);
  });

  it('drawer short → negative difference', () => {
    const r = computeShiftCashSummary(1000, 5000, 5900);
    assert.equal(r.cashDifference, -100);
  });

  it('no cash payments in the shift → expected is just the float', () => {
    const r = computeShiftCashSummary(1500, 0, 1500);
    assert.equal(r.expectedCash, 1500);
    assert.equal(r.cashDifference, 0);
  });

  it('opening float arrives as a numeric string from the DB', () => {
    const r = computeShiftCashSummary('1000.00', 532, 1532);
    assert.equal(r.expectedCash, 1532);
    assert.equal(r.cashDifference, 0);
  });

  it('cash rows total is the net drawer contribution (amount = tendered − change), e.g. ฿200 net from ฿500 tendered', () => {
    // payment_rows.amount already stores the net bill-share for cash rows,
    // so change never double-counts (documented in closeShift).
    const r = computeShiftCashSummary(1000, 200, 1200);
    assert.equal(r.cashDifference, 0);
  });
});
