import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  cashierShifts,
  paymentAdjustments,
  pricingTiles,
  sessions,
  tables,
  users,
} from '@/lib/db/schema';
import { formatThaiDate, formatThaiDateTime, formatThaiTime } from '@/lib/date-time';

type JsonRecord = Record<string, unknown>;

export interface SensitiveApprovalNotificationParams {
  actorUserId: string;
  actorRole: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  occurredAt?: Date;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'เจ้าของ',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
  staff: 'พนักงาน',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'เงินสด',
  cash_qr: 'เงินสด + QR',
  qr_promptpay: 'QR PromptPay',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต',
};

const ACTION_CONFIG: Record<string, { icon: string; title: string }> = {
  pos_saved_guest_count_edit: {
    icon: '👥',
    title: 'แก้ไขจำนวนผู้เข้าใช้บริการ',
  },
  pos_payment_reopen: {
    icon: '✏️',
    title: 'ยกเลิกบิลเพื่อแก้ไขการชำระเงิน',
  },
  pos_payment_delete: {
    icon: '🗑️',
    title: 'ลบรายการชำระเงิน / ยกเลิกบิล',
  },
  pos_store_day_close: {
    icon: '🏪',
    title: 'ปิดรอบวันระดับร้าน',
  },
  pos_store_day_reopen: {
    icon: '🔓',
    title: 'เปิดวันทำการระดับร้านอีกครั้ง',
  },
};

