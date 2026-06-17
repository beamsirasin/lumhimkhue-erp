'use server';

import { eq, and, gte, not, desc, asc, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { writeAuditLog } from '@/lib/actions/audit';
import { db } from '@/lib/db';
import { sessions, tables, payments, paymentLineItems, paymentAdjustments, orders, orderItems, menuItems } from '@/lib/db/schema';

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
        payment: true,
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

    return { ok: true as const, data: { session, orders: sessionOrders } };
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

  try {
    await db.transaction(async (tx) => {
      // Fetch line items inside tx for a consistent snapshot point-in-time
      const lineItems = await tx
        .select({
          id: paymentLineItems.id,
          pricingTileId: paymentLineItems.pricingTileId,
          quantity: paymentLineItems.quantity,
          amount: paymentLineItems.amount,
        })
        .from(paymentLineItems)
        .where(eq(paymentLineItems.paymentId, paymentId));

      // Insert immutable audit record — must commit before any delete.
      // paymentId has no FK (Approach C): payment_adjustments survives after hard delete.
      await tx.insert(paymentAdjustments).values({
        paymentId: payment.id,
        sessionId: payment.sessionId,
        shiftId: payment.shiftId,
        type: 'void',
        amount: payment.total,
        reason: reason ?? 'ไม่ระบุ',
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
          context: {
            action: 'delete_payment',
            performedBy: authSession.user.id,
            performedAt: new Date().toISOString(),
          },
        },
      });

      // Hard delete — rolls back atomically if insert above failed
      await tx.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId));
      await tx.delete(payments).where(eq(payments.id, paymentId));
      // Mark session closed: stays in history but won't re-appear in POS
      await tx.update(sessions)
        .set({ status: 'closed' })
        .where(eq(sessions.id, payment.sessionId));
    });

    // Fire-and-forget secondary log (payment_adjustments is the primary audit trail)
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'delete_payment',
      entity: 'payments',
      entityId: paymentId,
      before: { sessionId: payment.sessionId },
      after: { deleted: true, reason: reason ?? 'ไม่ระบุ' },
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
    await db.transaction(async (tx) => {
      // Fetch line items inside tx for a consistent snapshot point-in-time
      const lineItems = await tx
        .select({
          id: paymentLineItems.id,
          pricingTileId: paymentLineItems.pricingTileId,
          quantity: paymentLineItems.quantity,
          amount: paymentLineItems.amount,
        })
        .from(paymentLineItems)
        .where(eq(paymentLineItems.paymentId, paymentId));

      // Insert immutable audit record — must commit before any delete.
      // paymentId has no FK (Approach C): payment_adjustments survives after hard delete.
      await tx.insert(paymentAdjustments).values({
        paymentId: payment.id,
        sessionId: payment.sessionId,
        shiftId: payment.shiftId,
        type: 'void',
        amount: payment.total,
        reason: reason ?? 'ไม่ระบุ',
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
          linkedSessions: groupLinked,
          context: {
            action: 'reopen_session',
            performedBy: authSession.user.id,
            performedAt: new Date().toISOString(),
            allSessionIds,
            allTableIds,
          },
        },
      });

      // Hard delete — rolls back atomically if insert above failed
      await tx.delete(paymentLineItems).where(eq(paymentLineItems.paymentId, paymentId));
      await tx.delete(payments).where(eq(payments.id, paymentId));
      await tx.update(sessions)
        .set({ status: 'closing', closedAt: null })
        .where(inArray(sessions.id, allSessionIds));
      await tx.update(tables)
        .set({ status: 'occupied' })
        .where(inArray(tables.id, allTableIds));
    });

    // Fire-and-forget secondary log (payment_adjustments is the primary audit trail)
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'reopen_session',
      entity: 'payments',
      entityId: paymentId,
      before: { sessionId: mainSession.id, linkedSessionIds: groupLinked.map((s) => s.id) },
      after: { sessionStatus: 'closing', reason: reason ?? 'ไม่ระบุ' },
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
