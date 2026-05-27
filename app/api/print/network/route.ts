/**
 * Network printer relay — connects to a TCP/IP printer on the same LAN.
 *
 * ⚠️  WARNING: This endpoint only works when the server is on the same
 * network as the printer (i.e. during local development).
 * On Vercel production the server is in the cloud and CANNOT reach
 * a printer at 192.168.x.x.  Use USB transport in production, or run a
 * local print-bridge server.
 */

import { NextRequest, NextResponse } from 'next/server';
import net from 'node:net';

export const runtime = 'nodejs';

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const TIMEOUT_MS = 5_000;

function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { ip: unknown; port: unknown; data: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { ip, port, data } = body;

  if (typeof ip !== 'string' || !IP_RE.test(ip)) {
    return NextResponse.json({ ok: false, error: 'IP ไม่ถูกต้อง' }, { status: 400 });
  }
  if (typeof data !== 'string') {
    return NextResponse.json({ ok: false, error: 'ข้อมูล base64 ไม่ถูกต้อง' }, { status: 400 });
  }

  const targetPort = typeof port === 'number' ? port : 9100;
  const bytes = base64ToBuffer(data);

  return new Promise<NextResponse>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(TIMEOUT_MS);

    socket.connect(targetPort, ip, () => {
      socket.write(bytes, (err) => {
        socket.end();
        if (err) {
          resolve(
            NextResponse.json({ ok: false, error: err.message }, { status: 500 }),
          );
        } else {
          resolve(NextResponse.json({ ok: true }));
        }
      });
    });

    socket.on('error', (err) => {
      resolve(
        NextResponse.json({ ok: false, error: `เชื่อมต่อไม่ได้: ${err.message}` }, { status: 500 }),
      );
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(
        NextResponse.json({ ok: false, error: 'เชื่อมต่อ printer timeout' }, { status: 500 }),
      );
    });
  });
}
