'use server';

import { eq, and, desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { writeAuditLog } from '@/lib/actions/audit';
import { db } from '@/lib/db';
import { discountApprovals, sessions, users } from '@/lib/db/schema';
import {
  requestDiscountSchema,
  reviewDiscountSchema,
  listDiscountApprovalsSchema,
} from '@/lib/validations/discounts';

/* ─── requestDiscountApproval ─────────────────────────────────────────────────
 *
 * Cashier submits a discount request that exceeds their authority.
 * Pending until a manager/owner approves or rejects.
 *
 * Failure mode: single INSERT — if it fails, no state changes.
 */
export async function requestDiscountApproval(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'discount:apply'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = requestDiscountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, discountType, discountValue, reason } = parsed.data;
  const userId = authSession.user.id;

  try {
    // Verify session exists
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    // Auto-expire after 30 minutes if not acted upon
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const [approval] = await db
      .insert(discountApprovals)
      .values({
        sessionId,
        requestedBy: userId,
        discountType,
        discountValue: String(discountValue),
        reason,
        status: 'pending',
        expiresAt,
      })
      .returning({ id: discountApprovals.id });

    writeAuditLog({
      userId,
      role: authSession.user.role,
      action: 'discount_request',
      entity: 'discount_approvals',
      entityId: approval.id,
      after: { sessionId, discountType, discountValue, reason },
    });

    return { ok: true as const, data: { approvalId: approval.id } };
  } catch (e) {
    console.error('[requestDiscountApproval]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── approveDiscountApproval ─────────────────────────────────────────────────
 *
 * Manager/owner approves a pending discount request.
 * Failure mode: single UPDATE — if it fails, approval stays pending.
 */
export async function approveDiscountApproval(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'discount:approve'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น manager หรือ owner' };

  const parsed = reviewDiscountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { approvalId } = parsed.data;
  const userId = authSession.user.id;

  try {
    const [approval] = await db
      .select({ id: discountApprovals.id, status: discountApprovals.status })
      .from(discountApprovals)
      .where(eq(discountApprovals.id, approvalId))
      .limit(1);
    if (!approval) return { ok: false as const, error: 'ไม่พบคำขอส่วนลด' };
    if (approval.status !== 'pending') return { ok: false as const, error: 'คำขอนี้ดำเนินการไปแล้ว' };

    await db
      .update(discountApprovals)
      .set({ status: 'approved', approvedBy: userId })
      .where(eq(discountApprovals.id, approvalId));

    writeAuditLog({
      userId,
      role: authSession.user.role,
      action: 'discount_approve',
      entity: 'discount_approvals',
      entityId: approvalId,
      after: { status: 'approved' },
    });

    return { ok: true as const };
  } catch (e) {
    console.error('[approveDiscountApproval]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── rejectDiscountApproval ──────────────────────────────────────────────────
 *
 * Manager/owner rejects a pending discount request.
 * Failure mode: single UPDATE — if it fails, approval stays pending.
 */
export async function rejectDiscountApproval(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'discount:approve'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น manager หรือ owner' };

  const parsed = reviewDiscountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { approvalId, reviewNotes } = parsed.data;
  const userId = authSession.user.id;

  try {
    const [approval] = await db
      .select({ id: discountApprovals.id, status: discountApprovals.status })
      .from(discountApprovals)
      .where(eq(discountApprovals.id, approvalId))
      .limit(1);
    if (!approval) return { ok: false as const, error: 'ไม่พบคำขอส่วนลด' };
    if (approval.status !== 'pending') return { ok: false as const, error: 'คำขอนี้ดำเนินการไปแล้ว' };

    await db
      .update(discountApprovals)
      .set({ status: 'rejected', approvedBy: userId })
      .where(eq(discountApprovals.id, approvalId));

    writeAuditLog({
      userId,
      role: authSession.user.role,
      action: 'discount_reject',
      entity: 'discount_approvals',
      entityId: approvalId,
      after: { status: 'rejected', reason: reviewNotes ?? null },
    });

    return { ok: true as const };
  } catch (e) {
    console.error('[rejectDiscountApproval]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── listDiscountApprovals ───────────────────────────────────────────────────
 *
 * Lists discount approval requests.
 * cashier → own requests only; owner/manager → all, filterable by status.
 */
export async function listDiscountApprovals(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'discount:apply'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = listDiscountApprovalsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { status, sessionId } = parsed.data;
  const role = authSession.user.role;
  const userId = authSession.user.id;

  try {
    const rows = await db
      .select({
        id: discountApprovals.id,
        sessionId: discountApprovals.sessionId,
        discountType: discountApprovals.discountType,
        discountValue: discountApprovals.discountValue,
        reason: discountApprovals.reason,
        status: discountApprovals.status,
        requestedBy: discountApprovals.requestedBy,
        requesterName: users.name,
        approvedBy: discountApprovals.approvedBy,
        expiresAt: discountApprovals.expiresAt,
        createdAt: discountApprovals.createdAt,
      })
      .from(discountApprovals)
      .leftJoin(users, eq(discountApprovals.requestedBy, users.id))
      .where(
        and(
          // cashier sees own requests only
          role === 'cashier' ? eq(discountApprovals.requestedBy, userId) : undefined,
          status ? eq(discountApprovals.status, status) : undefined,
          sessionId ? eq(discountApprovals.sessionId, sessionId) : undefined,
        ),
      )
      .orderBy(desc(discountApprovals.createdAt))
      .limit(200);

    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[listDiscountApprovals]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type DiscountApprovalRow = NonNullable<
  Extract<Awaited<ReturnType<typeof listDiscountApprovals>>, { ok: true }>['data']
>[number];
