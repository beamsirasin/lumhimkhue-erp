import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReorderRecommendation,
  partitionReorderSelection,
  reorderGenerationKeyForSupplier,
  roundUpToPurchaseUnit,
  type ReorderSelectionLine,
} from '../../lib/inventory/reorder-recommendation';
import { normalizePurchaseQuantity } from '../../lib/inventory/procurement-integrity';

describe('Phase 17B — purchase-unit rounding', () => {
  it('rounds a partial purchase unit up so stock never lands below par', () => {
    // 12 kg short, 1 pack = 5 kg → 2.4 → 3 packs
    assert.equal(roundUpToPurchaseUnit(12, 5), 3);
  });

  it('does not push an exact multiple up by binary float error', () => {
    assert.equal(roundUpToPurchaseUnit(10, 5), 2);
    assert.equal(roundUpToPurchaseUnit(15, 5), 3);
    assert.equal(roundUpToPurchaseUnit(0.3, 0.1), 3);
  });

  it('needs at least one whole unit for any positive shortage', () => {
    assert.equal(roundUpToPurchaseUnit(1, 5), 1);
    assert.equal(roundUpToPurchaseUnit(0.01, 5), 1);
  });

  it('returns 0 for no shortage and throws on a bad conversion', () => {
    assert.equal(roundUpToPurchaseUnit(0, 5), 0);
    assert.equal(roundUpToPurchaseUnit(-4, 5), 0);
    assert.throws(() => roundUpToPurchaseUnit(5, 0), /CONVERSION_MUST_BE_POSITIVE/);
  });
});

describe('Phase 17B — reorder recommendation (Scenario C)', () => {
  it('physical 18, par 30, conversion 5 → 3 packs = 15 kg, projected 33', () => {
    const rec = buildReorderRecommendation({
      physicalStock: 18,
      parLevel: 30,
      minimumStock: 10,
      onTimeIncoming: 0,
      delayedIncoming: 0,
      conversion: 5,
      purchaseUnit: 'pack',
      stockUnit: 'kg',
    });
    assert.equal(rec.canRecommend, true);
    assert.equal(rec.shortageStockQty, 12);
    assert.equal(rec.recommendedPurchaseQty, 3);
    assert.equal(rec.normalizedStockQty, 15);
    assert.equal(rec.projectedStock, 33);
    assert.equal(rec.blockedReason, null);
  });
});

describe('Phase 17B — on-time vs delayed incoming (Scenario H)', () => {
  it('on-time PO reduces the need: physical 12, par 30, on-time 10 → shortage 8 → 2 packs', () => {
    const rec = buildReorderRecommendation({
      physicalStock: 12,
      parLevel: 30,
      minimumStock: 10,
      onTimeIncoming: 10,
      delayedIncoming: 0,
      conversion: 5,
      purchaseUnit: 'pack',
      stockUnit: 'kg',
    });
    assert.equal(rec.shortageStockQty, 8);
    assert.equal(rec.recommendedPurchaseQty, 2);
    assert.equal(rec.normalizedStockQty, 10);
    // physical 12 + on-time 10 + received 10 = 32
    assert.equal(rec.projectedStock, 32);
  });

  it('delayed incoming is shown separately and never subtracted: shortage stays 18 → 4 packs', () => {
    const rec = buildReorderRecommendation({
      physicalStock: 12,
      parLevel: 30,
      minimumStock: 10,
      onTimeIncoming: 0,
      delayedIncoming: 10,
      conversion: 5,
      purchaseUnit: 'pack',
      stockUnit: 'kg',
    });
    assert.equal(rec.shortageStockQty, 18);
    assert.equal(rec.delayedIncoming, 10);
    assert.equal(rec.recommendedPurchaseQty, 4);
    assert.equal(rec.normalizedStockQty, 20);
  });
});

