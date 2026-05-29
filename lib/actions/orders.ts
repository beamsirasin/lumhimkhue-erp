'use server';

import { eq, and, gte, desc, asc, inArray, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { revalidateTag } from 'next/cache';
import { db } from '@/lib/db';
import {
  sessions,
  tables,
  categories,
  menuItems,
  orders,
  orderItems,
} from '@/lib/db/schema';
import { placeOrderSchema } from '@/lib/validations/orders';

export async function getSessionData(tableToken: string, sessionToken: string) {
  try {
    const [table] = await db
      .select()
      .from(tables)
      .where(eq(tables.qrToken, tableToken))
      .limit(1);
    if (!table) return { ok: false as const, error: 'เนเธกเนเธเธเนเธ•เนเธฐ' };

    const session = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.sessionToken, sessionToken),
        eq(sessions.tableId, table.id),
      ),
    });
    if (!session || session.status === 'closed')
      return { ok: false as const, error: 'session เนเธกเนเธ–เธนเธเธ•เนเธญเธเธซเธฃเธทเธญเธซเธกเธ”เธญเธฒเธขเธธเนเธฅเนเธง' };

    return { ok: true as const, data: { table, session } };
  } catch (e) {
    console.error('[getSessionData]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

export async function getMenuCategories() {
  try {
    const result = await db.query.categories.findMany({
      where: eq(categories.isActive, true),
      orderBy: [asc(categories.sortOrder)],
      with: {
        menuItems: {
          where: eq(menuItems.isAvailable, true),
          orderBy: [asc(menuItems.name)],
        },
      },
    });
    return { ok: true as const, data: result };
  } catch (e) {
    console.error('[getMenuCategories]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

export type MenuCategoriesData = NonNullable<
  Extract<Awaited<ReturnType<typeof getMenuCategories>>, { ok: true }>['data']
>;

export type SessionData = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionData>>, { ok: true }>['data']
>;

export async function placeOrder(input: unknown) {
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'เธเนเธญเธกเธนเธฅเนเธกเนเธ–เธนเธเธ•เนเธญเธ' };

  const { sessionToken, items } = parsed.data;

  try {
    const [session] = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);

    if (!session || session.status !== 'active')
      return { ok: false as const, error: 'session เนเธกเนเธ–เธนเธเธ•เนเธญเธเธซเธฃเธทเธญเธซเธกเธ”เน€เธงเธฅเธฒเนเธฅเนเธง' };

    // Block new order if any items from previous orders are not yet served
    const [unserved] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.sessionId, session.id),
          inArray(orderItems.status, ['pending', 'preparing', 'ready']),
        ),
      )
      .limit(1);
    if (unserved)
      return { ok: false as const, error: 'เธเธฃเธธเธ“เธฒเธฃเธญเธเธฃเธฑเธงเน€เธชเธดเธฃเนเธเธญเธญเน€เธ”เธญเธฃเนเธเนเธญเธ' };

    const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
    const menuItemRows = await db
      .select({
        id: menuItems.id,
        name: menuItems.name,
        isAvailable: menuItems.isAvailable,
        cooldownSeconds: menuItems.cooldownSeconds,
        maxPerOrder: menuItems.maxPerOrder,
        station: categories.station,
        categoryId: menuItems.categoryId,
        maxPerSession: categories.maxPerSession,
      })
      .from(menuItems)
      .innerJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(inArray(menuItems.id, menuItemIds));

    const menuItemMap = new Map(menuItemRows.map((m) => [m.id, m]));

    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId);
      if (!mi) return { ok: false as const, error: 'เนเธกเนเธเธเน€เธกเธเธน' };
      if (!mi.isAvailable)
        return { ok: false as const, error: `${mi.name} เนเธกเนเธกเธตเนเธซเนเธเธฃเธดเธเธฒเธฃเนเธเธเธ“เธฐเธเธตเน` };

      if (mi.cooldownSeconds > 0) {
        const cooldownSince = new Date(Date.now() - mi.cooldownSeconds * 1000);
        const [recent] = await db
          .select({ id: orderItems.id })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .where(
            and(
              eq(orders.sessionId, session.id),
              eq(orderItems.menuItemId, item.menuItemId),
              gte(orders.createdAt, cooldownSince),
            ),
          )
          .limit(1);
        if (recent)
          return { ok: false as const, error: `${mi.name} เธขเธฑเธเนเธกเนเธเธฃเนเธญเธกเธชเธฑเนเธเธญเธตเธเธเธฃเธฑเนเธ` };
      }

      if (mi.maxPerOrder !== null && item.quantity > mi.maxPerOrder)
        return { ok: false as const, error: `${mi.name} เน€เธเธดเธเธเธณเธเธงเธเธ—เธตเนเธชเธฑเนเธเนเธ”เนเธ•เนเธญเธฃเธญเธ (เธชเธนเธเธชเธธเธ” ${mi.maxPerOrder} เธเธฒเธ)` };
    }

    // Category-level limit enforcement (per order round, not per session)
    const incomingByCat = new Map<string, { limit: number; incoming: number }>();
    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId)!;
      if (mi.maxPerSession === null) continue;
      const entry = incomingByCat.get(mi.categoryId) ?? { limit: mi.maxPerSession, incoming: 0 };
      entry.incoming += item.quantity;
      incomingByCat.set(mi.categoryId, entry);
    }
    for (const [, { limit, incoming }] of incomingByCat) {
      if (incoming > limit) {
        return { ok: false as const, error: `เน€เธเธดเธเธเธณเธเธงเธเธชเธนเธเธชเธธเธ”เธ•เนเธญเธเธฃเธฑเนเธเธเธญเธเธซเธกเธงเธ” (เธชเธนเธเธชเธธเธ” ${limit} เธเธฒเธ)` };
      }
    }

    const [newOrder] = await db
      .insert(orders)
      .values({ sessionId: session.id, status: 'pending' })
      .returning({ id: orders.id });

    await db.insert(orderItems).values(
      items.map((item) => ({
        orderId: newOrder.id,
        menuItemId: item.menuItemId,
        itemName: menuItemMap.get(item.menuItemId)!.name,
        quantity: item.quantity,
        notes: item.notes,
        station: menuItemMap.get(item.menuItemId)!.station,
        status: 'pending' as const,
      })),
    );

    revalidateTag('kds');
    return { ok: true as const };
  } catch (e) {
    console.error('[placeOrder]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ” เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเน' };
  }
}

