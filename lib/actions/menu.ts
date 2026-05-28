'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc, count } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { categories, menuItems } from '@/lib/db/schema';
import {
  createCategorySchema,
  updateCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
} from '@/lib/validations/menu';

async function requireManageMenu() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_menu')) return null;
  return session;
}

export async function getMenuCRUDData() {
  const session = await requireManageMenu();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const cats = await db.query.categories.findMany({
      orderBy: [asc(categories.sortOrder), asc(categories.name)],
      with: {
        menuItems: { orderBy: [asc(menuItems.name)] },
      },
    });
    return { ok: true as const, data: cats };
  } catch (e) {
    console.error('[getMenuCRUDData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type MenuCRUDData = NonNullable<
  Extract<Awaited<ReturnType<typeof getMenuCRUDData>>, { ok: true }>['data']
>;

export async function createCategory(input: unknown) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  try {
    await db.insert(categories).values(parsed.data);
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[createCategory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateCategory(input: unknown) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, ...data } = parsed.data;
  try {
    await db.update(categories).set(data).where(eq(categories.id, id));
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateCategory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleCategoryActive(id: string) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const [cat] = await db.select({ isActive: categories.isActive }).from(categories).where(eq(categories.id, id)).limit(1);
    if (!cat) return { ok: false as const, error: 'ไม่พบหมวด' };
    await db.update(categories).set({ isActive: !cat.isActive }).where(eq(categories.id, id));
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleCategoryActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function createMenuItem(input: unknown) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = createMenuItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  try {
    await db.insert(menuItems).values({
      ...parsed.data,
      nameEn: parsed.data.nameEn ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      extraPrice: String(parsed.data.extraPrice),
      maxPerOrder: parsed.data.maxPerOrder ?? null,
    });
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[createMenuItem]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateMenuItem(input: unknown) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = updateMenuItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, ...data } = parsed.data;
  try {
    await db.update(menuItems).set({
      ...data,
      nameEn: data.nameEn ?? null,
      imageUrl: data.imageUrl ?? null,
      extraPrice: String(data.extraPrice),
      maxPerOrder: data.maxPerOrder ?? null,
    }).where(eq(menuItems.id, id));
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateMenuItem]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function deleteMenuItem(id: string) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    await db.delete(menuItems).where(eq(menuItems.id, id));
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[deleteMenuItem]', e);
    return { ok: false as const, error: 'ไม่สามารถลบได้ (อาจมีออเดอร์ที่เชื่อมอยู่)' };
  }
}

export async function deleteCategory(id: string) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const [{ itemCount }] = await db
      .select({ itemCount: count(menuItems.id) })
      .from(menuItems)
      .where(eq(menuItems.categoryId, id));
    if (itemCount > 0)
      return { ok: false as const, error: `กรุณาลบเมนูทั้ง ${itemCount} รายการในหมวดนี้ก่อน` };
    await db.delete(categories).where(eq(categories.id, id));
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[deleteCategory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleMenuItemAvailable(id: string) {
  if (!await requireManageMenu()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const [item] = await db.select({ isAvailable: menuItems.isAvailable }).from(menuItems).where(eq(menuItems.id, id)).limit(1);
    if (!item) return { ok: false as const, error: 'ไม่พบเมนู' };
    await db.update(menuItems).set({ isAvailable: !item.isAvailable }).where(eq(menuItems.id, id));
    revalidatePath('/menu');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleMenuItemAvailable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
