/**
 * Phase 17POS-AUTH-A4 — pure tests for directional gating: only a decrease
 * in a previously-saved guest tile's quantity should require an approval
 * code; pure increases/additions never should. No DB access.
 * Runner: node:test via tsx — `npm run test:approval-code`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasGuestCountDecrease, requiresApprovalForSavedGuestEdit } from '../../lib/auth/approval-code-core';

const ADULT = 'tile-adult';
const CHILD = 'tile-child';

describe('hasGuestCountDecrease', () => {
  it('increasing an existing tile is not a decrease', () => {
    assert.equal(
      hasGuestCountDecrease([{ pricingTileId: ADULT, quantity: 2 }], [{ pricingTileId: ADULT, quantity: 5 }]),
      false,
    );
  });

  it('decreasing an existing tile is a decrease', () => {
    assert.equal(
      hasGuestCountDecrease([{ pricingTileId: ADULT, quantity: 5 }], [{ pricingTileId: ADULT, quantity: 2 }]),
      true,
    );
  });

  it('removing a tile entirely (drops to 0) is a decrease', () => {
    assert.equal(
      hasGuestCountDecrease([{ pricingTileId: ADULT, quantity: 2 }], []),
      true,
    );
  });

  it('adding a brand new tile not previously saved is not a decrease', () => {
    assert.equal(
      hasGuestCountDecrease(
        [{ pricingTileId: ADULT, quantity: 2 }],
        [{ pricingTileId: ADULT, quantity: 2 }, { pricingTileId: CHILD, quantity: 1 }],
      ),
      false,
    );
  });

  it('no change at all is not a decrease', () => {
    assert.equal(
      hasGuestCountDecrease([{ pricingTileId: ADULT, quantity: 3 }], [{ pricingTileId: ADULT, quantity: 3 }]),
      false,
    );
  });

  it('one tile increases while another decreases still counts as a decrease (no netting across tiles)', () => {
    assert.equal(
      hasGuestCountDecrease(
        [{ pricingTileId: ADULT, quantity: 2 }, { pricingTileId: CHILD, quantity: 3 }],
        [{ pricingTileId: ADULT, quantity: 5 }, { pricingTileId: CHILD, quantity: 1 }],
      ),
      true,
    );
  });

  it('empty old guests (first save) is never a decrease', () => {
    assert.equal(hasGuestCountDecrease([], [{ pricingTileId: ADULT, quantity: 3 }]), false);
  });
});

describe('requiresApprovalForSavedGuestEdit composed with hasGuestCountDecrease (A4 call-site semantics)', () => {
  it('owner increasing a saved guest tile is never gated', () => {
    const isDecrease = hasGuestCountDecrease([{ pricingTileId: ADULT, quantity: 2 }], [{ pricingTileId: ADULT, quantity: 4 }]);
    assert.equal(requiresApprovalForSavedGuestEdit('owner', isDecrease), false);
  });

  it('cashier decreasing a saved guest tile is gated', () => {
    const isDecrease = hasGuestCountDecrease([{ pricingTileId: ADULT, quantity: 4 }], [{ pricingTileId: ADULT, quantity: 2 }]);
    assert.equal(requiresApprovalForSavedGuestEdit('cashier', isDecrease), true);
  });
});
