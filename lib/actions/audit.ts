import { headers } from 'next/headers';
import { after } from 'next/server';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema';
import { notifySensitiveApprovalUse } from '@/lib/notifications/telegram-approval';

interface AuditParams {
  userId: string;
  role: string;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Fire-and-forget audit log write. Never throws; failures are logged to console only. */
export function writeAuditLog(params: AuditParams): void {
  const task = async () => {
    const h = await headers();
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      h.get('x-real-ip') ??
      'unknown';
    await db.insert(auditLogs).values({
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      metadata: {
        role: params.role,
        before: params.before ?? null,
        after: params.after ?? null,
        ip,
      },
    });

    if (params.action === 'sensitive_action_approved_by_code') {
      await notifySensitiveApprovalUse({
        actorUserId: params.userId,
        actorRole: params.role,
        entity: params.entity,
        entityId: params.entityId,
        before: params.before,
        after: params.after,
        occurredAt: new Date(),
      });
    }
  };

  try {
    after(() => task().catch((error) => console.error('[auditLog]', error)));
  } catch {
    void task().catch((error) => console.error('[auditLog]', error));
  }
}
