'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { storeSettings } from '@/lib/db/schema';

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

const billConfigSchema = z.object({
  shopNameTh: z.string().max(255).optional(),
  shopNameEn: z.string().max(255).optional(),
  companyName: z.string().max(255).optional(),
  address: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  taxId: z.string().max(30).optional(),
  branch: z.string().max(100).optional(),
  registerNo: z.string().max(50).optional(),
  footerNote: z.string().max(255).optional(),
  vatPercent: z.number().int().min(0).max(100).optional(),
}).nullable();

const updateSchema = z.object({
  shopNameTh: z.string().min(1).max(255),
  shopNameEn: z.string().max(255).default(''),
  companyName: z.string().max(255).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  taxId: z.string().max(30).nullable().optional(),
  branch: z.string().max(100).nullable().optional(),
  registerNo: z.string().max(50).nullable().optional(),
  footerNote: z.string().max(255).nullable().optional(),
  vatPercent: z.number().int().min(0).max(100).default(7),
  billPreviewConfig: billConfigSchema.optional(),
  billMainConfig: billConfigSchema.optional(),
  billSecondaryConfig: billConfigSchema.optional(),
});

export async function updateStoreSettings(input: unknown) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_settings'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db.update(storeSettings).set(parsed.data).where(eq(storeSettings.id, 1));
    revalidatePath('/settings');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateStoreSettings]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type StoreSettingsData = NonNullable<
  Extract<Awaited<ReturnType<typeof getStoreSettings>>, { ok: true }>['data']
>;
