'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { can } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/permissions';
import { employeeIncidentSchema, damageItemSchema } from '@/lib/validations/hr';
import { eq, desc, asc, and, lte, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireIncidentAccess() {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'กรุณาเข้าสู่ระบบ' } as const;
  if (!can(session.user.role as Role, 'hr:incident:manage'))
    return { ok: false, error: 'ไม่มีสิทธิ์เข้าถึง' } as const;
  return { ok: true, userId: session.user.id, role: session.user.role as Role } as const;
}

// ─── Page data ────────────────────────────────────────────────────────────────

export async function getEmployeeIncidentPageData() {
  const access = await requireIncidentAccess();
  if (!access.ok) return access;

  const employees = await db
    .select({
      id: schema.employees.id,
      firstName: schema.employees.firstName,
      lastName: schema.employees.lastName,
      type: schema.employees.type,
      department: schema.employees.department,
      status: schema.employees.status,
    })
    .from(schema.employees)
    .where(eq(schema.employees.status, 'active'))
    .orderBy(schema.employees.sortOrder, schema.employees.firstName);

  const resolver = alias(schema.users, 'resolver');
  const incidents = await db
    .select({
      id: schema.employeeIncidents.id,
      employeeId: schema.employeeIncidents.employeeId,
      type: schema.employeeIncidents.type,
      occurredDate: schema.employeeIncidents.occurredDate,
      lateMinutes: schema.employeeIncidents.lateMinutes,
      damageQuantity: schema.employeeIncidents.damageQuantity,
      damageItemName: schema.employeeIncidents.damageItemName,
      damageUnitPrice: schema.employeeIncidents.damageUnitPrice,
      description: schema.employeeIncidents.description,
      reportedBy: schema.employeeIncidents.reportedBy,
      reporterName: schema.users.name,
      createdAt: schema.employeeIncidents.createdAt,
      // Manual resolution (จัดการเอง — undoable)
      resolvedAt: schema.employeeIncidents.resolvedAt,
      resolverName: resolver.name,
      // Pulled into some payroll cycle (any state) — intermediate "อยู่ในรอบจ่าย".
      // Derived, self-healing: deleting the row (or its cycle) reverts to "รอจัดการ".
      inPayroll: sql<boolean>`(
        EXISTS (SELECT 1 FROM payroll_deductions pd WHERE pd.incident_id = ${schema.employeeIncidents.id})
        OR EXISTS (SELECT 1 FROM payroll_absences pa WHERE pa.incident_id = ${schema.employeeIncidents.id})
      )`,
      // Fully resolved via payroll ONLY when that employee's payroll item has been
      // paid AND its cycle is approved (finalized/paid) — merely sitting in a
      // draft cycle does not count as "จัดการแล้ว".
      resolved: sql<boolean>`(
        EXISTS (
          SELECT 1 FROM payroll_deductions pd
          JOIN payroll_items pi ON pi.id = pd.payroll_item_id
          JOIN payroll_cycles pc ON pc.id = pi.payroll_cycle_id
          WHERE pd.incident_id = ${schema.employeeIncidents.id}
            AND pi.is_paid AND pc.status IN ('finalized', 'paid')
        )
        OR EXISTS (
          SELECT 1 FROM payroll_absences pa
          JOIN payroll_items pi ON pi.id = pa.payroll_item_id
          JOIN payroll_cycles pc ON pc.id = pi.payroll_cycle_id
          WHERE pa.incident_id = ${schema.employeeIncidents.id}
            AND pi.is_paid AND pc.status IN ('finalized', 'paid')
        )
      )`,
      // Pay date of the cycle that pulled this incident in (null when not payroll-resolved)
      payrollPayDate: sql<string | null>`(
        SELECT pc.pay_date FROM payroll_deductions pd
        JOIN payroll_items pi ON pi.id = pd.payroll_item_id
        JOIN payroll_cycles pc ON pc.id = pi.payroll_cycle_id
        WHERE pd.incident_id = ${schema.employeeIncidents.id}
        UNION ALL
        SELECT pc.pay_date FROM payroll_absences pa
        JOIN payroll_items pi ON pi.id = pa.payroll_item_id
        JOIN payroll_cycles pc ON pc.id = pi.payroll_cycle_id
        WHERE pa.incident_id = ${schema.employeeIncidents.id}
        LIMIT 1
      )`,
    })
    .from(schema.employeeIncidents)
    .leftJoin(schema.users, eq(schema.employeeIncidents.reportedBy, schema.users.id))
    .leftJoin(resolver, eq(schema.employeeIncidents.resolvedBy, resolver.id))
    .orderBy(desc(schema.employeeIncidents.occurredDate), desc(schema.employeeIncidents.createdAt));

  const damageItems = await db
    .select()
    .from(schema.damageItems)
    .orderBy(asc(schema.damageItems.sortOrder), asc(schema.damageItems.name));

  return {
    ok: true as const,
    data: { employees, incidents, damageItems, currentUserId: access.userId, role: access.role },
  };
}

