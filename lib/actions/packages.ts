'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { packages } from '@/lib/db/schema';
import { packageSchema, updatePackageSchema } from '@/lib/validations/packages';

async function requireManagePackages() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_packages')) return null;
  return session;
}

export async function getPackagesCRUD() {
  const session = await requireManagePackages();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const data = await db.select().from(packages).orderBy(asc(packages.priceAdult));
    return { ok: true as const, data };
  } catch (e) {
    console.error('[getPackagesCRUD]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type PackageCRUD = NonNullable<
  Extract<Awaited<ReturnType<typeof getPackagesCRUD>>, { ok: true }>['data']
>[number];

export async function createPackage(input: unknown) {
  if (!await requireManagePackages()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  try {
    await db.insert(packages).values({
      ...parsed.data,
      priceAdult: String(parsed.data.priceAdult),
      priceChild: String(parsed.data.priceChild),
      priceSenior: String(parsed.data.priceSenior),
    });
    revalidatePath('/packages');
    return { ok: true as const };
  } catch (e) {
    console.error('[createPackage]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updatePackage(input: unknown) {
  if (!await requireManagePackages()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = updatePackageSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, ...data } = parsed.data;
  try {
    await db.update(packages).set({
      ...data,
      priceAdult: String(data.priceAdult),
      priceChild: String(data.priceChild),
      priceSenior: String(data.priceSenior),
    }).where(eq(packages.id, id));
    revalidatePath('/packages');
    return { ok: true as const };
  } catch (e) {
    console.error('[updatePackage]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function togglePackageActive(id: string) {
  if (!await requireManagePackages()) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const [pkg] = await db.select({ isActive: packages.isActive }).from(packages).where(eq(packages.id, id)).limit(1);
    if (!pkg) return { ok: false as const, error: 'ไม่พบแพ็กเกจ' };
    await db.update(packages).set({ isActive: !pkg.isActive }).where(eq(packages.id, id));
    revalidatePath('/packages');
    return { ok: true as const };
  } catch (e) {
    console.error('[togglePackageActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
