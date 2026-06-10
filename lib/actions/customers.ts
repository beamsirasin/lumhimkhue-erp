'use server';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { customers, customerVisits, storeSettings } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

const registerSchema = z.object({
  phone: z.string().min(9).max(20).regex(/^\d+$/, 'กรุณากรอกเฉพาะตัวเลข'),
  name: z.string().max(100).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export async function searchCustomerByPhone(phone: string) {
  const s = await auth();
  if (!s?.user) return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const result = await db.select().from(customers)
      .where(eq(customers.phone, phone.trim())).limit(1);
    return { ok: true as const, data: result[0] ?? null };
  } catch (e) {
    console.error('[searchCustomerByPhone]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function registerCustomer(input: unknown) {
  const s = await auth();
  if (!s?.user) return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { phone, name, birthDate } = parsed.data;

  try {
    const existing = await db.select({ id: customers.id }).from(customers)
      .where(eq(customers.phone, phone)).limit(1);
    if (existing.length) return { ok: false as const, error: 'เบอร์โทรนี้มีในระบบแล้ว' };

    const [created] = await db.insert(customers).values({
      phone,
      name: name ?? null,
      birthDate: birthDate ?? null,
    }).returning();
    return { ok: true as const, data: created };
  } catch (e) {
    console.error('[registerCustomer]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getCustomerById(id: string) {
  const s = await auth();
  if (!s?.user) return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return { ok: true as const, data: result[0] ?? null };
  } catch (e) {
    console.error('[getCustomerById]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/**
 * Award loyalty points on session payment. Called internally from processPayment.
 * Not a server action (no auth needed — runs in same server context).
 */
export async function awardLoyaltyPoints({
  customerId,
  sessionId,
  totalAmount,
  pointsRedeemed = 0,
}: {
  customerId: string;
  sessionId: string;
  totalAmount: number;
  pointsRedeemed?: number;
}) {
  try {
    const [settings] = await db.select({
      loyaltyPointsPerBaht: storeSettings.loyaltyPointsPerBaht,
    }).from(storeSettings).limit(1);

    const pointsPerBaht = settings?.loyaltyPointsPerBaht ?? 10;
    const pointsEarned = Math.floor(totalAmount / pointsPerBaht);
    const today = format(toZonedTime(new Date(), TZ), 'yyyy-MM-dd');

    await db.insert(customerVisits).values({
      customerId,
      sessionId,
      pointsEarned,
      pointsRedeemed,
      visitDate: today,
    });

    const netPointsDelta = pointsEarned - pointsRedeemed;
    await db.update(customers).set({
      loyaltyPoints: sql`${customers.loyaltyPoints} + ${netPointsDelta}`,
      totalVisits: sql`${customers.totalVisits} + 1`,
      totalSpend: sql`${customers.totalSpend} + ${totalAmount.toFixed(2)}::numeric`,
      lastVisitDate: today,
      updatedAt: new Date(),
    }).where(eq(customers.id, customerId));

    return pointsEarned;
  } catch (e) {
    console.error('[awardLoyaltyPoints]', e);
    return 0;
  }
}
