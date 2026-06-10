'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, or, and, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, sessionGuests, pricingTiles, reservations } from '@/lib/db/schema';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/actions/audit';

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
  /** Link a CRM customer to this session for loyalty tracking */
  customerId: z.string().uuid().optional().nullable(),
});

export async function openSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = openSessionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  const { tableId, linkedTableIds, guests, notes, reservationId, customerId } = parsed.data;
  const allTableIds = [tableId, ...linkedTableIds];

  // Filter out zero-quantity tiles
  const nonZeroGuests = guests.filter((g) => g.quantity > 0);

  try {
    // Verify tables + pricing tiles in parallel
    const [tableRows, activeTiles] = await Promise.all([
      db
        .select({ id: tables.id, status: tables.status, label: tables.label, qrToken: tables.qrToken })
        .from(tables)
        .where(inArray(tables.id, allTableIds)),
      nonZeroGuests.length > 0
        ? db.select({ id: pricingTiles.id }).from(pricingTiles).where(eq(pricingTiles.isActive, true))
        : Promise.resolve([] as { id: string }[]),
    ]);

    for (const t of tableRows) {
      if (t.id === tableId && t.status !== 'available' && t.status !== 'reserved')
        return { ok: false as const, error: `โต๊ะ ${t.label} ไม่พร้อมใช้งานในขณะนี้` };
      if (t.id !== tableId && t.status !== 'available' && t.status !== 'reserved')
        return { ok: false as const, error: `โต๊ะเชื่อมโยง ${t.label} ไม่ว่างในขณะนี้` };
    }

    const primaryTableRow = tableRows.find((t) => t.id === tableId);
    if (!primaryTableRow) return { ok: false as const, error: 'ไม่พบโต๊ะ' };

    const activeTileIds = new Set(activeTiles.map((t) => t.id));
    for (const g of nonZeroGuests) {
      if (!activeTileIds.has(g.pricingTileId))
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
        customerId: customerId ?? null,
      })
      .returning({ id: sessions.id, sessionToken: sessions.sessionToken });

    // Insert session guests on primary session (skip if none — Drizzle errors on empty values)
    if (nonZeroGuests.length > 0) {
      await db.insert(sessionGuests).values(
        nonZeroGuests.map((g) => ({
          sessionId: newSession.id,
          pricingTileId: g.pricingTileId,
          quantity: g.quantity,
        })),
      );
    }

    // Pre-generate linked session rows (tokens captured for return value)
    const linkedSessionRows = linkedTableIds.map((ltId) => ({
      tableId: ltId,
      startedAt,
      sessionToken: nanoid(12),
      status: 'active' as const,
      parentSessionId: newSession.id,
    }));

    if (linkedSessionRows.length > 0) {
      await db.insert(sessions).values(linkedSessionRows);
    }

    // Update table statuses (and optional reservation) in parallel
    await Promise.all([
      db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId)),
      linkedTableIds.length > 0
        ? db.update(tables).set({ status: 'linked' }).where(inArray(tables.id, linkedTableIds))
        : Promise.resolve(),
      reservationId
        ? db.update(reservations).set({ status: 'arrived' }).where(eq(reservations.id, reservationId))
        : Promise.resolve(),
    ]);

    const thLocale: Intl.DateTimeFormatOptions = {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    };

    // Build linked table QR data for the success dialog
    const linkedTables = linkedSessionRows.map((ls) => {
      const tableRow = tableRows.find((t) => t.id === ls.tableId);
      return {
        tableQrToken: tableRow?.qrToken ?? '',
        tableLabel: tableRow?.label ?? '',
        sessionToken: ls.sessionToken,
      };
    });

    revalidatePath('/tables');
    revalidatePath('/pos');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'create',
      entity: 'sessions',
      entityId: newSession.id,
      after: { tableId, linkedTableIds, sessionToken: newSession.sessionToken },
    });
    return {
      ok: true as const,
      data: {
        sessionToken: newSession.sessionToken,
        tableQrToken: primaryTableRow.qrToken,
        tableLabel: primaryTableRow.label,
        startedAt: startedAt.toLocaleString('th-TH', thLocale),
        linkedTables,
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

    const primaryId = session.parentSessionId ?? input.sessionId;

    // Single query fetches primary + all children (replaces 2 separate round trips)
    const groupSessions = await db
      .select({ id: sessions.id, tableId: sessions.tableId })
      .from(sessions)
      .where(or(eq(sessions.id, primaryId), eq(sessions.parentSessionId, primaryId)));

    const allSessionIds = groupSessions.map((s) => s.id);
    const allTableIds = groupSessions.map((s) => s.tableId);

    // Parallel: update sessions and tables simultaneously
    await Promise.all([
      db.update(sessions).set({ status: 'closed', closedAt: new Date() }).where(inArray(sessions.id, allSessionIds)),
      db.update(tables).set({ status: 'available' }).where(inArray(tables.id, allTableIds)),
    ]);

    revalidatePath('/tables');
    revalidatePath('/pos');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'close',
      entity: 'sessions',
      entityId: input.sessionId,
    });
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
    revalidatePath('/pos');
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
    revalidatePath('/pos');
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
    revalidatePath('/pos');
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

    const [newTable] = await db
      .select({ status: tables.status, label: tables.label })
      .from(tables)
      .where(eq(tables.id, input.newTableId))
      .limit(1);
    if (!newTable) return { ok: false as const, error: 'ไม่พบโต๊ะ' };
    if (newTable.status !== 'available')
      return { ok: false as const, error: `โต๊ะ ${newTable.label} ไม่ว่างในขณะนี้` };

    const oldTableId = session.tableId;
    // Secondary sessions keep 'linked' status on their new table
    const newTableStatus = session.parentSessionId ? 'linked' : 'occupied';

    // Move session to new table
    await db
      .update(sessions)
      .set({ tableId: input.newTableId })
      .where(eq(sessions.id, input.sessionId));

    // Parallel: update both table statuses simultaneously
    await Promise.all([
      db.update(tables).set({ status: 'available' }).where(eq(tables.id, oldTableId)),
      db.update(tables).set({ status: newTableStatus }).where(eq(tables.id, input.newTableId)),
    ]);

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[moveSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── closeSingleSession ─────────────────────────────────────────────── */
// Close only this one table/session and detach it from the linked group.
// If it's the primary, elect the first remaining secondary as the new primary.

export async function closeSingleSession(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [sess] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!sess) return { ok: false as const, error: 'ไม่พบ session' };

    const isPrimary = !sess.parentSessionId;

    if (isPrimary) {
      // Find all children
      const children = await db
        .select({ id: sessions.id, tableId: sessions.tableId })
        .from(sessions)
        .where(eq(sessions.parentSessionId, input.sessionId));

      if (children.length > 0) {
        // Elect first child as new primary
        const newPrimary = children[0];
        const rest = children.slice(1);

        // Transfer guests to new primary
        await db
          .update(sessionGuests)
          .set({ sessionId: newPrimary.id })
          .where(eq(sessionGuests.sessionId, input.sessionId));

        // New primary: clear parentSessionId
        await db
          .update(sessions)
          .set({ parentSessionId: null })
          .where(eq(sessions.id, newPrimary.id));

        // Remaining children: point to new primary
        if (rest.length > 0) {
          await db
            .update(sessions)
            .set({ parentSessionId: newPrimary.id })
            .where(inArray(sessions.id, rest.map((r) => r.id)));
        }

        // If new primary has no remaining siblings, keep 'linked' status so
        // the table still shows the grouped visual indicator on the floor map.
        const newStatus = rest.length === 0 ? 'linked' : 'occupied';
        await db.update(tables).set({ status: newStatus }).where(eq(tables.id, newPrimary.tableId));
      }
    }

    if (!isPrimary && sess.parentSessionId) {
      // Secondary being closed — check if primary now has no remaining children.
      // If so, mark the primary table as 'linked' to keep the visual grouping indicator.
      const remainingChildren = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(
          eq(sessions.parentSessionId, sess.parentSessionId),
          ne(sessions.id, input.sessionId),
        ));
      if (remainingChildren.length === 0) {
        const [primarySess] = await db
          .select({ tableId: sessions.tableId })
          .from(sessions)
          .where(eq(sessions.id, sess.parentSessionId))
          .limit(1);
        if (primarySess) {
          await db.update(tables).set({ status: 'linked' }).where(eq(tables.id, primarySess.tableId));
        }
      }
    }

    // Close this session and free its table
    await db
      .update(sessions)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(sessions.id, input.sessionId));
    await db
      .update(tables)
      .set({ status: 'available' })
      .where(eq(tables.id, sess.tableId));

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[closeSingleSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── transferPrimary ────────────────────────────────────────────────── */
// Make a secondary session the new primary of the linked group.
// Transfers guest (billing) data to the new primary's session.

export async function transferPrimary(input: { newPrimarySessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [newPrimSess] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.newPrimarySessionId))
      .limit(1);
    if (!newPrimSess) return { ok: false as const, error: 'ไม่พบ session' };
    if (!newPrimSess.parentSessionId) return { ok: false as const, error: 'โต๊ะนี้เป็นโต๊ะหลักอยู่แล้ว' };

    const oldPrimaryId = newPrimSess.parentSessionId;

    const [oldPrimSess] = await db
      .select({ tableId: sessions.tableId })
      .from(sessions)
      .where(eq(sessions.id, oldPrimaryId))
      .limit(1);
    if (!oldPrimSess) return { ok: false as const, error: 'ไม่พบ session หลัก' };

    // All other children (excluding the new primary)
    const otherChildren = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.parentSessionId, oldPrimaryId));

    // 1. Transfer session_guests from old primary to new primary
    await db
      .update(sessionGuests)
      .set({ sessionId: input.newPrimarySessionId })
      .where(eq(sessionGuests.sessionId, oldPrimaryId));

    // 2. New primary: clear parentSessionId
    await db
      .update(sessions)
      .set({ parentSessionId: null })
      .where(eq(sessions.id, input.newPrimarySessionId));

    // 3. Old primary becomes secondary → points to new primary
    await db
      .update(sessions)
      .set({ parentSessionId: input.newPrimarySessionId })
      .where(eq(sessions.id, oldPrimaryId));

    // 4. Remaining children → point to new primary
    const remainingIds = otherChildren
      .map((c) => c.id)
      .filter((id) => id !== input.newPrimarySessionId);
    if (remainingIds.length > 0) {
      await db
        .update(sessions)
        .set({ parentSessionId: input.newPrimarySessionId })
        .where(inArray(sessions.id, remainingIds));
    }

    // 5. Parallel: update both table statuses simultaneously
    await Promise.all([
      db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, newPrimSess.tableId)),
      db.update(tables).set({ status: 'linked' }).where(eq(tables.id, oldPrimSess.tableId)),
    ]);

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[transferPrimary]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── createContinuationSession ─────────────────────────────────────────
   Used after partial split payment to create a new "remaining" session
   linked to the original via parentSessionId.  The new session is in
   'closing' status (ready for immediate payment) and the table is reset
   to 'occupied' since some guests are still seated.
