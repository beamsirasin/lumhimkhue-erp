'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, or, inArray, isNotNull, lt, lte, desc, asc, gte, sql } from 'drizzle-orm';
import { startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { queueEntries } from '@/lib/db/schema';
import {
  addQueueSchema,
  updateQueueSchema,
  skipQueueSchema,
  admitQueueSchema,
  updatePlannedTableSchema,
} from '@/lib/validations/queue';

const TZ = 'Asia/Bangkok';

function bangkokDayStart(): Date {
  const zonedNow = toZonedTime(new Date(), TZ);
  return fromZonedTime(startOfDay(zonedNow), TZ);
}

/* ─── getQueueList ──────────────────────────────────────────────────────── */
// Returns all active entries: waiting/called/waiting_suitable_table/admitted (any billIssued).
// Billed admitted rows remain visible on the board — the UI distinguishes them visually.

export async function getQueueList() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const entries = await db
      .select()
      .from(queueEntries)
      .where(
        and(
          inArray(queueEntries.status, ['waiting', 'waiting_suitable_table', 'called', 'admitted']),
          gte(queueEntries.createdAt, bangkokDayStart()),
        ),
      )
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

/* ─── addToQueue ────────────────────────────────────────────────────────── */

export async function addToQueue(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = addQueueSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { adultCount, childCount } = parsed.data;
  if (adultCount + childCount < 1) {
    return { ok: false as const, error: 'กรุณากรอกจำนวนคนอย่างน้อย 1 คน' };
  }

  try {
    const dayStart = bangkokDayStart();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(queueEntries)
      .where(gte(queueEntries.createdAt, dayStart));

    const queueNumber = `Q${String(Number(count) + 1).padStart(3, '0')}`;
    const publicToken = nanoid(10);
    const partySize = adultCount + childCount;

    const [entry] = await db
      .insert(queueEntries)
      .values({
        queueNumber,
        publicToken,
        customerName: parsed.data.customerName?.trim() || '-',
        phone: parsed.data.phone,
        partySize,
        adultCount,
        childCount,
        customerType: parsed.data.customerType,
        soupPots: parsed.data.soupPots,
        seatingFit: parsed.data.seatingFit,
        plannedTableNote: parsed.data.plannedTableNote,
        preferredZone: parsed.data.preferredZone,
        status: 'waiting',
      })
      .returning();

    revalidatePath('/queue');
    return {
      ok: true as const,
      data: {
        queueNumber,
        publicToken,
        id: entry.id,
        partySize,
        adultCount,
        childCount,
        soupPots: parsed.data.soupPots,
      },
    };
  } catch (e) {
    console.error('[addToQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── updateQueue ───────────────────────────────────────────────────────── */

export async function updateQueue(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateQueueSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { id, adultCount, childCount, ...rest } = parsed.data;
  if (adultCount + childCount < 1) {
    return { ok: false as const, error: 'กรุณากรอกจำนวนคนอย่างน้อย 1 คน' };
  }
  const partySize = adultCount + childCount;

  try {
    await db
      .update(queueEntries)
      .set({ ...rest, adultCount, childCount, partySize })
      .where(eq(queueEntries.id, id));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── callQueue ─────────────────────────────────────────────────────────── */

export async function callQueue(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'called', calledAt: new Date() })
      .where(
        and(
          eq(queueEntries.id, id),
          inArray(queueEntries.status, ['waiting', 'waiting_suitable_table']),
        ),
      );

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[callQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── markWaitingSuitableTable ──────────────────────────────────────────── */

export async function markWaitingSuitableTable(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'waiting_suitable_table' })
      .where(and(eq(queueEntries.id, id), eq(queueEntries.status, 'waiting')));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[markWaitingSuitableTable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── revertToWaiting ───────────────────────────────────────────────────── */

export async function revertToWaiting(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'waiting' })
      .where(
        and(
          eq(queueEntries.id, id),
          inArray(queueEntries.status, ['waiting_suitable_table', 'called']),
        ),
      );

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[revertToWaiting]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── admitQueue ────────────────────────────────────────────────────────── */

export async function admitQueue(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = admitQueueSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db
      .update(queueEntries)
      .set({
        status: 'admitted',
        admittedAt: new Date(),
        seatedAt: new Date(),
        plannedTableNote: parsed.data.plannedTableNote ?? undefined,
        billIssued: parsed.data.billIssued,
      })
      .where(
        and(
          eq(queueEntries.id, parsed.data.id),
          inArray(queueEntries.status, ['called', 'waiting', 'waiting_suitable_table']),
        ),
      );

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[admitQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── Legacy seatQueue (keeps old client code working) ─────────────────── */

export async function seatQueue(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'admitted', admittedAt: new Date(), seatedAt: new Date() })
      .where(and(eq(queueEntries.id, id), eq(queueEntries.status, 'called')));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[seatQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── skipQueue ─────────────────────────────────────────────────────────── */

export async function skipQueue(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = skipQueueSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'skipped', skipReason: parsed.data.skipReason })
      .where(
        and(
          eq(queueEntries.id, parsed.data.id),
          inArray(queueEntries.status, ['called', 'waiting', 'waiting_suitable_table']),
        ),
      );

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[skipQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── cancelQueue ───────────────────────────────────────────────────────── */

export async function cancelQueue(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(queueEntries.id, id),
          inArray(queueEntries.status, ['waiting', 'waiting_suitable_table', 'called', 'admitted']),
        ),
      );

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[cancelQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── removeFromQueue (legacy — now cancels) ────────────────────────────── */

export async function removeFromQueue(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ status: 'cancelled' })
      .where(eq(queueEntries.id, id));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[removeFromQueue]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── toggleBillIssued ──────────────────────────────────────────────────── */

export async function toggleBillIssued(id: string, billIssued: boolean) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db
      .update(queueEntries)
      .set({ billIssued })
      .where(eq(queueEntries.id, id));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleBillIssued]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── updatePlannedTable ────────────────────────────────────────────────── */

export async function updatePlannedTable(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updatePlannedTableSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db
      .update(queueEntries)
      .set({ plannedTableNote: parsed.data.plannedTableNote })
      .where(eq(queueEntries.id, parsed.data.id));

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[updatePlannedTable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── getQueueStatus (customer-facing) ─────────────────────────────────── */

export async function getQueueStatus(token: string) {
  try {
    const [entry] = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.publicToken, token))
      .limit(1);

    if (!entry) return { ok: false as const, error: 'ไม่พบข้อมูลคิว' };

    let position = 0;
    if (entry.status === 'waiting' || entry.status === 'waiting_suitable_table') {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(queueEntries)
        .where(
          and(
            inArray(queueEntries.status, ['waiting', 'waiting_suitable_table']),
            lt(queueEntries.createdAt, entry.createdAt),
          ),
        );
      position = Number(count) + 1;
    }

    // Latest queue called OR admitted today — for customer position display.
    // The staff board admits directly without a separate "call" step
    // (รับเข้า = เรียกคิว), so admittedAt is the primary signal;
    // calledAt is kept for legacy called-only rows.
    const [latestCalledEntry] = await db
      .select({ queueNumber: queueEntries.queueNumber })
      .from(queueEntries)
      .where(
        and(
          gte(queueEntries.createdAt, bangkokDayStart()),
          or(
            isNotNull(queueEntries.admittedAt),
            isNotNull(queueEntries.calledAt),
          ),
        ),
      )
      .orderBy(desc(sql`COALESCE(${queueEntries.admittedAt}, ${queueEntries.calledAt})`))
      .limit(1);

    return {
      ok: true as const,
      data: {
        entry,
        position,
        latestCalledQueueNumber: latestCalledEntry?.queueNumber ?? null,
      },
    };
  } catch (e) {
    console.error('[getQueueStatus]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type QueueStatusData = NonNullable<
  Extract<Awaited<ReturnType<typeof getQueueStatus>>, { ok: true }>['data']
>;

/* ─── cancelQueueByToken (customer self-cancel) ─────────────────────────── */

export async function cancelQueueByToken(token: string) {
  try {
    const result = await db
      .update(queueEntries)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(queueEntries.publicToken, token),
          inArray(queueEntries.status, ['waiting', 'waiting_suitable_table']),
        ),
      );

    const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (rowCount === 0) {
      return { ok: false as const, error: 'ไม่สามารถยกเลิกคิวได้ (สถานะปัจจุบันไม่อนุญาต)' };
    }

    revalidatePath('/queue');
    return { ok: true as const };
  } catch (e) {
    console.error('[cancelQueueByToken]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/* ─── getQueueHistory ───────────────────────────────────────────────────── */

export async function getQueueHistory(date: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_queue'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const zonedDay = toZonedTime(new Date(date), TZ);
    const dayStart = fromZonedTime(startOfDay(zonedDay), TZ);
    const dayEnd = fromZonedTime(endOfDay(zonedDay), TZ);

    const entries = await db
      .select()
      .from(queueEntries)
      .where(and(gte(queueEntries.createdAt, dayStart), lte(queueEntries.createdAt, dayEnd)))
      .orderBy(asc(queueEntries.createdAt));

    return { ok: true as const, data: entries };
  } catch (e) {
    console.error('[getQueueHistory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type QueueHistoryEntry = NonNullable<
  Extract<Awaited<ReturnType<typeof getQueueHistory>>, { ok: true }>['data']
>[number];
