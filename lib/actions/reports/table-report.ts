'use server';

import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay, format } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, sessionGuests, payments } from '@/lib/db/schema';
import { SESSION_STATUS_LABELS } from '@/lib/reports/report-labels';

const TZ = 'Asia/Bangkok';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TableReportRow = {
  sessionId: string;
  tableId: string;
  tableLabel: string;
  tableZone: string;
  parentSessionId: string | null;
  status: string;
  startedAt: string;
  closedAt: string | null;
  durationMinutes: number | null;
  guestCount: number | null;    // null for child sessions (guests only on primary)
  revenue: number | null;       // null if no completed payment yet
  billPrintedAt: string | null;
};

export type TableBreakdownRow = {
  tableId: string;
  tableLabel: string;
  tableZone: string;
  sessionCount: number;
  guestCount: number;
  revenue: number;
  avgDurationMinutes: number | null;
};

export type TableStatusSummary = {
  status: string;
  label: string;
  count: number;
  pct: number;
};

export type TableDailyRow = {
  date: string;
  count: number;
};

export type TableReportData = {
  rows: TableReportRow[];
  totalSessions: number;
  closedSessions: number;
  openSessions: number;
  totalGuests: number;            // from primary sessions only
  avgDurationMinutes: number | null;  // closed sessions only
  avgGuestsPerSession: number | null;
  totalRevenue: number;           // sum of completed payments
  avgRevenuePerSession: number | null;
  tableBreakdown: TableBreakdownRow[];
  statusSummary: TableStatusSummary[];
  dailyRows: TableDailyRow[];
  longestSessions: TableReportRow[];  // top 10 by duration
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ORDERED_STATUSES = ['active', 'closing', 'closed', 'paid'];

// ─── Action ───────────────────────────────────────────────────────────────────

export async function getTableReport(startDate: string, endDate: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดูรายงาน' };

  const emptyResult: TableReportData = {
    rows: [], totalSessions: 0, closedSessions: 0, openSessions: 0,
    totalGuests: 0, avgDurationMinutes: null, avgGuestsPerSession: null,
    totalRevenue: 0, avgRevenuePerSession: null,
    tableBreakdown: [], statusSummary: [], dailyRows: [], longestSessions: [],
  };

  try {
    const startUtc = fromZonedTime(startOfDay(toZonedTime(new Date(startDate), TZ)), TZ);
    const endUtc   = fromZonedTime(endOfDay(toZonedTime(new Date(endDate), TZ)), TZ);

    // ── 1. Sessions in date range with table info ──────────────────────────

    const sessionRows = await db
      .select({
        id:              sessions.id,
        tableId:         sessions.tableId,
        parentSessionId: sessions.parentSessionId,
        status:          sessions.status,
        startedAt:       sessions.startedAt,
        closedAt:        sessions.closedAt,
        billPrintedAt:   sessions.billPrintedAt,
        tableLabel:      tables.label,
        tableZone:       tables.zone,
      })
      .from(sessions)
      .innerJoin(tables, eq(sessions.tableId, tables.id))
      .where(and(gte(sessions.startedAt, startUtc), lte(sessions.startedAt, endUtc)))
      .orderBy(asc(sessions.startedAt));

    if (sessionRows.length === 0) {
      return { ok: true as const, data: emptyResult };
    }

    const sessionIds        = sessionRows.map((s) => s.id);
    // Guests are stored only on primary sessions (parentSessionId IS NULL)
    const primarySessionIds = sessionRows
      .filter((s) => s.parentSessionId === null)
      .map((s) => s.id);

    // ── 2. Guest counts — primary sessions only (matches dashboard.ts pattern) ─

    const guestData = primarySessionIds.length > 0
      ? await db
          .select({ sessionId: sessionGuests.sessionId, quantity: sessionGuests.quantity })
          .from(sessionGuests)
          .where(inArray(sessionGuests.sessionId, primarySessionIds))
      : [];

    // ── 3. Revenue — sum ALL completed payments per session (partial + final) ─

    const paymentData = await db
      .select({ sessionId: payments.sessionId, total: payments.total })
      .from(payments)
      .where(and(
        inArray(payments.sessionId, sessionIds),
        eq(payments.status, 'completed'),
      ));

    // ── Aggregate helpers ──────────────────────────────────────────────────

    const guestsBySession = new Map<string, number>();
    for (const g of guestData) {
      guestsBySession.set(g.sessionId, (guestsBySession.get(g.sessionId) ?? 0) + g.quantity);
    }

    const revenueBySession = new Map<string, number>();
    for (const p of paymentData) {
      revenueBySession.set(p.sessionId,
        (revenueBySession.get(p.sessionId) ?? 0) + Number(p.total),
      );
    }

    // ── Build per-session rows ─────────────────────────────────────────────

    const rows: TableReportRow[] = sessionRows.map((s) => {
      const durationMinutes = s.closedAt != null
        ? Math.round((s.closedAt.getTime() - s.startedAt.getTime()) / 60_000)
        : null;
      const guestCount = s.parentSessionId === null
        ? (guestsBySession.get(s.id) ?? 0)
        : null;
      const revenue = revenueBySession.has(s.id)
        ? revenueBySession.get(s.id)!
        : null;

      return {
        sessionId:       s.id,
        tableId:         s.tableId,
        tableLabel:      s.tableLabel,
        tableZone:       s.tableZone,
        parentSessionId: s.parentSessionId,
        status:          s.status,
        startedAt:       s.startedAt.toISOString(),
        closedAt:        s.closedAt?.toISOString() ?? null,
        durationMinutes,
        guestCount,
        revenue,
        billPrintedAt:   s.billPrintedAt?.toISOString() ?? null,
      };
    });

    // ── KPIs ──────────────────────────────────────────────────────────────

    const total          = rows.length;
    const closedSessions = rows.filter((r) => r.status === 'closed' || r.status === 'paid').length;
    const openSessions   = total - closedSessions;
    const totalGuests    = [...guestsBySession.values()].reduce((s, v) => s + v, 0);

    const primaryWithGuests = rows.filter(
      (r) => r.parentSessionId === null && (r.guestCount ?? 0) > 0,
    ).length;
    const avgGuestsPerSession = primaryWithGuests > 0
      ? Math.round((totalGuests / primaryWithGuests) * 10) / 10
      : null;

    const closedWithDuration = rows.filter((r) => r.durationMinutes !== null);
    const avgDurationMinutes = closedWithDuration.length > 0
      ? Math.round(
          closedWithDuration.reduce((s, r) => s + (r.durationMinutes ?? 0), 0) /
          closedWithDuration.length,
        )
      : null;

    const totalRevenue       = [...revenueBySession.values()].reduce((s, v) => s + v, 0);
    const paidSessionCount   = revenueBySession.size;
    const avgRevenuePerSession = paidSessionCount > 0
      ? Math.round((totalRevenue / paidSessionCount) * 100) / 100
      : null;

    // ── Status summary ─────────────────────────────────────────────────────

    const statusCounts: Record<string, number> = {};
    for (const r of rows) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }
    const statusSummary: TableStatusSummary[] = ORDERED_STATUSES
      .filter((s) => (statusCounts[s] ?? 0) > 0)
      .map((s) => ({
        status: s,
        label:  SESSION_STATUS_LABELS[s] ?? s,
        count:  statusCounts[s] ?? 0,
        pct:    total > 0 ? Math.round(((statusCounts[s] ?? 0) / total) * 100) : 0,
      }));

    // ── Table breakdown — group by table ──────────────────────────────────

    const tableMap = new Map<string, {
      tableId: string; tableLabel: string; tableZone: string;
      sessionCount: number; guestCount: number; revenue: number; durations: number[];
    }>();
    for (const r of rows) {
      if (!tableMap.has(r.tableId)) {
        tableMap.set(r.tableId, {
          tableId: r.tableId, tableLabel: r.tableLabel, tableZone: r.tableZone,
          sessionCount: 0, guestCount: 0, revenue: 0, durations: [],
        });
      }
      const t = tableMap.get(r.tableId)!;
      t.sessionCount++;
      if (r.guestCount !== null) t.guestCount += r.guestCount;
      if (r.revenue !== null)    t.revenue    += r.revenue;
      if (r.durationMinutes !== null) t.durations.push(r.durationMinutes);
    }
    const tableBreakdown: TableBreakdownRow[] = [...tableMap.values()]
      .map(({ durations, ...rest }) => ({
        ...rest,
        avgDurationMinutes: durations.length > 0
          ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
          : null,
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount);

    // ── Daily rows ─────────────────────────────────────────────────────────

    const dailyCounts: Record<string, number> = {};
    for (const r of rows) {
      const day = format(toZonedTime(new Date(r.startedAt), TZ), 'yyyy-MM-dd');
      dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
    }
    const dailyRows: TableDailyRow[] = Object.entries(dailyCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Longest sessions (closed, top 10) ─────────────────────────────────

    const longestSessions = [...rows]
      .filter((r) => r.durationMinutes !== null)
      .sort((a, b) => (b.durationMinutes ?? 0) - (a.durationMinutes ?? 0))
      .slice(0, 10);

    return {
      ok: true as const,
      data: {
        rows,
        totalSessions: total,
        closedSessions,
        openSessions,
        totalGuests,
        avgDurationMinutes,
        avgGuestsPerSession,
        totalRevenue,
        avgRevenuePerSession,
        tableBreakdown,
        statusSummary,
        dailyRows,
        longestSessions,
      } satisfies TableReportData,
    };
  } catch (e) {
    console.error('[getTableReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน' };
  }
}
