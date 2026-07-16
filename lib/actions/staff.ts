'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { auth, unstable_update } from '@/auth';
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
        uiLayout: users.uiLayout,
        allowedModules: users.allowedModules,
        navLayout: users.navLayout,
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
    if (existing) return { ok: false as const, error: 'Username นี้ถูกใช้งานแล้ว' };

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [newUser] = await db.insert(users).values({
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      passwordHash,
      uiLayout: parsed.data.uiLayout,
      allowedModules: parsed.data.allowedModules,
      navLayout: parsed.data.navLayout ?? null,
    }).returning({ id: users.id });
    revalidatePath('/users');
    writeAuditLog({
      userId: session.user.id,
      role: session.user.role,
      action: 'create',
      entity: 'users',
      entityId: newUser.id,
      after: {
        email: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role,
        uiLayout: parsed.data.uiLayout,
        allowedModules: parsed.data.allowedModules,
      },
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
    if (dup && dup.id !== id) return { ok: false as const, error: 'Username นี้ถูกใช้งานแล้ว' };

    await db.update(users).set({
      email: data.email,
      name: data.name,
      role: data.role,
      uiLayout: data.uiLayout,
      allowedModules: data.allowedModules,
      navLayout: data.navLayout ?? null,
    }).where(eq(users.id, id));

    const selfUpdated = id === session.user.id;
    if (selfUpdated) {
      await unstable_update({
        user: {
          allowedModules: data.allowedModules ?? [],
          uiLayout: data.uiLayout ?? null,
          navLayout: data.navLayout ?? null,
          name: data.name,
        },
      });
    }

    revalidatePath('/users');
    writeAuditLog({
      userId: session.user.id,
      role: session.user.role,
      action: 'update',
      entity: 'users',
      entityId: id,
      after: { email: data.email, name: data.name, role: data.role, uiLayout: data.uiLayout, allowedModules: data.allowedModules },
    });
    return { ok: true as const, selfUpdated };
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

/** Drizzle wraps DB errors in DrizzleQueryError — the Postgres code lives on .cause */
function pgErrorCode(e: unknown): string | undefined {
  const direct = (e as { code?: string })?.code;
  if (direct) return direct;
  return (e as { cause?: { code?: string } })?.cause?.code;
}

/* History tables that reference users with ON DELETE NO ACTION — a user with
 * rows in any of these must stay (deactivate instead) so reports/audits keep
 * resolving. Keyed by the alias returned from the blocker query below. */
const DELETE_BLOCKER_LABEL: Record<string, string> = {
  payments: 'การรับชำระเงิน',
  payment_rows: 'การรับชำระเงิน',
  shifts: 'กะแคชเชียร์',
  discounts: 'การขออนุมัติส่วนลด',
  adjustments: 'การแก้ไข/ยกเลิกบิล',
  approval_codes: 'รหัสอนุมัติ',
  goods_receipts: 'การรับสินค้าเข้าคลัง',
  purchase_orders: 'ใบสั่งซื้อ',
  payroll: 'รอบเงินเดือน',
  schedules: 'ตารางเวลาทำงาน',
  stock_counts: 'การนับสต๊อก',
  stock_adjustments: 'การปรับยอดสต๊อก',
};

export async function deleteStaff(id: string) {
  const session = await requireManageUsers();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };
  if (id === session.user.id) return { ok: false as const, error: 'ไม่สามารถลบบัญชีตัวเองได้' };
  try {
    const [target] = await db
      .select({ email: users.email, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target) return { ok: false as const, error: 'ไม่พบผู้ใช้' };

    // Check operational history BEFORE touching anything, so we can fail with
    // a specific reason instead of a raw FK violation.
    const blockerResult = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM payments WHERE processed_by = ${id} OR voided_by = ${id}) AS payments,
        EXISTS (SELECT 1 FROM payment_rows WHERE cashier_id = ${id}) AS payment_rows,
        EXISTS (SELECT 1 FROM cashier_shifts WHERE cashier_id = ${id} OR opened_by = ${id} OR closed_by = ${id} OR reviewed_by = ${id}) AS shifts,
        EXISTS (SELECT 1 FROM discount_approvals WHERE requested_by = ${id} OR approved_by = ${id}) AS discounts,
        EXISTS (SELECT 1 FROM payment_adjustments WHERE requested_by = ${id} OR approved_by = ${id}) AS adjustments,
        EXISTS (SELECT 1 FROM manager_approval_codes WHERE generated_by_user_id = ${id} OR used_by_user_id = ${id} OR revoked_by_user_id = ${id}) AS approval_codes,
        EXISTS (SELECT 1 FROM goods_receipts WHERE received_by = ${id}) AS goods_receipts,
        EXISTS (SELECT 1 FROM purchase_orders WHERE created_by = ${id}) AS purchase_orders,
        EXISTS (SELECT 1 FROM payroll_cycles WHERE created_by = ${id}) AS payroll,
        EXISTS (SELECT 1 FROM schedule_cycles WHERE created_by = ${id}) AS schedules,
        EXISTS (SELECT 1 FROM stock_counts WHERE counted_by = ${id}) AS stock_counts,
        EXISTS (SELECT 1 FROM stock_count_adjustments WHERE created_by = ${id}) AS stock_adjustments
    `);
    const flags = (blockerResult.rows?.[0] ?? {}) as Record<string, boolean>;
    const blocked = Object.entries(flags).find(([, v]) => v === true);
    if (blocked) {
      const label = DELETE_BLOCKER_LABEL[blocked[0]] ?? 'การใช้งาน';
      return {
        ok: false as const,
        error: `ลบไม่ได้ — ผู้ใช้นี้มีประวัติ${label}ในระบบ ให้ใช้สวิตช์ "เปิด/ปิด" ในคอลัมน์สถานะเพื่อระงับการใช้งานแทน`,
      };
    }

    // audit_logs.user_id is declared ON DELETE SET NULL in schema.ts but the
    // live DB constraint is NO ACTION — detach explicitly (matches declared
    // intent; log rows themselves are kept untouched).
    await db.execute(sql`UPDATE audit_logs SET user_id = NULL WHERE user_id = ${id}`);
    await db.delete(users).where(eq(users.id, id));

    revalidatePath('/users');
    writeAuditLog({
      userId: session.user.id,
      role: session.user.role,
      action: 'delete',
      entity: 'users',
      entityId: id,
      before: { email: target.email, name: target.name, role: target.role },
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[deleteStaff]', e);
    // Postgres 23503 = foreign_key_violation — a reference the pre-check missed
    if (pgErrorCode(e) === '23503') {
      return {
        ok: false as const,
        error: 'ลบไม่ได้ — ผู้ใช้นี้มีประวัติการทำรายการในระบบ แนะนำให้ปิดการใช้งานแทน',
      };
    }
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
