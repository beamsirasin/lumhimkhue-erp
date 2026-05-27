'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, sessionGuests, pricingTiers } from '@/lib/db/schema';
import { openSessionSchema } from '@/lib/validations/sessions';

export async function openSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = openSessionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  const { tableId, guests, notes } = parsed.data;

  // Filter out zero-quantity tiers
  const nonZeroGuests = guests.filter((g) => g.quantity > 0);
  if (nonZeroGuests.length === 0)
    return { ok: false as const, error: 'ต้องมีผู้เข้าใช้บริการอย่างน้อย 1 คน' };

  try {
    const [table] = await db
      .select()
      .from(tables)
      .where(eq(tables.id, tableId))
      .limit(1);
    if (!table) return { ok: false as const, error: 'ไม่พบโต๊ะ' };
    if (table.status !== 'available')
      return { ok: false as const, error: 'โต๊ะนี้ไม่พร้อมใช้งานในขณะนี้' };

    // Verify all pricing tier IDs are valid and active
    const tierIds = nonZeroGuests.map((g) => g.pricingTierId);
    const tiers = await db
      .select({ id: pricingTiers.id })
      .from(pricingTiers)
      .where(eq(pricingTiers.isActive, true));
    const activeTierIds = new Set(tiers.map((t) => t.id));
    for (const tierId of tierIds) {
      if (!activeTierIds.has(tierId))
        return { ok: false as const, error: 'ไม่พบประเภทราคา' };
    }

    const startedAt = new Date();
    const sessionToken = nanoid(12);

    const [newSession] = await db
      .insert(sessions)
      .values({
        tableId,
        startedAt,
        sessionToken,
        status: 'active',
        notes: notes ?? null,
      })
      .returning({ id: sessions.id, sessionToken: sessions.sessionToken });

    // Insert session guests
    await db.insert(sessionGuests).values(
      nonZeroGuests.map((g) => ({
        sessionId: newSession.id,
        pricingTierId: g.pricingTierId,
        quantity: g.quantity,
      })),
    );

    await db
      .update(tables)
      .set({ status: 'occupied' })
      .where(eq(tables.id, tableId));

    const thLocale: Intl.DateTimeFormatOptions = {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    };

    revalidatePath('/tables');
    return {
      ok: true as const,
      data: {
        sessionToken: newSession.sessionToken,
        tableQrToken: table.qrToken,
        tableLabel: table.label,
        startedAt: startedAt.toLocaleString('th-TH', thLocale),
      },
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
      .set({ status: 'available' })
      .where(eq(tables.id, session.tableId));

    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[closeSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function requestBillFromTable(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(sessions)
      .set({ status: 'closing' })
      .where(eq(sessions.id, input.sessionId));

    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[requestBillFromTable]', e);
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
