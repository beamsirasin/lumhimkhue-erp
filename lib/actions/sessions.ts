'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, sessionGuests, pricingTiles, reservations } from '@/lib/db/schema';
import { z } from 'zod';

/* ─── Shared schemas ─────────────────────────────────────────────────── */

const guestRowSchema = z.object({
  pricingTileId: z.string().uuid(),
  quantity: z.number().int().min(0),
});

/* ─── openSession ────────────────────────────────────────────────────── */

const openSessionSchema = z.object({
  tableId: z.string().uuid(),
  linkedTableIds: z.array(z.string().uuid()).default([]),
  guests: z.array(guestRowSchema).default([]),
  notes: z.string().max(500).optional(),
  /** If the table was reserved, supply the reservationId to mark it as arrived */
  reservationId: z.string().uuid().optional(),
});

export async function openSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = openSessionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  const { tableId, linkedTableIds, guests, notes, reservationId } = parsed.data;
  const allTableIds = [tableId, ...linkedTableIds];

  // Filter out zero-quantity tiles
  const nonZeroGuests = guests.filter((g) => g.quantity > 0);

  try {
    // Verify all tables
    const tableRows = await db
      .select({ id: tables.id, status: tables.status, label: tables.label, qrToken: tables.qrToken })
      .from(tables)
      .where(inArray(tables.id, allTableIds));

    for (const t of tableRows) {
      if (t.id === tableId && t.status !== 'available' && t.status !== 'reserved')
        return { ok: false as const, error: `โต๊ะ ${t.label} ไม่พร้อมใช้งานในขณะนี้` };
      if (t.id !== tableId && t.status !== 'available' && t.status !== 'reserved')
        return { ok: false as const, error: `โต๊ะเชื่อมโยง ${t.label} ไม่ว่างในขณะนี้` };
    }

    const primaryTableRow = tableRows.find((t) => t.id === tableId);
    if (!primaryTableRow) return { ok: false as const, error: 'ไม่พบโต๊ะ' };

    // Verify pricing tiles
    const tileIds = nonZeroGuests.map((g) => g.pricingTileId);
    const activeTiles = await db
      .select({ id: pricingTiles.id })
      .from(pricingTiles)
      .where(eq(pricingTiles.isActive, true));
    const activeTileIds = new Set(activeTiles.map((t) => t.id));
    for (const tileId of tileIds) {
      if (!activeTileIds.has(tileId))
        return { ok: false as const, error: 'ไม่พบประเภทราคา' };
    }

    const startedAt = new Date();
    const sessionToken = nanoid(12);

    // Create primary session
    const [newSession] = await db
      .insert(sessions)
      .values({
        tableId,
        startedAt,
        sessionToken,
        status: 'active',
        notes: notes ?? null,
        parentSessionId: null,
      })
      .returning({ id: sessions.id, sessionToken: sessions.sessionToken });

    // Insert session guests on primary session
    await db.insert(sessionGuests).values(
      nonZeroGuests.map((g) => ({
        sessionId: newSession.id,
        pricingTileId: g.pricingTileId,
        quantity: g.quantity,
      })),
    );

    // Create child sessions for linked tables
    if (linkedTableIds.length > 0) {
      await db.insert(sessions).values(
        linkedTableIds.map((ltId) => ({
          tableId: ltId,
          startedAt,
          sessionToken: nanoid(12),
          status: 'active' as const,
          parentSessionId: newSession.id,
        })),
      );
    }

    // Mark primary table as occupied
    await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId));

    // Mark linked tables as linked
    if (linkedTableIds.length > 0) {
      await db
        .update(tables)
        .set({ status: 'linked' })
        .where(inArray(tables.id, linkedTableIds));
    }

    // If opened from a reservation, mark it arrived
    if (reservationId) {
      await db
        .update(reservations)
        .set({ status: 'arrived' })
        .where(eq(reservations.id, reservationId));
    }

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
        tableQrToken: primaryTableRow.qrToken,
        tableLabel: primaryTableRow.label,
        startedAt: startedAt.toLocaleString('th-TH', thLocale),
      },
    };
  } catch (e) {
    console.error('[openSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── closeSession ───────────────────────────────────────────────────── */

export async function closeSession(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [session] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบข้อมูล session' };

    // Resolve primary session id
    const primaryId = session.parentSessionId ?? input.sessionId;

    // Find all sessions in the group (primary + children)
    const linkedSessions = await db
      .select({ id: sessions.id, tableId: sessions.tableId })
      .from(sessions)
      .where(eq(sessions.parentSessionId, primaryId));

    const allSessionIds = [primaryId, ...linkedSessions.map((s) => s.id)];

    // Find the primary session's table
    const [primarySession] = await db
      .select({ tableId: sessions.tableId })
      .from(sessions)
      .where(eq(sessions.id, primaryId))
      .limit(1);

    const allTableIds = [
      ...(primarySession ? [primarySession.tableId] : []),
      ...linkedSessions.map((s) => s.tableId),
    ];

    await db
      .update(sessions)
      .set({ status: 'closed', closedAt: new Date() })
      .where(inArray(sessions.id, allSessionIds));

    await db
      .update(tables)
      .set({ status: 'available' })
      .where(inArray(tables.id, allTableIds));

    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[closeSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── requestBillFromTable ───────────────────────────────────────────── */

export async function requestBillFromTable(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    // Mark primary session (and its children) as closing
    const [session] = await db
      .select({ parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    const primaryId = session.parentSessionId ?? input.sessionId;

    const linked = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.parentSessionId, primaryId));

    const allIds = [primaryId, ...linked.map((s) => s.id)];

    await db
      .update(sessions)
      .set({ status: 'closing' })
      .where(inArray(sessions.id, allIds));

    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[requestBillFromTable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── setTableAvailable ──────────────────────────────────────────────── */

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

/* ─── updateSessionGuests ────────────────────────────────────────────── */

const updateGuestsSchema = z.object({
  sessionId: z.string().uuid(),
  guests: z
    .array(guestRowSchema)
    .refine((arr) => arr.some((g) => g.quantity > 0), {
      message: 'ต้องมีผู้เข้าใช้บริการอย่างน้อย 1 คน',
    }),
});

export async function updateSessionGuests(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateGuestsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, guests } = parsed.data;
  const nonZero = guests.filter((g) => g.quantity > 0);

  try {
    await db.delete(sessionGuests).where(eq(sessionGuests.sessionId, sessionId));
    if (nonZero.length > 0) {
      await db.insert(sessionGuests).values(
        nonZero.map((g) => ({
          sessionId,
          pricingTileId: g.pricingTileId,
          quantity: g.quantity,
        })),
      );
    }
    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateSessionGuests]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── moveSession ────────────────────────────────────────────────────── */

export async function moveSession(input: { sessionId: string; newTableId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [session] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    // Only primary sessions can be moved
    if (session.parentSessionId)
      return { ok: false as const, error: 'สามารถย้ายได้เฉพาะโต๊ะหลักเท่านั้น' };

    const [newTable] = await db
      .select({ status: tables.status, label: tables.label })
      .from(tables)
      .where(eq(tables.id, input.newTableId))
      .limit(1);
    if (!newTable) return { ok: false as const, error: 'ไม่พบโต๊ะ' };
    if (newTable.status !== 'available')
      return { ok: false as const, error: `โต๊ะ ${newTable.label} ไม่ว่างในขณะนี้` };

    const oldTableId = session.tableId;

    // Move session to new table
    await db
      .update(sessions)
      .set({ tableId: input.newTableId })
      .where(eq(sessions.id, input.sessionId));

    // Update table statuses
    await db.update(tables).set({ status: 'available' }).where(eq(tables.id, oldTableId));
    await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, input.newTableId));

    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[moveSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
