/**
 * Android POS App / Local Bridge transport.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Vercel hosts the app on cloud servers that cannot reach private LAN printer
 * IPs.  The existing Network transport (/api/print/network) proxies TCP from
 * the Next.js API route to the printer — fine on localhost/dev, broken on Vercel.
 * WebUSB (usb transport) works in Chrome on Android via OTG; keep it supported.
 *
 * For a production Android tablet POS setup where the tablet runs Chrome inside
 * an Android wrapper app, window.AndroidPrinter is injected by the native layer.
 * The webapp sends ESC/POS bytes (base64) + metadata; the Android app drives the
 * physical connection (USB OTG cable OR LAN/WiFi) entirely on-device — Vercel
 * is never involved in the data path to the printer.
 *
 * EXISTING METHODS — DO NOT REMOVE
 * ─────────────────────────────────
 * - USB / OTG (WebUSB) — remains supported; some setups use Chrome + OTG cable
 *   directly without a native wrapper app.
 * - Network — remains supported for localhost/dev and local-agent environments.
 * - Browser — remains supported as a universal fallback.
 */

import type { AndroidBridgeTarget, AndroidPrintPayload } from '../types';

/** Safe base64 encoding — avoids call-stack overflow on large byte arrays */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Returns true when window.AndroidPrinter is available (i.e., the webapp is
 * running inside the Android POS App WebView with the bridge injected).
 */
export function isAndroidBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.AndroidPrinter;
}

/**
 * Send ESC/POS bytes to the Android POS App for local delivery to the printer.
 *
 * Throws with a Thai-language message if window.AndroidPrinter is not present
 * (e.g., the page is opened in a regular browser, not the Android POS App).
 */
export function sendAndroidBridge(
  printerId: string,
  printerName: string,
  target: AndroidBridgeTarget,
  bytes: Uint8Array,
  jobType: AndroidPrintPayload['jobType'],
  paperWidth: 58 | 80,
  host?: string,
  port?: number,
): void {
  if (!isAndroidBridgeAvailable()) {
    throw new Error('ต้องเปิดผ่าน Android POS App เพื่อพิมพ์ด้วยวิธีนี้');
  }

  const payload: AndroidPrintPayload = {
    printerId,
    printerName,
    method: 'android_bridge',
    target,
    paperWidth,
    jobType,
    escposBase64: toBase64(bytes),
    ...(target === 'network' && host ? { host, port: port ?? 9100 } : {}),
  };

  // window.AndroidPrinter is guaranteed non-null by isAndroidBridgeAvailable() above
  window.AndroidPrinter!.print(payload);
}
