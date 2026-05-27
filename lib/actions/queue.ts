'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray, lt, asc, gte, sql } from 'drizzle-orm';
import { startOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { queueEntries } from '@/lib/db/schema';
import { addQueueSchema } from '@/lib/validations/queue';

const TZ = 'Asia/Bangkok';

function bangkokDayStart(): Date {
  const zonedNow = toZonedTime(new Date(), TZ);
  return fromZonedTime(startOfDay(zonedNow), TZ);
}

export async function getQueueList() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const entries = await db
      .select()
      .from(queueEntries)
      .where(inArray(queueEntries.status, ['waiting', 'called']))
      .orderBy(asc(queueEntries.createdAt));

    return { ok: true as const, data: entries };
  } catch (e) {
    console.error('[getQueueList]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type QueueEntry = NonNullable<
  Extract<Awaited<ReturnType<typeof getQueueList>>, { ok: true }>['data']
>[number];

export async function addToQueue(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = addQueueSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    const dayStart = bangkokDayStart();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(queueEntries)
      .where(gte(queueEntries.createdAt, dayStart));

    const queueNumber = `Q${String(Number(count) + 1).padStart(3, '0')}`;
    const publicToken = nanoid(10);

    const [entry] = await db
      .insert(queueEntries)
      .values({
        queueNumber,
        publicToken,
        customerName: parsed.data.customerName,
        phone: parsed.data.phone,
        partySize: parsed.data.partySize,
        preferredZone: parsed.data.preferredZone,
        status: 'waiting',
      })
      .returning();

    revalidatePath('/queue');
    return { ok: true as const, data: { queueNumber, publicToken, id: entry.id } };
  } catch (e) {
    console.error('[addToQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function callQueue(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'called', calledAt: new Date() })
      .where(and(eq(queueEntries.id, id), eq(queueEntries.status, 'waiting')));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[callQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function seatQueue(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'seated', seatedAt: new Date() })
      .where(and(eq(queueEntries.id, id), eq(queueEntries.status, 'called')));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[seatQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function removeFromQueue(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'left' })
      .where(eq(queueEntries.id, id));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[removeFromQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getQueueStatus(token: string) {
  try {
    const [entry] = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.publicToken, token))
      .limit(1);

    if (!entry) return { ok: false as const, error: 'ไม่พบข้อมูลคิว' };

    let position = 0;
    if (entry.status === 'waiting') {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(queueEntries)
        .where(
          and(
            eq(queueEntries.status, 'waiting'),
            lt(queueEntries.createdAt, entry.createdAt),
          ),
        );
      position = Number(count) + 1;
    }

    return { ok: true as const, data: { entry, position } };
  } catch (e) {
    console.error('[getQueueStatus]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type QueueStatusData = NonNullable<
  Extract<Awaited<ReturnType<typeof getQueueStatus>>, { ok: true }>['data']
>;
