'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { branches } from '@/lib/db/schema';

const branchSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  taxId: z.string().max(20).optional().nullable(),
  isActive: z.boolean().default(true),
});

async function requireOwner() {
  const s = await auth();
  if (!s?.user || s.user.role !== 'owner') return null;
  return s;
}

export async function getBranches() {
  const s = await auth();
  if (!s?.user) return { ok: false as const, error: 'ไม่มีสิทธิ์' };

  try {
    const rows = await db.select().from(branches).orderBy(branches.name);
    return { ok: true as const, data: rows };
  } catch (e) {
    console.error('[getBranches]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function createBranch(input: unknown) {
  if (!await requireOwner()) return { ok: false as const, error: 'เฉพาะเจ้าของร้านเท่านั้น' };

  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  try {
    const [created] = await db.insert(branches).values({
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      phone: parsed.data.phone ?? null,
      taxId: parsed.data.taxId ?? null,
      isActive: parsed.data.isActive,
    }).returning();
    revalidatePath('/branches');
    return { ok: true as const, data: created };
  } catch (e) {
    console.error('[createBranch]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateBranch(id: string, input: unknown) {
  if (!await requireOwner()) return { ok: false as const, error: 'เฉพาะเจ้าของร้านเท่านั้น' };

  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  try {
    await db.update(branches).set({
      ...parsed.data,
      address: parsed.data.address ?? null,
      phone: parsed.data.phone ?? null,
      taxId: parsed.data.taxId ?? null,
      updatedAt: new Date(),
    }).where(eq(branches.id, id));
    revalidatePath('/branches');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateBranch]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleBranchActive(id: string, isActive: boolean) {
  if (!await requireOwner()) return { ok: false as const, error: 'เฉพาะเจ้าของร้านเท่านั้น' };

  try {
    await db.update(branches).set({ isActive, updatedAt: new Date() }).where(eq(branches.id, id));
    revalidatePath('/branches');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleBranchActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
