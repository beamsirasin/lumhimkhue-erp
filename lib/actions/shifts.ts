'use server';

import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { writeAuditLog } from '@/lib/actions/audit';
import { consumeManagerApprovalCode } from '@/lib/actions/manager-approval';
import { db } from '@/lib/db';
import {
  cashierShifts,
  paymentRows,
  paymentMethods,
  receivingAccounts,
  storeBusinessDays,
  users,
} from '@/lib/db/schema';
import {
  openShiftSchema,
  closeShiftSchema,
  reviewShiftSchema,
  listShiftsSchema,
  storeDayApprovalSchema,
} from '@/lib/validations/shifts';
import { computeShiftCashSummary } from '@/lib/payments/money-math';
import {
  getBangkokBusinessDate,
  getStoreBusinessDayState,
  STORE_DAY_CLOSED_ERROR,
} from '@/lib/business-day';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ─── Store business day (Phase 17POS-AUTH-A5) ────────────────────────────── */

export async function getStoreDayStatus() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  try {
    return { ok: true as const, data: await getStoreBusinessDayState() };
  } catch (error) {
    console.error('[getStoreDayStatus]', error);
    return { ok: false as const, error: 'โหลดสถานะวันทำการไม่สำเร็จ' };
  }
}

export async function closeStoreDay(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const parsed = storeDayApprovalSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'กรุณาระบุรหัสอนุมัติและเหตุผล' };

  const { approvalCode, reason } = parsed.data;
  const businessDate = getBangkokBusinessDate();
  const userId = authSession.user.id;
  const role = authSession.user.role;

  try {
    const current = await getStoreBusinessDayState();
    if (current.status === 'closed')
      return { ok: false as const, error: 'ร้านปิดรอบวันสำหรับวันนี้แล้ว' };

    const approval = await consumeManagerApprovalCode({
      code: approvalCode,
      action: 'pos_store_day_close',
      entityType: 'store_business_days',
      entityId: businessDate,
      requestedByUserId: userId,
      requestedByRole: role,
      requestedByBranchId: authSession.user.branchId ?? null,
      reason,
    });
    if (!approval.ok) return approval;

    const now = new Date();
    const [day] = await db
      .insert(storeBusinessDays)
      .values({
        businessDate,
        status: 'closed',
        closedAt: now,
        closedByUserId: userId,
        closeApprovalCodeId: approval.codeId,
        closeReason: reason,
      })
      .onConflictDoUpdate({
        target: storeBusinessDays.businessDate,
        set: {
          status: 'closed',
          closedAt: now,
          closedByUserId: userId,
          closeApprovalCodeId: approval.codeId,
          closeReason: reason,
          reopenedAt: null,
          reopenedByUserId: null,
          reopenApprovalCodeId: null,
          reopenReason: null,
          updatedAt: now,
        },
      })
      .returning({ id: storeBusinessDays.id });

    writeAuditLog({
      userId,
      role,
      action: 'sensitive_action_approved_by_code',
      entity: 'store_business_days',
      entityId: day.id,
      before: { status: 'open', businessDate },
      after: {
        actionKey: 'pos_store_day_close',
        status: 'closed',
        businessDate,
        reason,
        approvalCodeId: approval.codeId,
        generatedByUserId: approval.generatedByUserId,
        selfApproved: approval.generatedByUserId === userId,
      },
    });

    return { ok: true as const, data: { businessDate, status: 'closed' as const, closedAt: now } };
  } catch (error) {
    console.error('[closeStoreDay]', error);
    return { ok: false as const, error: 'ปิดรอบวันไม่สำเร็จ' };
  }
}

