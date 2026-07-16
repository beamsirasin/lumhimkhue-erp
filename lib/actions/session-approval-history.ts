'use server';

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { auditLogs, paymentAdjustments, pricingTiles, users } from '@/lib/db/schema';

type JsonRecord = Record<string, unknown>;

export interface SessionApprovalHistoryChange {
  label: string;
  before: string;
  after: string;
}

export interface SessionApprovalHistoryItem {
  id: string;
  actionKey: string;
  actionLabel: string;
  reason: string | null;
  actorName: string | null;
  actorRole: string;
  codeOwnerName: string | null;
  selfApproved: boolean | null;
  createdAt: Date;
  changes: SessionApprovalHistoryChange[];
}

function asRecord(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function guestQuantities(value: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!Array.isArray(value)) return result;
  for (const row of value) {
    const record = asRecord(row);
    const id = asString(record.pricingTileId);
    const quantity = Number(record.quantity ?? 0);
    if (id && Number.isFinite(quantity)) result.set(id, quantity);
  }
  return result;
}

function formatMoney(value: unknown): string {
  const amount = Number(value ?? 0);
  return `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ACTION_LABELS: Record<string, string> = {
  pos_saved_guest_count_edit: 'แก้ไขจำนวนผู้เข้าใช้บริการ',
  pos_payment_delete: 'ลบรายการชำระเงิน',
  pos_payment_reopen: 'เปิดบิลกลับไปแก้ไขการชำระเงิน',
};

export async function getSessionApprovalHistory(sessionId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports') && !can(authSession.user.role, 'manage_tables')) {
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  }

  try {
    const logs = await db
      .select({
        id: auditLogs.id,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(and(
        eq(auditLogs.action, 'sensitive_action_approved_by_code'),
        or(
          and(eq(auditLogs.entity, 'session'), eq(auditLogs.entityId, sessionId)),
          sql`${auditLogs.metadata} -> 'after' ->> 'sessionId' = ${sessionId}`,
        ),
      ))
      .orderBy(desc(auditLogs.createdAt));

    if (logs.length === 0) return { ok: true as const, data: [] as SessionApprovalHistoryItem[] };

    const parsed = logs.map((log) => {
      const metadata = asRecord(log.metadata);
      const before = asRecord(metadata.before);
      const after = asRecord(metadata.after);
      return { log, metadata, before, after };
    });

    const codeOwnerIds = [...new Set(
      parsed.map(({ after }) => asString(after.generatedByUserId)).filter((id): id is string => Boolean(id)),
    )];
    const codeOwners = codeOwnerIds.length > 0
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, codeOwnerIds))
      : [];
    const codeOwnerNameById = new Map(codeOwners.map((user) => [user.id, user.name]));

    const tileIds = [...new Set(parsed.flatMap(({ before, after }) => [
      ...guestQuantities(before.guests).keys(),
      ...guestQuantities(after.guests).keys(),
    ]))];
    const tileRows = tileIds.length > 0
      ? await db.select({ id: pricingTiles.id, name: pricingTiles.name }).from(pricingTiles).where(inArray(pricingTiles.id, tileIds))
      : [];
    const tileNameById = new Map(tileRows.map((tile) => [tile.id, tile.name]));

    const paymentIds = [...new Set(
      parsed
        .filter(({ log }) => log.entity === 'payments')
        .map(({ log }) => log.entityId)
        .filter((id): id is string => Boolean(id)),
    )];
    const adjustmentRows = paymentIds.length > 0
      ? await db
          .select({
            paymentId: paymentAdjustments.paymentId,
            amount: paymentAdjustments.amount,
            paymentSnapshot: paymentAdjustments.paymentSnapshot,
            createdAt: paymentAdjustments.createdAt,
          })
          .from(paymentAdjustments)
          .where(and(
            eq(paymentAdjustments.sessionId, sessionId),
            inArray(paymentAdjustments.paymentId, paymentIds),
          ))
          .orderBy(desc(paymentAdjustments.createdAt))
      : [];
    const adjustmentByPaymentId = new Map<string, typeof adjustmentRows[number]>();
    for (const adjustment of adjustmentRows) {
      if (!adjustmentByPaymentId.has(adjustment.paymentId)) {
        adjustmentByPaymentId.set(adjustment.paymentId, adjustment);
      }
    }

    const data: SessionApprovalHistoryItem[] = parsed.map(({ log, metadata, before, after }) => {
      const actionKey = asString(after.actionKey) ?? 'unknown';
      const changes: SessionApprovalHistoryChange[] = [];

      if (actionKey === 'pos_saved_guest_count_edit') {
        const beforeGuests = guestQuantities(before.guests);
        const afterGuests = guestQuantities(after.guests);
        const changedTileIds = [...new Set([...beforeGuests.keys(), ...afterGuests.keys()])];
        for (const tileId of changedTileIds) {
          const beforeQuantity = beforeGuests.get(tileId) ?? 0;
          const afterQuantity = afterGuests.get(tileId) ?? 0;
          if (beforeQuantity === afterQuantity) continue;
          changes.push({
            label: tileNameById.get(tileId) ?? 'ประเภทผู้เข้าใช้',
            before: `${beforeQuantity} คน`,
            after: `${afterQuantity} คน`,
          });
        }
      } else {
        const adjustment = log.entityId ? adjustmentByPaymentId.get(log.entityId) : undefined;
        const snapshot = asRecord(adjustment?.paymentSnapshot);
        const payment = asRecord(snapshot.payment);
        const amount = adjustment?.amount ?? payment.total ?? 0;
        const receiptNo = asString(payment.receiptNo);

        if (actionKey === 'pos_payment_delete') {
          changes.push({
            label: receiptNo ? `การชำระเงิน ${receiptNo}` : 'สถานะการชำระเงิน',
            before: `ชำระสำเร็จ ${formatMoney(amount)}`,
            after: 'ลบรายการแล้ว',
          });
        } else if (actionKey === 'pos_payment_reopen') {
          changes.push({
            label: receiptNo ? `บิล ${receiptNo}` : 'สถานะบิล',
            before: `ชำระแล้ว ${formatMoney(amount)}`,
            after: 'เปิดรอชำระใหม่',
          });
        }
      }

      const codeOwnerId = asString(after.generatedByUserId);
      return {
        id: log.id,
        actionKey,
        actionLabel: ACTION_LABELS[actionKey] ?? 'แก้ไขรายการสำคัญ',
        reason: asString(after.reason),
        actorName: log.actorName,
        actorRole: asString(after.actorRole) ?? asString(metadata.role) ?? '-',
        codeOwnerName: codeOwnerId ? (codeOwnerNameById.get(codeOwnerId) ?? null) : null,
        selfApproved: typeof after.selfApproved === 'boolean' ? after.selfApproved : null,
        createdAt: log.createdAt,
        changes,
      };
    });

    return { ok: true as const, data };
  } catch (error) {
    console.error('[getSessionApprovalHistory]', error);
    return { ok: false as const, error: 'ไม่สามารถโหลดประวัติการอนุมัติได้' };
  }
}
