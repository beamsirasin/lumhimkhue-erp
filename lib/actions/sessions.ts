'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, or, and, ne, sql, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, sessionGuests, pricingTiles, buffetChargeLines, paymentAllocations } from '@/lib/db/schema';
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

  const { tableId, linkedTableIds, guests, notes, customerId } = parsed.data;
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
        ? db.select({ id: pricingTiles.id, code: pricingTiles.code, name: pricingTiles.name, price: pricingTiles.price })
            .from(pricingTiles).where(eq(pricingTiles.isActive, true))
        : Promise.resolve([] as { id: string; code: string; name: string; price: string }[]),
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
    const tileMap = new Map(activeTiles.map((t) => [t.id, t]));
    for (const g of nonZeroGuests) {
      if (!activeTileIds.has(g.pricingTileId))
        return { ok: false as const, error: 'ไม่พบประเภทราคา' };
    }

    const startedAt = new Date();
    const sessionToken = nanoid(12);
    let newSession: { id: string; sessionToken: string } | null = null;
    let linkedSessionRows: Array<{
      tableId: string;
      startedAt: Date;
      sessionToken: string;
      status: 'active';
      parentSessionId: string;
    }> = [];

    const cleanupCreatedSession = async () => {
      if (!newSession) return;
      try {
        await db.delete(buffetChargeLines).where(eq(buffetChargeLines.sessionId, newSession.id));
        await db.delete(sessionGuests).where(eq(sessionGuests.sessionId, newSession.id));
        await db.delete(sessions).where(eq(sessions.parentSessionId, newSession.id));
        await db.delete(sessions).where(eq(sessions.id, newSession.id));
        for (const tableRow of tableRows) {
          await db.update(tables).set({ status: tableRow.status }).where(eq(tables.id, tableRow.id));
        }
      } catch (cleanupError) {
        console.error('[openSession] Cleanup error', cleanupError);
      }
    };

    try {
      const [createdSession] = await db
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
      newSession = createdSession;

      // Pre-generate linked session rows (tokens captured for return value)
      linkedSessionRows = linkedTableIds.map((ltId) => ({
        tableId: ltId,
        startedAt,
        sessionToken: nanoid(12),
        status: 'active' as const,
        parentSessionId: createdSession.id,
      }));

      if (linkedSessionRows.length > 0) {
        await db.insert(sessions).values(linkedSessionRows);
      }

      // Insert session guests on primary session (skip if none - Drizzle errors on empty values)
      if (nonZeroGuests.length > 0) {
        await db.insert(sessionGuests).values(
          nonZeroGuests.map((g) => ({
            sessionId: createdSession.id,
            pricingTileId: g.pricingTileId,
            quantity: g.quantity,
            unitPrice: tileMap.get(g.pricingTileId)?.price ?? '0',
          })),
        );

        // Create buffet charge lines with snapshotted price.
        await db.insert(buffetChargeLines).values(
          nonZeroGuests.map((g) => {
            const tile = tileMap.get(g.pricingTileId)!;
            const unitPrice = Number(tile.price);
            return {
              sessionId: createdSession.id,
              pricingTileId: g.pricingTileId,
              chargeType: tile.code || tile.name || 'guest',
              label: tile.name,
              unitPrice: unitPrice.toFixed(2),
              quantity: g.quantity,
              total: (unitPrice * g.quantity).toFixed(2),
            };
          }),
        );

        const [guestCheck] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(sessionGuests)
          .where(eq(sessionGuests.sessionId, createdSession.id));
        const [chargeLineCheck] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(buffetChargeLines)
          .where(eq(buffetChargeLines.sessionId, createdSession.id));
        if (Number(guestCheck?.count ?? 0) < nonZeroGuests.length || Number(chargeLineCheck?.count ?? 0) < nonZeroGuests.length) {
          throw new Error('openSession verification failed: missing guest or charge-line rows');
        }
      }

      await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId));
      if (linkedTableIds.length > 0) {
        await db.update(tables).set({ status: 'linked' }).where(inArray(tables.id, linkedTableIds));
      }
    } catch (writeError) {
      console.error('[openSession] Error', writeError);
      await cleanupCreatedSession();
      return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
    }

    if (!newSession) {
      console.error('[openSession] Error', new Error('session was not created'));
      return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
    }
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
    if (nonZeroGuests.length > 0) {
      writeAuditLog({
        userId: authSession.user.id,
        role: authSession.user.role,
        action: 'headcount_created',
        entity: 'session_guests',
        entityId: newSession.id,
        after: {
          guests: nonZeroGuests.map((g) => ({
            pricingTileId: g.pricingTileId,
            label: tileMap.get(g.pricingTileId)?.name,
            quantity: g.quantity,
            unitPrice: tileMap.get(g.pricingTileId)?.price,
          })),
        },
      });
    }
    return {
      ok: true as const,
      data: {
        sessionId: newSession.id,
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
  guests: z.array(guestRowSchema),
  // Addon-type tiles — persisted to buffet_charge_lines only (not session_guests),
  // so processPayment can still add them via lineItems without double-counting.
  addonItems: z.array(guestRowSchema).optional().default([]),
});