export async function reopenStoreDay(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const parsed = storeDayApprovalSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'กรุณาระบุรหัสอนุมัติและเหตุผล' };

  const { approvalCode, reason } = parsed.data;
  const businessDate = getBangkokBusinessDate();
  const userId = authSession.user.id;
  const role = authSession.user.role;

  try {
    const current = await getStoreBusinessDayState();
    if (current.status === 'open')
      return { ok: false as const, error: 'ร้านเปิดรับชำระสำหรับวันนี้อยู่แล้ว' };

    const approval = await consumeManagerApprovalCode({
      code: approvalCode,
      action: 'pos_store_day_reopen',
      entityType: 'store_business_days',
      entityId: businessDate,
      requestedByUserId: userId,
      requestedByRole: role,
      requestedByBranchId: authSession.user.branchId ?? null,
      reason,
    });
    if (!approval.ok) return approval;

    const now = new Date();
    const [day] = await db
      .update(storeBusinessDays)
      .set({
        status: 'open',
        reopenedAt: now,
        reopenedByUserId: userId,
        reopenApprovalCodeId: approval.codeId,
        reopenReason: reason,
        updatedAt: now,
      })
      .where(and(
        eq(storeBusinessDays.businessDate, businessDate),
        eq(storeBusinessDays.status, 'closed'),
      ))
      .returning({ id: storeBusinessDays.id });

    if (!day) return { ok: false as const, error: 'สถานะวันทำการเปลี่ยนไปแล้ว กรุณาลองใหม่' };

    writeAuditLog({
      userId,
      role,
      action: 'sensitive_action_approved_by_code',
      entity: 'store_business_days',
      entityId: day.id,
      before: { status: 'closed', businessDate },
      after: {
        actionKey: 'pos_store_day_reopen',
        status: 'open',
        businessDate,
        reason,
        approvalCodeId: approval.codeId,
        generatedByUserId: approval.generatedByUserId,
        selfApproved: approval.generatedByUserId === userId,
      },
    });

    return { ok: true as const, data: { businessDate, status: 'open' as const, reopenedAt: now } };
  } catch (error) {
    console.error('[reopenStoreDay]', error);
    return { ok: false as const, error: 'เปิดวันทำการอีกครั้งไม่สำเร็จ' };
  }
}

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
    const dayState = await getStoreBusinessDayState();
    if (dayState.status === 'closed') return { ok: false as const, error: STORE_DAY_CLOSED_ERROR };

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

    // Calculate expectedCash = openingFloat + cash-type payment_rows linked to this shift.
    // payment_rows.amount is the net bill-share (amountTendered − changeAmount for cash),
    // so this formula correctly gives the expected drawer balance without double-counting change.
    const [cashResult] = await db
      .select({ total: sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)` })
      .from(paymentRows)
      .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
      .where(
        and(
          eq(paymentRows.shiftId, shiftId),
          eq(paymentRows.status, 'completed'),
          eq(paymentMethods.type, 'cash'),
        ),
      );
    const cashTotal = Number(cashResult?.total ?? 0);
    // Phase 16D: formula extracted to money-math (golden copy, tested)
    const { expectedCash, cashDifference } = computeShiftCashSummary(shift.openingFloat, cashTotal, actualCash);

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

/* ─── getShiftCashPreview ─────────────────────────────────────────────────────
 *
 * Live preview of collection totals for an open shift, computed from payment_rows.
 * Read-only — does not write anything. Used by the close modal to show the cashier
 * what the system expects before they enter the actual cash count.
 *
 * cashier → own open shift only; owner/manager → any open shift.
 */

export type ShiftCashPreview = {
  shiftId: string;
  openingFloat: number;
  cashSales: number;
  expectedCashInDrawer: number;
  promptpayTotal: number;
  welfareTotal: number;
  legacyTotal: number;
  totalCollected: number;
  rowCount: number;
};

export async function getShiftCashPreview(shiftId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'cashier_shift:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = z.string().uuid().safeParse(shiftId);
  if (!parsed.success) return { ok: false as const, error: 'shiftId ไม่ถูกต้อง' };

  const role = authSession.user.role;
  const userId = authSession.user.id;

  try {
    const [shift] = await db
      .select()
      .from(cashierShifts)
      .where(eq(cashierShifts.id, shiftId))
      .limit(1);
    if (!shift) return { ok: false as const, error: 'ไม่พบ shift' };
    if (shift.status !== 'open') return { ok: false as const, error: 'preview ได้เฉพาะ shift ที่เปิดอยู่' };

    if (role === 'cashier' && shift.cashierId !== userId)
      return { ok: false as const, error: 'cashier ดูได้เฉพาะ shift ของตัวเอง' };

    // Single grouped query — one row per payment method type
    const typeRows = await db
      .select({
        methodType: paymentMethods.type,
        total:      sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)`,
        cnt:        sql<number>`count(*)::int`,
      })
      .from(paymentRows)
      .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
      .where(
        and(
          eq(paymentRows.shiftId, shiftId),
          eq(paymentRows.status, 'completed'),
        ),
      )
      .groupBy(paymentMethods.type);

    let cashSales = 0, promptpayTotal = 0, welfareTotal = 0, legacyTotal = 0;
    let totalCollected = 0, rowCount = 0;

    for (const r of typeRows) {
      const amt = roundMoney(Number(r.total));
      const cnt = Number(r.cnt);
      totalCollected = roundMoney(totalCollected + amt);
      rowCount += cnt;
      if (r.methodType === 'cash')         cashSales      = amt;
      if (r.methodType === 'promptpay')    promptpayTotal = amt;
      if (r.methodType === 'welfare')      welfareTotal   = amt;
      if (r.methodType === 'mixed_legacy') legacyTotal    = amt;
    }

    const openingFloat = roundMoney(Number(shift.openingFloat));
    const expectedCashInDrawer = roundMoney(openingFloat + cashSales);

    return {
      ok: true as const,
      data: {
        shiftId,
        openingFloat,
        cashSales,
        expectedCashInDrawer,
        promptpayTotal,
        welfareTotal,
        legacyTotal,
        totalCollected,
        rowCount,
      } satisfies ShiftCashPreview,
    };
  } catch (e) {
    console.error('[getShiftCashPreview]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── getShiftCollectionBreakdown ────────────────────────────────────────────
 *
 * Live collection breakdown for any shift (open, closed, or reviewed).
 * Queries completed payment_rows for the shift and returns per-method,
 * per-account, and account×method matrix totals.
 *
 * cashier → own shift only; owner/manager → any shift.
 * No status guard — unlike getShiftCashPreview, this works for all statuses.
 */

export type ShiftCollectionBreakdown = {
  shiftId: string;
  totalCollected: number;
  cashTotal: number;
  promptpayTotal: number;
  welfareTotal: number;
  legacyTotal: number;
  rowCount: number;
  methodSummary: Array<{
    methodId: string;
    methodCode: string;
    methodName: string;
    methodType: string;
    amount: number;
    rowCount: number;
  }>;
  accountSummary: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    amount: number;
    rowCount: number;
  }>;
  matrix: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    methods: Array<{
      methodId: string;
      methodCode: string;
      methodName: string;
      methodType: string;
      amount: number;
    }>;
    total: number;
  }>;
};

