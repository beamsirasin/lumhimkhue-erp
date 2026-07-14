/**
 * Phase 17POS-AUTH-A2 — pure decision-logic tests for consumeManagerApprovalCode's
 * status/expiry state machine (evaluateApprovalCodeRow). No DB access — the
 * actual DB fetch + hash compare + atomic UPDATE in
 * lib/actions/manager-approval.ts are intentionally not covered here (no DB
 * test harness in this project); this covers the pure decision the DB row
 * feeds into. Runner: node:test via tsx — `npm run test:approval-code`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateApprovalCodeRow,
  APPROVAL_CODE_REJECT_MESSAGE,
} from '../../lib/auth/approval-code-core';

const NOW = new Date('2026-01-01T01:00:00.000Z');
const NOT_EXPIRED = new Date('2026-01-01T02:00:00.000Z');
const PAST = new Date('2026-01-01T00:00:00.000Z');

describe('evaluateApprovalCodeRow', () => {
  it('rejects when no row was found for the requester scope', () => {
    const result = evaluateApprovalCodeRow(null, NOW);
    assert.equal(result.usable, false);
    if (!result.usable) assert.equal(result.reason, 'not_found');
  });

  it('rejects an already-used code', () => {
    const result = evaluateApprovalCodeRow({ status: 'used', expiresAt: NOT_EXPIRED }, NOW);
    assert.equal(result.usable, false);
    if (!result.usable) assert.equal(result.reason, 'used');
  });

  it('rejects a revoked code', () => {
    const result = evaluateApprovalCodeRow({ status: 'revoked', expiresAt: NOT_EXPIRED }, NOW);
    assert.equal(result.usable, false);
    if (!result.usable) assert.equal(result.reason, 'revoked');
  });

  it('rejects a code already flagged expired in storage', () => {
    const result = evaluateApprovalCodeRow({ status: 'expired', expiresAt: NOT_EXPIRED }, NOW);
    assert.equal(result.usable, false);
    if (!result.usable) assert.equal(result.reason, 'expired');
  });

  it('rejects an active row whose expiresAt has passed even though status was never swept', () => {
    const result = evaluateApprovalCodeRow({ status: 'active', expiresAt: PAST }, NOW);
    assert.equal(result.usable, false);
    if (!result.usable) assert.equal(result.reason, 'expired');
  });

  it('rejects exactly at the expiry boundary', () => {
    const result = evaluateApprovalCodeRow({ status: 'active', expiresAt: NOW }, NOW);
    assert.equal(result.usable, false);
    if (!result.usable) assert.equal(result.reason, 'expired');
  });

  it('accepts an active, unexpired row', () => {
    const result = evaluateApprovalCodeRow({ status: 'active', expiresAt: NOT_EXPIRED }, NOW);
    assert.equal(result.usable, true);
  });
});

describe('APPROVAL_CODE_REJECT_MESSAGE', () => {
  it('is the single generic message shared by every rejection path (never reveals why)', () => {
    assert.equal(APPROVAL_CODE_REJECT_MESSAGE, 'รหัสอนุมัติไม่ถูกต้องหรือหมดอายุ');
  });

  it('never embeds a plaintext-looking 6-character code', () => {
    assert.doesNotMatch(APPROVAL_CODE_REJECT_MESSAGE, /[A-Z0-9]{6}/);
  });
});
