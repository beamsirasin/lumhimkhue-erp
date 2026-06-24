'use server';

import { and, asc, gte, lte } from 'drizzle-orm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay, format } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { queueEntries } from '@/lib/db/schema';
import { CUSTOMER_TYPE_LABELS } from '@/lib/validations/queue';
import type { CustomerType } from '@/lib/validations/queue';
import { QUEUE_STATUS_LABELS } from '@/lib/reports/report-labels';

const TZ = 'Asia/Bangkok';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueReportRow = {
  id: string;
  queueNumber: string;
  customerName: string;
  status: string;
  adultCount: number;
  childCount: number;
  customerType: string;
  soupPots: Array<{ soups: string[] }> | null;
  plannedTableNote: string | null;
  skipReason: string | null;
  billIssued: boolean;
  createdAt: string;
  admittedAt: string | null;
  waitMinutes: number | null;
};

export type QueueStatusSummary = {
  status: string;
  label: string;
  count: number;
  pct: number;
};

export type QueueCustomerTypeSummary = {
  type: string;
  label: string;
  queueCount: number;
  personCount: number;
  pct: number;
};

export type QueueSoupSummary = {
  soup: string;
  count: number;
  pct: number;
};

export type QueueDailyRow = {
  date: string;
  count: number;
};

