import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Never expose DB diagnostics in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!can(session.user.role, 'manage_settings')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await db.execute(sql`SELECT 1`);
    samples.push(performance.now() - start);
  }

  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = Math.min(...samples);
  const max = Math.max(...samples);

  return NextResponse.json({
    samples: samples.map((s) => Math.round(s)),
    avg: Math.round(avg),
    min: Math.round(min),
    max: Math.round(max),
    note: 'sample[0] = first query (may include cold start). sample[1-9] = warm RTT.',
  });
}
