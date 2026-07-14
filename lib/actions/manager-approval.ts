'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, or, isNull, desc, lte, gt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { BatchItem } from 'drizzle-orm/batch';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { managerApprovalCodes, users } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/actions/audit';
import {
  generateApprovalCode,
  hashApprovalCode,
  verifyApprovalCode,
  normalizeApprovalCodeInput,
  approvalCodeExpiresAt,
  deriveApprovalCodeDisplayStatus,
  evaluateApprovalCodeRow,
  isSelfApprovalAllowed,
  APPROVAL_CODE_REJECT_MESSAGE,
  APPROVAL_CODE_SELF_APPROVAL_REJECT_MESSAGE,
  APPROVAL_CODE_LENGTH,
  type ApprovalCodeStatus,
} from '@/lib/auth/approval-code-core';
import { revokeManagerApprovalCodeSchema } from '@/lib/validations/manager-approval';

/**
 * Phase 17POS-AUTH-A1 — Manager Approval Code (รหัสอนุมัติ) foundation actions.
 *
 * Scope of this phase: view / generate / revoke / history only. No sensitive
 * POS action reads or validates a code yet — that wiring (consumeApprovalCode
 * against usedAt/usedBy/... columns) is Phase 17POS-AUTH-A2. Nothing here
 * touches payments, sessions, receipts, reports, or cashier shift math.
 *
 * Branch scoping: one active code per the acting owner/manager's branchId
 * (NULL branchId = store-wide code, matching how the seeded owner account has
 * no branchId and oversees all branches).
 */

function branchScope(branchId: string | null | undefined) {
  return branchId ? eq(managerApprovalCodes.branchId, branchId) : isNull(managerApprovalCodes.branchId);
}

/** Lazily flips any active-but-time-expired row in scope to 'expired'. No-op if none found. */
async function sweepExpired(branchId: string | null | undefined) {
  await db
    .update(managerApprovalCodes)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        branchScope(branchId),
        eq(managerApprovalCodes.status, 'active'),
        lte(managerApprovalCodes.expiresAt, new Date()),
      ),
    );
}

type CodeRow = typeof managerApprovalCodes.$inferSelect;

function toDisplayCode(
  row: CodeRow,
  generatedByName: string | null,
  usedByName: string | null = null,
  revokedByName: string | null = null,
) {
  return {
    id: row.id,
    status: deriveApprovalCodeDisplayStatus(row.status as ApprovalCodeStatus, row.expiresAt),
    generatedByUserId: row.generatedByUserId,
    generatedByName,
    generatedAt: row.generatedAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    usedByName,
    usedForAction: row.usedForAction,
    revokedAt: row.revokedAt,
    revokedByName,
  };
}

/* ─── getManagerApprovalCodeState ───────────────────────────────────────── */

