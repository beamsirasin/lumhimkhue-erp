'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';
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
        inArray(sessions.status, ['active', 'closing']),
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

