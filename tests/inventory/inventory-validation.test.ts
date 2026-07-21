import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPurchaseOrderSchema,
  emergencyPurchaseSchema,
  receivePurchaseOrderSchema,
  saveStockCountSchema,
} from '../../lib/validations/inventory';

const ingredientId = '11111111-1111-4111-8111-111111111111';
const supplierId = '22222222-2222-4222-8222-222222222222';
const poId = '33333333-3333-4333-8333-333333333333';
const poItemId = '44444444-4444-4444-8444-444444444444';

describe('stock count zero versus uncounted contract', () => {
  it('accepts an explicit counted zero', () => {
    const result = saveStockCountSchema.safeParse({
      countDate: '2026-07-21',
      asDraft: false,
      items: [{
        ingredientId,
        openingBalance: 5,
        receivedQty: 0,
        regularReceivedQty: 0,
        emergencyReceivedQty: 0,
        physicalCount: 0,
        isCounted: true,
        unit: 'kg',
      }],
    });
    assert.equal(result.success, true);
  });

  it('accepts null only as the explicit uncounted state for a draft payload', () => {
    const result = saveStockCountSchema.safeParse({
      countDate: '2026-07-21',
      asDraft: true,
      items: [{
        ingredientId,
        openingBalance: 5,
        receivedQty: 0,
        physicalCount: null,
        isCounted: false,
        unit: 'kg',
      }],
    });
    assert.equal(result.success, true);
  });
});

describe('flexible PO price validation', () => {
  const base = {
    supplierId,
    orderDate: '2026-07-21',
    vatRate: 7,
    hasTaxInvoice: false,
  };

  it('accepts pending price with null unit cost', () => {
    assert.equal(createPurchaseOrderSchema.safeParse({
      ...base,
      items: [{ ingredientId, quantity: 2, unit: 'kg', priceStatus: 'pending', unitCost: null }],
    }).success, true);
  });

  it('rejects estimated price without a planning cost', () => {
    assert.equal(createPurchaseOrderSchema.safeParse({
      ...base,
      items: [{ ingredientId, quantity: 2, unit: 'kg', priceStatus: 'estimated', unitCost: null }],
    }).success, false);
  });

  it('rejects a confirmed zero price', () => {
    assert.equal(createPurchaseOrderSchema.safeParse({
      ...base,
      items: [{ ingredientId, quantity: 2, unit: 'kg', priceStatus: 'confirmed', unitCost: 0 }],
    }).success, false);
  });
});

describe('idempotent receipt input contract', () => {
  const baseReceipt = {
    id: poId,
    receivedDate: '2026-07-21',
    hasTaxInvoice: false,
    isPartial: false,
    overReceiveConfirmed: false,
    items: [{
      id: poItemId,
      receivedQuantity: 1,
      discrepancyType: 'none',
      priceStatus: 'pending',
      actualUnitCost: null,
    }],
  };

  it('requires a non-trivial idempotency key', () => {
    assert.equal(receivePurchaseOrderSchema.safeParse({
      ...baseReceipt,
      idempotencyKey: 'short',
    }).success, false);
  });

  it('accepts a UUID idempotency key and pending receipt price', () => {
    assert.equal(receivePurchaseOrderSchema.safeParse({
      ...baseReceipt,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    }).success, true);
  });
});

describe('emergency purchase evidence contract', () => {
  const base = {
    businessDate: '2026-07-21',
    vendorName: 'ตลาดสด',
    reason: 'ของขาดระหว่างวัน',
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
  };

  it('accepts a pending-price emergency purchase with unit conversion', () => {
    assert.equal(emergencyPurchaseSchema.safeParse({
      ...base,
      items: [{
        ingredientId,
        quantity: 2,
        unit: 'kg',
        purchaseUnit: 'ถุง',
        conversion: 5,
        priceStatus: 'pending',
        actualUnitCost: null,
      }],
    }).success, true);
  });

  it('rejects confirmed emergency purchase without actual price', () => {
    assert.equal(emergencyPurchaseSchema.safeParse({
      ...base,
      items: [{
        ingredientId,
        quantity: 2,
        unit: 'kg',
        conversion: 1,
        priceStatus: 'confirmed',
        actualUnitCost: null,
      }],
    }).success, false);
  });
});
