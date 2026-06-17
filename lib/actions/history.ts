'use server';

import { eq, and, gte, not, lte, desc, asc, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { writeAuditLog } from '@/lib/actions/audit';
import { db } from '@/lib/db';
import { sessions, tables, payments, paymentRows, paymentLineItems, paymentAdjustments, orders, auditLogs, cashierShifts, users } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

function dayRange(dateStr: string): { from: Date; to: Date } {
  const from = fromZonedTime(startOfDay(toZonedTime(new Date(dateStr), TZ)), TZ);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export async function getSessionHistory(dateStr: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports') && !can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const { from, to } = dayRange(dateStr);

    const rows = await db
      .select({
        sessionId: sessions.id,
        sessionToken: sessions.sessionToken,
        parentSessionId: sessions.parentSessionId,
        tableLabel: tables.label,
        zone: tables.zone,
        startedAt: sessions.startedAt,
        closedAt: sessions.closedAt,
        status: sessions.status,
        notes: sessions.notes,
        totalRevenue: sql<number>`coalesce(${payments.total}::numeric, 0)`,
        receivedAmount: sql<number>`coalesce(${payments.receivedAmount}::numeric, 0)`,
        paymentMethod: payments.paymentMethod,
        receiptNo: payments.receiptNo,
        guestCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          WHERE sg.session_id = ${sessions.id}
        )`,
        adultCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'adult'
        )`,
        childCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'child'
        )`,
        toddlerCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'toddler'
        )`,
        staffCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'staff'
        )`,
        staffGuestCount: sql<number>`(
          SELECT coalesce(sum(sg.quantity), 0)
          FROM session_guests sg
          INNER JOIN pricing_tiles pt ON pt.id = sg.pricing_tile_id
          WHERE sg.session_id = ${sessions.id} AND pt.code = 'staff_guest_first'
        )`,
      })
      .from(sessions)
      .innerJoin(tables, eq(sessions.tableId, tables.id))
      .leftJoin(payments, eq(payments.sessionId, sessions.id))
      .where(
        and(
          gte(sessions.startedAt, from),
          not(gte(sessions.startedAt, to)),
        ),
      )
      .orderBy(desc(sessions.startedAt));

    return {
      ok: true as const,
      data: rows.map((r) => ({
        sessionId: r.sessionId,
        sessionToken: r.sessionToken,
        parentSessionId: r.parentSessionId,
        tableLabel: r.tableLabel,
        zone: r.zone,
        startedAt: r.startedAt,
        closedAt: r.closedAt,
        status: r.status,
        notes: r.notes,
        totalRevenue: Number(r.totalRevenue),
        receivedAmount: Number(r.receivedAmount),
        paymentMethod: r.paymentMethod,
        receiptNo: r.receiptNo,
        guestCount: Number(r.guestCount),
        adultCount: Number(r.adultCount),
        childCount: Number(r.childCount),
        toddlerCount: Number(r.toddlerCount),
        staffCount: Number(r.staffCount),
        staffGuestCount: Number(r.staffGuestCount),
      })),
    };
  } catch (e) {
    console.error('[getSessionHistory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SessionHistoryRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionHistory>>, { ok: true }>['data']
>[number];

export async function getSessionDetail(sessionId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports') && !can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: {
        table: true,
        guests: { with: { pricingTile: true } },
        payment: {
          with: {
            rows: {
              with: {
                paymentMethod: true,
                receivingAccount: true,
              },
            },
          },
        },
      },
    });
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    const sessionOrders = await db.query.orders.findMany({
      where: eq(orders.sessionId, sessionId),
      orderBy: [asc(orders.createdAt)],
      with: {
        items: {
          with: { menuItem: true },
        },
      },
    });

    const paymentShiftRow = session.payment?.shiftId
      ? await db
          .select({ status: cashierShifts.status, closedAt: cashierShifts.closedAt })
          .from(cashierShifts)
          .where(eq(cashierShifts.id, session.payment.shiftId))
          .then((rows) => rows[0] ?? null)
      : null;
    return { ok: true as const, data: { session, orders: sessionOrders, paymentShift: paymentShiftRow } };
  } catch (e) {
    console.error('[getSessionDetail]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SessionDetailData = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionDetail>>, { ok: true }>['data']
>;

export async function getHistoryCalendarDates(year: number, month: number) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  try {
    const from = fromZonedTime(
      startOfDay(toZonedTime(new Date(year, month - 1, 1), TZ)),
      TZ,
    );
    const to = fromZonedTime(
      startOfDay(toZonedTime(new Date(year, month, 1), TZ)),
      TZ,
    );

    const rows = await db
      .select({
        date: sql<string>`(${sessions.startedAt} AT TIME ZONE 'Asia/Bangkok')::date`,
        count: sql<number>`count(*)`,
      })
      .from(sessions)
      .where(and(gte(sessions.startedAt, from), not(gte(sessions.startedAt, to))))
      .groupBy(sql`(${sessions.startedAt} AT TIME ZONE 'Asia/Bangkok')::date`);

    return {
      ok: true as const,
      data: Object.fromEntries(rows.map((r) => [r.date, Number(r.count)])),
    };
  } catch (e) {
    console.error('[getHistoryCalendarDates]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── deletePaymentRecord — ลบประวัติอย่างเดียว (ไม่เปิดโต๊ะใหม่) ──── */
//
// Phase 1 Step 4 (Approach C): INSERT payment_adjustments (immutable audit trail)
// inside same transaction before hard DELETE. If insert fails → rollback → payment kept.

export async function deletePaymentRecord(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  // Restricted to owner via payment:delete — cashier/manager ทำไม่ได้
  if (!can(authSession.user.role, 'payment:delete'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น owner เท่านั้น' };

  const parsed = z
    .object({
      paymentId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { paymentId, reason } = parsed.data;

  // Fetch full payment for snapshot outside tx — early return gives clean error message
  const [payment] = await db
    .select({
      id: payments.id,
      sessionId: payments.sessionId,
      subtotal: payments.subtotal,
      serviceCharge: payments.serviceCharge,
      discount: payments.discount,
      total: payments.total,
      paymentMethod: payments.paymentMethod,
      receivedAmount: payments.receivedAmount,
      changeAmount: payments.changeAmount,
      paidAt: payments.paidAt,
      processedBy: payments.processedBy,
      receiptNo: payments.receiptNo,
      notes: payments.notes,
      shiftId: payments.shiftId,
      status: payments.status,
    })
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };

  const normalizedReason = (reason ?? '').trim();

  const shift = payment.shiftId
    ? await db
        .select({ status: cashierShifts.status, closedAt: cashierShifts.closedAt })
        .from(cashierShifts)
        .where(eq(cashierShifts.id, payment.shiftId))
        .then((rows) => rows[0] ?? null)
    : null;
  const shiftStatusAtMutation: string | null = shift?.status ?? null;

  if (shift?.status === 'reviewed') {
    return { ok: false as const, error: 'ไม่สามารถแก้ไขการชำระเงินในรอบที่ตรวจสอบแล้ว' };
  }
  if (shift?.status === 'closed' && !normalizedReason) {
    return { ok: false as const, error: 'ต้องระบุเหตุผลสำหรับการแก้ไขในรอบที่ปิดแล้ว' };
  }

  try {
    // neon-http does not support db.transaction() — ops run sequentially.
    // INSERT is first (Approach C): if it fails → payment untouched.
    // If a subsequent delete fails → orphaned adjustment row (detectable) but payment preserved.
    const lineItems = await db
      .select({
        id: paymentLineItems.id,
        pricingTileId: paymentLineItems.pricingTileId,
        quantity: paymentLineItems.quantity,
        amount: paymentLineItems.amount,
      })
      .from(paymentLineItems)
      .where(eq(paymentLineItems.paymentId, paymentId));
    const rowItems = await db
      .select()
      .from(paymentRows)
      .where(eq(paymentRows.paymentId, paymentId));

    // Insert immutable audit record first — Approach C guarantee.
    // paymentId has no FK: payment_adjustments survives after hard delete.
    await db.insert(paymentAdjustments).values({
      paymentId: payment.id,
      sessionId: payment.sessionId,
      shiftId: payment.shiftId,
      type: 'void',
      amount: payment.total,
      reason: normalizedReason || 'ไม่ระบุ',
      requestedBy: authSession.user.id,
      approvedBy: authSession.user.id,
      approvedAt: new Date(),
      status: 'approved',
      paymentSnapshot: {
        payment: {
          id: payment.id,
          sessionId: payment.sessionId,
          subtotal: payment.subtotal,
          serviceCharge: payment.serviceCharge,
          discount: payment.discount,
          total: payment.total,
          paymentMethod: payment.paymentMethod,
          receivedAmount: payment.receivedAmount,
          changeAmount: payment.changeAmount,
          paidAt: payment.paidAt.toISOString(),
          processedBy: payment.processedBy,
          receiptNo: payment.receiptNo,
          notes: payment.notes,
          shiftId: payment.shiftId,
          status: payment.status,
        },
        lineItems,
        paymentRows: rowItems,
        context: {
          action: 'delete_payment',
          performedBy: authSession.user.id,
          performedAt: new Date().toISOString(),
          shiftStatusAtMutation,
          shiftClosedAt: shift?.closedAt ? new Date(shift.closedAt).toISOString() : null,
          mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
          reason: normalizedReason || 'ไม่ระบุ',
        },
      },
    });

    await db.delete(paymentRows).where(eq(paymentRows.paymentId, paymentId));
    await db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId));
    await db.delete(payments).where(eq(payments.id, paymentId));
    // Mark session closed: stays in history but won't re-appear in POS
    await db.update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, payment.sessionId));

    // Fire-and-forget secondary log (payment_adjustments is the primary audit trail)
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'delete_payment',
      entity: 'payments',
      entityId: paymentId,
      before: {
        sessionId: payment.sessionId,
        shiftId: payment.shiftId ?? null,
        shiftStatusAtMutation,
        mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
      },
      after: { deleted: true, reason: normalizedReason || 'ไม่ระบุ' },
    });

    revalidatePath('/pos/history');
    revalidatePath('/tables/history');
    return { ok: true as const };
  } catch (e) {
    console.error('[deletePaymentRecord]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── reopenSessionForPayment — ยกเลิกการชำระ แล้วส่งกลับ POS ──────── */
//
// Phase 1 Step 4 (Approach C): INSERT payment_adjustments inside same transaction
// before hard DELETE. If insert fails → rollback → session NOT reopened.

export async function reopenSessionForPayment(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  // Restricted to owner + manager via payment:reopen — cashier ทำไม่ได้
  if (!can(authSession.user.role, 'payment:reopen'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ — ต้องเป็น owner หรือ manager' };

  const parsed = z
    .object({
      paymentId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { paymentId, reason } = parsed.data;

  // Fetch full payment for snapshot outside tx — early return gives clean error message
  const [payment] = await db
    .select({
      id: payments.id,
      sessionId: payments.sessionId,
      subtotal: payments.subtotal,
      serviceCharge: payments.serviceCharge,
      discount: payments.discount,
      total: payments.total,
      paymentMethod: payments.paymentMethod,
      receivedAmount: payments.receivedAmount,
      changeAmount: payments.changeAmount,
      paidAt: payments.paidAt,
      processedBy: payments.processedBy,
      receiptNo: payments.receiptNo,
      notes: payments.notes,
      shiftId: payments.shiftId,
      status: payments.status,
    })
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) return { ok: false as const, error: 'ไม่พบข้อมูลการชำระเงิน' };

  const normalizedReason = (reason ?? '').trim();

  const shift = payment.shiftId
    ? await db
        .select({ status: cashierShifts.status, closedAt: cashierShifts.closedAt })
        .from(cashierShifts)
        .where(eq(cashierShifts.id, payment.shiftId))
        .then((rows) => rows[0] ?? null)
    : null;
  const shiftStatusAtMutation: string | null = shift?.status ?? null;

  if (shift?.status === 'reviewed') {
    return { ok: false as const, error: 'ไม่สามารถแก้ไขการชำระเงินในรอบที่ตรวจสอบแล้ว' };
  }
  if (shift?.status === 'closed' && !normalizedReason) {
    return { ok: false as const, error: 'ต้องระบุเหตุผลสำหรับการแก้ไขในรอบที่ปิดแล้ว' };
  }
  if (shift?.status === 'closed' && authSession.user.role === 'manager') {
    return { ok: false as const, error: 'เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขการชำระเงินในรอบที่ปิดแล้วได้' };
  }

  const [mainSession] = await db
    .select({ id: sessions.id, tableId: sessions.tableId })
    .from(sessions)
    .where(eq(sessions.id, payment.sessionId));
  if (!mainSession) return { ok: false as const, error: 'ไม่พบ session' };

  // Include group-bill linked sessions (different table), not split children (same table)
  const childSessions = await db
    .select({ id: sessions.id, tableId: sessions.tableId })
    .from(sessions)
    .where(eq(sessions.parentSessionId, mainSession.id));
  const groupLinked = childSessions.filter((s) => s.tableId !== mainSession.tableId);

  const allSessionIds = [mainSession.id, ...groupLinked.map((s) => s.id)];
  const allTableIds = [...new Set([mainSession.tableId, ...groupLinked.map((s) => s.tableId)])];

  try {
    // neon-http does not support db.transaction() — ops run sequentially.
    // INSERT is first (Approach C): if it fails → payment untouched.
    const lineItems = await db
      .select({
        id: paymentLineItems.id,
        pricingTileId: paymentLineItems.pricingTileId,
        quantity: paymentLineItems.quantity,
        amount: paymentLineItems.amount,
      })
      .from(paymentLineItems)
      .where(eq(paymentLineItems.paymentId, paymentId));
    const rowItems = await db
      .select()
      .from(paymentRows)
      .where(eq(paymentRows.paymentId, paymentId));

    // Insert immutable audit record first — Approach C guarantee.
    // paymentId has no FK: payment_adjustments survives after hard delete.
    await db.insert(paymentAdjustments).values({
      paymentId: payment.id,
      sessionId: payment.sessionId,
      shiftId: payment.shiftId,
      type: 'void',
      amount: payment.total,
      reason: normalizedReason || 'ไม่ระบุ',
      requestedBy: authSession.user.id,
      approvedBy: authSession.user.id,
      approvedAt: new Date(),
      status: 'approved',
      paymentSnapshot: {
        payment: {
          id: payment.id,
          sessionId: payment.sessionId,
          subtotal: payment.subtotal,
          serviceCharge: payment.serviceCharge,
          discount: payment.discount,
          total: payment.total,
          paymentMethod: payment.paymentMethod,
          receivedAmount: payment.receivedAmount,
          changeAmount: payment.changeAmount,
          paidAt: payment.paidAt.toISOString(),
          processedBy: payment.processedBy,
          receiptNo: payment.receiptNo,
          notes: payment.notes,
          shiftId: payment.shiftId,
          status: payment.status,
        },
        lineItems,
        paymentRows: rowItems,
        linkedSessions: groupLinked,
        context: {
          action: 'reopen_session',
          performedBy: authSession.user.id,
          performedAt: new Date().toISOString(),
          allSessionIds,
          allTableIds,
          shiftStatusAtMutation,
          shiftClosedAt: shift?.closedAt ? new Date(shift.closedAt).toISOString() : null,
          mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
          reason: normalizedReason || 'ไม่ระบุ',
        },
      },
    });

    await db.delete(paymentRows).where(eq(paymentRows.paymentId, paymentId));
    await db.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId));
    await db.delete(payments).where(eq(payments.id, paymentId));
    await db.update(sessions)
      .set({ status: 'closing', closedAt: null })
      .where(inArray(sessions.id, allSessionIds));
    await db.update(tables)
      .set({ status: 'occupied' })
      .where(inArray(tables.id, allTableIds));

    // Fire-and-forget secondary log (payment_adjustments is the primary audit trail)
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'reopen_session',
      entity: 'payments',
      entityId: paymentId,
      before: {
        sessionId: mainSession.id,
        linkedSessionIds: groupLinked.map((s) => s.id),
        shiftId: payment.shiftId ?? null,
        shiftStatusAtMutation,
        mutationAfterClose: shiftStatusAtMutation === 'closed' || shiftStatusAtMutation === 'reviewed',
      },
      after: { sessionStatus: 'closing', reason: normalizedReason || 'ไม่ระบุ' },
    });

    revalidatePath('/pos');
    revalidatePath('/pos/history');
    revalidatePath('/tables');
    revalidatePath('/tables/history');
    return { ok: true as const, sessionId: mainSession.id };
  } catch (e) {
    console.error('[reopenSessionForPayment]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── Phase 1 Step 7: Audit / Fraud Report ─────────────────────────────────*/

const AUDIT_ACTIONS = [
  'delete_payment', 'void_payment', 'reopen_session', 'process_payment',
  'shift_open', 'shift_close', 'shift_review',
  'discount_request', 'discount_approve', 'discount_reject',
  'cancel_order',
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

const auditReportSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo:   z.string().optional(),
  action:   z.enum(AUDIT_ACTIONS).optional(),
  userId:   z.string().uuid().optional(),
});

export async function getAuditReport(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const role = authSession.user.role;
  if (role !== 'owner' && role !== 'manager')
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = auditReportSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { dateFrom, dateTo, action, userId } = parsed.data;

  try {
    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        userId: auditLogs.userId,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(
        and(
          inArray(auditLogs.action, [...AUDIT_ACTIONS]),
          action   ? eq(auditLogs.action, action)              : undefined,
          userId   ? eq(auditLogs.userId, userId)              : undefined,
          dateFrom ? gte(auditLogs.createdAt, new Date(dateFrom)) : undefined,
          dateTo   ? lte(auditLogs.createdAt, new Date(dateTo))   : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(500);

    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getAuditReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type AuditReportRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getAuditReport>>, { ok: true }>['data']
>[number];

const shiftReportSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo:   z.string().optional(),
  cashierId: z.string().uuid().optional(),
});

export async function getShiftReport(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const role = authSession.user.role;
  if (role !== 'owner' && role !== 'manager')
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = shiftReportSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { dateFrom, dateTo, cashierId } = parsed.data;

  try {
    const rows = await db
      .select({
        id: cashierShifts.id,
        cashierId: cashierShifts.cashierId,
        cashierName: users.name,
        status: cashierShifts.status,
        openedAt: cashierShifts.openedAt,
        closedAt: cashierShifts.closedAt,
        openingFloat: cashierShifts.openingFloat,
        expectedCash: cashierShifts.expectedCash,
        actualCash: cashierShifts.actualCash,
        cashDifference: cashierShifts.cashDifference,
        differenceReason: cashierShifts.differenceReason,
        reviewNotes: cashierShifts.reviewNotes,
        reviewedAt: cashierShifts.reviewedAt,
      })
      .from(cashierShifts)
      .leftJoin(users, eq(cashierShifts.cashierId, users.id))
      .where(
        and(
          cashierId ? eq(cashierShifts.cashierId, cashierId)        : undefined,
          dateFrom  ? gte(cashierShifts.openedAt, new Date(dateFrom)) : undefined,
          dateTo    ? lte(cashierShifts.openedAt, new Date(dateTo))   : undefined,
        ),
      )
      .orderBy(desc(cashierShifts.openedAt))
      .limit(200);

    return {
      ok: true as const,
      data: rows.map((r) => ({
        ...r,
        openingFloat: Number(r.openingFloat),
        expectedCash: r.expectedCash != null ? Number(r.expectedCash) : null,
        actualCash:   r.actualCash   != null ? Number(r.actualCash)   : null,
        cashDifference: r.cashDifference != null ? Number(r.cashDifference) : null,
      })),
    };
  } catch (e) {
    console.error('[getShiftReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type ShiftReportRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getShiftReport>>, { ok: true }>['data']
>[number];

export async function getPaymentAdjustmentsReport(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  const role = authSession.user.role;
  if (role !== 'owner' && role !== 'manager')
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = z.object({
    dateFrom: z.string().optional(),
    dateTo:   z.string().optional(),
  }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { dateFrom, dateTo } = parsed.data;

  try {
    const rows = await db
      .select({
        id: paymentAdjustments.id,
        paymentId: paymentAdjustments.paymentId,
        sessionId: paymentAdjustments.sessionId,
        shiftId: paymentAdjustments.shiftId,
        type: paymentAdjustments.type,
        amount: paymentAdjustments.amount,
        reason: paymentAdjustments.reason,
        status: paymentAdjustments.status,
        createdAt: paymentAdjustments.createdAt,
        requestedBy: paymentAdjustments.requestedBy,
        requesterName: users.name,
        paymentSnapshot: paymentAdjustments.paymentSnapshot,
      })
      .from(paymentAdjustments)
      .leftJoin(users, eq(paymentAdjustments.requestedBy, users.id))
      .where(
        and(
          dateFrom ? gte(paymentAdjustments.createdAt, new Date(dateFrom)) : undefined,
          dateTo   ? lte(paymentAdjustments.createdAt, new Date(dateTo))   : undefined,
        ),
      )
      .orderBy(desc(paymentAdjustments.createdAt))
      .limit(500);

    return {
      ok: true as const,
      data: rows.map((r) => {
        const snapshot = r.paymentSnapshot as Record<string, unknown> | null;
        const context =
          snapshot && typeof snapshot.context === 'object' && snapshot.context !== null
            ? (snapshot.context as Record<string, unknown>)
            : {};
        const rawRows: Array<Record<string, unknown>> = Array.isArray(snapshot?.paymentRows)
          ? (snapshot?.paymentRows as Array<Record<string, unknown>>)
          : [];

        const paymentRowsBefore = rawRows.map((pr) => ({
          paymentMethodId: String(pr.paymentMethodId ?? pr.payment_method_id ?? ''),
          receivingAccountId:
            (pr.receivingAccountId ?? pr.receiving_account_id) != null
              ? String(pr.receivingAccountId ?? pr.receiving_account_id)
              : null,
          amount: Number(pr.amount ?? 0),
          amountTendered:
            (pr.amountTendered ?? pr.amount_tendered) != null
              ? Number(pr.amountTendered ?? pr.amount_tendered)
              : null,
          changeAmount:
            (pr.changeAmount ?? pr.change_amount) != null
              ? Number(pr.changeAmount ?? pr.change_amount)
              : null,
          status: String(pr.status ?? ''),
        }));

        const collectionImpact =
          Math.round(paymentRowsBefore.reduce((s, row) => s + row.amount, 0) * 100) / 100;

        return {
          id: r.id,
          paymentId: r.paymentId,
          sessionId: r.sessionId,
          shiftId: r.shiftId ?? null,
          type: r.type,
          amount: Number(r.amount),
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
          requestedBy: r.requestedBy,
          requesterName: r.requesterName,
          mutationAction: typeof context.action === 'string' ? context.action : null,
          shiftStatusAtMutation:
            typeof context.shiftStatusAtMutation === 'string'
              ? context.shiftStatusAtMutation
              : null,
          shiftClosedAt:
            typeof context.shiftClosedAt === 'string' ? context.shiftClosedAt : null,
          mutationAfterClose: context.mutationAfterClose === true,
          mutationReason:
            typeof context.reason === 'string' ? context.reason : (r.reason ?? null),
          paymentRowsBefore,
          collectionImpact,
          paymentRowCount: paymentRowsBefore.length,
        };
      }),
    };
  } catch (e) {
    console.error('[getPaymentAdjustmentsReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
