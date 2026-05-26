'use server';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { packages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function getTablesWithSessions() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const rows = await db.query.tables.findMany({
    orderBy: (t, { asc }) => [asc(t.number)],
    with: {
      sessions: {
        where: (s, { inArray }) => inArray(s.status, ['active', 'closing']),
        limit: 1,
        orderBy: (s, { desc }) => [desc(s.startedAt)],
        with: { package: true },
      },
    },
  });

  return {
    ok: true as const,
    data: rows.map((row) => {
      const s = row.sessions[0];
      return {
        id: row.id,
        number: row.number,
        capacity: row.capacity,
        zone: row.zone,
        status: row.status,
        qrToken: row.qrToken,
        activeSession: s
          ? {
              id: s.id,
              status: s.status,
              adults: s.adults,
              children: s.children,
              seniors: s.seniors,
              startedAt: s.startedAt,
              endsAt: s.endsAt,
              sessionToken: s.sessionToken,
              package: s.package!,
            }
          : null,
      };
    }),
  };
}

export async function getActivePackages() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };

  const data = await db
    .select()
    .from(packages)
    .where(eq(packages.isActive, true))
    .orderBy(packages.name);

  return { ok: true as const, data };
}

// Inferred types for use in components
export type TableData = NonNullable<
  Extract<Awaited<ReturnType<typeof getTablesWithSessions>>, { ok: true }>['data']
>[number];

export type PackageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getActivePackages>>, { ok: true }>['data']
>[number];
