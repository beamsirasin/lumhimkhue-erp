'use server';

import { eq, and, gte, desc, asc, inArray, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
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
    if (!table) return { ok: false as const, error: 'ไม่พบโต๊ะ' };

    const session = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.sessionToken, sessionToken),
        eq(sessions.tableId, table.id),
      ),
    });
    if (!session || session.status === 'closed')
      return { ok: false as const, error: 'session ไม่ถูกต้องหรือหมดอายุแล้ว' };

    return { ok: true as const, data: { table, session } };
  } catch (e) {
    console.error('[getSessionData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
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
    // Strip base64 blobs — images are served via /api/img/[id] with
    // Cache-Control: immutable so they never inflate the HTML payload.
    const data = result.map((cat) => ({
      ...cat,
      menuItems: cat.menuItems.map(({ imageUrl, ...item }) => ({
        ...item,
        hasImage: !!imageUrl,
      })),
    }));
    return { ok: true as const, data };
  } catch (e) {
    console.error('[getMenuCategories]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
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
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { sessionToken, items } = parsed.data;

  try {
    // neon-http does not support db.transaction() — queries run sequentially
    const [session] = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);

    if (!session || (session.status !== 'active' && session.status !== 'paid'))
      return { ok: false as const, error: 'session ไม่ถูกต้องหรือหมดเวลาแล้ว' };

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
      return { ok: false as const, error: 'กรุณารอรับวงเดิมก่อนสั่งรอบใหม่' };

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

    // Batch cooldown check
    const cooldownMenuItemIds = [
      ...new Set(
        items
          .filter((i) => (menuItemMap.get(i.menuItemId)?.cooldownSeconds ?? 0) > 0)
          .map((i) => i.menuItemId),
      ),
    ];
    const recentOrderedAt = new Map<string, Date>();
    if (cooldownMenuItemIds.length > 0) {
      const maxCooldown = Math.max(
        ...cooldownMenuItemIds.map((id) => menuItemMap.get(id)!.cooldownSeconds),
      );
      const earliestSince = new Date(Date.now() - maxCooldown * 1000);
      const recentRows = await db
        .select({ menuItemId: orderItems.menuItemId, orderedAt: orders.createdAt })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(
          and(
            eq(orders.sessionId, session.id),
            inArray(orderItems.menuItemId, cooldownMenuItemIds),
            gte(orders.createdAt, earliestSince),
          ),
        );
      for (const r of recentRows) {
        if (!r.menuItemId) continue;
        const existing = recentOrderedAt.get(r.menuItemId);
        if (!existing || r.orderedAt > existing) recentOrderedAt.set(r.menuItemId, r.orderedAt);
      }
    }

    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId);
      if (!mi) return { ok: false as const, error: 'ไม่พบเมนู' };
      if (!mi.isAvailable)
        return { ok: false as const, error: `${mi.name} ไม่มีให้บริการในขณะนี้` };

      if (mi.cooldownSeconds > 0) {
        const lastOrdered = recentOrderedAt.get(item.menuItemId);
        const cooldownSince = new Date(Date.now() - mi.cooldownSeconds * 1000);
        if (lastOrdered && lastOrdered >= cooldownSince)
          return { ok: false as const, error: `${mi.name} ยังไม่พร้อมสั่งอีกครั้ง` };
      }

      if (mi.maxPerOrder !== null && item.quantity > mi.maxPerOrder)
        return { ok: false as const, error: `${mi.name} เกินจำนวนที่สั่งได้ต่อรอบ (สูงสุด ${mi.maxPerOrder} ชิ้น)` };
    }

    // Category-level limit enforcement (per order round)
    const incomingByCat = new Map<string, { limit: number; incoming: number }>();
    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId)!;
      if (mi.maxPerSession === null) continue;
      const entry = incomingByCat.get(mi.categoryId) ?? { limit: mi.maxPerSession, incoming: 0 };
      entry.incoming += item.quantity;
      incomingByCat.set(mi.categoryId, entry);
    }
    for (const [, { limit, incoming }] of incomingByCat) {
      if (incoming > limit)
        return { ok: false as const, error: `เกินจำนวนสูงสุดต่อรอบของหมวด (สูงสุด ${limit} ชิ้น)` };
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
        notes: item.notes ?? null,
        station: menuItemMap.get(item.menuItemId)!.station,
        status: 'pending' as const,
      })),
    );

    revalidatePath('/kds', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error('[placeOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function hasUnservedItems(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่มี session' };

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
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getCategoryOrderedQty(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่มี session' };

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
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getSessionOrders(sessionToken: string) {
  try {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่มี session' };

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
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SessionOrdersData = NonNullable<
  Extract<Awaited<ReturnType<typeof getSessionOrders>>, { ok: true }>['data']
>;

export async function getActiveSessionByTable(tableToken: string) {
  try {
    const [table] = await db
      .select({ id: tables.id, label: tables.label, qrToken: tables.qrToken })
      .from(tables)
      .where(eq(tables.qrToken, tableToken))
      .limit(1);
    if (!table) return { ok: false as const, error: 'ไม่พบโต๊ะ' };

    const [session] = await db
      .select({ id: sessions.id, sessionToken: sessions.sessionToken, status: sessions.status })
      .from(sessions)
      .where(
        and(
          eq(sessions.tableId, table.id),
          inArray(sessions.status, ['active', 'closing']),
        ),
      )
      .orderBy(desc(sessions.startedAt))
      .limit(1);

    if (!session) return { ok: false as const, error: 'ยังไม่มีการเปิดโต๊ะ' };

    return {
      ok: true as const,
      data: { table, session },
    };
  } catch (e) {
    console.error('[getActiveSessionByTable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

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
    if (!session) return { ok: false as const, error: 'session ไม่ถูกต้อง' };
    return { ok: true as const };
  } catch (e) {
    console.error('[callStaff]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
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
    if (!session) return { ok: false as const, error: 'session ไม่ถูกต้อง' };

    await db
      .update(sessions)
      .set({ status: 'closing' })
      .where(eq(sessions.id, session.id));

    return { ok: true as const };
  } catch (e) {
    console.error('[requestBill]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
