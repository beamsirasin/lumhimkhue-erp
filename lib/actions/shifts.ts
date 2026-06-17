'use server';

import { eq, and, gte, lte, sum, desc } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { writeAuditLog } from '@/lib/actions/audit';
import { db } from '@/lib/db';
import { cashierShifts, payments, users } from '@/lib/db/schema';
import {
  openShiftSchema,
  closeShiftSchema,
  reviewShiftSchema,
  listShiftsSchema,
} from '@/lib/validations/shifts';

/* ─── getActiveShift ──────────────────────────────────────────────────────────
 *
 * Returns the currently open shift for a cashier.
 * cashier → own shift only; owner/manager → any cashier via optional cashierId.
 */
export async function getActiveShift(cashierId?: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'cashier_shift:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const role = authSession.user.role;
  const currentUserId = authSession.user.id;

  // Cashier can only see own shift
  const targetId = cashierId ?? currentUserId;
  if (role === 'cashier' && targetId !== currentUserId)
    return { ok: false as const, error: 'cashier ดูได้เฉพาะ shift ของตัวเอง' };

  // Validate UUID if provided
  if (cashierId) {
    const parsed = z.string().uuid().safeParse(cashierId);
    if (!parsed.success) return { ok: false as const, error: 'cashierId ไม่ถูกต้อง' };
  }

  try {
    const [shift] = await db
      .select()
      .from(cashierShifts)
      .where(and(eq(cashierShifts.cashierId, targetId), eq(cashierShifts.status, 'open')))
      .limit(1);

    return { ok: true as const, data: shift ?? null };
  } catch (e) {
    console.error('[getActiveShift]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── openShift ───────────────────────────────────────────────────────────────
 *
 * Opens a new cashier shift for the current user.
 * Rejects if the user already has an open shift (1 active shift per cashier).
 *
 * Failure mode: INSERT is the only write op. If it fails, no state is changed.
 */
export async function openShift(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'cashier_shift:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = openShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { openingFloat, branchId } = parsed.data;
  const userId = authSession.user.id;

  try {
    // Reject if a shift is already open for this cashier
    const [existing] = await db
      .select({ id: cashierShifts.id })
      .from(cashierShifts)
      .where(and(eq(cashierShifts.cashierId, userId), eq(cashierShifts.status, 'open')))
      .limit(1);
    if (existing) return { ok: false as const, error: 'มี shift ที่เปิดอยู่แล้ว — ต้องปิดก่อน' };

    const [shift] = await db
      .insert(cashierShifts)
      .values({
        cashierId: userId,
        openedBy: userId,
        branchId: branchId ?? null,
        openingFloat: String(openingFloat),
        status: 'open',
      })
      .returning({ id: cashierShifts.id, openedAt: cashierShifts.openedAt });

    writeAuditLog({
      userId,
      role: authSession.user.role,
      action: 'shift_open',
      entity: 'cashier_shifts',
      entityId: shift.id,
      after: { openingFloat, branchId: branchId ?? null },
    });

    return { ok: true as const, data: shift };
  } catch (e) {
    console.error('[openShift]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── closeShift ──────────────────────────────────────────────────────────────
 *
 * Closes an open shift. Calculates expectedCash from openingFloat +
 * cash-method payments linked to this shift.
 *
 * cashDifference = actualCash − expectedCash
 * Requires differenceReason when cashDifference ≠ 0.
 *
 * Failure mode: ops are sequential.
 *   1. Fetch shift + cash total (reads)
 *   2. Validate business rules
 *   3. UPDATE cashierShifts
 * If step 3 fails → no state change. If audit write fails → shift still closed.
 */
export async function closeShift(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'cashier_shift:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = closeShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { shiftId, actualCash, differenceReason } = parsed.data;
  const userId = authSession.user.id;
  const role = authSession.user.role;

  try {
    const [shift] = await db
      .select()
      .from(cashierShifts)
      .where(eq(cashierShifts.id, shiftId))
      .limit(1);
    if (!shift) return { ok: false as const, error: 'ไม่พบ shift' };
    if (shift.status !== 'open') return { ok: false as const, error: 'shift นี้ปิดไปแล้ว' };

    // Cashier can only close own shift; owner/manager can close any
    if (role === 'cashier' && shift.cashierId !== userId)
      return { ok: false as const, error: 'cashier ปิดได้เฉพาะ shift ของตัวเอง' };

    // Calculate expectedCash = openingFloat + cash-method payments linked to this shift
    const [cashResult] = await db
      .select({ total: sum(payments.total) })
      .from(payments)
      .where(
        and(
          eq(payments.shiftId, shiftId),
          eq(payments.paymentMethod, 'cash'),
          eq(payments.status, 'completed'),
        ),
      );
    const cashTotal = Number(cashResult?.total ?? 0);
    const expectedCash = Number(shift.openingFloat) + cashTotal;
    const cashDifference = actualCash - expectedCash;

    if (cashDifference !== 0 && !differenceReason?.trim())
      return {
        ok: false as const,
        error: `ยอดเงินต่างกัน ${cashDifference >= 0 ? '+' : ''}${cashDifference.toFixed(2)} บาท — กรุณาระบุเหตุผล`,
      };

    await db
      .update(cashierShifts)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closedBy: userId,
        expectedCash: String(expectedCash),
        actualCash: String(actualCash),
        cashDifference: String(cashDifference),
        differenceReason: differenceReason ?? null,
      })
      .where(eq(cashierShifts.id, shiftId));

    writeAuditLog({
      userId,
      role,
      action: 'shift_close',
      entity: 'cashier_shifts',
      entityId: shiftId,
      before: { status: 'open', cashierId: shift.cashierId },
      after: { status: 'closed', expectedCash, actualCash, cashDifference },
    });

    return { ok: true as const, data: { shiftId, expectedCash, actualCash, cashDifference } };
  } catch (e) {
    console.error('[closeShift]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── reviewShift ─────────────────────────────────────────────────────────────
 *
 * Marks a closed shift as reviewed. Owner / manager only.
 *
 * Failure mode: UPDATE is the only write op. If it fails → shift remains 'closed'.
 */
export async function reviewShift(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const role = authSession.user.role;
  if (role !== 'owner' && role !== 'manager')
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น owner หรือ manager' };

  const parsed = reviewShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { shiftId, reviewNotes } = parsed.data;
  const userId = authSession.user.id;

  try {
    const [shift] = await db
      .select({ id: cashierShifts.id, status: cashierShifts.status })
      .from(cashierShifts)
      .where(eq(cashierShifts.id, shiftId))
      .limit(1);
    if (!shift) return { ok: false as const, error: 'ไม่พบ shift' };
    if (shift.status !== 'closed')
      return { ok: false as const, error: 'review ได้เฉพาะ shift ที่ปิดแล้ว' };

    await db
      .update(cashierShifts)
      .set({
        status: 'reviewed',
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes ?? null,
      })
      .where(eq(cashierShifts.id, shiftId));

    writeAuditLog({
      userId,
      role,
      action: 'shift_review',
      entity: 'cashier_shifts',
      entityId: shiftId,
      after: { status: 'reviewed', reviewNotes: reviewNotes ?? null },
    });

    return { ok: true as const };
  } catch (e) {
    console.error('[reviewShift]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── listShifts ──────────────────────────────────────────────────────────────
 *
 * Paginated shift list with optional filters.
 * cashier → own shifts only (cashierId filter silently overridden).
 * owner / manager → all shifts with optional cashierId, date range, status filter.
 */
export async function listShifts(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'cashier_shift:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = listShiftsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { dateFrom, dateTo, status, cashierId } = parsed.data;
  const role = authSession.user.role;
  const currentUserId = authSession.user.id;

  // Cashier always sees own shifts only
  const cashierIdFilter =
    role === 'cashier' ? currentUserId : (cashierId ?? undefined);

  try {
    const rows = await db
      .select({
        id: cashierShifts.id,
        cashierId: cashierShifts.cashierId,
        cashierName: users.name,
        branchId: cashierShifts.branchId,
        status: cashierShifts.status,
        openedAt: cashierShifts.openedAt,
        closedAt: cashierShifts.closedAt,
        openingFloat: cashierShifts.openingFloat,
        expectedCash: cashierShifts.expectedCash,
        actualCash: cashierShifts.actualCash,
        cashDifference: cashierShifts.cashDifference,
        differenceReason: cashierShifts.differenceReason,
        reviewedAt: cashierShifts.reviewedAt,
        reviewNotes: cashierShifts.reviewNotes,
      })
      .from(cashierShifts)
      .leftJoin(users, eq(cashierShifts.cashierId, users.id))
      .where(
        and(
          cashierIdFilter ? eq(cashierShifts.cashierId, cashierIdFilter) : undefined,
          dateFrom ? gte(cashierShifts.openedAt, new Date(dateFrom)) : undefined,
          dateTo ? lte(cashierShifts.openedAt, new Date(dateTo)) : undefined,
          status ? eq(cashierShifts.status, status) : undefined,
        ),
      )
      .orderBy(desc(cashierShifts.openedAt))
      .limit(200);

    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[listShifts]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
