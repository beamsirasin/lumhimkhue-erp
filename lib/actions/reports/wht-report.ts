'use server';

import { and, gte, lt, inArray, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { payrollCycles, payrollItems, employees } from '@/lib/db/schema';

export type WhtReportRow = {
  employeeId: string;
  fullName: string;
  nationalId: string | null;
  gross: number;
  withholdingTax: number;
};

export type WhtReport = {
  month: string;
  rows: WhtReportRow[];
  totalGross: number;
  totalWht: number;
};

export async function getWhtReport(month: string) {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'view_reports'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    // Find payroll cycles with payDate in month
    const mStart = `${month}-01`;
    const [year, mon] = month.split('-').map(Number);
    const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

    const cycles = await db.select({ id: payrollCycles.id })
      .from(payrollCycles)
      .where(and(gte(payrollCycles.payDate, mStart), lt(payrollCycles.payDate, nextMonth)));

    if (!cycles.length) {
      return { ok: true as const, data: { month, rows: [], totalGross: 0, totalWht: 0 } };
    }

    const cycleIds = cycles.map((c) => c.id);
    const items = await db.select({
      employeeId: payrollItems.employeeId,
      gross: sql<number>`sum(${payrollItems.gross}::numeric)`,
      withholdingTax: sql<number>`sum(${payrollItems.withholdingTax}::numeric)`,
    }).from(payrollItems)
      .where(inArray(payrollItems.payrollCycleId, cycleIds))
      .groupBy(payrollItems.employeeId);

    const empIds = items.map((i) => i.employeeId);
    const empRows = empIds.length > 0
      ? await db.select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          nationalId: employees.nationalId,
        }).from(employees).where(inArray(employees.id, empIds))
      : [];

    const empMap = new Map(empRows.map((e) => [e.id, e]));

    const rows: WhtReportRow[] = items
      .filter((i) => Number(i.withholdingTax) > 0)
      .map((i) => {
        const emp = empMap.get(i.employeeId);
        return {
          employeeId: i.employeeId,
          fullName: emp ? `${emp.firstName} ${emp.lastName}` : i.employeeId,
          nationalId: emp?.nationalId ?? null,
          gross: Number(i.gross),
          withholdingTax: Number(i.withholdingTax),
        };
      });

    const report: WhtReport = {
      month,
      rows,
      totalGross: rows.reduce((s, r) => s + r.gross, 0),
      totalWht: rows.reduce((s, r) => s + r.withholdingTax, 0),
    };

    return { ok: true as const, data: report };
  } catch (e) {
    console.error('[getWhtReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
