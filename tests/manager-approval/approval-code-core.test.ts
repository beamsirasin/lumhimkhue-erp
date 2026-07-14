/**
 * Phase 17POS-AUTH-A1 — pure helper tests for the manager approval code
 * (รหัสอนุมัติ) foundation. No DB access — mirrors tests/money conventions.
 * Runner: node:test via tsx — `npm run test:approval-code`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_CODE_CHARSET,
  APPROVAL_CODE_LENGTH,
  APPROVAL_CODE_TTL_MS,
  generateApprovalCode,
  normalizeApprovalCodeInput,
  hashApprovalCode,
  verifyApprovalCode,
  approvalCodeExpiresAt,
  isApprovalCodeExpired,
  deriveApprovalCodeDisplayStatus,
} from '../../lib/auth/approval-code-core';

describe('APPROVAL_CODE_CHARSET', () => {
  it('excludes confusable characters O, 0, I, 1, L', () => {
    for (const ch of ['O', '0', 'I', '1', 'L']) {
      assert.equal(APPROVAL_CODE_CHARSET.includes(ch), false, `charset should not include ${ch}`);
    }
  });

  it('contains only uppercase letters and digits', () => {
    assert.match(APPROVAL_CODE_CHARSET, /^[A-Z0-9]+$/);
  });
});

describe('generateApprovalCode', () => {
  it('produces a code of the configured length', () => {
    for (let i = 0; i < 200; i++) {
      assert.equal(generateApprovalCode().length, APPROVAL_CODE_LENGTH);
    }
  });

  it('only uses characters from the confusable-free charset', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateApprovalCode();
      for (const ch of code) {
        assert.ok(APPROVAL_CODE_CHARSET.includes(ch), `unexpected char ${ch} in ${code}`);
      }
    }
  });

  it('is not deterministic across calls (sanity check on randomness)', () => {
    const samples = new Set(Array.from({ length: 50 }, () => generateApprovalCode()));
    // 50 draws from a 31^6 (~887M) keyspace should essentially never collide
    assert.ok(samples.size > 1);
  });
});

describe('normalizeApprovalCodeInput', () => {
  it('trims whitespace and uppercases', () => {
    assert.equal(normalizeApprovalCodeInput('  ab3xz9 '), 'AB3XZ9');
  });

  it('is idempotent on already-normalized input', () => {
    assert.equal(normalizeApprovalCodeInput('AB3XZ9'), 'AB3XZ9');
  });
});

describe('hashApprovalCode / verifyApprovalCode', () => {
  it('verifies a matching code against its hash', async () => {
    const code = generateApprovalCode();
    const hash = await hashApprovalCode(code);
    assert.equal(await verifyApprovalCode(code, hash), true);
  });

  it('rejects a non-matching code', async () => {
    const hash = await hashApprovalCode('AB3XZ9');
    assert.equal(await verifyApprovalCode('ZZ9999', hash), false);
  });

  it('never stores the plaintext code inside the hash string', async () => {
    const code = 'AB3XZ9';
    const hash = await hashApprovalCode(code);
    assert.equal(hash.includes(code), false);
  });
});

describe('approvalCodeExpiresAt / isApprovalCodeExpired', () => {
  it('sets expiry exactly 1 hour after the given time', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = approvalCodeExpiresAt(from);
    assert.equal(expiresAt.getTime() - from.getTime(), APPROVAL_CODE_TTL_MS);
  });

  it('is not expired before expiresAt', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    const now = new Date('2026-01-01T00:59:59.000Z');
    assert.equal(isApprovalCodeExpired(expiresAt, now), false);
  });

  it('is expired exactly at expiresAt (boundary is inclusive)', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    assert.equal(isApprovalCodeExpired(expiresAt, expiresAt), true);
  });

  it('is expired after expiresAt', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    const now = new Date('2026-01-01T01:00:01.000Z');
    assert.equal(isApprovalCodeExpired(expiresAt, now), true);
  });
});

describe('deriveApprovalCodeDisplayStatus', () => {
  it('shows an active, unexpired row as active', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    const now = new Date('2026-01-01T00:30:00.000Z');
    assert.equal(deriveApprovalCodeDisplayStatus('active', expiresAt, now), 'active');
  });

  it('shows an active row past expiresAt as expired, even before the DB is swept', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    const now = new Date('2026-01-01T02:00:00.000Z');
    assert.equal(deriveApprovalCodeDisplayStatus('active', expiresAt, now), 'expired');
  });

  it('leaves used status untouched regardless of expiry', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    const now = new Date('2026-01-01T02:00:00.000Z');
    assert.equal(deriveApprovalCodeDisplayStatus('used', expiresAt, now), 'used');
  });

  it('leaves revoked status untouched regardless of expiry', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    const now = new Date('2026-01-01T00:30:00.000Z');
    assert.equal(deriveApprovalCodeDisplayStatus('revoked', expiresAt, now), 'revoked');
  });
});
