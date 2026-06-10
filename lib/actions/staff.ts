'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc, ne } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { writeAuditLog } from '@/lib/actions/audit';
import { users } from '@/lib/db/schema';
import {
  createStaffSchema,
  updateStaffSchema,
  resetPasswordSchema,
} from '@/lib/validations/staff';

async function requireManageUsers() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'manage_users')) return null;
  return session;
}

export async function getStaffList() {
  const session = await requireManageUsers();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  try {
    const data = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.role), asc(users.name));
    return { ok: true as const, data };
  } catch (e) {
    console.error('[getStaffList]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type StaffMember = NonNullable<
  Extract<Awaited<ReturnType<typeof getStaffList>>, { ok: true }>['data']
>[number];

export async function createStaff(input: unknown) {
  const session = await requireManageUsers();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  try {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (existing) return { ok: false as const, error: 'อีเมลนี้ถูกใช้งานแล้ว' };

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [newUser] = await db.insert(users).values({
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      passwordHash,
    }).returning({ id: users.id });
    revalidatePath('/users');
    writeAuditLog({
      userId: session.user.id,
      role: session.user.role,
      action: 'create',
      entity: 'users',
      entityId: newUser.id,
      after: { email: parsed.data.email, name: parsed.data.name, role: parsed.data.role },
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[createStaff]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateStaff(input: unknown) {
  const session = await requireManageUsers();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = updateStaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  const { id, ...data } = parsed.data;

  try {
    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
    if (dup && dup.id !== id) return { ok: false as const, error: 'อีเมลนี้ถูกใช้งานแล้ว' };

    await db.update(users).set({ email: data.email, name: data.name, role: data.role }).where(eq(users.id, id));
    revalidatePath('/users');
    writeAuditLog({
      userId: session.user.id,
      role: session.user.role,
      action: 'update',
      entity: 'users',
      entityId: id,
      after: { email: data.email, name: data.name, role: data.role },
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[updateStaff]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function resetStaffPassword(input: unknown) {
  const session = await requireManageUsers();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await db.update(users).set({ passwordHash }).where(eq(users.id, parsed.data.id));
    writeAuditLog({
      userId: session.user.id,
      role: session.user.role,
      action: 'reset_password',
      entity: 'users',
      entityId: parsed.data.id,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[resetStaffPassword]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function deleteStaff(id: string) {
  const session = await requireManageUsers();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  if (id === session.user.id) return { ok: false as const, error: 'ไม่สามารถลบบัญชีตัวเองได้' };
  try {
    await db.delete(users).where(eq(users.id, id));
    revalidatePath('/users');
    writeAuditLog({
      userId: session.user.id,
      role: session.user.role,
      action: 'delete',
      entity: 'users',
      entityId: id,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[deleteStaff]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleStaffActive(id: string) {
  const session = await requireManageUsers();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  if (id === session.user.id) return { ok: false as const, error: 'ไม่สามารถปิดการใช้งานตัวเองได้' };
  try {
    const [user] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) return { ok: false as const, error: 'ไม่พบผู้ใช้' };
    await db.update(users).set({ isActive: !user.isActive }).where(eq(users.id, id));
    revalidatePath('/users');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleStaffActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