describe('Phase 17B — recommendation edge cases', () => {
  it('blocks the recommendation when the conversion is missing/invalid', () => {
    for (const conversion of [null, undefined, 0, -1, Number.NaN]) {
      const rec = buildReorderRecommendation({
        physicalStock: 18,
        parLevel: 30,
        minimumStock: 10,
        onTimeIncoming: 0,
        delayedIncoming: 0,
        conversion,
        purchaseUnit: null,
        stockUnit: 'kg',
      });
      assert.equal(rec.canRecommend, false, `conversion=${String(conversion)}`);
      assert.equal(rec.blockedReason, 'missing_conversion');
      assert.equal(rec.recommendedPurchaseQty, 0);
      assert.equal(rec.normalizedStockQty, 0);
      // still surfaces the real stock shortage so the user can fix the unit
      assert.equal(rec.shortageStockQty, 12);
    }
  });

  it('falls back to minimum stock when par level is 0', () => {
    const rec = buildReorderRecommendation({
      physicalStock: 4,
      parLevel: 0,
      minimumStock: 10,
      onTimeIncoming: 0,
      delayedIncoming: 0,
      conversion: 1,
      purchaseUnit: 'kg',
      stockUnit: 'kg',
    });
    assert.equal(rec.target, 10);
    assert.equal(rec.shortageStockQty, 6);
    assert.equal(rec.recommendedPurchaseQty, 6);
  });

  it('a 1:1 stock/purchase unit is a valid recommendation', () => {
    const rec = buildReorderRecommendation({
      physicalStock: 18,
      parLevel: 30,
      minimumStock: 10,
      onTimeIncoming: 0,
      delayedIncoming: 0,
      conversion: 1,
      purchaseUnit: 'kg',
      stockUnit: 'kg',
    });
    assert.equal(rec.canRecommend, true);
    assert.equal(rec.recommendedPurchaseQty, 12);
    assert.equal(rec.projectedStock, 30);
  });
});

describe('Phase 17B — supplier grouping for draft generation', () => {
  const line = (over: Partial<ReorderSelectionLine>): ReorderSelectionLine => ({
    ingredientId: 'i',
    supplierId: 's1',
    purchaseQuantity: 3,
    conversion: 5,
    ...over,
  });

  it('groups selected lines by supplier deterministically', () => {
    const result = partitionReorderSelection([
      line({ ingredientId: 'a', supplierId: 's2' }),
      line({ ingredientId: 'b', supplierId: 's1' }),
      line({ ingredientId: 'c', supplierId: 's1' }),
    ]);
    assert.equal(result.groups.length, 2);
    assert.equal(result.groups[0].supplierId, 's1');
    assert.deepEqual(result.groups[0].lines.map((l) => l.ingredientId), ['b', 'c']);
    assert.equal(result.groups[1].supplierId, 's2');
    assert.equal(result.missingSupplier.length, 0);
  });

  it('separates lines with no supplier instead of guessing one', () => {
    const result = partitionReorderSelection([
      line({ ingredientId: 'a', supplierId: null }),
      line({ ingredientId: 'b', supplierId: 's1' }),
    ]);
    assert.equal(result.missingSupplier.length, 1);
    assert.equal(result.missingSupplier[0].ingredientId, 'a');
    assert.equal(result.groups.length, 1);
  });

  it('separates invalid conversion and non-positive quantity lines', () => {
    const result = partitionReorderSelection([
      line({ ingredientId: 'a', conversion: null }),
      line({ ingredientId: 'b', purchaseQuantity: 0 }),
      line({ ingredientId: 'c' }),
    ]);
    assert.deepEqual(result.invalidConversion.map((l) => l.ingredientId), ['a']);
    assert.deepEqual(result.invalidQuantity.map((l) => l.ingredientId), ['b']);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].lines[0].ingredientId, 'c');
  });
});

describe('Phase 17B — draft generation idempotency key', () => {
  it('composes a stable per-supplier key from the base key', () => {
    assert.equal(reorderGenerationKeyForSupplier('abc', 's1'), 'abc:s1');
    assert.notEqual(
      reorderGenerationKeyForSupplier('abc', 's1'),
      reorderGenerationKeyForSupplier('abc', 's2'),
    );
  });
});

describe('Phase 17B — draft edit normalization (Scenario E, no double conversion)', () => {
  it('5 packs at 5 kg/pack normalizes to 25 kg exactly once', () => {
    assert.equal(normalizePurchaseQuantity(5, 5), 25);
    // and does not re-apply the conversion a second time
    assert.notEqual(normalizePurchaseQuantity(5, 5), 125);
  });
});
