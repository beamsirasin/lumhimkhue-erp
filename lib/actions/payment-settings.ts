'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, ne } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import {
  paymentMethodAccounts,
  paymentMethods,
  receivingAccounts,
} from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/actions/audit';
import { ensureDefaultPaymentFoundation } from '@/lib/payments/foundation';
import {
  createPaymentMethodSchema,
  setDefaultReceivingAccountSchema,
  togglePaymentMethodSchema,
  toggleReceivingAccountSchema,
  updateMethodAccountMappingsSchema,
  updatePaymentMethodSchema,
  updateReceivingAccountSchema,
  createReceivingAccountSchema,
} from '@/lib/validations/payment-settings';

const SETTINGS_PATH = '/payment-settings';

async function requirePaymentSettingsUser() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'Please sign in' };
  if (!can(session.user.role, 'payment_settings:manage')) {
    return { ok: false as const, error: 'You do not have permission to manage payment settings' };
  }
  return { ok: true as const, user: session.user };
}

function uniqueError(e: unknown) {
  return e instanceof Error && e.message.toLowerCase().includes('unique')
    ? 'Code already exists'
    : 'Unable to save payment settings';
}

function isAllowedMethodAccount(methodType: string, accountType: string) {
  if (methodType === 'welfare') return accountType === 'welfare';
  if (methodType === 'promptpay' || methodType === 'cash') return accountType === 'bank_cash_group';
  if (methodType === 'mixed_legacy') return accountType === 'other';
  return accountType !== 'welfare';
}

async function getMethodAndAccount(paymentMethodId: string, receivingAccountId: string) {
  const [[method], [account]] = await Promise.all([
    db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethodId)).limit(1),
    db.select().from(receivingAccounts).where(eq(receivingAccounts.id, receivingAccountId)).limit(1),
  ]);
  return { method, account };
}

async function ensureActiveDefault(paymentMethodId: string) {
  const activeDefaults = await db
    .select({ id: paymentMethodAccounts.id })
    .from(paymentMethodAccounts)
    .where(
      and(
        eq(paymentMethodAccounts.paymentMethodId, paymentMethodId),
        eq(paymentMethodAccounts.isActive, true),
        eq(paymentMethodAccounts.isDefault, true),
      ),
    )
    .limit(1);
  return activeDefaults.length > 0;
}

export async function getPaymentSettings() {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;

  try {
    await ensureDefaultPaymentFoundation();
    const [methods, accounts, mappings] = await Promise.all([
      db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.name)),
      db.select().from(receivingAccounts).orderBy(asc(receivingAccounts.sortOrder), asc(receivingAccounts.name)),
      db
        .select()
        .from(paymentMethodAccounts)
        .orderBy(asc(paymentMethodAccounts.createdAt)),
    ]);

    return { ok: true as const, data: { methods, accounts, mappings } };
  } catch (e) {
    console.error('[getPaymentSettings]', e);
    return { ok: false as const, error: 'Unable to load payment settings' };
  }
}

export type PaymentSettingsData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPaymentSettings>>, { ok: true }>['data']
>;

export async function createPaymentMethod(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = createPaymentMethodSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid data' };

  try {
    const d = parsed.data;
    const [row] = await db.insert(paymentMethods).values({
      code: d.code,
      name: d.name,
      type: d.type,
      requiresReference: d.requiresReference,
      allowOverpay: d.allowOverpay,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
    }).returning();

    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'create_payment_method',
      entity: 'payment_methods',
      entityId: row.id,
      after: row,
    });
    return { ok: true as const, data: row };
  } catch (e) {
    console.error('[createPaymentMethod]', e);
    return { ok: false as const, error: uniqueError(e) };
  }
}

export async function updatePaymentMethod(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = updatePaymentMethodSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid data' };

  try {
    const d = parsed.data;
    const [before] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, d.id)).limit(1);
    if (!before) return { ok: false as const, error: 'Payment method not found' };

    const [duplicate] = await db
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.code, d.code), ne(paymentMethods.id, d.id)))
      .limit(1);
    if (duplicate) return { ok: false as const, error: 'Code already exists' };

    const [after] = await db.update(paymentMethods).set({
      code: d.code,
      name: d.name,
      type: d.type,
      requiresReference: d.requiresReference,
      allowOverpay: d.allowOverpay,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
      updatedAt: new Date(),
    }).where(eq(paymentMethods.id, d.id)).returning();

    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'update_payment_method',
      entity: 'payment_methods',
      entityId: d.id,
      before,
      after,
    });
    return { ok: true as const, data: after };
  } catch (e) {
    console.error('[updatePaymentMethod]', e);
    return { ok: false as const, error: uniqueError(e) };
  }
}

