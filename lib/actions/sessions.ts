'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { addMinutes } from 'date-fns';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, packages } from '@/lib/db/schema';
import {
  openSessionSchema,
  extendSessionSchema,
} from '@/lib/validations/sessions';

export async function openSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = openSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { tableId, packageId, adults, children, seniors } = parsed.data;

  try {
    const [table] = await db
      .select()
      .from(tables)
      .where(eq(tables.id, tableId))
      .limit(1);
    if (!table) return { ok: false as const, error: 'ไม่พบโต๊ะ' };
    if (table.status !== 'available')
      return { ok: false as const, error: 'โต๊ะนี้ไม่พร้อมใช้งานในขณะนี้' };

    const [pkg] = await db
      .select()
      .from(packages)
      .where(eq(packages.id, packageId))
      .limit(1);
    if (!pkg || !pkg.isActive)
      return { ok: false as const, error: 'ไม่พบแพ็กเกจ' };

    const startedAt = new Date();
    const endsAt = addMinutes(startedAt, pkg.durationMinutes);
    const sessionToken = nanoid(12);

    const [newSession] = await db
      .insert(sessions)
      .values({ tableId, packageId, adults, children, seniors, startedAt, endsAt, sessionToken, status: 'active' })
      .returning({ sessionToken: sessions.sessionToken });

    await db
      .update(tables)
      .set({ status: 'occupied' })
      .where(eq(tables.id, tableId));

    revalidatePath('/tables');
    return {
      ok: true as const,
      data: { sessionToken: newSession.sessionToken, tableQrToken: table.qrToken },
    };
  } catch (e) {
    console.error('[openSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function closeSession(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [session] = await db
      .select({ tableId: sessions.tableId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบข้อมูล session' };

    await db
      .update(sessions)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(sessions.id, input.sessionId));

    await db
      .update(tables)
      .set({ status: 'cleaning' })
      .where(eq(tables.id, session.tableId));

    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[closeSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function extendSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = extendSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    const [session] = await db
      .select({ endsAt: sessions.endsAt })
      .from(sessions)
      .where(eq(sessions.id, parsed.data.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบข้อมูล session' };

    await db
      .update(sessions)
      .set({ endsAt: addMinutes(session.endsAt, parsed.data.minutes) })
      .where(eq(sessions.id, parsed.data.sessionId));

    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[extendSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function setTableCleaning(input: { tableId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db.update(tables).set({ status: 'cleaning' }).where(eq(tables.id, input.tableId));
    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[setTableCleaning]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function setTableAvailable(input: { tableId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db.update(tables).set({ status: 'available' }).where(eq(tables.id, input.tableId));
    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[setTableAvailable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
