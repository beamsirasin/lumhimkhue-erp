'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { pricingTiers } from '@/lib/db/schema';
import { pricingTierSchema, updatePricingTierSchema } from '@/lib/validations/pricing';

export async function getPricingTiers() {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_menu'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const data = await db
    .select()
    .from(pricingTiers)
    .orderBy(pricingTiers.sortOrder);

  return { ok: true as const, data };
}

export type PricingTierRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getPricingTiers>>, { ok: true }>['data']
>[number];

export async function createPricingTier(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_menu'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = pricingTierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง: ' + parsed.error.issues[0]?.message };

  try {
    await db.insert(pricingTiers).values({
      code: parsed.data.code,
      name: parsed.data.name,
      price: String(parsed.data.price),
      vatIncluded: parsed.data.vatIncluded,
      vatRate: String(parsed.data.vatRate),
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
      notes: parsed.data.notes ?? null,
    });

    revalidatePath('/pricing');
    return { ok: true as const };
  } catch (e) {
    console.error('[createPricingTier]', e);
    const msg = e instanceof Error && e.message.includes('unique')
      ? 'รหัส (code) นี้มีอยู่แล้ว'
      : 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    return { ok: false as const, error: msg };
  }
}

export async function updatePricingTier(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_menu'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updatePricingTierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await db
      .update(pricingTiers)
      .set({
        code: parsed.data.code,
        name: parsed.data.name,
        price: String(parsed.data.price),
        vatIncluded: parsed.data.vatIncluded,
        vatRate: String(parsed.data.vatRate),
        sortOrder: parsed.data.sortOrder,
        isActive: parsed.data.isActive,
        notes: parsed.data.notes ?? null,
      })
      .where(eq(pricingTiers.id, parsed.data.id));

    revalidatePath('/pricing');
    return { ok: true as const };
  } catch (e) {
    console.error('[updatePricingTier]', e);
    const msg = e instanceof Error && e.message.includes('unique')
      ? 'รหัส (code) นี้มีอยู่แล้ว'
      : 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    return { ok: false as const, error: msg };
  }
}

export async function togglePricingTierActive(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_menu'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [tier] = await db
      .select({ isActive: pricingTiers.isActive })
      .from(pricingTiers)
      .where(eq(pricingTiers.id, id))
      .limit(1);
    if (!tier) return { ok: false as const, error: 'ไม่พบข้อมูล' };

    await db
      .update(pricingTiers)
      .set({ isActive: !tier.isActive })
      .where(eq(pricingTiers.id, id));

    revalidatePath('/pricing');
    return { ok: true as const };
  } catch (e) {
    console.error('[togglePricingTierActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