export async function togglePaymentMethodActive(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = togglePaymentMethodSchema.safeParse(typeof input === 'string' ? { id: input } : input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid payment method' };

  try {
    const [before] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, parsed.data.id)).limit(1);
    if (!before) return { ok: false as const, error: 'Payment method not found' };
    if (!before.isActive && !(await ensureActiveDefault(before.id))) {
      return { ok: false as const, error: 'Set an active default account before enabling this method' };
    }

    const [after] = await db.update(paymentMethods).set({
      isActive: !before.isActive,
      updatedAt: new Date(),
    }).where(eq(paymentMethods.id, before.id)).returning();

    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'toggle_payment_method',
      entity: 'payment_methods',
      entityId: before.id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    });
    return { ok: true as const, data: after };
  } catch (e) {
    console.error('[togglePaymentMethodActive]', e);
    return { ok: false as const, error: 'Unable to update payment method' };
  }
}

export async function createReceivingAccount(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = createReceivingAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid data' };

  try {
    const d = parsed.data;
    const [row] = await db.insert(receivingAccounts).values({
      code: d.code,
      name: d.name,
      type: d.type,
      bankName: d.bankName || null,
      accountLabel: d.accountLabel || null,
      accountLast4: d.accountLast4 || null,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
    }).returning();

    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'create_receiving_account',
      entity: 'receiving_accounts',
      entityId: row.id,
      after: row,
    });
    return { ok: true as const, data: row };
  } catch (e) {
    console.error('[createReceivingAccount]', e);
    return { ok: false as const, error: uniqueError(e) };
  }
}

export async function updateReceivingAccount(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = updateReceivingAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid data' };

  try {
    const d = parsed.data;
    const [before] = await db.select().from(receivingAccounts).where(eq(receivingAccounts.id, d.id)).limit(1);
    if (!before) return { ok: false as const, error: 'Receiving account not found' };

    const [duplicate] = await db
      .select({ id: receivingAccounts.id })
      .from(receivingAccounts)
      .where(and(eq(receivingAccounts.code, d.code), ne(receivingAccounts.id, d.id)))
      .limit(1);
    if (duplicate) return { ok: false as const, error: 'Code already exists' };

    const [after] = await db.update(receivingAccounts).set({
      code: d.code,
      name: d.name,
      type: d.type,
      bankName: d.bankName || null,
      accountLabel: d.accountLabel || null,
      accountLast4: d.accountLast4 || null,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
      updatedAt: new Date(),
    }).where(eq(receivingAccounts.id, d.id)).returning();

    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'update_receiving_account',
      entity: 'receiving_accounts',
      entityId: d.id,
      before,
      after,
    });
    return { ok: true as const, data: after };
  } catch (e) {
    console.error('[updateReceivingAccount]', e);
    return { ok: false as const, error: uniqueError(e) };
  }
}

export async function toggleReceivingAccountActive(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = toggleReceivingAccountSchema.safeParse(typeof input === 'string' ? { id: input } : input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid receiving account' };

  try {
    const [before] = await db.select().from(receivingAccounts).where(eq(receivingAccounts.id, parsed.data.id)).limit(1);
    if (!before) return { ok: false as const, error: 'Receiving account not found' };

    if (before.isActive) {
      const defaultMappings = await db
        .select({ paymentMethodId: paymentMethodAccounts.paymentMethodId })
        .from(paymentMethodAccounts)
        .where(
          and(
            eq(paymentMethodAccounts.receivingAccountId, before.id),
            eq(paymentMethodAccounts.isActive, true),
            eq(paymentMethodAccounts.isDefault, true),
          ),
        );
      for (const mapping of defaultMappings) {
        const alternatives = await db
          .select({ id: paymentMethodAccounts.id })
          .from(paymentMethodAccounts)
          .innerJoin(receivingAccounts, eq(receivingAccounts.id, paymentMethodAccounts.receivingAccountId))
          .where(
            and(
              eq(paymentMethodAccounts.paymentMethodId, mapping.paymentMethodId),
              eq(paymentMethodAccounts.isActive, true),
              eq(receivingAccounts.isActive, true),
              ne(paymentMethodAccounts.receivingAccountId, before.id),
            ),
          )
          .limit(1);
        if (alternatives.length === 0) {
          return { ok: false as const, error: 'Set another active default before disabling this account' };
        }
      }
    }

    const [after] = await db.update(receivingAccounts).set({
      isActive: !before.isActive,
      updatedAt: new Date(),
    }).where(eq(receivingAccounts.id, before.id)).returning();

    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'toggle_receiving_account',
      entity: 'receiving_accounts',
      entityId: before.id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    });
    return { ok: true as const, data: after };
  } catch (e) {
    console.error('[toggleReceivingAccountActive]', e);
    return { ok: false as const, error: 'Unable to update receiving account' };
  }
}