export type IncidentEmployee = Extract<
  Awaited<ReturnType<typeof getEmployeeIncidentPageData>>,
  { ok: true }
>['data']['employees'][number];

export type IncidentRow = Extract<
  Awaited<ReturnType<typeof getEmployeeIncidentPageData>>,
  { ok: true }
>['data']['incidents'][number];

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createEmployeeIncident(raw: unknown) {
  const access = await requireIncidentAccess();
  if (!access.ok) return access;

  const parsed = employeeIncidentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  const [emp] = await db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(eq(schema.employees.id, data.employeeId));
  if (!emp) return { ok: false, error: 'ไม่พบพนักงาน' } as const;

  // Damage reports snapshot the catalog item's name + current price.
  let damageItemName: string | null = null;
  let damageUnitPrice: string | null = null;
  if (data.type === 'damage' && data.damageItemId) {
    const [catalogItem] = await db
      .select()
      .from(schema.damageItems)
      .where(eq(schema.damageItems.id, data.damageItemId));
    if (!catalogItem) return { ok: false, error: 'ไม่พบรายการของเสียหาย' } as const;
    damageItemName = catalogItem.name;
    damageUnitPrice = catalogItem.pricePerUnit;
  }

  await db.insert(schema.employeeIncidents).values({
    employeeId: data.employeeId,
    type: data.type,
    occurredDate: data.occurredDate,
    lateMinutes: data.type === 'late' ? (data.lateMinutes ?? null) : null,
    damageQuantity: data.type === 'damage' ? (data.damageQuantity ?? null) : null,
    damageItemName,
    damageUnitPrice,
    description: data.description?.trim() || null,
    reportedBy: access.userId,
  });

  revalidatePath('/hr-incidents');
  return { ok: true } as const;
}

// ─── Pending incidents for a payroll cycle ────────────────────────────────────

/**
 * Unresolved money-relevant incidents (สาย/ขาด/เสียหาย) occurring on or before
 * the cycle's work end date, for the payroll detail page's "ดึงรายการค้าง" banner.
 */
export async function getPendingIncidentsForCycle(cycleId: string) {
  const access = await requireHrManage();
  if (!access.ok) return access;

  const [cycle] = await db
    .select({ workEndDate: schema.payrollCycles.workEndDate })
    .from(schema.payrollCycles)
    .where(eq(schema.payrollCycles.id, cycleId));
  if (!cycle) return { ok: false, error: 'ไม่พบรอบเงินเดือน' } as const;

  const rows = await db
    .select({
      id: schema.employeeIncidents.id,
      employeeId: schema.employeeIncidents.employeeId,
      type: schema.employeeIncidents.type,
      occurredDate: schema.employeeIncidents.occurredDate,
      lateMinutes: schema.employeeIncidents.lateMinutes,
      damageItemName: schema.employeeIncidents.damageItemName,
      damageQuantity: schema.employeeIncidents.damageQuantity,
      damageUnitPrice: schema.employeeIncidents.damageUnitPrice,
      description: schema.employeeIncidents.description,
    })
    .from(schema.employeeIncidents)
    .where(
      and(
        lte(schema.employeeIncidents.occurredDate, cycle.workEndDate),
        inArray(schema.employeeIncidents.type, ['late', 'absence', 'damage']),
        isNull(schema.employeeIncidents.resolvedAt),
        sql`NOT EXISTS (SELECT 1 FROM payroll_deductions pd WHERE pd.incident_id = ${schema.employeeIncidents.id})`,
        sql`NOT EXISTS (SELECT 1 FROM payroll_absences pa WHERE pa.incident_id = ${schema.employeeIncidents.id})`,
      ),
    )
    .orderBy(asc(schema.employeeIncidents.occurredDate));

  const byEmployee: Record<string, typeof rows> = {};
  for (const row of rows) {
    (byEmployee[row.employeeId] ??= []).push(row);
  }
  return { ok: true as const, data: byEmployee };
}

export type PendingIncident = Extract<
  Awaited<ReturnType<typeof getPendingIncidentsForCycle>>,
  { ok: true }
>['data'][string][number];

// ─── Manual resolution (จัดการเอง นอกรอบเงินเดือน) ──────────────────────────

