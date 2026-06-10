'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { can } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/permissions';
import {
  hrSettingsSchema,
  employeeSchema,
  scheduleCycleSchema,
  scheduleEntrySchema,
  timeEntrySchema,
  payrollCycleSchema,
  payrollDeductionSchema,
  payrollAbsenceSchema,
  markPaidSchema,
} from '@/lib/validations/hr';
import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm';

// ─── Thai progressive income tax (WHT) ───────────────────────────────────────

function calcMonthlyWithholdingTax(monthlyGross: number): number {
  const annual = monthlyGross * 12;
  const tiers: [number, number][] = [
    [150_000,    0    ],
    [300_000,    0.05 ],
    [500_000,    0.10 ],
    [750_000,    0.15 ],
    [1_000_000,  0.20 ],
    [Infinity,   0.25 ],
  ];
  let tax = 0;
  let prev = 0;
  for (const [ceiling, rate] of tiers) {
    if (annual <= prev) break;
    tax += (Math.min(annual, ceiling) - prev) * rate;
    prev = ceiling;
  }
  return Math.round((tax / 12) * 100) / 100;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireHr() {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'กรุณาเข้าสู่ระบบ' } as const;
  if (!can(session.user.role as Role, 'hr:manage')) return { ok: false, error: 'ไม่มีสิทธิ์เข้าถึง' } as const;
  return { ok: true, userId: session.user.id } as const;
}

// ─── HR Settings ─────────────────────────────────────────────────────────────

export async function getHrSettings() {
  const rows = await db.select().from(schema.hrSettings).limit(1);
  if (rows.length === 0) {
    await db.insert(schema.hrSettings).values({ id: 'singleton' });
    return (await db.select().from(schema.hrSettings).limit(1))[0];
  }
  return rows[0];
}

export async function saveHrSettings(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = hrSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  await db
    .insert(schema.hrSettings)
    .values({
      id: 'singleton',
      absenceRatePerDay: String(data.absenceRatePerDay),
      lateRatePerMinute: String(data.lateRatePerMinute),
      morningShiftStart: data.morningShiftStart,
      morningShiftEnd: data.morningShiftEnd,
      afternoonShiftStart: data.afternoonShiftStart,
      afternoonShiftEnd: data.afternoonShiftEnd,
      defaultBreakMinutes: data.defaultBreakMinutes,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.hrSettings.id,
      set: {
        absenceRatePerDay: String(data.absenceRatePerDay),
        lateRatePerMinute: String(data.lateRatePerMinute),
        morningShiftStart: data.morningShiftStart,
        morningShiftEnd: data.morningShiftEnd,
        afternoonShiftStart: data.afternoonShiftStart,
        afternoonShiftEnd: data.afternoonShiftEnd,
        defaultBreakMinutes: data.defaultBreakMinutes,
        updatedAt: new Date(),
      },
    });

  revalidatePath('/hr/settings');
  return { ok: true } as const;
}

// ─── Employees ────────────────────────────────────────────────────────────────

export async function getEmployees(filter?: { type?: 'full_time' | 'part_time'; status?: 'active' | 'inactive' }) {
  const conditions = [];
  if (filter?.type) conditions.push(eq(schema.employees.type, filter.type));
  if (filter?.status) conditions.push(eq(schema.employees.status, filter.status));

  return db
    .select()
    .from(schema.employees)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(schema.employees.firstName);
}

export async function createEmployee(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  const [emp] = await db
    .insert(schema.employees)
    .values({
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone ?? null,
      bankName: data.bankName ?? null,
      bankAccountNumber: data.bankAccountNumber ?? null,
      nationalId: data.nationalId ?? null,
      taxId: data.taxId ?? null,
      socialSecurityNumber: data.socialSecurityNumber ?? null,
      employmentEndDate: data.employmentEndDate ?? null,
      ssfRegistered: data.ssfRegistered,
      type: data.type,
      status: data.status,
      baseSalaryPerCycle: data.baseSalaryPerCycle != null ? String(data.baseSalaryPerCycle) : null,
      incentivePerDay: String(data.incentivePerDay),
      hourlyRate: data.hourlyRate != null ? String(data.hourlyRate) : null,
      startDate: data.startDate ?? null,
      notes: data.notes ?? null,
    })
    .returning();

  revalidatePath('/hr/employees');
  return { ok: true, data: emp } as const;
}

