/**
 * Phase 17B — Initial Inventory Setup semantics (pure)
 *
 * The very first physical count when a branch starts using inventory. It is a
 * PHYSICAL-TRUTH count, not an operational movement:
 *  - no goods receipt, no PO, no operational usage
 *  - received = waste = other outbound = total depletion = usage = 0
 *  - quantity_on_hand = the counted physical quantity
 *  - once Reviewed, that quantity becomes the OPENING of the next count round
 *
 * A blank count means "not counted yet"; 0 means "counted and none on hand".
 */

export const INITIAL_SETUP_COUNT_TYPE = 'initial_setup';
export const DAILY_COUNT_TYPE = 'daily';

export type InitialSetupItemValues = {
  openingBalance: number;
  regularReceivedQty: number;
  emergencyReceivedQty: number;
  positiveAdjustmentQty: number;
  recordedWasteQty: number;
  otherOutboundQty: number;
  totalDepletionQty: number;
  estimatedOperationalUsageQty: number;
  quantityOnHand: number;
};

/**
 * Deterministic stored values for an initial-setup line. Everything except the
 * on-hand quantity is forced to zero so the dashboard never reports usage on
 * the day the system is switched on.
 */
export function buildInitialSetupItemValues(physicalCount: number): InitialSetupItemValues {
  const quantityOnHand = Number.isFinite(physicalCount) && physicalCount > 0 ? physicalCount : 0;
  return {
    openingBalance: 0,
    regularReceivedQty: 0,
    emergencyReceivedQty: 0,
    positiveAdjustmentQty: 0,
    recordedWasteQty: 0,
    otherOutboundQty: 0,
    totalDepletionQty: 0,
    estimatedOperationalUsageQty: 0,
    quantityOnHand,
  };
}

export type InitialSetupGateInput = {
  /** Any Reviewed stock count already exists for the branch (daily or setup). */
  hasReviewedCount: boolean;
  /** Status of an existing non-reviewed initial setup, if one is in progress. */
  existingSetupStatus: 'draft' | 'submitted' | 'reviewed' | null;
};

export type InitialSetupGate =
  | { allowed: true; mode: 'create' | 'edit'; reason: null }
  | { allowed: false; mode: 'blocked'; reason: 'already_reviewed' };

/**
 * Whether the initial-setup onboarding may be shown / saved. Once ANY reviewed
 * count exists the branch is considered initialized and onboarding is blocked —
 * we never retro-create an initial balance behind the user's back.
 */
export function evaluateInitialSetupGate(input: InitialSetupGateInput): InitialSetupGate {
  if (input.existingSetupStatus === 'reviewed' || input.hasReviewedCount) {
    return { allowed: false, mode: 'blocked', reason: 'already_reviewed' };
  }
  return {
    allowed: true,
    mode: input.existingSetupStatus === null ? 'create' : 'edit',
    reason: null,
  };
}

/** A blank input is "uncounted"; an explicit 0 is a real "none on hand" count. */
export function isCountedValue(physicalCount: number | null | undefined): boolean {
  return physicalCount != null && Number.isFinite(physicalCount);
}