export async function resolveEmployeeIncident(incidentId: string) {
  const access = await requireIncidentAccess();
  if (!access.ok) return access;

  const [incident] = await db
    .select({
      id: schema.employeeIncidents.id,
      resolvedAt: schema.employeeIncidents.resolvedAt,
      payrollLinked: sql<boolean>`(
        EXISTS (SELECT 1 FROM payroll_deductions pd WHERE pd.incident_id = ${schema.employeeIncidents.id})
        OR EXISTS (SELECT 1 FROM payroll_absences pa WHERE pa.incident_id = ${schema.employeeIncidents.id})
      )`,
    })
    .from(schema.employeeIncidents)
    .where(eq(schema.employeeIncidents.id, incidentId));
  if (!incident) return { ok: false, error: 'ไม่พบรายการ' } as const;
  if (incident.resolvedAt || incident.payrollLinked)
    return { ok: false, error: 'รายการนี้ถูกจัดการแล้ว' } as const;

  await db
    .update(schema.employeeIncidents)
    .set({ resolvedAt: new Date(), resolvedBy: access.userId })
    .where(eq(schema.employeeIncidents.id, incidentId));

  revalidatePath('/hr-incidents');
  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

export async function unresolveEmployeeIncident(incidentId: string) {
  const access = await requireIncidentAccess();
  if (!access.ok) return access;

  const [incident] = await db
    .select({ id: schema.employeeIncidents.id, resolvedAt: schema.employeeIncidents.resolvedAt })
    .from(schema.employeeIncidents)
    .where(eq(schema.employeeIncidents.id, incidentId));
  if (!incident) return { ok: false, error: 'ไม่พบรายการ' } as const;
  if (!incident.resolvedAt)
    return { ok: false, error: 'ยกเลิกได้เฉพาะรายการที่จัดการเอง — รายการที่อยู่ในรอบเงินเดือนต้องลบรายการหักในรอบนั้นแทน' } as const;

  await db
    .update(schema.employeeIncidents)
    .set({ resolvedAt: null, resolvedBy: null })
    .where(eq(schema.employeeIncidents.id, incidentId));

  revalidatePath('/hr-incidents');
  revalidatePath('/hr/payroll');
  return { ok: true } as const;
}

// ─── Damage catalog (owner-only, managed in HR settings) ─────────────────────

async function requireHrManage() {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'กรุณาเข้าสู่ระบบ' } as const;
  if (!can(session.user.role as Role, 'hr:manage'))
    return { ok: false, error: 'ไม่มีสิทธิ์เข้าถึง' } as const;
  return { ok: true, userId: session.user.id } as const;
}

export async function getDamageItems() {
  const access = await requireHrManage();
  if (!access.ok) return access;

  const items = await db
    .select()
    .from(schema.damageItems)
    .orderBy(asc(schema.damageItems.sortOrder), asc(schema.damageItems.name));
  return { ok: true as const, data: items };
}

export async function createDamageItem(raw: unknown) {
  const access = await requireHrManage();
  if (!access.ok) return access;

  const parsed = damageItemSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message } as const;
  const data = parsed.data;

  const [duplicate] = await db
    .select({ id: schema.damageItems.id })
    .from(schema.damageItems)
    .where(eq(schema.damageItems.name, data.name));
  if (duplicate) return { ok: false, error: 'มีรายการชื่อนี้อยู่แล้ว' } as const;

  const [item] = await db
    .insert(schema.damageItems)
    .values({ name: data.name, pricePerUnit: String(data.pricePerUnit) })
    .returning();

  revalidatePath('/hr/settings');
  revalidatePath('/hr-incidents');
  return { ok: true, data: item } as const;
}

export async function deleteDamageItem(itemId: string) {
  const access = await requireHrManage();
  if (!access.ok) return access;

  const [item] = await db
    .select({ id: schema.damageItems.id })
    .from(schema.damageItems)
    .where(eq(schema.damageItems.id, itemId));
  if (!item) return { ok: false, error: 'ไม่พบรายการ' } as const;

  // Past incident reports keep their own name/price snapshot — safe to delete.
  await db.delete(schema.damageItems).where(eq(schema.damageItems.id, itemId));

  revalidatePath('/hr/settings');
  revalidatePath('/hr-incidents');
  return { ok: true } as const;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteEmployeeIncident(incidentId: string) {
  const access = await requireIncidentAccess();
  if (!access.ok) return access;

  const [incident] = await db
    .select()
    .from(schema.employeeIncidents)
    .where(eq(schema.employeeIncidents.id, incidentId));
  if (!incident) return { ok: false, error: 'ไม่พบรายการ' } as const;

  // Owner can delete any report; manager can delete only reports they created.
  if (access.role !== 'owner' && incident.reportedBy !== access.userId)
    return { ok: false, error: 'ลบได้เฉพาะรายการที่ตัวเองแจ้งเท่านั้น' } as const;

  // Already pulled into a payroll cycle — deleting would orphan the deduction's audit trail.
  const [linked] = await db
    .select({ resolved: sql<boolean>`true` })
    .from(schema.employeeIncidents)
    .where(
      and(
        eq(schema.employeeIncidents.id, incidentId),
        sql`(
          EXISTS (SELECT 1 FROM payroll_deductions pd WHERE pd.incident_id = ${schema.employeeIncidents.id})
          OR EXISTS (SELECT 1 FROM payroll_absences pa WHERE pa.incident_id = ${schema.employeeIncidents.id})
        )`,
      ),
    );
  if (linked)
    return { ok: false, error: 'รายการนี้ถูกดึงเข้ารอบเงินเดือนแล้ว — ลบรายการหักในรอบนั้นก่อน' } as const;

  await db.delete(schema.employeeIncidents).where(eq(schema.employeeIncidents.id, incidentId));

  revalidatePath('/hr-incidents');
  return { ok: true } as const;
}