export async function updateEmployee(id: string, raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  await db
    .update(schema.employees)
    .set({
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone ?? null,
      bankName: data.bankName ?? null,
      bankAccountNumber: data.bankAccountNumber ?? null,
      nationalId: data.nationalId ?? null,
      taxId: data.taxId ?? null,
      socialSecurityNumber: data.socialSecurityNumber ?? null,
      employmentEndDate: data.employmentEndDate ?? null,
      ssfRegistered: data.ssfRegistered,
      type: data.type,
      status: data.status,
      baseSalaryPerCycle: data.baseSalaryPerCycle != null ? String(data.baseSalaryPerCycle) : null,
      incentivePerDay: String(data.incentivePerDay),
      hourlyRate: data.hourlyRate != null ? String(data.hourlyRate) : null,
      startDate: data.startDate ?? null,
      notes: data.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.employees.id, id));

  revalidatePath('/hr/employees');
  return { ok: true } as const;
}

export async function deleteEmployee(id: string) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  // Check if has payroll history → soft delete
  const payrollRows = await db
    .select({ id: schema.payrollItems.id })
    .from(schema.payrollItems)
    .where(eq(schema.payrollItems.employeeId, id))
    .limit(1);

  if (payrollRows.length > 0) {
    await db
      .update(schema.employees)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(schema.employees.id, id));
  } else {
    await db.delete(schema.employees).where(eq(schema.employees.id, id));
  }

  revalidatePath('/hr/employees');
  return { ok: true } as const;
}

// ─── Schedule Cycles ──────────────────────────────────────────────────────────

export async function getScheduleCycles() {
  return db
    .select()
    .from(schema.scheduleCycles)
    .orderBy(sql`${schema.scheduleCycles.startDate} DESC`);
}

export async function createScheduleCycle(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = scheduleCycleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  const [cycle] = await db
    .insert(schema.scheduleCycles)
    .values({
      name: data.name,
      startDate: data.startDate,
      endDate: data.endDate,
      notes: data.notes ?? null,
      createdBy: auth.userId,
    })
    .returning();

  revalidatePath('/hr/schedule');
  return { ok: true, data: cycle } as const;
}

export async function publishSchedule(cycleId: string) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  await db
    .update(schema.scheduleCycles)
    .set({ status: 'published' })
    .where(eq(schema.scheduleCycles.id, cycleId));

  revalidatePath('/hr/schedule');
  return { ok: true } as const;
}

// ─── Schedule Entries ────────────────────────────────────────────────────────

export async function getScheduleGrid(cycleId: string) {
  const cycle = await db
    .select()
    .from(schema.scheduleCycles)
    .where(eq(schema.scheduleCycles.id, cycleId))
    .then((r) => r[0]);
  if (!cycle) return null;

  const employees = await db
    .select()
    .from(schema.employees)
    .where(eq(schema.employees.status, 'active'))
    .orderBy(schema.employees.firstName);

  const entries = await db
    .select()
    .from(schema.scheduleEntries)
    .where(eq(schema.scheduleEntries.cycleId, cycleId));

  // Build lookup: employeeId + workDate → entry
  const entryMap = new Map(entries.map((e) => [`${e.employeeId}|${e.workDate}`, e]));

  return { cycle, employees, entryMap: Object.fromEntries(entryMap) };
}

export async function setScheduleEntry(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = scheduleEntrySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  await db
    .insert(schema.scheduleEntries)
    .values({
      cycleId: data.cycleId,
      employeeId: data.employeeId,
      workDate: data.workDate,
      status: data.status,
      shiftType: data.shiftType ?? null,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      leaveReason: data.leaveReason ?? null,
      notes: data.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.scheduleEntries.cycleId, schema.scheduleEntries.employeeId, schema.scheduleEntries.workDate],
      set: {
        status: data.status,
        shiftType: data.shiftType ?? null,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        leaveReason: data.leaveReason ?? null,
        notes: data.notes ?? null,
      },
    });

  revalidatePath('/hr/schedule');
  return { ok: true } as const;
}

// ─── Time Entries ────────────────────────────────────────────────────────────

export async function getTimeEntries(employeeId: string, startDate: string, endDate: string) {
  return db
    .select()
    .from(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.employeeId, employeeId),
        gte(schema.timeEntries.workDate, startDate),
        lte(schema.timeEntries.workDate, endDate),
      ),
    )
    .orderBy(schema.timeEntries.workDate);
}

