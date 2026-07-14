import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Phase 17POS-AUTH-A1 — Manager Approval Code (รหัสอนุมัติ) pure helpers.
 * No DB access here — kept pure so it is unit-testable without a harness.
 * Consumption/verification against a live code row belongs to Phase 17POS-AUTH-A2.
 */

/** Uppercase letters + digits, excluding confusable O/0/I/1/L per phase spec. */
export const APPROVAL_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const APPROVAL_CODE_LENGTH = 6;

export const APPROVAL_CODE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const APPROVAL_CODE_BCRYPT_COST = 10;

export type ApprovalCodeStatus = 'active' | 'used' | 'expired' | 'revoked';

/** Crypto-safe 6-character code from the confusable-free charset. */
export function generateApprovalCode(): string {
  let code = '';
  for (let i = 0; i < APPROVAL_CODE_LENGTH; i++) {
    code += APPROVAL_CODE_CHARSET[randomInt(APPROVAL_CODE_CHARSET.length)];
  }
  return code;
}

/** Trims whitespace and uppercases user-entered code input for comparison. */
export function normalizeApprovalCodeInput(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function hashApprovalCode(code: string): Promise<string> {
  return bcrypt.hash(code, APPROVAL_CODE_BCRYPT_COST);
}

export async function verifyApprovalCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function approvalCodeExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + APPROVAL_CODE_TTL_MS);
}

export function isApprovalCodeExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Derives the display status for a code row given its stored status and
 * expiresAt, without mutating anything. 'active' rows past expiresAt are
 * shown as 'expired' even before the lazy DB flip has run.
 */
export function deriveApprovalCodeDisplayStatus(
  storedStatus: ApprovalCodeStatus,
  expiresAt: Date,
  now: Date = new Date(),
): ApprovalCodeStatus {
  if (storedStatus === 'active' && isApprovalCodeExpired(expiresAt, now)) return 'expired';
  return storedStatus;
}

/**
 * Phase 17POS-AUTH-A2 — consumption-side helpers. Never reveal to the
 * caller *why* a code was rejected (not found vs expired vs used vs
 * revoked) — the reason is for server-side audit metadata only. The
 * user-facing message is always the single generic REJECT constant.
 */
export const APPROVAL_CODE_REJECT_MESSAGE = 'รหัสอนุมัติไม่ถูกต้องหรือหมดอายุ';

export type ApprovalCodeRejectReason = 'not_found' | 'expired' | 'used' | 'revoked' | 'mismatch';

export type ApprovalCodeEvaluation =
  | { usable: true }
  | { usable: false; reason: ApprovalCodeRejectReason };

/**
 * Pure decision: given a code row's stored status/expiry (or null if none
 * was found for the requester's scope), is it currently redeemable? Hash
 * comparison happens separately (async, bcrypt) — this only covers the
 * status/expiry state machine so it can be unit-tested without a DB.
 */
export function evaluateApprovalCodeRow(
  row: { status: ApprovalCodeStatus; expiresAt: Date } | null,
  now: Date = new Date(),
): ApprovalCodeEvaluation {
  if (!row) return { usable: false, reason: 'not_found' };
  if (row.status === 'used') return { usable: false, reason: 'used' };
  if (row.status === 'revoked') return { usable: false, reason: 'revoked' };
  if (row.status === 'expired') return { usable: false, reason: 'expired' };
  // status === 'active'
  if (isApprovalCodeExpired(row.expiresAt, now)) return { usable: false, reason: 'expired' };
  return { usable: true };
}

/**
 * Phase 17POS-AUTH-A2B — policy change: EVERY role that is otherwise
 * permitted to edit saved guest counts (owner, manager, cashier) must enter
 * a valid approval code for a saved-guest edit — not cashier only. There is
 * no silent bypass for owner/manager.
 *
 * This function is deliberately NOT an authorization check — it only
 * decides whether the approval-code gate applies to an already-authorized
 * request. The actual permission gate is `can(role, 'manage_tables')` in
 * lib/auth/permissions.ts, evaluated before this is ever reached; kitchen
 * (not in APPROVAL_GATED_ROLES, and lacking manage_tables) never gets this
 * far, so this function returning false for it is not a bypass — it simply
 * means the question doesn't arise for a role that was already rejected.
 */
export const APPROVAL_GATED_ROLES: ReadonlySet<string> = new Set(['owner', 'manager', 'cashier']);

export function requiresApprovalForSavedGuestEdit(role: string, isSavedGuestEdit: boolean): boolean {
  return isSavedGuestEdit && APPROVAL_GATED_ROLES.has(role);
}

/**
 * Phase 17POS-AUTH-A4 — directional gating: the second boolean passed to
 * requiresApprovalForSavedGuestEdit() is now "is this edit a decrease" (via
 * hasGuestCountDecrease below), not just "did anything change". A pure
 * increase to an already-saved guest set — adding a new tile, or raising an
 * existing tile's quantity — never requires a code, because it can only
 * raise the bill; the fraud scenario an approval code guards against
 * (quietly removing a paying guest after the count was saved) only exists
 * on a decrease. Any per-tile decrease gates the whole edit, even if other
 * tiles in the same save increased (no averaging/netting across tiles).
 */
export function hasGuestCountDecrease(
  oldGuests: { pricingTileId: string; quantity: number }[],
  newGuests: { pricingTileId: string; quantity: number }[],
): boolean {
  const newQtyByTile = new Map(newGuests.map((g) => [g.pricingTileId, g.quantity]));
  return oldGuests.some((old) => (newQtyByTile.get(old.pricingTileId) ?? 0) < old.quantity);
}

/**
 * Phase 17POS-AUTH-A2C — self-approval policy.
 *
 * Owner is the only role allowed to redeem a code it generated itself.
 * Manager may generate codes but must have someone else (owner, another
 * manager, or the cashier being approved) redeem them — a manager cannot
 * approve their own gated action. Cashier can never generate a code, so
 * self-approval should be structurally impossible for it, but the check
 * is role-based (not "cashier can never be generatedByUserId"), so it is
 * still explicitly rejected here as defense in depth.
 *
 * This is a deliberately different, MORE INFORMATIVE message than the
 * generic invalid-code rejection: the code IS genuinely valid here (right
 * status, right hash) — the actor just isn't allowed to be the one to use
 * it. Telling the actor that is actionable ("ask someone else") and does
 * not help an attacker guess codes, unlike revealing used/expired/revoked
 * distinctions on an otherwise-wrong code.
 */
export const APPROVAL_CODE_SELF_APPROVAL_REJECT_MESSAGE =
  'ไม่สามารถใช้รหัสที่คุณสร้างเองได้ กรุณาให้ผู้จัดการหรือเจ้าของสร้างรหัสใหม่';

export function isSelfApprovalAllowed(
  actorRole: string,
  generatedByUserId: string,
  actorUserId: string,
): boolean {
  const isSelf = generatedByUserId === actorUserId;
  if (!isSelf) return true;
  return actorRole === 'owner';
}
