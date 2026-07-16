'use server';

import { revalidatePath } from 'next/cache';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { hrLookupOptions, scheduleCycles, scheduleEntries } from '@/lib/db/schema';

export type HrLookupOption = typeof hrLookupOptions.$inferSelect;

/** Drizzle wraps DB errors in DrizzleQueryError — the Postgres code lives on .cause */
function pgErrorCode(e: unknown): string | undefined {
  const direct = (e as { code?: string })?.code;
  if (direct) return direct;
  return (e as { cause?: { code?: string } })?.cause?.code;
}

const addOptionSchema = z.object({
  kind: z.enum(['department', 'bank']),
  label: z.string().trim().min(1, 'กรุณากรอกชื่อตัวเลือก').max(50, 'ยาวเกินไป (สูงสุด 50 ตัวอักษร)'),
});

export async function getHrLookupOptions() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'hr:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const rows = await db
      .select()
      .from(hrLookupOptions)
      .where(eq(hrLookupOptions.isActive, true))
      .orderBy(asc(hrLookupOptions.sortOrder), asc(hrLookupOptions.createdAt));
    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getHrLookupOptions]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function addHrLookupOption(input: unknown) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'hr:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = addOptionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  try {
    const [row] = await db
      .insert(hrLookupOptions)
      .values({ kind: parsed.data.kind, label: parsed.data.label })
      .returning();
    revalidatePath('/hr/employees');
    return { ok: true as const, data: row };
  } catch (e) {
    // 23505 = unique_violation on (kind, label)
    if (pgErrorCode(e) === '23505')
      return { ok: false as const, error: 'มีตัวเลือกนี้อยู่แล้ว' };
    console.error('[addHrLookupOption]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── Schedule cycle delete ──────────────────────────────────────────────── */

const deleteCycleSchema = z.object({ cycleId: z.string().uuid() });

/**
 * Delete a schedule cycle and all of its entries. Entries are removed
 * explicitly first (schema declares ON DELETE CASCADE, but we don't rely on
 * the live constraint matching) — if the second delete fails, the cycle
 * simply remains with fewer entries, which is recoverable.
 */
export async function deleteScheduleCycle(input: unknown) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'hr:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = deleteCycleSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    const [cycle] = await db
      .select({ id: scheduleCycles.id })
      .from(scheduleCycles)
      .where(eq(scheduleCycles.id, parsed.data.cycleId))
      .limit(1);
    if (!cycle) return { ok: false as const, error: 'ไม่พบรอบตารางงาน' };

    await db.delete(scheduleEntries).where(eq(scheduleEntries.cycleId, parsed.data.cycleId));
    await db.delete(scheduleCycles).where(eq(scheduleCycles.id, parsed.data.cycleId));

    revalidatePath('/hr/schedule');
    return { ok: true as const };
  } catch (e) {
    console.error('[deleteScheduleCycle]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── Employee display order ─────────────────────────────────────────────── */

const employeeOrderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Persist manual display order of employees (schedule grid / employee lists).
 * Assigns employees.sort_order = position of each id in orderedIds.
 * Ids not included keep their current sort_order.
 */
export async function setEmployeeOrder(input: unknown) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'hr:manage'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = employeeOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    // Single statement — position in the array becomes sort_order.
    // NB: drizzle expands a bare JS array to ($1,$2,…) (a record), so build
    // an explicit ARRAY[...] literal with per-element params instead.
    const idList = sql.join(parsed.data.orderedIds.map((id) => sql`${id}`), sql`, `);
    await db.execute(sql`
      UPDATE employees AS e
      SET sort_order = x.ord - 1, updated_at = now()
      FROM unnest(ARRAY[${idList}]::uuid[]) WITH ORDINALITY AS x(id, ord)
      WHERE e.id = x.id
    `);
    revalidatePath('/hr/schedule');
    revalidatePath('/hr/employees');
    return { ok: true as const };
  } catch (e) {
    console.error('[setEmployeeOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