export async function createTimeEntry(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = timeEntrySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  // Calculate totalHours from clockIn/clockOut minus break
  const totalHours = calcTotalHours(data.clockIn, data.clockOut, data.breakMinutes);
  if (totalHours <= 0) return { ok: false, error: 'เวลาออกต้องมากกว่าเวลาเข้า' } as const;

  const [entry] = await db
    .insert(schema.timeEntries)
    .values({
      employeeId: data.employeeId,
      workDate: data.workDate,
      clockIn: data.clockIn,
      clockOut: data.clockOut,
      totalHours: String(totalHours),
      breakMinutes: data.breakMinutes,
      notes: data.notes ?? null,
    })
    .returning();

  revalidatePath('/hr/time');
  return { ok: true, data: entry } as const;
}

export async function updateTimeEntry(id: string, raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = timeEntrySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  const totalHours = calcTotalHours(data.clockIn, data.clockOut, data.breakMinutes);
  if (totalHours <= 0) return { ok: false, error: 'เวลาออกต้องมากกว่าเวลาเข้า' } as const;

  await db
    .update(schema.timeEntries)
    .set({
      workDate: data.workDate,
      clockIn: data.clockIn,
      clockOut: data.clockOut,
      totalHours: String(totalHours),
      breakMinutes: data.breakMinutes,
      notes: data.notes ?? null,
    })
    .where(eq(schema.timeEntries.id, id));

  revalidatePath('/hr/time');
  return { ok: true } as const;
}

export async function deleteTimeEntry(id: string) {
  const auth = await requireHr();
  if (!auth.ok) return auth;
  await db.delete(schema.timeEntries).where(eq(schema.timeEntries.id, id));
  revalidatePath('/hr/time');
  return { ok: true } as const;
}

function calcTotalHours(clockIn: string, clockOut: string, breakMinutes: number): number {
  const [inH, inM] = clockIn.split(':').map(Number);
  const [outH, outM] = clockOut.split(':').map(Number);
  const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM) - breakMinutes;
  return Math.round((totalMinutes / 60) * 100) / 100;
}

// ─── Payroll Cycles ───────────────────────────────────────────────────────────

export async function getPayrollCycles() {
  const cycles = await db
    .select()
    .from(schema.payrollCycles)
    .orderBy(sql`${schema.payrollCycles.workStartDate} DESC`);

  // Attach paid/total counts per cycle
  const cycleIds = cycles.map((c) => c.id);
  if (cycleIds.length === 0) return cycles.map((c) => ({ ...c, paidCount: 0, totalCount: 0, totalNet: 0 }));

  const itemStats = await db
    .select({
      cycleId: schema.payrollItems.payrollCycleId,
      paidCount: sql<number>`count(*) filter (where ${schema.payrollItems.isPaid})::int`,
      totalCount: sql<number>`count(*)::int`,
      totalNet: sql<number>`coalesce(sum(${schema.payrollItems.netPay}), 0)`,
    })
    .from(schema.payrollItems)
    .where(inArray(schema.payrollItems.payrollCycleId, cycleIds))
    .groupBy(schema.payrollItems.payrollCycleId);

  const statsMap = new Map(itemStats.map((s) => [s.cycleId, s]));

  return cycles.map((c) => {
    const s = statsMap.get(c.id);
    return {
      ...c,
      paidCount: s?.paidCount ?? 0,
      totalCount: s?.totalCount ?? 0,
      totalNet: Number(s?.totalNet ?? 0),
    };
  });
}

