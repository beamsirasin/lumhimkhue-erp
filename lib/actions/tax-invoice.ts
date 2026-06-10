'use server';

import { eq, sql } from 'drizzle-orm';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { db } from '@/lib/db';
import { taxInvoiceSequence, storeSettings } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

/**
 * Generate a sequential tax invoice number for the current month.
 * Format: {prefix}{MMYY}{4-digit seq}, e.g. LHK06260001
 * Called internally from processPayment — not a server action.
 */
export async function generateTaxInvoiceNumber(): Promise<string> {
  const now = toZonedTime(new Date(), TZ);
  const month = format(now, 'yyyy-MM');
  const mmyy = format(now, 'MMyy');

  const [settings] = await db.select({ prefix: storeSettings.taxInvoicePrefix })
    .from(storeSettings).limit(1);
  const prefix = settings?.prefix ?? 'INV';

  // Upsert sequence row and atomically increment
  await db.insert(taxInvoiceSequence)
    .values({ month, lastNumber: 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: taxInvoiceSequence.month,
      set: {
        lastNumber: sql`${taxInvoiceSequence.lastNumber} + 1`,
        updatedAt: new Date(),
      },
    });

  const [row] = await db.select({ lastNumber: taxInvoiceSequence.lastNumber })
    .from(taxInvoiceSequence)
    .where(eq(taxInvoiceSequence.month, month));

  const seq = String(row.lastNumber).padStart(4, '0');
  return `${prefix}${mmyy}${seq}`;
}
