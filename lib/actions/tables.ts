'use server';

import { revalidatePath } from 'next/cache';
import { eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { tables, pricingTiers } from '@/lib/db/schema';

/* ─── Queries ─────────────────────────────────────────────────────────────── */

export async function getTablesWithSessions() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const rows = await db.query.tables.findMany({
    where: isNull(tables.deletedAt),
    orderBy: (t, { asc }) => [asc(t.label)],
    with: {
      sessions: {
        where: (s, { inArray }) => inArray(s.status, ['active', 'closing']),
        limit: 1,
        orderBy: (s, { desc }) => [desc(s.startedAt)],
        with: {
          guests: {
            with: { pricingTier: true },
          },
        },
      },
    },
  });

  return {
    ok: true as const,
    data: rows.map((row) => {
      const s = row.sessions[0];
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
        activeSession: s
          ? {
              id: s.id,
              status: s.status,
              startedAt: s.startedAt,
              sessionToken: s.sessionToken,
              notes: s.notes,
              guests: s.guests.map((g) => ({
                id: g.id,
                quantity: g.quantity,
                pricingTier: {
                  id: g.pricingTier.id,
                  code: g.pricingTier.code,
                  name: g.pricingTier.name,
                  price: g.pricingTier.price,
                },
              })),
              /** Total guest count across all tiers */
              totalGuests: s.guests.reduce((sum, g) => sum + g.quantity, 0),
              /** Base amount (sum of price × quantity) */
              baseAmount: s.guests.reduce(
                (sum, g) => sum + Number(g.pricingTier.price) * g.quantity,
                0,
              ),
            }
          : null,
      };
    }),
  };
}

export type TableData = NonNullable<
  Extract<Awaited<ReturnType<typeof getTablesWithSessions>>, { ok: true }>['data']
>[number];

export async function getActivePricingTiers() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const data = await db
    .select()
    .from(pricingTiers)
    .where(eq(pricingTiers.isActive, true))
    .orderBy(pricingTiers.sortOrder);

  return { ok: true as const, data };
}

export type PricingTierData = NonNullable<
  Extract<Awaited<ReturnType<typeof getActivePricingTiers>>, { ok: true }>['data']
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

    revalidatePath('/tables');
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

    revalidatePath('/tables');
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

    revalidatePath('/tables');
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

    revalidatePath('/tables');
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
    revalidatePath('/tables');
    return { ok: true as const };
  } catch (e) {
    console.error('[setTableReserved]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