export async function createPayrollCycle(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = payrollCycleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  const settings = await getHrSettings();
  const activeEmployees = await db
    .select()
    .from(schema.employees)
    .where(eq(schema.employees.status, 'active'));

  if (activeEmployees.length === 0) return { ok: false, error: 'ไม่มีพนักงาน active ในระบบ' } as const;

  const [cycle] = await db
    .insert(schema.payrollCycles)
    .values({
      name: data.name,
      workStartDate: data.workStartDate,
      workEndDate: data.workEndDate,
      payDate: data.payDate,
      notes: data.notes ?? null,
      createdBy: auth.userId,
    })
    .returning();

  // Generate payroll items for each active employee
  for (const emp of activeEmployees) {
    // Count working days from schedule entries in range
    const workingDays = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.scheduleEntries)
      .where(
        and(
          eq(schema.scheduleEntries.employeeId, emp.id),
          eq(schema.scheduleEntries.status, 'working'),
          gte(schema.scheduleEntries.workDate, data.workStartDate),
          lte(schema.scheduleEntries.workDate, data.workEndDate),
        ),
      )
      .then((r) => r[0]?.count ?? 0);

    // Sum total hours from time entries in range (part_time)
    const totalHoursRow = await db
      .select({ total: sql<number>`coalesce(sum(${schema.timeEntries.totalHours}), 0)` })
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.employeeId, emp.id),
          gte(schema.timeEntries.workDate, data.workStartDate),
          lte(schema.timeEntries.workDate, data.workEndDate),
        ),
      )
      .then((r) => r[0]?.total ?? 0);

    const baseSalary = Number(emp.baseSalaryPerCycle ?? 0);
    const incentivePerDay = Number(emp.incentivePerDay ?? 0);
    const hourlyRate = Number(emp.hourlyRate ?? 0);
    const workDays = workingDays;
    const totalHours = Number(totalHoursRow);

    let gross = 0;
    let incentiveTotal = 0;
    let hourlyTotal = 0;

    if (emp.type === 'full_time') {
      incentiveTotal = incentivePerDay * workDays;
      gross = baseSalary + incentiveTotal;
    } else {
      hourlyTotal = hourlyRate * totalHours;
      gross = hourlyTotal;
    }

    const ssfEmployee = emp.ssfRegistered ? Math.min(gross * 0.05, 750) : 0;
    const ssfEmployer = emp.ssfRegistered ? Math.min(gross * 0.05, 750) : 0;
    const withholdingTax = calcMonthlyWithholdingTax(gross);
    const netPay = gross;
    const netPayAfterTax = Math.max(0, netPay - withholdingTax);

    await db.insert(schema.payrollItems).values({
      payrollCycleId: cycle.id,
      employeeId: emp.id,
      employeeType: emp.type,
      baseSalary: String(baseSalary),
      incentivePerDay: String(incentivePerDay),
      workDays,
      incentiveTotal: String(incentiveTotal),
      hourlyRate: String(hourlyRate),
      totalHours: String(totalHours),
      hourlyTotal: String(hourlyTotal),
      gross: String(gross),
      totalDeduction: '0',
      netPay: String(netPay),
      ssfEmployee: String(Math.round(ssfEmployee * 100) / 100),
      ssfEmployer: String(Math.round(ssfEmployer * 100) / 100),
      withholdingTax: String(withholdingTax),
      netPayAfterTax: String(Math.round(netPayAfterTax * 100) / 100),
    });
  }

  revalidatePath('/hr/payroll');
  return { ok: true, data: cycle } as const;
}

export async function getPayrollCycleDetail(cycleId: string) {
  const [cycle] = await db
    .select()
    .from(schema.payrollCycles)
    .where(eq(schema.payrollCycles.id, cycleId));
  if (!cycle) return null;

  const items = await db
    .select()
    .from(schema.payrollItems)
    .where(eq(schema.payrollItems.payrollCycleId, cycleId));

  const employeeIds = items.map((i) => i.employeeId);
  const employees =
    employeeIds.length > 0
      ? await db.select().from(schema.employees).where(inArray(schema.employees.id, employeeIds))
      : [];
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const itemIds = items.map((i) => i.id);
  const deductions =
    itemIds.length > 0
      ? await db.select().from(schema.payrollDeductions).where(inArray(schema.payrollDeductions.payrollItemId, itemIds))
      : [];
  const absences =
    itemIds.length > 0
      ? await db.select().from(schema.payrollAbsences).where(inArray(schema.payrollAbsences.payrollItemId, itemIds))
      : [];

  const deductionMap = new Map<string, typeof deductions>();
  for (const d of deductions) {
    if (!deductionMap.has(d.payrollItemId)) deductionMap.set(d.payrollItemId, []);
    deductionMap.get(d.payrollItemId)!.push(d);
  }
  const absenceMap = new Map<string, typeof absences>();
  for (const a of absences) {
    if (!absenceMap.has(a.payrollItemId)) absenceMap.set(a.payrollItemId, []);
    absenceMap.get(a.payrollItemId)!.push(a);
  }

  const enrichedItems = items.map((item) => ({
    ...item,
    employee: empMap.get(item.employeeId),
    deductions: deductionMap.get(item.id) ?? [],
    absences: absenceMap.get(item.id) ?? [],
  }));

  return { cycle, items: enrichedItems };
}

// ─── Payroll recalculate ─────────────────────────────────────────────────────