────────────────────────────────────────────────────────────────────── */

const continuationSchema = z.object({
  originalSessionId: z.string().uuid(),
  guests: z.array(guestRowSchema).min(1),
});

export async function createContinuationSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = continuationSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { originalSessionId, guests } = parsed.data;

  try {
    const original = await db.query.sessions.findFirst({
      where: eq(sessions.id, originalSessionId),
    });
    if (!original) return { ok: false as const, error: 'ไม่พบ session ต้นฉบับ' };

    // Always link to the root session (so all continuations share one parent)
    const rootParentId = original.parentSessionId ?? originalSessionId;

    const [newSession] = await db
      .insert(sessions)
      .values({
        tableId:         original.tableId,
        startedAt:       new Date(),
        sessionToken:    nanoid(12),
        status:          'closing',
        notes:           '[แบ่งชำระ]',
        parentSessionId: rootParentId,
      })
      .returning({ id: sessions.id });

    await db.insert(sessionGuests).values(
      guests.map((g) => ({
        sessionId:      newSession.id,
        pricingTileId:  g.pricingTileId,
        quantity:       g.quantity,
      })),
    );

    // Table is still occupied (remaining guests are seated)
    await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, original.tableId));

    revalidatePath('/pos');
    revalidatePath('/tables');
    return { ok: true as const, data: { sessionId: newSession.id } };
  } catch (e) {
    console.error('[createContinuationSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