export async function updateSessionGuests(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateGuestsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, guests, addonItems } = parsed.data;
  const nonZeroGuests = guests.filter((g) => g.quantity > 0);
  const nonZeroAddons = addonItems.filter((a) => a.quantity > 0);
  // All items that should have active charge lines after this save
  const allNonZeroItems = [...nonZeroGuests, ...nonZeroAddons];

  try {
    // Fetch tile data, current active charge lines, and allocation sums in parallel
    const allTileIds = allNonZeroItems.map((g) => g.pricingTileId);
    const [currentChargeLines, allocationRows, tileRows, oldGuests] = await Promise.all([
      db.select().from(buffetChargeLines).where(
        and(eq(buffetChargeLines.sessionId, sessionId), isNull(buffetChargeLines.voidedAt)),
      ),
      db.select({
        chargeLineId: paymentAllocations.chargeLineId,
        allocatedQty: sql<number>`sum(${paymentAllocations.quantity})::int`,
      }).from(paymentAllocations)
        .where(eq(paymentAllocations.sessionId, sessionId))
        .groupBy(paymentAllocations.chargeLineId),
      allTileIds.length > 0
        ? db.select({ id: pricingTiles.id, code: pricingTiles.code, name: pricingTiles.name, price: pricingTiles.price })
            .from(pricingTiles).where(inArray(pricingTiles.id, allTileIds))
        : Promise.resolve([] as { id: string; code: string; name: string; price: string }[]),
      db.select().from(sessionGuests).where(eq(sessionGuests.sessionId, sessionId)),
    ]);

    const tileMap = new Map(tileRows.map((t) => [t.id, t]));
    const allocMap = new Map(allocationRows.map((r) => [r.chargeLineId, r.allocatedQty]));
    const newTileIds = new Set(allNonZeroItems.map((g) => g.pricingTileId));

    // Allocation guard: block reducing any charge line below its already-allocated quantity
    for (const line of currentChargeLines) {
      const allocatedQty = allocMap.get(line.id) ?? 0;
      if (allocatedQty === 0) continue;
      const newItem = allNonZeroItems.find((g) => g.pricingTileId === line.pricingTileId);
      const newQty = newItem?.quantity ?? 0;
      if (newQty < allocatedQty) {
        return {
          ok: false as const,
          error: `ไม่สามารถลดจำนวนต่ำกว่าจำนวนที่ชำระแล้ว (${line.label}: ชำระแล้ว ${allocatedQty} หน่วย)`,
        };
      }
    }

    // Replace session_guests with GUEST tiles only (addon tiles must NOT go here —
    // processPayment adds addon amounts via lineItems to avoid double-counting)
    await db.delete(sessionGuests).where(eq(sessionGuests.sessionId, sessionId));
    if (nonZeroGuests.length > 0) {
      await db.insert(sessionGuests).values(
        nonZeroGuests.map((g) => {
          const tile = tileMap.get(g.pricingTileId);
          // Reuse snapshotted unitPrice from existing charge line if available; else use live price
          const existingLine = currentChargeLines.find((l) => l.pricingTileId === g.pricingTileId);
          const unitPrice = existingLine ? existingLine.unitPrice : (tile?.price ?? '0');
          return {
            sessionId,
            pricingTileId: g.pricingTileId,
            quantity: g.quantity,
            unitPrice,
          };
        }),
      );
    }

    // Sync buffet_charge_lines for ALL items (guests + addons)
    const chargeLineByTileId = new Map(
      currentChargeLines.map((l) => [l.pricingTileId, l]),
    );

    // Void removed lines (only safe because allocation guard above already blocked any with allocations)
    const linesToVoid = currentChargeLines.filter((l) => !newTileIds.has(l.pricingTileId ?? ''));
    if (linesToVoid.length > 0) {
      await db.update(buffetChargeLines)
        .set({ voidedAt: new Date() })
        .where(inArray(buffetChargeLines.id, linesToVoid.map((l) => l.id)));
    }

    // Update existing lines or create new ones for all items
    for (const item of allNonZeroItems) {
      const tile = tileMap.get(item.pricingTileId);
      const existingLine = chargeLineByTileId.get(item.pricingTileId);

      if (existingLine) {
        // Keep existing unitPrice snapshot; only update quantity + total
        await db.update(buffetChargeLines)
          .set({
            quantity: item.quantity,
            total: (Number(existingLine.unitPrice) * item.quantity).toFixed(2),
          })
          .where(eq(buffetChargeLines.id, existingLine.id));
      } else if (tile) {
        // New tile not seen before: create charge line with current tile price
        const unitPrice = Number(tile.price);
        await db.insert(buffetChargeLines).values({
          sessionId,
          pricingTileId: item.pricingTileId,
          chargeType: tile.code || tile.name || 'item',
          label: tile.name,
          unitPrice: unitPrice.toFixed(2),
          quantity: item.quantity,
          total: (unitPrice * item.quantity).toFixed(2),
        });
      }
    }

    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'headcount_changed',
      entity: 'session_guests',
      entityId: sessionId,
      before: { guests: oldGuests.map((g) => ({ pricingTileId: g.pricingTileId, quantity: g.quantity })) },
      after: {
        guests: nonZeroGuests.map((g) => ({ pricingTileId: g.pricingTileId, quantity: g.quantity })),
        addons: nonZeroAddons.map((a) => ({ pricingTileId: a.pricingTileId, quantity: a.quantity })),
      },
    });

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
      // Find all ACTIVE children only — closed children must not be elected as new primary
      const children = await db
        .select({ id: sessions.id, tableId: sessions.tableId })
        .from(sessions)
        .where(and(
          eq(sessions.parentSessionId, input.sessionId),
          inArray(sessions.status, ['active', 'closing']),
        ));

      if (children.length > 0) {
        // Elect first child as new primary
        const newPrimary = children[0];
        const rest = children.slice(1);

        // Transfer guests and buffet charge lines to new primary
        await db
          .update(sessionGuests)
          .set({ sessionId: newPrimary.id })
          .where(eq(sessionGuests.sessionId, input.sessionId));
        await db
          .update(buffetChargeLines)
          .set({ sessionId: newPrimary.id })
          .where(eq(buffetChargeLines.sessionId, input.sessionId));

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
      // Count only ACTIVE siblings — closed siblings must not block the 'linked' indicator
      const remainingChildren = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(
          eq(sessions.parentSessionId, sess.parentSessionId),
          ne(sessions.id, input.sessionId),
          inArray(sessions.status, ['active', 'closing']),
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

    // 1. Transfer session_guests and buffet charge lines from old primary to new primary
    await db
      .update(sessionGuests)
      .set({ sessionId: input.newPrimarySessionId })
      .where(eq(sessionGuests.sessionId, oldPrimaryId));
    await db
      .update(buffetChargeLines)
      .set({ sessionId: input.newPrimarySessionId })
      .where(eq(buffetChargeLines.sessionId, oldPrimaryId));

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