export async function hasUnservedItems(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    if (!session) return { ok: false as const, error: 'เนเธกเนเธเธ session' };

    const [row] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.sessionId, session.id),
          inArray(orderItems.status, ['pending', 'preparing', 'ready']),
        ),
      )
      .limit(1);

    return { ok: true as const, data: { hasUnserved: !!row } };
  } catch (e) {
    console.error('[hasUnservedItems]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

export async function getCategoryOrderedQty(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    if (!session) return { ok: false as const, error: 'เนเธกเนเธเธ session' };

    const rows = await db
      .select({
        categoryId: menuItems.categoryId,
        total: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(
        and(
          eq(orders.sessionId, session.id),
          ne(orderItems.status, 'cancelled'),
        ),
      )
      .groupBy(menuItems.categoryId);

    const data: Record<string, number> = {};
    for (const row of rows) data[row.categoryId] = row.total;
    return { ok: true as const, data };
  } catch (e) {
    console.error('[getCategoryOrderedQty]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

export async function getSessionOrders(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    if (!session) return { ok: false as const, error: 'เนเธกเนเธเธ session' };

    const result = await db.query.orders.findMany({
      where: eq(orders.sessionId, session.id),
      orderBy: [desc(orders.createdAt)],
      with: {
        items: {
          with: { menuItem: true },
        },
      },
    });

    return { ok: true as const, data: result };
  } catch (e) {
    console.error('[getSessionOrders]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

export type SessionOrdersData = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionOrders>>, { ok: true }>['data']
>;

export async function callStaff(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.sessionToken, sessionToken),
          eq(sessions.status, 'active'),
        ),
      )
      .limit(1);
    if (!session) return { ok: false as const, error: 'session เนเธกเนเธ–เธนเธเธ•เนเธญเธ' };
    return { ok: true as const };
  } catch (e) {
    console.error('[callStaff]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

export async function requestBill(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.sessionToken, sessionToken),
          eq(sessions.status, 'active'),
        ),
      )
      .limit(1);
    if (!session) return { ok: false as const, error: 'session เนเธกเนเธ–เธนเธเธ•เนเธญเธ' };

    await db
      .update(sessions)
      .set({ status: 'closing' })
      .where(eq(sessions.id, session.id));

    return { ok: true as const };
  } catch (e) {
    console.error('[requestBill]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”' };
  }
}