export type QueueReportData = {
  rows: QueueReportRow[];
  totalQueues: number;
  activeQueues: number;
  admitted: number;
  billed: number;
  skipped: number;
  cancelled: number;
  totalPersons: number;
  totalAdults: number;
  totalChildren: number;
  avgWaitMinutes: number | null;
  statusSummary: QueueStatusSummary[];
  customerTypeSummary: QueueCustomerTypeSummary[];
  soupSummary: QueueSoupSummary[];
  skipReasons: { reason: string; count: number }[];
  dailyRows: QueueDailyRow[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ORDERED_STATUSES = [
  'waiting', 'waiting_suitable_table', 'called',
  'admitted', 'skipped', 'cancelled', 'seated', 'left',
];

// ─── Action ───────────────────────────────────────────────────────────────────

export async function getQueueReport(startDate: string, endDate: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดูรายงาน' };

  try {
    const startUtc = fromZonedTime(startOfDay(toZonedTime(new Date(startDate), TZ)), TZ);
    const endUtc   = fromZonedTime(endOfDay(toZonedTime(new Date(endDate), TZ)), TZ);

    const entries = await db
      .select()
      .from(queueEntries)
      .where(and(gte(queueEntries.createdAt, startUtc), lte(queueEntries.createdAt, endUtc)))
      .orderBy(asc(queueEntries.createdAt));

    // ── Row mapping ────────────────────────────────────────────────────────

    const rows: QueueReportRow[] = entries.map((e) => {
      const waitMinutes =
        e.admittedAt != null
          ? Math.round((e.admittedAt.getTime() - e.createdAt.getTime()) / 60_000)
          : null;
      return {
        id:               e.id,
        queueNumber:      e.queueNumber,
        customerName:     e.customerName,
        status:           e.status,
        adultCount:       e.adultCount,
        childCount:       e.childCount,
        customerType:     e.customerType,
        soupPots:         e.soupPots ?? null,
        plannedTableNote: e.plannedTableNote ?? null,
        skipReason:       e.skipReason ?? null,
        billIssued:       e.billIssued,
        createdAt:        e.createdAt.toISOString(),
        admittedAt:       e.admittedAt?.toISOString() ?? null,
        waitMinutes,
      };
    });

    const total = rows.length;

    // ── Status counts ──────────────────────────────────────────────────────

    const statusCounts: Record<string, number> = {};
    for (const r of rows) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }
    const activeQueues = ['waiting', 'waiting_suitable_table', 'called'].reduce(
      (s, k) => s + (statusCounts[k] ?? 0), 0,
    );
    const admitted  = statusCounts['admitted']  ?? 0;
    const billed    = rows.filter((r) => r.status === 'admitted' && r.billIssued).length;
    const skipped   = statusCounts['skipped']   ?? 0;
    const cancelled = statusCounts['cancelled'] ?? 0;

    // ── Person totals ──────────────────────────────────────────────────────

    const totalAdults   = rows.reduce((s, r) => s + r.adultCount, 0);
    const totalChildren = rows.reduce((s, r) => s + r.childCount, 0);
    const totalPersons  = totalAdults + totalChildren;

    // ── Average wait time (admitted entries with admittedAt only) ──────────

    const withWait     = rows.filter((r) => r.waitMinutes !== null);
    const avgWaitMinutes =
      withWait.length > 0
        ? Math.round(withWait.reduce((s, r) => s + (r.waitMinutes ?? 0), 0) / withWait.length)
        : null;

    // ── Status summary ─────────────────────────────────────────────────────

    const statusSummary: QueueStatusSummary[] = ORDERED_STATUSES
      .filter((s) => (statusCounts[s] ?? 0) > 0)
      .map((s) => ({
        status: s,
        label:  QUEUE_STATUS_LABELS[s] ?? s,
        count:  statusCounts[s] ?? 0,
        pct:    total > 0 ? Math.round(((statusCounts[s] ?? 0) / total) * 100) : 0,
      }));

    // ── Customer type summary ──────────────────────────────────────────────

    const typeCounts: Record<string, { queues: number; persons: number }> = {};
    for (const r of rows) {
      const t = r.customerType || 'normal';
      if (!typeCounts[t]) typeCounts[t] = { queues: 0, persons: 0 };
      typeCounts[t].queues  += 1;
      typeCounts[t].persons += r.adultCount + r.childCount;
    }
    const customerTypeSummary: QueueCustomerTypeSummary[] = Object.entries(typeCounts)
      .map(([type, { queues, persons }]) => ({
        type,
        label:      CUSTOMER_TYPE_LABELS[type as CustomerType] ?? type,
        queueCount: queues,
        personCount: persons,
        pct: total > 0 ? Math.round((queues / total) * 100) : 0,
      }))
      .sort((a, b) => b.queueCount - a.queueCount);

    // ── Soup summary — each soup slot counted independently (duplicates count) ─

    const soupCounts: Record<string, number> = {};
    let totalSoupSlots = 0;
    for (const r of rows) {
      if (!r.soupPots) continue;
      for (const pot of r.soupPots) {
        for (const soup of pot.soups) {
          soupCounts[soup] = (soupCounts[soup] ?? 0) + 1;
          totalSoupSlots++;
        }
      }
    }
    const soupSummary: QueueSoupSummary[] = Object.entries(soupCounts)
      .map(([soup, count]) => ({
        soup,
        count,
        pct: totalSoupSlots > 0 ? Math.round((count / totalSoupSlots) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // ── Skip reasons ───────────────────────────────────────────────────────

    const reasonCounts: Record<string, number> = {};
    for (const r of rows.filter((r) => r.status === 'skipped')) {
      const reason = r.skipReason?.trim() || 'ไม่ระบุ';
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    const skipReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // ── Daily rows (group by Bangkok calendar day) ─────────────────────────

    const dailyCounts: Record<string, number> = {};
    for (const r of rows) {
      const day = format(toZonedTime(new Date(r.createdAt), TZ), 'yyyy-MM-dd');
      dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
    }
    const dailyRows: QueueDailyRow[] = Object.entries(dailyCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      ok: true as const,
      data: {
        rows,
        totalQueues: total,
        activeQueues,
        admitted,
        billed,
        skipped,
        cancelled,
        totalPersons,
        totalAdults,
        totalChildren,
        avgWaitMinutes,
        statusSummary,
        customerTypeSummary,
        soupSummary,
        skipReasons,
        dailyRows,
      } satisfies QueueReportData,
    };
  } catch (e) {
    console.error('[getQueueReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน' };
  }
}
