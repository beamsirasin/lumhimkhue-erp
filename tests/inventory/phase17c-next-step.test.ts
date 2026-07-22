import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryNextStep,
  type InventoryStateSignals,
} from '../../lib/inventory/next-step';
import {
  purchaseOrderPrimaryAction,
  poStepIndex,
  PO_STATUS_LABELS,
} from '../../lib/inventory/purchase-order-flow';

const base: InventoryStateSignals = {
  hasIngredients: true,
  hasReviewedCount: true,
  initialSetupStatus: null,
  todayCountStatus: 'reviewed',
  todayCounted: 0,
  todayTotal: 0,
  recommendationCount: 0,
  draftPoCount: 0,
  pendingApprovalPoCount: 0,
  awaitingReceiptCount: 0,
};
const sig = (o: Partial<InventoryStateSignals>): InventoryStateSignals => ({ ...base, ...o });

describe('Phase 17C — inventory next-step (onboarding)', () => {
  it('no ingredients → set up ingredients (step 1)', () => {
    const { primary } = buildInventoryNextStep(sig({ hasIngredients: false, hasReviewedCount: false }));
    assert.equal(primary.key, 'setup-ingredients');
    assert.equal(primary.href, '/inventory/ingredients');
    assert.equal(primary.step, 'ขั้นที่ 1');
  });

  it('ingredients but no initial setup → start initial setup (step 2)', () => {
    const { primary } = buildInventoryNextStep(sig({ hasReviewedCount: false, initialSetupStatus: null }));
    assert.equal(primary.key, 'start-initial-setup');
    assert.equal(primary.href, '/inventory/setup');
  });

  it('initial setup draft → continue', () => {
    const { primary } = buildInventoryNextStep(sig({ hasReviewedCount: false, initialSetupStatus: 'draft' }));
    assert.equal(primary.key, 'continue-initial-setup');
    assert.equal(primary.ctaLabel, 'ทำต่อ');
  });

  it('initial setup submitted → review', () => {
    const { primary } = buildInventoryNextStep(sig({ hasReviewedCount: false, initialSetupStatus: 'submitted' }));
    assert.equal(primary.key, 'review-initial-setup');
    assert.equal(primary.href, '/inventory/setup');
  });
});

describe('Phase 17C — inventory next-step (daily)', () => {
  it('initialized but not counted today → count today', () => {
    const { primary } = buildInventoryNextStep(sig({ todayCountStatus: null }));
    assert.equal(primary.key, 'count-today');
    assert.equal(primary.href, '/inventory/count');
  });

  it('count draft → continue with X/Y progress', () => {
    const { primary } = buildInventoryNextStep(sig({ todayCountStatus: 'draft', todayCounted: 3, todayTotal: 10 }));
    assert.equal(primary.key, 'continue-count');
    assert.match(primary.title, /3\/10/);
  });

  it('count submitted → review (confirm closing)', () => {
    const { primary } = buildInventoryNextStep(sig({ todayCountStatus: 'submitted' }));
    assert.equal(primary.key, 'review-count');
  });

  it('reviewed + recommendations → view recommendations (primary)', () => {
    const { primary } = buildInventoryNextStep(sig({ recommendationCount: 4 }));
    assert.equal(primary.key, 'view-recommendations');
    assert.equal(primary.href, '/inventory/reorder');
    assert.match(primary.title, /4/);
  });

  it('reviewed + no recs + draft PO → review draft PO', () => {
    const { primary } = buildInventoryNextStep(sig({ recommendationCount: 0, draftPoCount: 2 }));
    assert.equal(primary.key, 'review-draft-po');
    assert.equal(primary.href, '/inventory/orders');
  });

  it('reviewed + only awaiting receipt → receive goods', () => {
    const { primary } = buildInventoryNextStep(sig({ awaitingReceiptCount: 3 }));
    assert.equal(primary.key, 'receive-goods');
    assert.equal(primary.ctaLabel, 'บันทึกรับสินค้า');
  });

  it('nothing pending → up to date', () => {
    const { primary } = buildInventoryNextStep(base);
    assert.equal(primary.key, 'up-to-date');
  });

  it('surfaces awaiting-receipt as a secondary hint while the primary is counting', () => {
    const { primary, secondary } = buildInventoryNextStep(sig({ todayCountStatus: null, awaitingReceiptCount: 2 }));
    assert.equal(primary.key, 'count-today');
    assert.ok(secondary.some((a) => a.key === 'receive-goods'));
  });

  it('does not duplicate the primary action inside secondary', () => {
    const { primary, secondary } = buildInventoryNextStep(sig({ awaitingReceiptCount: 2 }));
    assert.equal(primary.key, 'receive-goods');
    assert.equal(secondary.filter((a) => a.key === 'receive-goods').length, 0);
  });
});

describe('Phase 17C — purchase-order status → primary action', () => {
  const owner = { canManage: true, canApprove: true };
  const manager = { canManage: true, canApprove: false };

  it('draft → ส่งขออนุมัติ (submit) for a manager', () => {
    assert.deepEqual(purchaseOrderPrimaryAction('draft', manager), { action: 'submit', label: 'ส่งขออนุมัติ' });
  });

  it('pending_approval → approve for owner, blocked for manager', () => {
    assert.equal(purchaseOrderPrimaryAction('pending_approval', owner)?.action, 'approve');
    const mgr = purchaseOrderPrimaryAction('pending_approval', manager);
    assert.equal(mgr?.action, 'none');
    assert.ok(mgr?.blockedReason);
  });

  it('ordered → รับสินค้า, partial_received → รับสินค้าเพิ่มเติม', () => {
    assert.equal(purchaseOrderPrimaryAction('ordered', manager)?.label, 'รับสินค้า');
    assert.equal(purchaseOrderPrimaryAction('partial_received', manager)?.label, 'รับสินค้าเพิ่มเติม');
  });

  it('received and cancelled have no forward action', () => {
    assert.equal(purchaseOrderPrimaryAction('received', owner), null);
    assert.equal(purchaseOrderPrimaryAction('cancelled', owner), null);
  });

  it('stepper index is linear for the happy path and -1 for cancelled', () => {
    assert.equal(poStepIndex('draft'), 0);
    assert.equal(poStepIndex('received'), 4);
    assert.equal(poStepIndex('cancelled'), -1);
    assert.equal(PO_STATUS_LABELS.ordered, 'ส่งให้ผู้ขายแล้ว');
  });
});
