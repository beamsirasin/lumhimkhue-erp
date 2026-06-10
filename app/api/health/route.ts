import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();
  let dbStatus = 'ok';

  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = 'error';
  }

  const latencyMs = Date.now() - start;
  const status = dbStatus === 'ok' ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status,
      database: dbStatus,
      latencyMs,
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? '1.0.0',
      timestamp: new Date().toISOString(),
    },
    { status: status === 'ok' ? 200 : 503 },
  );
}
