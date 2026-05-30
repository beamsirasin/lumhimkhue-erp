import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
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
