import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema';

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
  (async () => {
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
  })().catch((e) => console.error('[auditLog]', e));
}
