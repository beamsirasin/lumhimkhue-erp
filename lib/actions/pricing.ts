'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc, and } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { pricingTiles, sessionGuests } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/actions/audit';
import {
  pricingTileSchema,
  updatePricingTileSchema,
  reorderTilesSchema,
  type TileCategory,
} from '@/lib/validations/pricing';

export async function getPricingTiles(category?: TileCategory) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const conditions = category
    ? and(eq(pricingTiles.category, category))
    : undefined;

  const data = await db
    .select()
    .from(pricingTiles)
    .where(conditions)
    .orderBy(asc(pricingTiles.sortOrder), asc(pricingTiles.name));

  return { ok: true as const, data };
}

export async function getActivePricingTiles(category?: TileCategory) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const conditions = category
    ? and(eq(pricingTiles.isActive, true), eq(pricingTiles.category, category))
    : eq(pricingTiles.isActive, true);

  const data = await db
    .select()
    .from(pricingTiles)
    .where(conditions)
    .orderBy(asc(pricingTiles.sortOrder), asc(pricingTiles.name));

  return { ok: true as const, data };
}

export type PricingTileRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getPricingTiles>>, { ok: true }>['data']
>[number];

export async function createPricingTile(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'pricing_tile:edit'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = pricingTileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง: ' + parsed.error.issues[0]?.message };

  const d = parsed.data;

  // Validate discount fields
  if (d.category === 'discount') {
    if (!d.discountType)
      return { ok: false as const, error: 'กรุณาระบุประเภทส่วนลด' };
    if (d.discountValue == null || d.discountValue <= 0)
      return { ok: false as const, error: 'กรุณาระบุจำนวนส่วนลด' };
  }

  // Penalty tiles must have a positive fixed amount — cannot be zero or negative
  if (d.category === 'penalty' && d.price <= 0)
    return { ok: false as const, error: 'กรุณาระบุจำนวนเงินค่าปรับ (ต้องมากกว่า 0)' };

  try {
    const [tile] = await db
      .insert(pricingTiles)
      .values({
        code: d.code,
        name: d.name,
        category: d.category,
        imageUrl: d.imageUrl ?? null,
        price: String(d.price),
        vatIncluded: d.vatIncluded,
        vatRate: String(d.vatRate),
        discountType: d.discountType ?? null,
        discountValue: d.discountValue != null ? String(d.discountValue) : null,
        color: d.color ?? null,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
        notes: d.notes ?? null,
      })
      .returning({ id: pricingTiles.id });

    revalidatePath('/admin/pricing-tiles');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'create',
      entity: 'pricing_tiles',
      entityId: tile.id,
      after: { code: d.code, name: d.name, category: d.category, price: d.price },
    });
    return { ok: true as const, data: { id: tile.id } };
  } catch (e) {
    console.error('[createPricingTile]', e);
    const msg =
      e instanceof Error && e.message.includes('unique')
        ? 'รหัส (code) นี้มีอยู่แล้ว'
        : 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    return { ok: false as const, error: msg };
  }
}

export async function updatePricingTile(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'pricing_tile:edit'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updatePricingTileSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง: ' + parsed.error.issues[0]?.message };

  const d = parsed.data;

  // Validate discount fields
  if (d.category === 'discount') {
    if (!d.discountType)
      return { ok: false as const, error: 'กรุณาระบุประเภทส่วนลด' };
    if (d.discountValue == null || d.discountValue <= 0)
      return { ok: false as const, error: 'กรุณาระบุจำนวนส่วนลด' };
  }

  // Penalty tiles must have a positive fixed amount
  if (d.category === 'penalty' && d.price <= 0)
    return { ok: false as const, error: 'กรุณาระบุจำนวนเงินค่าปรับ (ต้องมากกว่า 0)' };

  try {
    await db
      .update(pricingTiles)
      .set({
        name: d.name,
        imageUrl: d.imageUrl ?? null,
        price: String(d.price),
        vatIncluded: d.vatIncluded,
        vatRate: String(d.vatRate),
        discountType: d.discountType ?? null,
        discountValue: d.discountValue != null ? String(d.discountValue) : null,
        color: d.color ?? null,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
        notes: d.notes ?? null,
        // code and category are immutable after creation
      })
      .where(eq(pricingTiles.id, d.id));

    revalidatePath('/admin/pricing-tiles');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'update',
      entity: 'pricing_tiles',
      entityId: d.id,
      after: { name: d.name, price: d.price },
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[updatePricingTile]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function togglePricingTileActive(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'pricing_tile:edit'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [tile] = await db
      .select({ isActive: pricingTiles.isActive })
      .from(pricingTiles)
      .where(eq(pricingTiles.id, id))
      .limit(1);
    if (!tile) return { ok: false as const, error: 'ไม่พบข้อมูล' };

    await db
      .update(pricingTiles)
      .set({ isActive: !tile.isActive })
      .where(eq(pricingTiles.id, id));

    revalidatePath('/admin/pricing-tiles');
    return { ok: true as const };
  } catch (e) {
    console.error('[togglePricingTileActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function deletePricingTile(id: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'pricing_tile:edit'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  // Check if tile is referenced in any session_guests
  const [usageCheck] = await db
    .select({ id: sessionGuests.id })
    .from(sessionGuests)
    .where(eq(sessionGuests.pricingTileId, id))
    .limit(1);

  if (usageCheck) {
    return {
      ok: false as const,
      error: 'ไม่สามารถลบ tile นี้ได้เนื่องจากมีการใช้งานแล้ว กรุณาปิด active แทน',
    };
  }

  try {
    await db.delete(pricingTiles).where(eq(pricingTiles.id, id));
    revalidatePath('/admin/pricing-tiles');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'delete',
      entity: 'pricing_tiles',
      entityId: id,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[deletePricingTile]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function reorderPricingTiles(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'pricing_tile:reorder'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = reorderTilesSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  try {
    await Promise.all(
      parsed.data.map(({ id, sortOrder }) =>
        db
          .update(pricingTiles)
          .set({ sortOrder })
          .where(eq(pricingTiles.id, id)),
      ),
    );
    revalidatePath('/admin/pricing-tiles');
    return { ok: true as const };
  } catch (e) {
    console.error('[reorderPricingTiles]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