async function recalcPayrollItem(itemId: string, settings: schema.HrSettings) {
  const [item] = await db.select().from(schema.payrollItems).where(eq(schema.payrollItems.id, itemId));
  if (!item) return;

  const [emp] = await db
    .select({ ssfRegistered: schema.employees.ssfRegistered })
    .from(schema.employees)
    .where(eq(schema.employees.id, item.employeeId))
    .limit(1);

  const deductions = await db.select().from(schema.payrollDeductions).where(eq(schema.payrollDeductions.payrollItemId, itemId));
  const absences = await db.select().from(schema.payrollAbsences).where(eq(schema.payrollAbsences.payrollItemId, itemId));

  const baseSalary = Number(item.baseSalary);
  const incentiveTotal = Number(item.incentivePerDay) * item.workDays;
  const hourlyTotal = Number(item.hourlyRate) * Number(item.totalHours);

  let gross = 0;
  if (item.employeeType === 'full_time') {
    gross = baseSalary + incentiveTotal;
  } else {
    gross = hourlyTotal;
  }

  // Absences (full_time only)
  const absenceDays = absences.filter((a) => a.type === 'absence').length;
  const absenceDeduction = absenceDays * Number(settings.absenceRatePerDay);

  // Late minutes
  const lateMinutes = absences
    .filter((a) => a.type === 'late')
    .reduce((sum, a) => sum + (a.lateMinutes ?? 0), 0);
  const lateDeduction = lateMinutes * Number(settings.lateRatePerMinute);

  // Advance / damage
  const advanceTotal = deductions.filter((d) => d.type === 'advance').reduce((s, d) => s + Number(d.amount), 0);
  const damageTotal = deductions.filter((d) => d.type === 'damage').reduce((s, d) => s + Number(d.amount), 0);

  const totalDeduction = absenceDeduction + lateDeduction + advanceTotal + damageTotal;
  const netPay = gross - totalDeduction;
  const ssfEmployee = (emp?.ssfRegistered ?? true) ? Math.min(gross * 0.05, 750) : 0;
  const ssfEmployer = (emp?.ssfRegistered ?? true) ? Math.min(gross * 0.05, 750) : 0;
  const withholdingTax = calcMonthlyWithholdingTax(gross);
  const netPayAfterTax = Math.max(0, netPay - withholdingTax);

  await db.update(schema.payrollItems).set({
    incentiveTotal: String(incentiveTotal),
    hourlyTotal: String(hourlyTotal),
    absenceDays,
    absenceDeduction: String(absenceDeduction),
    lateMinutes,
    lateDeduction: String(lateDeduction),
    advanceTotal: String(advanceTotal),
    damageTotal: String(damageTotal),
    gross: String(gross),
    totalDeduction: String(totalDeduction),
    netPay: String(netPay),
    ssfEmployee: String(Math.round(ssfEmployee * 100) / 100),
    ssfEmployer: String(Math.round(ssfEmployer * 100) / 100),
    withholdingTax: String(withholdingTax),
    netPayAfterTax: String(Math.round(netPayAfterTax * 100) / 100),
  }).where(eq(schema.payrollItems.id, itemId));
}

// ─── Payroll Deductions ───────────────────────────────────────────────────────

