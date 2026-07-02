/**
 * Phase 16D — remaining balance / partial vs final settlement rules
 * (golden behavior of paidBeforeError + settlementAmountError from processPayment).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  paidBeforeError,
  settlementAmountError,
  legacyCashChange,
} from '../../lib/payments/money-math';

describe('paidBeforeError (prior payments vs bill total)', () => {
  it('no previous payment → proceed', () => {
    assert.equal(paidBeforeError(0, 69100), null);
  });

  it('partial previously paid → proceed', () => {
    assert.equal(paidBeforeError(30000, 69100), null);
  });

  it('already fully paid → "บิลนี้ชำระครบแล้ว"', () => {
    assert.equal(paidBeforeError(69100, 69100), 'บิลนี้ชำระครบแล้ว');
  });

  it('paid exceeds bill (e.g. discount added after a payment) → bill-lower error', () => {
    assert.equal(
      paidBeforeError(69100, 60000),
      'ยอดบิลต่ำกว่ายอดที่ชำระไปแล้ว กรุณาตรวจสอบส่วนลดหรือรายการก่อนรับชำระเพิ่ม',
    );
  });
});

describe('settlementAmountError — final settlement', () => {
  it('final for exactly the remaining balance → valid', () => {
    assert.equal(settlementAmountError('final', 39100, 39100), null);
  });

  it('final short of remaining → rejected', () => {
    assert.equal(settlementAmountError('final', 30000, 39100), 'ยอดปิดบิลต้องเท่ากับยอดคงเหลือ');
  });

  it('paying more than remaining is always rejected (overpay prevention)', () => {
    assert.equal(settlementAmountError('final', 40000, 39100), 'ยอดชำระมากกว่ายอดคงเหลือ');
  });

  it('zero or negative amount is rejected', () => {
    assert.equal(settlementAmountError('final', 0, 39100), 'ยอดชำระต้องมากกว่า 0');
    assert.equal(settlementAmountError('final', -100, 39100), 'ยอดชำระต้องมากกว่า 0');
  });
});

describe('settlementAmountError — partial settlement (deposit)', () => {
  it('partial strictly below remaining → valid', () => {
    assert.equal(settlementAmountError('partial', 30000, 69100), null);
  });

  it('partial equal to remaining → rejected (must use final/close-all)', () => {
    assert.equal(settlementAmountError('partial', 69100, 69100), 'ยอดชำระบางส่วนต้องน้อยกว่ายอดคงเหลือ');
  });

  it('partial above remaining → overpay rejection wins', () => {
    assert.equal(settlementAmountError('partial', 70000, 69100), 'ยอดชำระมากกว่ายอดคงเหลือ');
  });

  it('final after a partial: remaining shrinks and final must match it exactly', () => {
    const billCents = 69100;
    const partialCents = 30000;
    assert.equal(settlementAmountError('partial', partialCents, billCents), null);
    const remainingAfterPartial = billCents - partialCents;
    assert.equal(settlementAmountError('final', remainingAfterPartial, remainingAfterPartial), null);
    assert.equal(
      settlementAmountError('final', remainingAfterPartial - 1, remainingAfterPartial),
      'ยอดปิดบิลต้องเท่ากับยอดคงเหลือ',
    );
  });
});

describe('legacyCashChange (no-payment-rows path)', () => {
  it('cash: change = received − paid', () => {
    assert.equal(legacyCashChange('cash', 1000, 691), 309);
  });

  it('non-cash methods never produce change', () => {
    assert.equal(legacyCashChange('qr_promptpay', 1000, 691), 0);
    assert.equal(legacyCashChange('cash_qr', 1000, 691), 0);
  });
});
