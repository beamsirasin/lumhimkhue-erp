/**
 * Phase 17POS-AUTH-A2B — pure tests for the role-gating policy change:
 * ALL roles that can reach a saved-guest edit (owner, manager, cashier)
 * must now enter an approval code, not cashier only. No DB access.
 * Runner: node:test via tsx — `npm run test:approval-code`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requiresApprovalForSavedGuestEdit } from '../../lib/auth/approval-code-core';
import { can } from '../../lib/auth/permissions';

describe('requiresApprovalForSavedGuestEdit — A2B policy (all eligible roles gated)', () => {
  it('owner requires approval on a saved-guest edit', () => {
    assert.equal(requiresApprovalForSavedGuestEdit('owner', true), true);
  });

  it('manager requires approval on a saved-guest edit', () => {
    assert.equal(requiresApprovalForSavedGuestEdit('manager', true), true);
  });

  it('cashier requires approval on a saved-guest edit', () => {
    assert.equal(requiresApprovalForSavedGuestEdit('cashier', true), true);
  });

  it('first save (no prior saved guests) is never gated, regardless of role', () => {
    assert.equal(requiresApprovalForSavedGuestEdit('owner', false), false);
    assert.equal(requiresApprovalForSavedGuestEdit('manager', false), false);
    assert.equal(requiresApprovalForSavedGuestEdit('cashier', false), false);
  });

  it('kitchen is never granted access via the approval gate — the actual permission gate (can) already blocks it upstream, and this function does not signal a bypass for it either', () => {
    assert.equal(can('kitchen', 'manage_tables'), false);
    assert.equal(requiresApprovalForSavedGuestEdit('kitchen', true), false);
  });

  it('an unrecognized/unauthorized role string is never signaled as requiring (or bypassing via) approval', () => {
    assert.equal(requiresApprovalForSavedGuestEdit('not_a_real_role', true), false);
  });
});
