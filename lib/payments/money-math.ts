/**
 * Phase 16D — pure money math for the POS/payment/session/shift flows.
 *
 * Every function here is a GOLDEN-BEHAVIOR extraction: the logic (including
 * error strings, rounding, and edge-case handling) is copied exactly from its
 * original call site and locked in by tests/money/*. Do not "improve" formulas
 * here without an explicit approved phase — the runtime actions import these.
 *
 * Origins:
 *  - toCents/fromCents, subtotal/bill-total/discount/settlement guards → lib/actions/pos.ts
 *  - checkoutRowTenderError → lib/payments/foundation.ts (validateCheckoutPaymentRowsForTotal)
 *  - chargeLineTotal → lib/actions/sessions.ts (openSession / updateSessionGuests)
 *  - computeShiftCashSummary → lib/actions/shifts.ts (closeShift)
 */

/** Baht → integer satang cents. Golden: Math.round(Number(value ?? 0) * 100). */
export function toCents(value: number | string | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

/** Integer satang cents → baht. */
export function fromCents(value: number) {
  return value / 100;
}

/** Addon line amount at checkout: live tile price × quantity. */
export function addonLineAmount(tilePrice: number | string, quantity: number): number {
  return Number(tilePrice) * quantity;
}

/**
 * Discount tile amount (always ≤ 0).
 * percentage → % of subtotalSoFar; anything else (fixed / null) → value × quantity.
 */
export function discountTileAmount(
  discountType: string | null,
  discountValue: number | string | null,
  quantity: number,
  subtotalSoFar: number,
): number {
  if (discountType === 'percentage') {
    return -(subtotalSoFar * Number(discountValue) / 100);
  }
  return -(Number(discountValue) * quantity);
}

/** Loyalty redemption: baht discount = points ÷ redeem rate. */
export function loyaltyRedemptionBaht(pointsToRedeem: number, redeemRate: number): number {
  return pointsToRedeem / redeemRate;
}

/**
 * Base amount a percentage discount applies to at the time the discount line is
 * processed: the saved charge-line total when present (it already includes saved
 * addon lines), else live guest+order pricing — plus lineItems addons accumulated
 * so far in the checkout request.
 */
export function discountBaseSoFar(
  savedChargeLineTotal: number,
  baseAmount: number,
  extraAmount: number,
  addonTotalSoFar: number,
): number {
  return (savedChargeLineTotal > 0 ? savedChargeLineTotal : baseAmount + extraAmount) + addonTotalSoFar;
}

/** Canonical pre-discount subtotal — saved charge lines are authoritative when present. */
export function resolveCanonicalSubtotal(
  savedChargeLineTotal: number,
  baseAmount: number,
  extraAmount: number,
  addonTotal: number,
): number {
  return savedChargeLineTotal > 0 ? savedChargeLineTotal : baseAmount + extraAmount + addonTotal;
}

/** Bill total is floored at zero — a discount can never produce a negative bill. */
export function computeBillTotal(subtotal: number, serviceCharge: number, discountAmount: number): number {
  return Math.max(0, subtotal + serviceCharge - discountAmount);
}

/**
 * Guards comparing prior payments against the (possibly re-discounted) bill.
 * Returns the Thai error to show, or null when a payment may proceed.
 */
export function paidBeforeError(paidBeforeCents: number, billTotalCents: number): string | null {
  if (paidBeforeCents > billTotalCents) {
    return 'ยอดบิลต่ำกว่ายอดที่ชำระไปแล้ว กรุณาตรวจสอบส่วนลดหรือรายการก่อนรับชำระเพิ่ม';
  }
  if (billTotalCents - paidBeforeCents <= 0) {
    return 'บิลนี้ชำระครบแล้ว';
  }
  return null;
}

/**
 * Settlement amount rules:
 *  - amount must be positive and never exceed the remaining balance
 *  - partial must be strictly less than remaining
 *  - final must equal remaining exactly
 */
export function settlementAmountError(
  settlementMode: 'partial' | 'final',
  paidThisTimeCents: number,
  remainingBeforeCents: number,
): string | null {
  if (paidThisTimeCents <= 0) return 'ยอดชำระต้องมากกว่า 0';
  if (paidThisTimeCents > remainingBeforeCents) return 'ยอดชำระมากกว่ายอดคงเหลือ';
  if (settlementMode === 'partial' && paidThisTimeCents >= remainingBeforeCents) {
    return 'ยอดชำระบางส่วนต้องน้อยกว่ายอดคงเหลือ';
  }
  if (settlementMode === 'final' && paidThisTimeCents !== remainingBeforeCents) {
    return 'ยอดปิดบิลต้องเท่ากับยอดคงเหลือ';
  }
  return null;
}

/** Legacy (no payment rows) cash change: received − paid for cash, 0 otherwise. */
export function legacyCashChange(paymentMethod: string, receivedAmount: number, paidThisTime: number): number {
  return paymentMethod === 'cash' ? receivedAmount - paidThisTime : 0;
}

/**
 * Cash / non-cash tender rules for one checkout payment row.
 * English messages preserved exactly from validateCheckoutPaymentRowsForTotal.
 */
export function checkoutRowTenderError(
  methodType: string,
  amountCents: number,
  tenderedCents: number | null,
  changeCents: number,
): string | null {
  if (methodType === 'cash') {
    if (tenderedCents == null || tenderedCents < amountCents) {
      return 'Cash tendered must be greater than or equal to the cash amount';
    }
    if (changeCents !== tenderedCents - amountCents) {
      return 'Cash change must equal tendered minus amount';
    }
  } else {
    if (changeCents !== 0) return 'Non-cash payment rows cannot have change';
    if (tenderedCents != null && tenderedCents !== amountCents) {
      return 'Non-cash tendered amount must equal the row amount';
    }
  }
  return null;
}

/** Charge-line total as the satang-precision string stored in numeric columns. */
export function chargeLineTotal(unitPrice: number | string, quantity: number): string {
  return (Number(unitPrice) * quantity).toFixed(2);
}

/** Shift cash: expected = opening float + completed cash rows; difference = actual − expected. */
export function computeShiftCashSummary(
  openingFloat: number | string,
  cashRowsTotal: number,
  actualCash: number,
): { expectedCash: number; cashDifference: number } {
  const expectedCash = Number(openingFloat) + cashRowsTotal;
  const cashDifference = actualCash - expectedCash;
  return { expectedCash, cashDifference };
}