export async function updateMethodAccountMappings(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = updateMethodAccountMappingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid data' };

  try {
    const { paymentMethodId, mappings } = parsed.data;
    const [method] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethodId)).limit(1);
    if (!method) return { ok: false as const, error: 'Payment method not found' };

    const activeDefaults = mappings.filter((m) => m.isActive && m.isDefault);
    if (method.isActive && activeDefaults.length !== 1) {
      return { ok: false as const, error: 'Active methods need exactly one active default account' };
    }

    const before = await db.select().from(paymentMethodAccounts).where(eq(paymentMethodAccounts.paymentMethodId, paymentMethodId));

    for (const mapping of mappings) {
      const { account } = await getMethodAndAccount(paymentMethodId, mapping.receivingAccountId);
      if (!account) return { ok: false as const, error: 'Receiving account not found' };
      if (!isAllowedMethodAccount(method.type, account.type)) {
        return { ok: false as const, error: `${method.name} cannot map to ${account.name}` };
      }
    }

    if (activeDefaults.length === 1) {
      await db.update(paymentMethodAccounts).set({
        isDefault: false,
        updatedAt: new Date(),
      }).where(eq(paymentMethodAccounts.paymentMethodId, paymentMethodId));
    }

    for (const mapping of mappings) {
      await db.insert(paymentMethodAccounts).values({
        paymentMethodId,
        receivingAccountId: mapping.receivingAccountId,
        isDefault: mapping.isDefault,
        isActive: mapping.isActive,
      }).onConflictDoUpdate({
        target: [paymentMethodAccounts.paymentMethodId, paymentMethodAccounts.receivingAccountId],
        set: {
          isDefault: mapping.isDefault,
          isActive: mapping.isActive,
          updatedAt: new Date(),
        },
      });
    }

    const after = await db.select().from(paymentMethodAccounts).where(eq(paymentMethodAccounts.paymentMethodId, paymentMethodId));
    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'update_payment_mapping',
      entity: 'payment_method_accounts',
      entityId: paymentMethodId,
      before,
      after,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[updateMethodAccountMappings]', e);
    return { ok: false as const, error: 'Unable to update mappings' };
  }
}

export async function setDefaultReceivingAccount(input: unknown) {
  const guard = await requirePaymentSettingsUser();
  if (!guard.ok) return guard;
  const parsed = setDefaultReceivingAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid default account' };

  try {
    const { paymentMethodId, receivingAccountId } = parsed.data;
    const { method, account } = await getMethodAndAccount(paymentMethodId, receivingAccountId);
    if (!method || !account) return { ok: false as const, error: 'Method or account not found' };
    if (!isAllowedMethodAccount(method.type, account.type)) {
      return { ok: false as const, error: `${method.name} cannot map to ${account.name}` };
    }
    if (!method.isActive || !account.isActive) {
      return { ok: false as const, error: 'Default requires active method and active account' };
    }

    const before = await db.select().from(paymentMethodAccounts).where(eq(paymentMethodAccounts.paymentMethodId, paymentMethodId));
    await db.update(paymentMethodAccounts).set({
      isDefault: false,
      updatedAt: new Date(),
    }).where(eq(paymentMethodAccounts.paymentMethodId, paymentMethodId));
    await db.insert(paymentMethodAccounts).values({
      paymentMethodId,
      receivingAccountId,
      isDefault: true,
      isActive: true,
    }).onConflictDoUpdate({
      target: [paymentMethodAccounts.paymentMethodId, paymentMethodAccounts.receivingAccountId],
      set: { isDefault: true, isActive: true, updatedAt: new Date() },
    });
    const after = await db.select().from(paymentMethodAccounts).where(eq(paymentMethodAccounts.paymentMethodId, paymentMethodId));

    revalidatePath(SETTINGS_PATH);
    writeAuditLog({
      userId: guard.user.id,
      role: guard.user.role,
      action: 'set_default_receiving_account',
      entity: 'payment_method_accounts',
      entityId: paymentMethodId,
      before,
      after,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[setDefaultReceivingAccount]', e);
    return { ok: false as const, error: 'Unable to set default account' };
  }
}
