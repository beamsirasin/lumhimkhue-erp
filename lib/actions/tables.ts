'use server';

import { updateTag, unstable_cache } from 'next/cache';
import { eq, isNull, inArray, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { tables, pricingTiles, sessions, sessionGuests, reservations } from '@/lib/db/schema';

/* ─── Queries ─────────────────────────────────────────────────────────────── */

// Raw DB fetch — 2 parallel rounds instead of 5 sequential Drizzle sub-queries.
// Cached by tag 'tables'; invalidated by revalidateTag('tables') on any mutation.
const _fetchTablesWithSessions = async () => {
  // Round 1 (parallel): tables + active sessions + pending reservations
  const [tableRows, sessionRows, reservationRows] = await Promise.all([
    db.select().from(tables).where(isNull(tables.deletedAt)).orderBy(asc(tables.label)),
    db.select().from(sessions).where(inArray(sessions.status, ['active', 'closing'])),
    db.select().from(reservations).where(eq(reservations.status, 'pending')),
  ]);

  // Round 2 (parallel): session guests + pricing tile names/prices
  const activeSessionIds = sessionRows.map((s) => s.id);
  type TileRow = { id: string; code: string; name: string; price: string };
  let guestRows: (typeof sessionGuests.$inferSelect)[] = [];
  let tileRows: TileRow[] = [];

  if (activeSessionIds.length > 0) {
    [guestRows, tileRows] = await Promise.all([
      db.select().from(sessionGuests).where(inArray(sessionGuests.sessionId, activeSessionIds)),
      db
        .select({
          id: pricingTiles.id,
          code: pricingTiles.code,
          name: pricingTiles.name,
          price: pricingTiles.price,
        })
        .from(pricingTiles)
        .where(eq(pricingTiles.isActive, true)),
    ]);
  }

  // Build lookup maps
  const tilesById = new Map(tileRows.map((t) => [t.id, t]));

  const guestsBySessionId = new Map<string, (typeof guestRows)[number][]>();
  for (const g of guestRows) {
    const arr = guestsBySessionId.get(g.sessionId) ?? [];
    arr.push(g);
    guestsBySessionId.set(g.sessionId, arr);
  }

  // Most-recent active/closing session per table
  const sessionByTableId = new Map<string, (typeof sessionRows)[number]>();
  for (const s of sessionRows) {
    const existing = sessionByTableId.get(s.tableId);
    if (!existing || s.startedAt > existing.startedAt) {
      sessionByTableId.set(s.tableId, s);
    }
  }

  // Earliest pending reservation per table
  const reservationByTableId = new Map<string, (typeof reservationRows)[number]>();
  for (const r of reservationRows) {
    const existing = reservationByTableId.get(r.tableId);
    if (!existing || r.reservedAt < existing.reservedAt) {
      reservationByTableId.set(r.tableId, r);
    }
  }

  return tableRows.map((row) => {
    const s = sessionByTableId.get(row.id);
    const r = reservationByTableId.get(row.id);

    let activeSession = null;
    if (s) {
      const rawGuests = guestsBySessionId.get(s.id) ?? [];
      const guests = rawGuests
        .map((g) => {
          const tile = tilesById.get(g.pricingTileId);
          if (!tile) return null;
          return {
            id: g.id,
            quantity: g.quantity,
            pricingTile: { id: tile.id, code: tile.code, name: tile.name, price: tile.price },
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      activeSession = {
        id: s.id,
        status: s.status,
        startedAt: s.startedAt,
        sessionToken: s.sessionToken,
        parentSessionId: s.parentSessionId,
        notes: s.notes,
        guests,
        totalGuests: guests.reduce((sum, g) => sum + g.quantity, 0),
        baseAmount: guests.reduce(
          (sum, g) => sum + Number(g.pricingTile.price) * g.quantity,
          0,
        ),
      };
    }

    return {
      id: row.id,
      label: row.label,
      capacity: row.capacity,
      zone: row.zone,
      status: row.status,
      qrToken: row.qrToken,
      positionX: row.positionX,
      positionY: row.positionY,
      width: row.width,
      height: row.height,
      shape: row.shape,
      activeSession,
      activeReservation: r
        ? {
            id: r.id,
            customerName: r.customerName,
            customerPhone: r.customerPhone,
            reservedAt: r.reservedAt,
            partySize: r.partySize,
            notes: r.notes,
            status: r.status,
          }
        : null,
    };
  });
};

const _cachedTablesQuery = unstable_cache(_fetchTablesWithSessions, ['tables-with-sessions'], {
  tags: ['tables'],
});

export async function getTablesWithSessions() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  try {
    const data = await _cachedTablesQuery();
    return { ok: true as const, data };
  } catch (e) {
    console.error('[getTablesWithSessions]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type TableData = NonNullable<
  Extract<Awaited<ReturnType<typeof getTablesWithSessions>>, { ok: true }>['data']
>[number];

export async function getActivePricingTiles(category?: 'guest' | 'addon' | 'discount') {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const rows = await db
    .select()
    .from(pricingTiles)
    .where(eq(pricingTiles.isActive, true))
    .orderBy(pricingTiles.sortOrder);

  const data = category ? rows.filter((r) => r.category === category) : rows;
  return { ok: true as const, data };
}

export type PricingTileData = NonNullable<
  Extract<Awaited<ReturnType<typeof getActivePricingTiles>>, { ok: true }>['data']
>[number];

/* ─── Floor Plan CRUD ─────────────────────────────────────────────────────── */

const createTableSchema = z.object({
  label: z.string().min(1).max(50),
  capacity: z.number().int().min(1).max(50).default(4),
  zone: z.string().min(1).max(100).default('ทั่วไป'),
  positionX: z.number().int().min(0).default(20),
  positionY: z.number().int().min(0).default(20),
  width: z.number().int().min(40).max(400).default(80),
  height: z.number().int().min(40).max(400).default(80),
  shape: z.enum(['square', 'rectangle']).default('square'),
});

export async function createTable(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = createTableSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    const [newTable] = await db
      .insert(tables)
      .values({
        ...parsed.data,
        qrToken: nanoid(16),
        status: 'available',
      })
      .returning({ id: tables.id });

    updateTag('tables');
    return { ok: true as const, data: { id: newTable.id } };
  } catch (e) {
    console.error('[createTable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

const updatePositionSchema = z.object({
  tableId: z.string().uuid(),
  positionX: z.number().int().min(0),
  positionY: z.number().int().min(0),
});

export async function updateTablePosition(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updatePositionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db
      .update(tables)
      .set({ positionX: parsed.data.positionX, positionY: parsed.data.positionY })
      .where(eq(tables.id, parsed.data.tableId));

    updateTag('tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateTablePosition]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

const updateTableMetaSchema = z.object({
  tableId: z.string().uuid(),
  label: z.string().min(1).max(50),
  capacity: z.number().int().min(1).max(50),
  zone: z.string().min(1).max(100),
  shape: z.enum(['square', 'rectangle']),
  width: z.number().int().min(40).max(400),
  height: z.number().int().min(40).max(400),
});

export async function updateTableMeta(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateTableMetaSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db
      .update(tables)
      .set({
        label: parsed.data.label,
        capacity: parsed.data.capacity,
        zone: parsed.data.zone,
        shape: parsed.data.shape,
        width: parsed.data.width,
        height: parsed.data.height,
      })
      .where(eq(tables.id, parsed.data.tableId));

    updateTag('tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateTableMeta]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function softDeleteTable(input: { tableId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [table] = await db
      .select({ status: tables.status })
      .from(tables)
      .where(eq(tables.id, input.tableId))
      .limit(1);

    if (!table) return { ok: false as const, error: 'ไม่พบโต๊ะ' };
    if (table.status !== 'available')
      return { ok: false as const, error: 'ไม่สามารถลบโต๊ะที่กำลังใช้งานอยู่ได้' };

    await db
      .update(tables)
      .set({ deletedAt: new Date() })
      .where(eq(tables.id, input.tableId));

    updateTag('tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[softDeleteTable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function setTableReserved(input: { tableId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db.update(tables).set({ status: 'reserved' }).where(eq(tables.id, input.tableId));
    updateTag('tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[setTableReserved]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
