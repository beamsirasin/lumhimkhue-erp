'use server';

/**
 * Phase 16G-A — Same-Day Cash Shift Backfill (owner/manager correction tool).
 *
 * Cash payment rows taken without an open shift have shift_id NULL and are
 * excluded from shift expectedCash (reconciliation R7a). This module lets the
 * owner/manager assign such rows to a cashier shift from the SAME business day,
 * with a mandatory reason and an atomic audit trail.
 *
 * Never changes payment amounts, methods, paid_at, receipt numbers, sessions,
 * or receipts — only payment_rows.shift_id (and, for already-closed shifts, the
 * shift's stored expectedCash/cashDifference so the backfilled cash actually
 * counts). All writes commit in one db.batch() together with the audit row.
 */

import { revalidatePath } from 'next/cache';
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { format, startOfDay } from 'date-fns';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import {
  auditLogs,
  cashierShifts,
  paymentMethods,
  paymentRows,
  payments,
  sessions,
  tables,
  users,
} from '@/lib/db/schema';
import { computeShiftCashSummary } from '@/lib/payments/money-math';

const TZ = 'Asia/Bangkok';

function dayRange(dateStr: string): { from: Date; to: Date } {
  const from = fromZonedTime(startOfDay(toZonedTime(new Date(dateStr), TZ)), TZ);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

function requireOwnerManager(role: string | undefined): string | null {
  if (role !== 'owner' && role !== 'manager') {
    return 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น owner หรือ manager';
  }
  return null;
}

/* ─── List unlinked same-day cash rows + assignable shifts ────────────────── */

export async function getCashBackfillData(dateStr: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const roleError = requireOwnerManager(authSession.user.role);
  if (roleError) return { ok: false as const, error: roleError };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { ok: false as const, error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  }
  const { from, to } = dayRange(dateStr);

  try {
    const [rows, shifts] = await Promise.all([
      db
        .select({
          id: paymentRows.id,
          paymentId: paymentRows.paymentId,
          amount: paymentRows.amount,
          paidAt: paymentRows.paidAt,
          receiptNo: payments.receiptNo,
          tableLabel: tables.label,
        })
        .from(paymentRows)
        .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
        .innerJoin(payments, eq(paymentRows.paymentId, payments.id))
        .leftJoin(sessions, eq(paymentRows.sessionId, sessions.id))
        .leftJoin(tables, eq(sessions.tableId, tables.id))
        .where(
          and(
            eq(paymentRows.status, 'completed'),
            eq(paymentMethods.type, 'cash'),
            isNull(paymentRows.shiftId),
            gte(paymentRows.paidAt, from),
            lt(paymentRows.paidAt, to),
          ),
        )
        .orderBy(asc(paymentRows.paidAt)),
      db
        .select({
          id: cashierShifts.id,
          status: cashierShifts.status,
          openedAt: cashierShifts.openedAt,
          closedAt: cashierShifts.closedAt,
          cashierName: users.name,
        })
        .from(cashierShifts)
        .innerJoin(users, eq(cashierShifts.cashierId, users.id))
        .where(and(gte(cashierShifts.openedAt, from), lt(cashierShifts.openedAt, to)))
        .orderBy(asc(cashierShifts.openedAt)),
    ]);

    return {
      ok: true as const,
      data: {
        rows: rows.map((r) => ({
          id: r.id,
          paymentId: r.paymentId,
          amount: Number(r.amount),
          paidAt: r.paidAt,
          receiptNo: r.receiptNo,
          tableLabel: r.tableLabel,
        })),
        // reviewed shifts are shown but not assignable (audited rounds are final)
        shifts,
      },
    };
  } catch (e) {
    console.error('[getCashBackfillData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── Assign selected rows to a same-day shift (atomic) ───────────────────── */

const assignSchema = z.object({
  paymentRowIds: z.array(z.string().uuid()).min(1),
  shiftId: z.string().uuid(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(500),
});

export async function assignCashRowsToShift(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const roleError = requireOwnerManager(authSession.user.role);
  if (roleError) return { ok: false as const, error: roleError };

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  }
  const { paymentRowIds, shiftId, reason } = parsed.data;

  try {
    const [shift] = await db
      .select()
      .from(cashierShifts)
      .where(eq(cashierShifts.id, shiftId));
    if (!shift) return { ok: false as const, error: 'ไม่พบรอบแคชเชียร์' };
    if (shift.status === 'reviewed') {
      return { ok: false as const, error: 'รอบนี้ผ่านการตรวจสอบแล้ว ไม่สามารถผูกเงินสดเพิ่มได้' };
    }

    // Same business day as the target shift (Asia/Bangkok)
    const shiftDay = format(toZonedTime(shift.openedAt, TZ), 'yyyy-MM-dd');
    const { from, to } = dayRange(shiftDay);

    const rows = await db
      .select({
        id: paymentRows.id,
        paymentId: paymentRows.paymentId,
        amount: paymentRows.amount,
        paidAt: paymentRows.paidAt,
        shiftId: paymentRows.shiftId,
        status: paymentRows.status,
        methodType: paymentMethods.type,
      })
      .from(paymentRows)
      .innerJoin(paymentMethods, eq(paymentRows.paymentMethodId, paymentMethods.id))
      .where(inArray(paymentRows.id, paymentRowIds));

    if (rows.length !== paymentRowIds.length) {
      return { ok: false as const, error: 'ไม่พบบางรายการที่เลือก กรุณาโหลดรายการใหม่' };
    }
    for (const r of rows) {
      if (r.methodType !== 'cash') return { ok: false as const, error: 'เลือกได้เฉพาะรายการเงินสดเท่านั้น' };
      if (r.status !== 'completed') return { ok: false as const, error: 'เลือกได้เฉพาะรายการที่สำเร็จแล้วเท่านั้น' };
      if (r.shiftId !== null) return { ok: false as const, error: 'บางรายการถูกผูกเข้ารอบไปแล้ว กรุณาโหลดรายการใหม่' };
      if (r.paidAt < from || r.paidAt >= to) {
        return { ok: false as const, error: 'เลือกได้เฉพาะรายการของวันเดียวกับรอบแคชเชียร์เท่านั้น' };
      }
    }

    const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);

    // ip captured pre-batch so the audit insert can run inside the batch
    const h = await headers();
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';

    // Atomic: rows update (+ closed-shift totals refresh) + audit row — all or nothing.
    const batchStatements: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db
        .update(paymentRows)
        .set({ shiftId })
        // isNull guard: a concurrently-assigned row is never silently re-assigned
        .where(and(inArray(paymentRows.id, paymentRowIds), isNull(paymentRows.shiftId))),
    ];

    // A closed shift stored its expectedCash/cashDifference at close time —
    // fold the backfilled cash in so the round actually accounts for it.
    // Open shifts need nothing: closeShift sums payment_rows by shift_id live.
    let shiftTotalsAfter: { expectedCash: number; cashDifference: number } | null = null;
    if (shift.status === 'closed' && shift.actualCash !== null) {
      const newExpected = Number(shift.expectedCash ?? 0) + totalAmount;
      shiftTotalsAfter = computeShiftCashSummary(newExpected, 0, Number(shift.actualCash));
      batchStatements.push(
        db
          .update(cashierShifts)
          .set({
            expectedCash: String(shiftTotalsAfter.expectedCash),
            cashDifference: String(shiftTotalsAfter.cashDifference),
          })
          .where(eq(cashierShifts.id, shiftId)),
      );
    }

    batchStatements.push(
      db.insert(auditLogs).values({
        userId: authSession.user.id,
        action: 'cash_shift_backfill',
        entity: 'payment_rows',
        entityId: shiftId,
        metadata: {
          role: authSession.user.role,
          before: {
            rows: rows.map((r) => ({
              id: r.id,
              paymentId: r.paymentId,
              amount: Number(r.amount),
              paidAt: r.paidAt.toISOString(),
              shiftId: null,
            })),
            shiftExpectedCash: shift.expectedCash,
            shiftCashDifference: shift.cashDifference,
          },
          after: {
            shiftId,
            shiftStatus: shift.status,
            rowCount: rows.length,
            totalAmount,
            shiftExpectedCash: shiftTotalsAfter ? String(shiftTotalsAfter.expectedCash) : shift.expectedCash,
            shiftCashDifference: shiftTotalsAfter ? String(shiftTotalsAfter.cashDifference) : shift.cashDifference,
          },
          reason,
          lateAssignment: true, // ผูกเข้ารอบย้อนหลัง — never hidden
          ip,
        },
      }),
    );

    await db.batch(batchStatements);

    revalidatePath('/pos/shifts');
    return { ok: true as const, data: { assigned: rows.length, totalAmount } };
  } catch (e) {
    console.error('[assignCashRowsToShift]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
