'use server';

import { and, gte, lt, inArray, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { payrollCycles, payrollItems, employees } from '@/lib/db/schema';

export type SsfReportRow = {
  employeeId: string;
  fullName: string;
  socialSecurityNumber: string | null;
  gross: number;
  ssfEmployee: number;
  ssfEmployer: number;
  total: number;
};

export type SsfReport = {
  month: string;
  rows: SsfReportRow[];
  totalSsfEmployee: number;
  totalSsfEmployer: number;
  totalSsf: number;
};

export async function getSsfReport(month: string) {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'view_reports'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const mStart = `${month}-01`;
    const [year, mon] = month.split('-').map(Number);
    const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

    const cycles = await db.select({ id: payrollCycles.id })
      .from(payrollCycles)
      .where(and(gte(payrollCycles.payDate, mStart), lt(payrollCycles.payDate, nextMonth)));

    if (!cycles.length) {
      return {
        ok: true as const,
        data: { month, rows: [], totalSsfEmployee: 0, totalSsfEmployer: 0, totalSsf: 0 },
      };
    }

    const cycleIds = cycles.map((c) => c.id);
    const items = await db.select({
      employeeId: payrollItems.employeeId,
      gross: sql<number>`sum(${payrollItems.gross}::numeric)`,
      ssfEmployee: sql<number>`sum(${payrollItems.ssfEmployee}::numeric)`,
      ssfEmployer: sql<number>`sum(${payrollItems.ssfEmployer}::numeric)`,
    }).from(payrollItems)
      .where(inArray(payrollItems.payrollCycleId, cycleIds))
      .groupBy(payrollItems.employeeId);

    const empIds = items.map((i) => i.employeeId);
    const empRows = empIds.length > 0
      ? await db.select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          socialSecurityNumber: employees.socialSecurityNumber,
          ssfRegistered: employees.ssfRegistered,
        }).from(employees).where(inArray(employees.id, empIds))
      : [];

    const empMap = new Map(empRows.map((e) => [e.id, e]));

    const rows: SsfReportRow[] = items
      .filter((i) => {
        const emp = empMap.get(i.employeeId);
        return emp?.ssfRegistered && (Number(i.ssfEmployee) > 0 || Number(i.ssfEmployer) > 0);
      })
      .map((i) => {
        const emp = empMap.get(i.employeeId);
        const ssfEmp = Number(i.ssfEmployee);
        const ssfEmpr = Number(i.ssfEmployer);
        return {
          employeeId: i.employeeId,
          fullName: emp ? `${emp.firstName} ${emp.lastName}` : i.employeeId,
          socialSecurityNumber: emp?.socialSecurityNumber ?? null,
          gross: Number(i.gross),
          ssfEmployee: ssfEmp,
          ssfEmployer: ssfEmpr,
          total: ssfEmp + ssfEmpr,
        };
      });

    const report: SsfReport = {
      month,
      rows,
      totalSsfEmployee: rows.reduce((s, r) => s + r.ssfEmployee, 0),
      totalSsfEmployer: rows.reduce((s, r) => s + r.ssfEmployer, 0),
      totalSsf: rows.reduce((s, r) => s + r.total, 0),
    };

    return { ok: true as const, data: report };
  } catch (e) {
    console.error('[getSsfReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
