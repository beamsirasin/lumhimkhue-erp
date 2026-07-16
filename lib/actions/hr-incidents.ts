'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { can } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/permissions';
import { employeeIncidentSchema } from '@/lib/validations/hr';
import { eq, desc } from 'drizzle-orm';

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

  const incidents = await db
    .select({
      id: schema.employeeIncidents.id,
      employeeId: schema.employeeIncidents.employeeId,
      type: schema.employeeIncidents.type,
      occurredDate: schema.employeeIncidents.occurredDate,
      lateMinutes: schema.employeeIncidents.lateMinutes,
      damageQuantity: schema.employeeIncidents.damageQuantity,
      description: schema.employeeIncidents.description,
      reportedBy: schema.employeeIncidents.reportedBy,
      reporterName: schema.users.name,
      createdAt: schema.employeeIncidents.createdAt,
    })
    .from(schema.employeeIncidents)
    .leftJoin(schema.users, eq(schema.employeeIncidents.reportedBy, schema.users.id))
    .orderBy(desc(schema.employeeIncidents.occurredDate), desc(schema.employeeIncidents.createdAt));

  return { ok: true as const, data: { employees, incidents, currentUserId: access.userId, role: access.role } };
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

  await db.insert(schema.employeeIncidents).values({
    employeeId: data.employeeId,
    type: data.type,
    occurredDate: data.occurredDate,
    lateMinutes: data.type === 'late' ? (data.lateMinutes ?? null) : null,
    damageQuantity: data.type === 'damage' ? (data.damageQuantity ?? null) : null,
    description: data.description?.trim() || null,
    reportedBy: access.userId,
  });

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

  await db.delete(schema.employeeIncidents).where(eq(schema.employeeIncidents.id, incidentId));

  revalidatePath('/hr-incidents');
  return { ok: true } as const;
}