export async function addDeduction(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = payrollDeductionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  await db.insert(schema.payrollDeductions).values({
    payrollItemId: data.payrollItemId,
    type: data.type,
    amount: String(data.amount),
    reason: data.reason,
    occurredDate: data.occurredDate ?? null,
  });

  const settings = await getHrSettings();
  await recalcPayrollItem(data.payrollItemId, settings);

  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

export async function removeDeduction(deductionId: string) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const [ded] = await db
    .select()
    .from(schema.payrollDeductions)
    .where(eq(schema.payrollDeductions.id, deductionId));
  if (!ded) return { ok: false, error: 'ไม่พบรายการ' } as const;

  await db.delete(schema.payrollDeductions).where(eq(schema.payrollDeductions.id, deductionId));

  const settings = await getHrSettings();
  await recalcPayrollItem(ded.payrollItemId, settings);

  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

// ─── Payroll Absences ─────────────────────────────────────────────────────────

export async function addAbsence(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = payrollAbsenceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  await db.insert(schema.payrollAbsences).values({
    payrollItemId: data.payrollItemId,
    type: data.type,
    occurredDate: data.occurredDate,
    lateMinutes: data.type === 'late' ? (data.lateMinutes ?? null) : null,
    notes: data.notes ?? null,
  });

  const settings = await getHrSettings();
  await recalcPayrollItem(data.payrollItemId, settings);

  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

export async function removeAbsence(absenceId: string) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const [abs] = await db
    .select()
    .from(schema.payrollAbsences)
    .where(eq(schema.payrollAbsences.id, absenceId));
  if (!abs) return { ok: false, error: 'ไม่พบรายการ' } as const;

  await db.delete(schema.payrollAbsences).where(eq(schema.payrollAbsences.id, absenceId));

  const settings = await getHrSettings();
  await recalcPayrollItem(abs.payrollItemId, settings);

  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

// ─── Mark Paid ────────────────────────────────────────────────────────────────

export async function markAsPaid(raw: unknown) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  const parsed = markPaidSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  await db
    .update(schema.payrollItems)
    .set({
      isPaid: true,
      paidMethod: data.paidMethod,
      paidAt: new Date(),
      paymentProofUrl: data.paymentProofUrl ?? null,
    })
    .where(eq(schema.payrollItems.id, data.payrollItemId));

  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

export async function finalizePayrollCycle(cycleId: string) {
  const auth = await requireHr();
  if (!auth.ok) return auth;

  await db
    .update(schema.payrollCycles)
    .set({ status: 'finalized' })
    .where(eq(schema.payrollCycles.id, cycleId));

  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

// ─── HR Dashboard stats ───────────────────────────────────────────────────────

export async function getHrDashboardStats() {
  const [fullTimeCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.employees)
    .where(and(eq(schema.employees.type, 'full_time'), eq(schema.employees.status, 'active')));

  const [partTimeCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.employees)
    .where(and(eq(schema.employees.type, 'part_time'), eq(schema.employees.status, 'active')));

  const [unpaidCycles] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.payrollCycles)
    .where(eq(schema.payrollCycles.status, 'draft'));

  const recentCycles = await db
    .select()
    .from(schema.payrollCycles)
    .orderBy(sql`${schema.payrollCycles.createdAt} DESC`)
    .limit(3);

  return {
    fullTimeCount: fullTimeCount?.count ?? 0,
    partTimeCount: partTimeCount?.count ?? 0,
    unpaidCycles: unpaidCycles?.count ?? 0,
    recentCycles,
  };
}

// ─── SSF & Tax Report ─────────────────────────────────────────────────────────

export async function getPayrollSsfReport(cycleId: string) {
  const authResult = await requireHr();
  if (!authResult.ok) return authResult;

  const [cycle] = await db
    .select()
    .from(schema.payrollCycles)
    .where(eq(schema.payrollCycles.id, cycleId));
  if (!cycle) return { ok: false, error: 'ไม่พบรอบเงินเดือน' } as const;

  const items = await db
    .select({
      id: schema.payrollItems.id,
      employeeId: schema.payrollItems.employeeId,
      gross: schema.payrollItems.gross,
      netPay: schema.payrollItems.netPay,
      ssfEmployee: schema.payrollItems.ssfEmployee,
      ssfEmployer: schema.payrollItems.ssfEmployer,
      withholdingTax: schema.payrollItems.withholdingTax,
      netPayAfterTax: schema.payrollItems.netPayAfterTax,
    })
    .from(schema.payrollItems)
    .where(eq(schema.payrollItems.payrollCycleId, cycleId));

  const employeeIds = items.map((i) => i.employeeId);
  const employees =
    employeeIds.length > 0
      ? await db
          .select({ id: schema.employees.id, firstName: schema.employees.firstName, lastName: schema.employees.lastName })
          .from(schema.employees)
          .where(inArray(schema.employees.id, employeeIds))
      : [];
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const rows = items.map((item) => ({
    id: item.id,
    employee: empMap.get(item.employeeId),
    gross: Number(item.gross),
    netPay: Number(item.netPay),
    ssfEmployee: Number(item.ssfEmployee),
    ssfEmployer: Number(item.ssfEmployer),
    withholdingTax: Number(item.withholdingTax),
    netPayAfterTax: Number(item.netPayAfterTax),
  }));

  const totals = {
    gross: rows.reduce((s, r) => s + r.gross, 0),
    ssfEmployee: rows.reduce((s, r) => s + r.ssfEmployee, 0),
    ssfEmployer: rows.reduce((s, r) => s + r.ssfEmployer, 0),
    withholdingTax: rows.reduce((s, r) => s + r.withholdingTax, 0),
    netPayAfterTax: rows.reduce((s, r) => s + r.netPayAfterTax, 0),
  };

  return { ok: true as const, data: { cycle, rows, totals } };
}

export type SsfReportRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getPayrollSsfReport>>, { ok: true }>['data']
>['rows'][number];
