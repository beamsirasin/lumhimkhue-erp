/**
 * Network printer relay — connects to a TCP/IP printer on the same LAN.
 *
 * ⚠️  WARNING: This endpoint only works when the server is on the same
 * network as the printer (i.e. during local development or on-premise deploy).
 * On Vercel production the server is in the cloud and CANNOT reach
 * a printer at 192.168.x.x.  Use USB transport in production, or run a
 * local print-bridge server.
 *
 * Future: pull printer IP/port from branch config in DB instead of
 * accepting it from the request body (tracked in Phase 1 plan).
 */

import { NextRequest, NextResponse } from 'next/server';
import net from 'node:net';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { writeAuditLog } from '@/lib/actions/audit';

export const runtime = 'nodejs';

const TIMEOUT_MS = 5_000;
// Raised to 512 KB decoded — bitmap receipts on 80mm paper can exceed 64 KB.
const MAX_DATA_B64_CHARS = Math.ceil((512 * 1024 * 4) / 3);

// Accepts both IPv4 addresses (192.168.1.100) and hostnames (localhost, printer.local)
const IP_OR_HOST = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$|^(\d{1,3}\.){3}\d{1,3}$/;

const printBodySchema = z.object({
  ip: z
    .string()
    .min(1, 'กรุณาระบุ IP หรือ hostname ของ printer')
    .regex(IP_OR_HOST, 'IP หรือ hostname ไม่ถูกต้อง')
    .refine(
      (ip) => {
        // Only validate octet range for IPv4 addresses
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return true;
        return ip.split('.').every((oct) => Number(oct) <= 255);
      },
      'IP ไม่ถูกต้อง (octet เกิน 255)',
    ),
  port: z.number().int().min(1).max(65535).optional().default(9100),
  data: z.string().min(1, 'ข้อมูล ESC/POS ว่างเปล่า').max(MAX_DATA_B64_CHARS, 'ข้อมูลใหญ่เกินไป (เกิน 512 KB)'),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Permission
  if (!can(session.user.role, 'printer:network_print')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  // 3. Validate input
  let body: z.infer<typeof printBodySchema>;
  try {
    const raw = await req.json();
    const result = printBodySchema.safeParse(raw);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
    body = result.data;
  } catch {
    return NextResponse.json({ ok: false, error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 });
  }

  const { ip, port, data } = body;
  const bytes = Buffer.from(data, 'base64');
  const printerId = `${ip}:${port}`;
  const { id: userId, role } = session.user;

  // 4. Connect and write
  return new Promise<NextResponse>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(TIMEOUT_MS);

    socket.connect(port, ip, () => {
      socket.write(bytes, (writeErr) => {
        socket.end();
        if (writeErr) {
          console.error('[print/network] write error:', writeErr.message);
          writeAuditLog({
            userId,
            role,
            action: 'print_bill',
            entity: 'printer',
            entityId: printerId,
            after: { success: false, reason: 'write_error' },
          });
          resolve(
            NextResponse.json(
              { ok: false, error: 'ส่งข้อมูลไปยัง printer ไม่สำเร็จ' },
              { status: 500 },
            ),
          );
        } else {
          writeAuditLog({
            userId,
            role,
            action: 'print_bill',
            entity: 'printer',
            entityId: printerId,
            after: { success: true, bytes: bytes.length },
          });
          resolve(NextResponse.json({ ok: true }));
        }
      });
    });

    socket.on('error', (err) => {
      console.error('[print/network] socket error:', err.message);
      writeAuditLog({
        userId,
        role,
        action: 'print_bill',
        entity: 'printer',
        entityId: printerId,
        after: { success: false, reason: 'connection_error' },
      });
      resolve(
        NextResponse.json(
          { ok: false, error: 'เชื่อมต่อ printer ไม่ได้' },
          { status: 500 },
        ),
      );
    });

    socket.on('timeout', () => {
      socket.destroy();
      writeAuditLog({
        userId,
        role,
        action: 'print_bill',
        entity: 'printer',
        entityId: printerId,
        after: { success: false, reason: 'timeout' },
      });
      resolve(
        NextResponse.json(
          { ok: false, error: 'เชื่อมต่อ printer timeout' },
          { status: 500 },
        ),
      );
    });
  });
}