export async function getManagerApprovalCodeState() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'approval_code:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const branchId = authSession.user.branchId ?? null;

    // Lazy-expire before reading so the UI never shows a stale 'active' badge.
    await sweepExpired(branchId);

    const usedByUsers = alias(users, 'used_by_users');
    const revokedByUsers = alias(users, 'revoked_by_users');
    const rows = await db
      .select({
        code: managerApprovalCodes,
        generatedByName: users.name,
        usedByName: usedByUsers.name,
        revokedByName: revokedByUsers.name,
      })
      .from(managerApprovalCodes)
      .leftJoin(users, eq(managerApprovalCodes.generatedByUserId, users.id))
      .leftJoin(usedByUsers, eq(managerApprovalCodes.usedByUserId, usedByUsers.id))
      .leftJoin(revokedByUsers, eq(managerApprovalCodes.revokedByUserId, revokedByUsers.id))
      .where(branchScope(branchId))
      .orderBy(desc(managerApprovalCodes.generatedAt))
      .limit(20);

    const activeRow = rows.find((r) => r.code.status === 'active') ?? null;

    return {
      ok: true as const,
      data: {
        activeCode: activeRow
          ? toDisplayCode(activeRow.code, activeRow.generatedByName, activeRow.usedByName, activeRow.revokedByName)
          : null,
        history: rows.map((r) => toDisplayCode(r.code, r.generatedByName, r.usedByName, r.revokedByName)),
      },
    };
  } catch (e) {
    console.error('[getManagerApprovalCodeState]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── generateManagerApprovalCode ───────────────────────────────────────── */

export async function generateManagerApprovalCode() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'approval_code:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const branchId = authSession.user.branchId ?? null;
    const userId = authSession.user.id;

    const previousActive = await db
      .select({ id: managerApprovalCodes.id })
      .from(managerApprovalCodes)
      .where(and(branchScope(branchId), eq(managerApprovalCodes.status, 'active')));

    const plainCode = generateApprovalCode();
    const codeHash = await hashApprovalCode(plainCode);
    const now = new Date();
    const newId = crypto.randomUUID();

    const batchStatements: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(managerApprovalCodes).values({
        id: newId,
        branchId,
        codeHash,
        status: 'active',
        generatedByUserId: userId,
        generatedAt: now,
        expiresAt: approvalCodeExpiresAt(now),
      }),
    ];

    if (previousActive.length > 0) {
      batchStatements.push(
        db
          .update(managerApprovalCodes)
          .set({ status: 'revoked', revokedAt: now, revokedByUserId: userId, updatedAt: now })
          .where(
            and(
              branchScope(branchId),
              eq(managerApprovalCodes.status, 'active'),
            ),
          ),
      );
    }

    await db.batch(batchStatements);

    writeAuditLog({
      userId,
      role: authSession.user.role,
      action: 'manager_approval_code_generated',
      entity: 'manager_approval_code',
      entityId: newId,
      before: previousActive.length > 0 ? { revokedCodeIds: previousActive.map((r) => r.id) } : null,
      after: { expiresAt: approvalCodeExpiresAt(now).toISOString(), branchId },
    });

    revalidatePath('/approval-code');

    return {
      ok: true as const,
      data: {
        id: newId,
        code: plainCode,
        expiresAt: approvalCodeExpiresAt(now),
        generatedAt: now,
      },
    };
  } catch (e) {
    console.error('[generateManagerApprovalCode]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── revokeManagerApprovalCode ─────────────────────────────────────────── */

export async function revokeManagerApprovalCode(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'approval_code:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = revokeManagerApprovalCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { codeId } = parsed.data;

  try {
    const branchId = authSession.user.branchId ?? null;
    const userId = authSession.user.id;
    const now = new Date();

    const result = await db
      .update(managerApprovalCodes)
      .set({ status: 'revoked', revokedAt: now, revokedByUserId: userId, updatedAt: now })
      .where(
        and(
          eq(managerApprovalCodes.id, codeId),
          branchScope(branchId),
          eq(managerApprovalCodes.status, 'active'),
        ),
      )
      .returning({ id: managerApprovalCodes.id });

    if (result.length === 0)
      return { ok: false as const, error: 'ไม่พบรหัสที่ใช้งานอยู่ หรือถูกยกเลิก/หมดอายุไปแล้ว' };

    writeAuditLog({
      userId,
      role: authSession.user.role,
      action: 'manager_approval_code_revoked',
      entity: 'manager_approval_code',
      entityId: codeId,
      before: { status: 'active' },
      after: { status: 'revoked' },
    });

    revalidatePath('/approval-code');

    return { ok: true as const, data: { id: codeId } };
  } catch (e) {
    console.error('[revokeManagerApprovalCode]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── consumeManagerApprovalCode (Phase 17POS-AUTH-A2) ──────────────────────
 *
 * Shared server-side gate for cashier-facing sensitive actions. This does
 * NOT perform the gated mutation — callers validate their own edit inputs
 * first, call this, and only run their hardened mutation after a
 * `{ ok: true }` result. See callers (e.g. updateSessionGuests) for the
 * documented atomic-boundary limitation: code-consumption and the gated
 * mutation are two separate statements/batches, not one transaction — the
 * current neon-http driver has no db.transaction(). Consuming the code
 * happens via a single conditional UPDATE ... WHERE status='active'
 * RETURNING, so concurrent redemption attempts can never both succeed.
 *
 * Never reveals *why* a code was rejected to the caller — always the same
 * generic message, regardless of not-found/expired/used/revoked/wrong-hash.
 */

export interface ConsumeManagerApprovalCodeParams {
  code: string;
  action: string;
  entityType: string;
  entityId: string;
  requestedByUserId: string;
  requestedByRole: string;
  requestedByBranchId?: string | null;
  reason?: string;
}

export type ConsumeManagerApprovalCodeResult =
  | { ok: true; codeId: string; generatedByUserId: string }
  | { ok: false; error: string };

export async function consumeManagerApprovalCode(
  params: ConsumeManagerApprovalCodeParams,
): Promise<ConsumeManagerApprovalCodeResult> {
  const {
    code, action, entityType, entityId,
    requestedByUserId, requestedByRole, requestedByBranchId, reason,
  } = params;

  function auditFailure(rejectReason: string) {
    writeAuditLog({
      userId: requestedByUserId,
      role: requestedByRole,
      action: 'manager_approval_code_failed_attempt',
      entity: entityType,
      entityId,
      before: null,
      // Never include the submitted code, even normalized/uppercased.
      after: { requestedAction: action, rejectReason },
    });
  }

  const normalized = normalizeApprovalCodeInput(code ?? '');
  if (normalized.length !== APPROVAL_CODE_LENGTH) {
    auditFailure('malformed_input');
    return { ok: false, error: APPROVAL_CODE_REJECT_MESSAGE };
  }

  // Store-wide (NULL branchId) codes are usable from any branch; a
  // branch-specific code is only usable within that same branch.
  const branchCondition = requestedByBranchId
    ? or(isNull(managerApprovalCodes.branchId), eq(managerApprovalCodes.branchId, requestedByBranchId))
    : isNull(managerApprovalCodes.branchId);

  const now = new Date();
  const [row] = await db
    .select({
      id: managerApprovalCodes.id,
      codeHash: managerApprovalCodes.codeHash,
      status: managerApprovalCodes.status,
      expiresAt: managerApprovalCodes.expiresAt,
      generatedByUserId: managerApprovalCodes.generatedByUserId,
    })
    .from(managerApprovalCodes)
    .where(and(branchCondition, eq(managerApprovalCodes.status, 'active'), gt(managerApprovalCodes.expiresAt, now)))
    .orderBy(desc(managerApprovalCodes.generatedAt))
    .limit(1);

  const evaluation = evaluateApprovalCodeRow(
    row ? { status: row.status as ApprovalCodeStatus, expiresAt: row.expiresAt } : null,
    now,
  );
  if (!evaluation.usable) {
    auditFailure(evaluation.reason);
    return { ok: false, error: APPROVAL_CODE_REJECT_MESSAGE };
  }

  const hashMatches = await verifyApprovalCode(normalized, row.codeHash);
  if (!hashMatches) {
    auditFailure('mismatch');
    return { ok: false, error: APPROVAL_CODE_REJECT_MESSAGE };
  }

  // Phase 17POS-AUTH-A2C: the code is genuinely valid at this point (right
  // status, right hash) — self-approval policy is evaluated BEFORE marking
  // it used, so a blocked self-approval never consumes the code. Owner may
  // redeem its own code; manager/cashier may not.
  if (!isSelfApprovalAllowed(requestedByRole, row.generatedByUserId, requestedByUserId)) {
    auditFailure('self_approval_not_allowed');
    return { ok: false, error: APPROVAL_CODE_SELF_APPROVAL_REJECT_MESSAGE };
  }

  // Atomic, conditional: only succeeds if still 'active' at this instant —
  // closes the race window between the SELECT above and this UPDATE.
  const [usedRow] = await db
    .update(managerApprovalCodes)
    .set({
      status: 'used',
      usedAt: now,
      usedByUserId: requestedByUserId,
      usedForAction: action,
      usedEntityType: entityType,
      usedEntityId: entityId,
      updatedAt: now,
    })
    .where(and(eq(managerApprovalCodes.id, row.id), eq(managerApprovalCodes.status, 'active')))
    .returning({ id: managerApprovalCodes.id, generatedByUserId: managerApprovalCodes.generatedByUserId });

  if (!usedRow) {
    auditFailure('race_lost');
    return { ok: false, error: APPROVAL_CODE_REJECT_MESSAGE };
  }

  writeAuditLog({
    userId: requestedByUserId,
    role: requestedByRole,
    action: 'manager_approval_code_used',
    entity: entityType,
    entityId,
    before: null,
    after: {
      codeId: usedRow.id,
      generatedByUserId: usedRow.generatedByUserId,
      requestedAction: action,
      reason: reason ?? null,
      // Phase 17POS-AUTH-A2C: by this point selfApproved can only be true
      // when requestedByRole === 'owner' — isSelfApprovalAllowed() above
      // already rejected any manager/cashier self-approval before the code
      // was marked used.
      selfApproved: usedRow.generatedByUserId === requestedByUserId,
    },
  });

  return { ok: true, codeId: usedRow.id, generatedByUserId: usedRow.generatedByUserId };
}
