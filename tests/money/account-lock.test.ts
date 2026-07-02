/**
 * Phase 16D — receiving-account A/B group lock (golden behavior of
 * getAccountGroup + hasMixedAccountGroups used by processPayment).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAccountGroup, hasMixedAccountGroups } from '../../lib/payments/account-group';

describe('getAccountGroup', () => {
  it('bank/cash accounts derive their group from the _a/_b suffix', () => {
    assert.equal(getAccountGroup('bank_cash_a'), 'a');
    assert.equal(getAccountGroup('bank_cash_b'), 'b');
  });

  it('welfare accounts follow the same suffix convention', () => {
    assert.equal(getAccountGroup('welfare_a'), 'a');
    assert.equal(getAccountGroup('welfare_b'), 'b');
  });

  it('accounts without a group suffix are exempt (null)', () => {
    assert.equal(getAccountGroup('legacy_unknown'), null);
    assert.equal(getAccountGroup('cash_drawer'), null);
  });

  it('suffix matching is case-insensitive', () => {
    assert.equal(getAccountGroup('BANK_CASH_A'), 'a');
  });
});

describe('hasMixedAccountGroups (cross-row lock in one payment)', () => {
  it('all group A → allowed', () => {
    assert.equal(hasMixedAccountGroups(['bank_cash_a', 'welfare_a']), false);
  });

  it('all group B → allowed', () => {
    assert.equal(hasMixedAccountGroups(['bank_cash_b', 'welfare_b']), false);
  });

  it('A + B in one payment → rejected', () => {
    assert.equal(hasMixedAccountGroups(['bank_cash_a', 'bank_cash_b']), true);
  });

  it('welfare group follows the same lock: welfare_a + bank_cash_b → rejected', () => {
    assert.equal(hasMixedAccountGroups(['welfare_a', 'bank_cash_b']), true);
  });

  it('ungrouped accounts never cause a mix (exempt by design)', () => {
    assert.equal(hasMixedAccountGroups(['bank_cash_a', 'legacy_unknown']), false);
    assert.equal(hasMixedAccountGroups(['legacy_unknown', 'cash_drawer']), false);
  });

  it('single row is never mixed', () => {
    assert.equal(hasMixedAccountGroups(['bank_cash_a']), false);
  });
});
