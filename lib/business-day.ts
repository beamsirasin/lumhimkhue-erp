import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { storeBusinessDays } from '@/lib/db/schema';

export const STORE_DAY_CLOSED_ERROR = 'ร้านปิดรอบวันแล้ว ไม่สามารถรับชำระหรือเปิดรอบแคชเชียร์ใหม่ได้';

export function getBangkokBusinessDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const day = part('day');
  const month = part('month');
  const year = part('year');
  if (!day || !month || !year) throw new Error('Cannot resolve Bangkok business date');
  return `${year}-${month}-${day}`;
}

export async function getStoreBusinessDayState(value: Date = new Date()) {
  const businessDate = getBangkokBusinessDate(value);
  const [row] = await db
    .select({
      id: storeBusinessDays.id,
      status: storeBusinessDays.status,
      closedAt: storeBusinessDays.closedAt,
      reopenedAt: storeBusinessDays.reopenedAt,
    })
    .from(storeBusinessDays)
    .where(eq(storeBusinessDays.businessDate, businessDate))
    .limit(1);

  return {
    id: row?.id ?? null,
    businessDate,
    status: row?.status === 'closed' ? 'closed' as const : 'open' as const,
    closedAt: row?.closedAt ?? null,
    reopenedAt: row?.reopenedAt ?? null,
  };
}
