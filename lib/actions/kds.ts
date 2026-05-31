'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray, asc, gte, not, sql } from 'drizzle-orm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { orderItems, orders, sessions, tables, menuItems } from '@/lib/db/schema';

const _fetchKdsItems = async () =>
  db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      notes: orderItems.notes,
      station: orderItems.station,
      status: orderItems.status,
      orderedAt: orders.createdAt,
      menuItemName: sql<string>`coalesce(${menuItems.name}, ${orderItems.itemName}, '(เน€เธกเธเธนเธ—เธตเนเธ–เธนเธเธฅเธ)')`,
      imageUrl: menuItems.imageUrl,
      tableNumber: tables.label,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(sessions, eq(orders.sessionId, sessions.id))
    .innerJoin(tables, eq(sessions.tableId, tables.id))
    .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(
      and(
        inArray(orderItems.status, ['pending', 'preparing', 'ready']),
        inArray(sessions.status, ['active', 'closing', 'paid']),
      ),
    )
    .orderBy(asc(orders.createdAt), asc(sql`coalesce(${menuItems.sortOrder}, 0)`), asc(orderItems.id));

export async function getKdsItems() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ' };
  if (!can(authSession.user.role, 'view_kds'))
    return { ok: false as const, error: 'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธ”เธณเน€เธเธดเธเธเธฒเธฃ' };

  try {
    const data = await _fetchKdsItems();
    return { ok: true as const, data };
  } catch (e) {
    console.error('[getKdsItems]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

export type KdsItem = NonNullable<
  Extract<Awaited<ReturnType<typeof getKdsItems>>, { ok: true }>['data']
>[number];

const serveGroupSchema = z.object({ itemIds: z.array(z.string().uuid()).min(1) });

export async function serveGroup(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ' };
  if (!can(authSession.user.role, 'view_kds'))
    return { ok: false as const, error: 'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธ”เธณเน€เธเธดเธเธเธฒเธฃ' };

  const parsed = serveGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'เธเนเธญเธกเธนเธฅเนเธกเนเธ–เธนเธเธ•เนเธญเธ' };

  try {
    const now = new Date();
    await db
      .update(orderItems)
      .set({ status: 'served', servedAt: now })
      .where(inArray(orderItems.id, parsed.data.itemIds));
    revalidatePath('/kds', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error('[serveGroup]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

const cancelGroupSchema = z.object({ itemIds: z.array(z.string().uuid()).min(1) });

export async function cancelGroup(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_kds'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = cancelGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db
      .update(orderItems)
      .set({ status: 'cancelled' })
      .where(inArray(orderItems.id, parsed.data.itemIds));
    revalidatePath('/kds', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error('[cancelGroup]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// kept for backward compat (used nowhere new)
const updateItemStatusSchema = z.object({
  itemId: z.string().uuid(),
  status: z.enum(['preparing', 'ready', 'served', 'cancelled']),
});

export async function updateItemStatus(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ' };
  if (!can(authSession.user.role, 'view_kds'))
    return { ok: false as const, error: 'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธ”เธณเน€เธเธดเธเธเธฒเธฃ' };

  const parsed = updateItemStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'เธเนเธญเธกเธนเธฅเนเธกเนเธ–เธนเธเธ•เนเธญเธ' };

  const { itemId, status } = parsed.data;
  const now = new Date();

  try {
    await db
      .update(orderItems)
      .set({
        status,
        ...(status === 'ready' ? { preparedAt: now } : {}),
        ...(status === 'served' ? { servedAt: now } : {}),
      })
      .where(eq(orderItems.id, itemId));
    revalidatePath('/kds', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateItemStatus]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}


/* ─── Kitchen History ────────────────────────────────────────────────────── */

const TZ = 'Asia/Bangkok';

function dayRange(dateStr: string) {
  const from = fromZonedTime(startOfDay(toZonedTime(new Date(dateStr), TZ)), TZ);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

const STATION_SORT: Record<string, number> = {
  meat: 0, seafood: 1, vegetable: 2, noodle: 3, drink: 4, dessert: 5, sauce: 6,
};

export async function getKdsHistory(dateStr: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_kds'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const { from, to } = dayRange(dateStr);

    // Group by station + menuItemId + itemName (all real columns — no sql expressions)
    // so PostgreSQL can always resolve GROUP BY without ambiguity.
    const rows = await db
      .select({
        station:       orderItems.station,
        menuItemId:    orderItems.menuItemId,
        rawItemName:   orderItems.itemName,
        menuItemName:  menuItems.name,
        totalQty:      sql<number>`sum(${orderItems.quantity})`,
        servedQty:     sql<number>`sum(case when ${orderItems.status} = 'served'    then ${orderItems.quantity} else 0 end)`,
        cancelledQty:  sql<number>`sum(case when ${orderItems.status} = 'cancelled' then ${orderItems.quantity} else 0 end)`,
        pendingQty:    sql<number>`sum(case when ${orderItems.status} in ('pending','preparing','ready') then ${orderItems.quantity} else 0 end)`,
      })
      .from(orderItems)
      .innerJoin(orders,   eq(orderItems.orderId,    orders.id))
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(and(
        gte(orders.createdAt, from),
        not(gte(orders.createdAt, to)),
      ))
      .groupBy(
        orderItems.station,
        orderItems.menuItemId,
        orderItems.itemName,
        menuItems.name,
      );

    // Sort in JS: by station order, then item name
    const data = rows
      .map((r) => ({
        station:      r.station,
        itemName:     r.menuItemName ?? r.rawItemName ?? '(เมนูถูกลบ)',
        totalQty:     Number(r.totalQty),
        servedQty:    Number(r.servedQty),
        cancelledQty: Number(r.cancelledQty),
        pendingQty:   Number(r.pendingQty),
      }))
      .sort((a, b) => {
        const sd = (STATION_SORT[a.station] ?? 9) - (STATION_SORT[b.station] ?? 9);
        return sd !== 0 ? sd : a.itemName.localeCompare(b.itemName, 'th');
      });

    return { ok: true as const, data };
  } catch (e) {
    console.error('[getKdsHistory]', e);
    return { ok: false as const, error: String(e) };
  }
}

export type KdsHistoryRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getKdsHistory>>, { ok: true }>['data']
>[number];
