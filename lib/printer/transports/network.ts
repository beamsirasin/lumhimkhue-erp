/**
 * Network printer transport — client side.
 * Encodes print bytes as base64 and POSTs to /api/print/network,
 * which proxies the data to the printer over TCP.
 *
 * ⚠️  Only works in development (localhost).  In production the API server
 * is in the cloud and cannot reach printers on the local network.
 */

/** Safe base64 encoding — avoids call-stack overflow on large buffers */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function sendNetwork(
  ip: string,
  port: number,
  bytes: Uint8Array,
): Promise<void> {
  const res = await fetch('/api/print/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, port, data: toBase64(bytes) }),
  });

  const result = (await res.json()) as { ok: boolean; error?: string };
  if (!result.ok) {
    throw new Error(result.error ?? 'ส่งข้อมูลไปยัง printer ไม่สำเร็จ');
  }
}