export async function getShiftCollectionBreakdown(shiftId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'cashier_shift:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = z.string().uuid().safeParse(shiftId);
  if (!parsed.success) return { ok: false as const, error: 'shiftId ไม่ถูกต้อง' };

  const role = authSession.user.role;
  const userId = authSession.user.id;

  try {
    const [shift] = await db
      .select({ id: cashierShifts.id, cashierId: cashierShifts.cashierId })
      .from(cashierShifts)
      .where(eq(cashierShifts.id, shiftId))
      .limit(1);
    if (!shift) return { ok: false as const, error: 'ไม่พบ shift' };

    if (role === 'cashier' && shift.cashierId !== userId)
      return { ok: false as const, error: 'cashier ดูได้เฉพาะ shift ของตัวเอง' };

    const shiftFilter = and(
      eq(paymentRows.shiftId, shiftId),
      eq(paymentRows.status, 'completed'),
    );

    const [methodRows, accountRows, matrixRaw] = await Promise.all([
      // Query 1: method summary
      db
        .select({
          methodId:   paymentMethods.id,
          methodCode: paymentMethods.code,
          methodName: paymentMethods.name,
          methodType: paymentMethods.type,
          amount:     sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)`,
          rowCount:   sql<number>`count(*)::int`,
        })
        .from(paymentRows)
        .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
        .where(shiftFilter)
        .groupBy(paymentMethods.id, paymentMethods.code, paymentMethods.name, paymentMethods.type)
        .orderBy(paymentMethods.sortOrder, paymentMethods.name),

      // Query 2: account summary
      db
        .select({
          accountId:   receivingAccounts.id,
          accountCode: receivingAccounts.code,
          accountName: receivingAccounts.name,
          accountType: receivingAccounts.type,
          amount:      sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)`,
          rowCount:    sql<number>`count(*)::int`,
        })
        .from(paymentRows)
        .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
        .where(shiftFilter)
        .groupBy(receivingAccounts.id, receivingAccounts.code, receivingAccounts.name, receivingAccounts.type)
        .orderBy(receivingAccounts.sortOrder, receivingAccounts.name),

      // Query 3: account × method matrix raw
      db
        .select({
          accountId:   receivingAccounts.id,
          accountCode: receivingAccounts.code,
          accountName: receivingAccounts.name,
          accountType: receivingAccounts.type,
          methodId:    paymentMethods.id,
          methodCode:  paymentMethods.code,
          methodName:  paymentMethods.name,
          methodType:  paymentMethods.type,
          amount:      sql<number>`coalesce(sum(${paymentRows.amount}::numeric), 0)`,
        })
        .from(paymentRows)
        .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
        .innerJoin(receivingAccounts, eq(paymentRows.receivingAccountId, receivingAccounts.id))
        .where(shiftFilter)
        .groupBy(
          receivingAccounts.id, receivingAccounts.code, receivingAccounts.name, receivingAccounts.type,
          paymentMethods.id, paymentMethods.code, paymentMethods.name, paymentMethods.type,
        )
        .orderBy(
          receivingAccounts.sortOrder, receivingAccounts.name,
          paymentMethods.sortOrder, paymentMethods.name,
        ),
    ]);

    // Assemble method summary
    const methodSummary: ShiftCollectionBreakdown['methodSummary'] = methodRows.map((r) => ({
      methodId:   r.methodId,
      methodCode: r.methodCode,
      methodName: r.methodName,
      methodType: r.methodType,
      amount:     roundMoney(Number(r.amount)),
      rowCount:   Number(r.rowCount),
    }));

    // Assemble account summary
    const accountSummary: ShiftCollectionBreakdown['accountSummary'] = accountRows.map((r) => ({
      accountId:   r.accountId,
      accountCode: r.accountCode,
      accountName: r.accountName,
      accountType: r.accountType,
      amount:      roundMoney(Number(r.amount)),
      rowCount:    Number(r.rowCount),
    }));

    // Build account × method matrix in JS
    const matrixMap = new Map<string, ShiftCollectionBreakdown['matrix'][number]>();
    for (const r of matrixRaw) {
      if (!matrixMap.has(r.accountId)) {
        matrixMap.set(r.accountId, {
          accountId: r.accountId, accountCode: r.accountCode,
          accountName: r.accountName, accountType: r.accountType,
          methods: [], total: 0,
        });
      }
      const entry = matrixMap.get(r.accountId)!;
      const methodAmount = roundMoney(Number(r.amount));
      entry.methods.push({
        methodId:   r.methodId,
        methodCode: r.methodCode,
        methodName: r.methodName,
        methodType: r.methodType,
        amount:     methodAmount,
      });
      entry.total = roundMoney(entry.total + methodAmount);
    }
    const matrix = Array.from(matrixMap.values());

    // Compute totals from method summary
    const totalCollected = roundMoney(methodSummary.reduce((s, m) => s + m.amount, 0));
    const cashTotal      = roundMoney(methodSummary.filter((m) => m.methodType === 'cash').reduce((s, m) => s + m.amount, 0));
    const promptpayTotal = roundMoney(methodSummary.filter((m) => m.methodType === 'promptpay').reduce((s, m) => s + m.amount, 0));
    const welfareTotal   = roundMoney(methodSummary.filter((m) => m.methodType === 'welfare').reduce((s, m) => s + m.amount, 0));
    const legacyTotal    = roundMoney(methodSummary.filter((m) => m.methodType === 'mixed_legacy').reduce((s, m) => s + m.amount, 0));
    const rowCount       = methodSummary.reduce((s, m) => s + m.rowCount, 0);

    return {
      ok: true as const,
      data: {
        shiftId,
        totalCollected,
        cashTotal,
        promptpayTotal,
        welfareTotal,
        legacyTotal,
        rowCount,
        methodSummary,
        accountSummary,
        matrix,
      } satisfies ShiftCollectionBreakdown,
    };
  } catch (e) {
    console.error('[getShiftCollectionBreakdown]', e);
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