function asRecord(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatMoney(value: unknown): string {
  const amount = Number(value ?? 0);
  return `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function guestQuantities(value: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!Array.isArray(value)) return result;
  for (const row of value) {
    const record = asRecord(row);
    const tileId = asString(record.pricingTileId);
    const quantity = Number(record.quantity ?? 0);
    if (tileId && Number.isFinite(quantity)) result.set(tileId, quantity);
  }
  return result;
}

function formatCashDifference(difference: number): string {
  if (difference === 0) return '✅ ครบ';
  return difference < 0
    ? `⚠️ ขาด ${formatMoney(Math.abs(difference))}`
    : `⚠️ เกิน ${formatMoney(difference)}`;
}

/** สรุปรอบแคชเชียร์ทุกกะของวันทำการ (เวลาไทย) สำหรับแนบท้ายแจ้งเตือนปิดรอบวัน */
async function buildStoreDayShiftSummaryLines(businessDate: string): Promise<string[]> {
  const dayStart = new Date(`${businessDate}T00:00:00+07:00`);
  const dayEnd = new Date(`${businessDate}T23:59:59.999+07:00`);
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) return [];

  const shifts = await db
    .select({
      status: cashierShifts.status,
      openedAt: cashierShifts.openedAt,
      closedAt: cashierShifts.closedAt,
      openingFloat: cashierShifts.openingFloat,
      expectedCash: cashierShifts.expectedCash,
      actualCash: cashierShifts.actualCash,
      cashDifference: cashierShifts.cashDifference,
      cashierName: users.name,
    })
    .from(cashierShifts)
    .leftJoin(users, eq(cashierShifts.cashierId, users.id))
    .where(and(gte(cashierShifts.openedAt, dayStart), lte(cashierShifts.openedAt, dayEnd)))
    .orderBy(asc(cashierShifts.openedAt));

  const lines: string[] = ['', `💰 <b>สรุปรอบแคชเชียร์ (${shifts.length} รอบ)</b>`];
  if (shifts.length === 0) {
    lines.push('• ไม่พบรอบแคชเชียร์ในวันทำการนี้');
    return lines;
  }

  let totalExpected = 0;
  let totalActual = 0;
  let hasClosedShift = false;
  let openShiftCount = 0;

  shifts.forEach((shift, index) => {
    const cashierName = truncate(shift.cashierName ?? 'ไม่พบชื่อแคชเชียร์', 40);
    const timeRange = shift.closedAt
      ? `${formatThaiTime(shift.openedAt)}–${formatThaiTime(shift.closedAt)} น.`
      : `เปิด ${formatThaiTime(shift.openedAt)} น.`;
    lines.push(`<b>รอบ ${index + 1}</b> · ${escapeHtml(cashierName)} · ${escapeHtml(timeRange)}`);

    const openingFloat = Number(shift.openingFloat ?? 0);
    if (shift.status === 'open' || shift.expectedCash == null || shift.actualCash == null) {
      openShiftCount += 1;
      lines.push(`• เงินต้น ${escapeHtml(formatMoney(openingFloat))} · ⏳ ยังไม่ปิดรอบ — ยังไม่มียอดนับ`);
      return;
    }

    const expected = Number(shift.expectedCash);
    const actual = Number(shift.actualCash);
    const difference = shift.cashDifference != null
      ? Number(shift.cashDifference)
      : Math.round((actual - expected) * 100) / 100;
    hasClosedShift = true;
    totalExpected += expected;
    totalActual += actual;

    lines.push(
      `• เงินต้น ${escapeHtml(formatMoney(openingFloat))} · ควรมี ${escapeHtml(formatMoney(expected))}`,
    );
    lines.push(
      `• นับได้ ${escapeHtml(formatMoney(actual))} — ${escapeHtml(formatCashDifference(difference))}`,
    );
  });

  if (hasClosedShift) {
    const totalDifference = Math.round((totalActual - totalExpected) * 100) / 100;
    lines.push(
      `<b>รวมทั้งวัน:</b> ควรมี ${escapeHtml(formatMoney(totalExpected))} · ` +
      `นับได้ ${escapeHtml(formatMoney(totalActual))} — ${escapeHtml(formatCashDifference(totalDifference))}`,
    );
  }
  if (openShiftCount > 0) {
    lines.push(`<i>ยังมีรอบที่ไม่ปิด ${openShiftCount} รอบ — ยอดรวมยังไม่รวมรอบดังกล่าว</i>`);
  }
  return lines;
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_MANAGEMENT_CHAT_ID?.trim();

  if (!token || !chatId) {
    console.warn('[telegram-approval] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_MANAGEMENT_CHAT_ID');
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    const errorBody = (await response.text()).slice(0, 500);
    throw new Error(`Telegram API ${response.status}: ${errorBody}`);
  }
}

export async function notifySensitiveApprovalUse(
  params: SensitiveApprovalNotificationParams,
): Promise<void> {
  const after = asRecord(params.after);
  const before = asRecord(params.before);
  const actionKey = asString(after.actionKey);
  if (!actionKey || !ACTION_CONFIG[actionKey]) return;
  const isStoreDayAction = actionKey === 'pos_store_day_close' || actionKey === 'pos_store_day_reopen';

  try {
    const sessionId = actionKey === 'pos_saved_guest_count_edit'
      ? params.entityId ?? null
      : asString(after.sessionId);
    const generatedByUserId = asString(after.generatedByUserId);
    const userIds = [...new Set(
      [params.actorUserId, generatedByUserId].filter((id): id is string => Boolean(id)),
    )];
    const userRows = userIds.length > 0
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [];
    const userNameById = new Map(userRows.map((user) => [user.id, user.name]));

    const [sessionRow] = sessionId
      ? await db
          .select({ id: sessions.id, tableLabel: tables.label })
          .from(sessions)
          .leftJoin(tables, eq(sessions.tableId, tables.id))
          .where(eq(sessions.id, sessionId))
          .limit(1)
      : [];

    const detailLines: string[] = [];

    if (actionKey === 'pos_saved_guest_count_edit') {
      const beforeGuests = guestQuantities(before.guests);
      const afterGuests = guestQuantities(after.guests);
      const tileIds = [...new Set([...beforeGuests.keys(), ...afterGuests.keys()])];
      const tileRows = tileIds.length > 0
        ? await db
            .select({ id: pricingTiles.id, name: pricingTiles.name })
            .from(pricingTiles)
            .where(inArray(pricingTiles.id, tileIds))
        : [];
      const tileNameById = new Map(tileRows.map((tile) => [tile.id, tile.name]));

      for (const tileId of tileIds) {
        const oldQuantity = beforeGuests.get(tileId) ?? 0;
        const newQuantity = afterGuests.get(tileId) ?? 0;
        if (oldQuantity === newQuantity) continue;
        const tileName = truncate(tileNameById.get(tileId) ?? 'ประเภทผู้เข้าใช้', 80);
        detailLines.push(
          `• <b>${escapeHtml(tileName)}</b>: ` +
          `<code>${oldQuantity} คน</code> → <code>${newQuantity} คน</code>`,
        );
      }

      const oldTotal = [...beforeGuests.values()].reduce((sum, quantity) => sum + quantity, 0);
      const newTotal = [...afterGuests.values()].reduce((sum, quantity) => sum + quantity, 0);
      if (oldTotal !== newTotal) {
        detailLines.push(`• <b>รวมทั้งหมด</b>: <code>${oldTotal} คน</code> → <code>${newTotal} คน</code>`);
      }
    } else if (isStoreDayAction) {
      const businessDate = asString(after.businessDate) ?? params.entityId ?? null;
      if (businessDate) {
        detailLines.push(`• <b>วันทำการ:</b> ${escapeHtml(formatThaiDate(businessDate))}`);
      }
      detailLines.push(
        actionKey === 'pos_store_day_close'
          ? '• <b>สถานะ:</b> <code>เปิดรับชำระ</code> → <code>ปิดรอบวันทั้งร้าน</code>'
          : '• <b>สถานะ:</b> <code>ปิดรอบวันทั้งร้าน</code> → <code>เปิดรับชำระอีกครั้ง</code>',
      );
      detailLines.push(
        actionKey === 'pos_store_day_close'
          ? '• <b>ผลลัพธ์:</b> ระงับการรับชำระใหม่และการเปิดรอบแคชเชียร์ใหม่'
          : '• <b>ผลลัพธ์:</b> อนุญาตการรับชำระและเปิดรอบแคชเชียร์ใหม่',
      );
    } else if (params.entityId) {
      const [adjustment] = await db
        .select({
          amount: paymentAdjustments.amount,
          paymentSnapshot: paymentAdjustments.paymentSnapshot,
        })
        .from(paymentAdjustments)
        .where(and(
          eq(paymentAdjustments.paymentId, params.entityId),
          sessionId ? eq(paymentAdjustments.sessionId, sessionId) : undefined,
        ))
        .orderBy(desc(paymentAdjustments.createdAt))
        .limit(1);

      const snapshot = asRecord(adjustment?.paymentSnapshot);
      const payment = asRecord(snapshot.payment);
      const receiptNo = asString(payment.receiptNo);
      const amount = adjustment?.amount ?? payment.total ?? 0;
      const paymentMethod = asString(payment.paymentMethod);

      if (receiptNo) detailLines.push(`• <b>เลขที่ใบเสร็จ:</b> <code>${escapeHtml(receiptNo)}</code>`);
      detailLines.push(`• <b>ยอดเงิน:</b> ${escapeHtml(formatMoney(amount))}`);
      if (paymentMethod) {
        detailLines.push(`• <b>ช่องทางเดิม:</b> ${escapeHtml(PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod)}`);
      }
      detailLines.push(
        actionKey === 'pos_payment_reopen'
          ? '• <b>สถานะ:</b> <code>ชำระแล้ว</code> → <code>เปิดรอชำระใหม่</code>'
          : '• <b>สถานะ:</b> <code>ชำระสำเร็จ</code> → <code>ลบรายการแล้ว</code>',
      );
    }

    if (detailLines.length === 0) detailLines.push('• ไม่มีรายละเอียดค่าก่อนและหลังใน audit');

    const action = ACTION_CONFIG[actionKey];
    const actorName = userNameById.get(params.actorUserId) ?? 'ไม่พบชื่อผู้ใช้';
    const actorRole = ROLE_LABELS[params.actorRole] ?? params.actorRole;
    const codeOwnerName = generatedByUserId
      ? userNameById.get(generatedByUserId) ?? 'ไม่พบชื่อผู้ออกรหัส'
      : 'ไม่พบชื่อผู้ออกรหัส';
    const isSelfApproved = typeof after.selfApproved === 'boolean' ? after.selfApproved : false;
    const reason = truncate(asString(after.reason) ?? 'ไม่ระบุเหตุผล', 500);
    const occurredAt = params.occurredAt ?? new Date();
    const sessionDisplay = sessionId ? `${sessionId.slice(0, 8)}…` : '-';
    const businessDate = asString(after.businessDate) ?? (isStoreDayAction ? params.entityId ?? null : null);
    const locationLines = isStoreDayAction
      ? [
          '🏪 <b>ขอบเขต:</b> ทั้งร้าน',
          `📅 <b>วันทำการ:</b> ${escapeHtml(formatThaiDate(businessDate))}`,
        ]
      : [
          `🏷️ <b>โต๊ะ:</b> ${escapeHtml(sessionRow?.tableLabel ?? '-')}`,
          `🧾 <b>Session:</b> <code>${escapeHtml(sessionDisplay)}</code>`,
        ];
    const visibleDetailLines = detailLines.slice(0, 12);
    if (detailLines.length > visibleDetailLines.length) {
      visibleDetailLines.push(`• และอีก ${detailLines.length - visibleDetailLines.length} รายการ`);
    }

    let shiftSummaryLines: string[] = [];
    if (actionKey === 'pos_store_day_close' && businessDate) {
      try {
        shiftSummaryLines = await buildStoreDayShiftSummaryLines(businessDate);
      } catch (error) {
        console.error('[telegram-approval] Failed to build shift summary', error);
        shiftSummaryLines = ['', '💰 <b>สรุปรอบแคชเชียร์</b>', '• โหลดข้อมูลรอบแคชเชียร์ไม่สำเร็จ'];
      }
    }

    const message = [
      '🚨 <b>แจ้งเตือนการใช้ Approval Code</b>',
      '━━━━━━━━━━━━━━━━━━',
      `${action.icon} <b>${escapeHtml(action.title)}</b>`,
      '',
      ...locationLines,
      `👤 <b>ผู้ใช้รหัส:</b> ${escapeHtml(actorName)} (${escapeHtml(actorRole)})`,
      `🔐 <b>ผู้ออกรหัส:</b> ${escapeHtml(codeOwnerName)}${isSelfApproved ? ' — อนุมัติด้วยตนเอง' : ''}`,
      `🕒 <b>เวลา:</b> ${escapeHtml(formatThaiDateTime(occurredAt))} น.`,
      '',
      '📋 <b>รายละเอียดการเปลี่ยนแปลง</b>',
      ...visibleDetailLines,
      ...shiftSummaryLines,
      '',
      `📝 <b>เหตุผล:</b> ${escapeHtml(reason)}`,
      '━━━━━━━━━━━━━━━━━━',
      '<i>บันทึกใน Audit Log แล้ว</i>',
    ].join('\n');

    await sendTelegramMessage(message);
  } catch (error) {
    console.error('[telegram-approval] Failed to send notification', error);
  }
}
