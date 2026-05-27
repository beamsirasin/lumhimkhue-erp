'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { orderItems, orders, sessions, tables, menuItems } from '@/lib/db/schema';

export async function getKdsItems() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_kds'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const items = await db
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        notes: orderItems.notes,
        station: orderItems.station,
        status: orderItems.status,
        orderedAt: orders.createdAt,
        menuItemName: menuItems.name,
        tableNumber: tables.label,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(sessions, eq(orders.sessionId, sessions.id))
      .innerJoin(tables, eq(sessions.tableId, tables.id))
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(
        and(
          inArray(orderItems.status, ['pending', 'preparing', 'ready']),
          inArray(sessions.status, ['active', 'closing']),
        ),
      )
      .orderBy(asc(orders.createdAt), asc(orderItems.id));

    return { ok: true as const, data: items };
  } catch (e) {
    console.error('[getKdsItems]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type KdsItem = NonNullable<
  Extract<Awaited<ReturnType<typeof getKdsItems>>, { ok: true }>['data']
>[number];

const updateItemStatusSchema = z.object({
  itemId: z.string().uuid(),
  status: z.enum(['preparing', 'ready', 'served', 'cancelled']),
});

export async function updateItemStatus(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_kds'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateItemStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

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

    revalidatePath('/kds');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateItemStatus]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
