'use server';

import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { storeSettings } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';

export async function getStoreSettings() {
  try {
    const [row] = await db.select().from(storeSettings).where(eq(storeSettings.id, 1)).limit(1);
    if (!row) {
      await db.insert(storeSettings).values({ id: 1 }).onConflictDoNothing();
      const [fresh] = await db.select().from(storeSettings).where(eq(storeSettings.id, 1)).limit(1);
      return { ok: true as const, data: fresh! };
    }
    return { ok: true as const, data: row };
  } catch (e) {
    console.error('[getStoreSettings]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

const billTypeLabelSchema = z.enum(['food', 'receipt_short', 'tax_full']).optional();

const billConfigSchema = z.object({
  shopNameTh:    z.string().max(255).optional(),
  shopNameEn:    z.string().max(255).optional(),
  companyName:   z.string().max(255).optional(),
  address:       z.string().max(1000).optional(),
  phone:         z.string().max(50).optional(),
  taxId:         z.string().max(30).optional(),
  branch:        z.string().max(100).optional(),
  registerNo:    z.string().max(50).optional(),
  footerNote:    z.string().max(255).optional(),
  vatPercent:    z.number().int().min(0).max(100).optional(),
  logoHeight:    z.number().int().min(20).max(200).optional(),
  billTypeLabel: billTypeLabelSchema,
  hiddenFields:  z.array(z.string()).optional(),
}).nullable();

const updateSchema = z.object({
  shopNameTh:      z.string().min(1).max(255),
  shopNameEn:      z.string().max(255).default(''),
  companyName:     z.string().max(255).nullable().optional(),
  address:         z.string().max(1000).nullable().optional(),
  phone:           z.string().max(50).nullable().optional(),
  taxId:           z.string().max(30).nullable().optional(),
  branch:          z.string().max(100).nullable().optional(),
  registerNo:      z.string().max(50).nullable().optional(),
  footerNote:      z.string().max(255).nullable().optional(),
  vatPercent:      z.number().int().min(0).max(100).default(7),
  logoUrl:         z.string().max(2_097_152).nullable().optional(),
  logoHeight:      z.number().int().min(20).max(200).default(56),
  billPaperWidth:  z.number().int().transform((v) => (v === 58 ? 58 : 80) as 58 | 80).default(80),
  taxInvoicePrefix: z.string().max(20).default('2605'),
  billPreviewConfig:    billConfigSchema.optional(),
  billMainConfig:       billConfigSchema.optional(),
  billSecondaryConfig:  billConfigSchema.optional(),
  billTaxInvoiceConfig: billConfigSchema.optional(),
});

export async function updateStoreSettings(input: unknown) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    console.error('[updateStoreSettings] validation errors:', JSON.stringify(flat, null, 2));
    const firstField = Object.keys(flat.fieldErrors)[0];
    const devDetail = firstField ? ` (field: ${firstField})` : '';
    return { ok: false as const, error: `ข้อมูลไม่ถูกต้อง${process.env.NODE_ENV === 'development' ? devDetail : ''}` };
  }

  try {
    await db.update(storeSettings).set(parsed.data).where(eq(storeSettings.id, 1));
    revalidatePath('/settings');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateStoreSettings]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

/**
 * Atomically increments the daily receipt counter.
 * Resets to 1 each new day (Asia/Bangkok).
 * Returns the formatted receipt number: "{prefix}/{counter:05d}"
 */
export async function incrementReceiptCounter(): Promise<{ ok: true; receiptNo: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'ไม่ได้เข้าสู่ระบบ' };

  try {
    const today = format(toZonedTime(new Date(), TZ), 'yyyy-MM-dd');

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ counter: storeSettings.receiptCounter, counterDate: storeSettings.receiptCounterDate, prefix: storeSettings.taxInvoicePrefix })
        .from(storeSettings)
        .where(eq(storeSettings.id, 1))
        .for('update');

      if (!row) throw new Error('ไม่พบการตั้งค่าร้าน');

      const newCounter = row.counterDate === today ? row.counter + 1 : 1;

      await tx
        .update(storeSettings)
        .set({ receiptCounter: newCounter, receiptCounterDate: today })
        .where(eq(storeSettings.id, 1));

      return { counter: newCounter, prefix: row.prefix };
    });

    const receiptNo = `${result.prefix}/${result.counter.toString().padStart(5, '0')}`;
    return { ok: true, receiptNo };
  } catch (e) {
    console.error('[incrementReceiptCounter]', e);
    return { ok: false, error: 'ไม่สามารถออกเลขที่บิลได้' };
  }
}

export type StoreSettingsData = NonNullable<
  Extract<Awaited<ReturnType<typeof getStoreSettings>>, { ok: true }>['data']
>;
