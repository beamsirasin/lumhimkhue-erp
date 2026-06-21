/**
 * Print service — public API for the rest of the app.
 *
 * Usage:
 *   import { print } from '@/lib/printer/service';
 *   await print({ type: 'receipt', payment: receiptData });
 *
 * Resolution order:
 *   1. Use printerId if supplied, else load default printer
 *   2. No config → toast error, return { ok: false }
 *   3. USB / Network → ESC/POS bytes
 *   4. Any transport error → toast error, return { ok: false }
 */

import { toast } from 'sonner';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

import { getDefaultPrinter, getPrinter } from './store';
import { buildReceipt, buildTableQr, buildQueueQr, buildKitchenOrder } from './escpos';
import {
  buildBitmapReceipt,
  buildBitmapKitchenOrder,
  buildBitmapQueueQr,
  buildBitmapTableQr,
} from './bitmap';
import { findPairedDevice, sendUSB } from './transports/usb';
import { sendNetwork } from './transports/network';
import { printBrowser } from './transports/browser';
import { sendAndroidBridge, isAndroidBridgeAvailable } from './transports/android-bridge';
import {
  renderReceiptHTML,
  renderTableQrHTML,
  renderQueueQrHTML,
  renderKitchenOrderHTML,
} from './templates';
import type { PrintJob, PrinterConfig } from './types';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type PrintResult = { ok: true } | { ok: false; error: string };

/* ─── Public API ─────────────────────────────────────────────────────────── */

/**
 * Print a job using the specified printer, or the default printer.
 * Returns { ok: false } with a toast on failure — no browser fallback.
 */
export async function print(
  job: PrintJob,
  printerId?: string,
): Promise<PrintResult> {
  const config = printerId
    ? await getPrinter(printerId)
    : await getDefaultPrinter();

  if (!config) {
    toast.error('ไม่พบการตั้งค่าเครื่องพิมพ์ — กรุณาตั้งค่าเครื่องพิมพ์ในหน้า Settings');
    return { ok: false, error: 'ไม่พบการตั้งค่าเครื่องพิมพ์' };
  }

  try {
    if (config.type === 'usb') {
      if (!config.usbVendorId || !config.usbProductId)
        throw new Error('ไม่พบข้อมูล USB (vendorId / productId)');
      const device = await findPairedDevice(config.usbVendorId, config.usbProductId);
      if (!device) throw new Error('ไม่พบ printer USB ที่จับคู่ไว้ กรุณาเสียบสาย OTG');
      const bytes = config.thaiImageMode
        ? await buildBitmapBytes(job, config)
        : buildBytes(job, config);
      console.log('[print] mode:', config.thaiImageMode ? 'BITMAP' : 'ESCPOS', 'bytes:', bytes.length);
      await sendUSB(device, bytes);
      return { ok: true };
    }

    if (config.type === 'network') {
      // NOTE: Vercel cannot access private LAN printer IPs.
      // This transport only works on localhost/dev or with a local relay agent.
      // For production Android tablet POS, use android_bridge instead.
      if (!config.ipAddress) throw new Error('ไม่พบ IP address ของ printer');
      const bytes = config.thaiImageMode
        ? await buildBitmapBytes(job, config)
        : buildBytes(job, config);
      await sendNetwork(config.ipAddress, config.port ?? 9100, bytes);
      return { ok: true };
    }

    if (config.type === 'android_bridge') {
      // The Android POS App injects window.AndroidPrinter into the WebView.
      // ESC/POS bytes are sent to the app, which forwards them to the printer
      // over USB OTG or LAN/WiFi locally — no Vercel server involved.
      if (!isAndroidBridgeAvailable()) {
        throw new Error('ต้องเปิดผ่าน Android POS App เพื่อพิมพ์ด้วยวิธีนี้');
      }
      const bytes = config.thaiImageMode
        ? await buildBitmapBytes(job, config)
        : buildBytes(job, config);
      sendAndroidBridge(
        config.id,
        config.name,
        config.androidTarget ?? 'usb_otg',
        bytes,
        job.type,
        config.paperWidth,
        config.ipAddress,
        config.port,
      );
      return { ok: true };
    }

    // type === 'browser'
    return printViaBrowser(job);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'พิมพ์ไม่สำเร็จ';
    toast.error(msg);
    return { ok: false, error: msg };
  }
}

/* ─── Test print ─────────────────────────────────────────────────────────── */

/**
 * Print only Thai characters to verify the Thai codepage setting is correct.
 */
export async function testThaiCodepage(config: PrinterConfig): Promise<PrintResult> {
  if (config.type === 'browser') {
    printBrowser(`
      <div class="center big">ทดสอบภาษาไทย</div>
      <hr />
      <div class="center">กขคงจฉชซญดตถทนบปผฝพฟภมยรลวสหอฮ</div>
      <div class="center">อักขระพิเศษ: ฿ ๐๑๒๓๔๕๖๗๘๙</div>
      <div class="center">ไก่จิกเด็กตายบนปากโอ่ง</div>
      <hr />
      <div class="center small">Codepage หน้า ${config.thaiCodepage}</div>
    `);
    return { ok: true };
  }

  try {
    const cols = config.paperWidth === 80 ? 48 : 32;
    const sep = '-'.repeat(cols);
    const cp = config.thaiCodepage ?? 21;

    // Use the correct Thai codepage name matching the page number
    const cpName = cp === 20 ? 'thai42' : cp === 21 ? 'thai11' : cp === 27 ? 'thai13' : 'cp874';

    const { default: ReceiptPrinterEncoder } = await import('@point-of-sale/receipt-printer-encoder');
    const bytes = new ReceiptPrinterEncoder({
      language: 'esc-pos',
      columns: cols,
      errors: 'relaxed',
      codepageMapping: { [cpName]: cp } as unknown as string,
    })
      .initialize()
      .codepage(cpName)
      .align('center')
      .bold(true).line('ทดสอบ Codepage ภาษาไทย').bold(false)
      .line(sep)
      .line('กขคงจฉชซญดตถทนบปผฝพฟภมยรลวสหอฮ')
      .line('ฤฦฯ ะ า ิ ี ึ ื ุ ู')
      .line('เแโใไ ็่้๊๋์ํ๎')
      .line('฿ ๐๑๒๓๔๕๖๗๘๙')
      .line(sep)
      .align('left')
      .line(`Codepage: หน้า ${cp}`)
      .line('ถ้าอ่านได้ — ตั้งค่าถูกต้องแล้ว')
      .line('ถ้าเป็นตัวแปลก — ลองเปลี่ยนหน้า')
      .newline(3)
      .cut('partial')
      .encode();

    if (config.type === 'usb') {
      const { findPairedDevice, sendUSB } = await import('./transports/usb');
      if (!config.usbVendorId || !config.usbProductId) throw new Error('ไม่พบข้อมูล USB');
      const device = await findPairedDevice(config.usbVendorId, config.usbProductId);
      if (!device) throw new Error('ไม่พบ printer USB');
      await sendUSB(device, bytes);
    } else if (config.type === 'android_bridge') {
      sendAndroidBridge(
        config.id, config.name,
        config.androidTarget ?? 'usb_otg',
        bytes, 'test', config.paperWidth,
        config.ipAddress, config.port,
      );
    } else {
      const { sendNetwork } = await import('./transports/network');
      if (!config.ipAddress) throw new Error('ไม่พบ IP address');
      await sendNetwork(config.ipAddress, config.port ?? 9100, bytes);
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'ทดสอบไม่สำเร็จ';
    return { ok: false, error };
  }
}

/**
 * Print a byte map: shows every byte 0xA0–0xFF on the printer at the configured
 * Thai page, labelled with its hex value.  Use this to identify where vowels and
 * tone marks actually live in the printer's character table.
 */
export async function printByteMap(config: PrinterConfig): Promise<PrintResult> {
  if (config.type === 'browser') {
    return { ok: false, error: 'Byte map ใช้ได้เฉพาะ USB / Network / Android Bridge' };
  }

  try {
    const cp = config.thaiCodepage ?? 21;
    const cols = config.paperWidth === 80 ? 48 : 32;
    const colsPerRow = 8;

    // Build raw ESC/POS bytes manually — bypass the encoder's charset conversion
    // so we can send exact byte values without any Unicode re-encoding.
    const cmds: number[] = [];

    // ESC @ — initialize
    cmds.push(0x1B, 0x40);
    // ESC t <page> — select Thai codepage
    cmds.push(0x1B, 0x74, cp);

    // Header
    const header = `Byte map  page ${cp}\n`;
    for (const c of header) cmds.push(c.charCodeAt(0));
    cmds.push(...Array.from('-'.repeat(cols)).map(c => c.charCodeAt(0)), 0x0A);

    // Print rows of 8 bytes: "A0:[char] A1:[char] ..."
    for (let base = 0xA0; base <= 0xF0; base += colsPerRow) {
      // Label row: "A0 A1 A2 ..."
      let label = '';
      for (let i = 0; i < colsPerRow && base + i <= 0xFF; i++) {
        label += (base + i).toString(16).toUpperCase().padStart(2, '0') + ' ';
      }
      for (const c of label.trimEnd() + '\n') cmds.push(c.charCodeAt(0));

      // Character row: send actual bytes
      for (let i = 0; i < colsPerRow && base + i <= 0xFF; i++) {
        cmds.push(base + i, 0x20, 0x20); // byte + 2 spaces
      }
      cmds.push(0x0A, 0x0A); // blank line between rows

      if ((base - 0xA0) % 0x20 === 0x10) {
        cmds.push(...Array.from('-'.repeat(Math.min(cols, 24))).map(c => c.charCodeAt(0)), 0x0A);
      }
    }

    // Feed and cut
    cmds.push(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x01);

    const bytes = new Uint8Array(cmds);

    if (config.type === 'usb') {
      const { findPairedDevice, sendUSB } = await import('./transports/usb');
      if (!config.usbVendorId || !config.usbProductId) throw new Error('ไม่พบข้อมูล USB');
      const device = await findPairedDevice(config.usbVendorId, config.usbProductId);
      if (!device) throw new Error('ไม่พบ printer USB');
      await sendUSB(device, bytes);
    } else if (config.type === 'android_bridge') {
      sendAndroidBridge(
        config.id, config.name,
        config.androidTarget ?? 'usb_otg',
        bytes, 'test', config.paperWidth,
        config.ipAddress, config.port,
      );
    } else {
      const { sendNetwork } = await import('./transports/network');
      if (!config.ipAddress) throw new Error('ไม่พบ IP address');
      await sendNetwork(config.ipAddress, config.port ?? 9100, bytes);
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'ทดสอบไม่สำเร็จ';
    return { ok: false, error };
  }
}

/**
 * Send a test-print to verify a printer config works.
 * Respects thaiImageMode — uses bitmap when enabled, text mode otherwise.
 */
export async function testPrint(config: PrinterConfig): Promise<PrintResult> {
  const now = new Date().toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  });

  if (config.type === 'browser') {
    printBrowser(`
      <div class="center big">ทดสอบการพิมพ์</div>
      <hr />
      <div class="center">Test Print</div>
      <div class="center">${now}</div>
      <div class="center">${config.name}</div>
      <hr />
      <div class="center">✓ พิมพ์ได้ปกติ</div>
    `);
    return { ok: true };
  }

  try {
    let bytes: Uint8Array;

    if (config.thaiImageMode) {
      // Bitmap mode — same path as real printing, Thai text rendered by browser
      bytes = await buildBitmapReceipt({
        receiptType: 'bill',
        shopNameTh: 'ทดสอบการพิมพ์',
        tableNumber: 'Test',
        cashierName: config.name,
        paidAt: now,
        sessionId: 'test',
        items: [
          { name: 'ทดสอบภาษาไทย กขคงจฉชซ', quantity: 1, total: 99 },
          { name: 'สระ อา อิ อี อู เอ แอ โอ', quantity: 1, total: 99 },
        ],
        subtotal: 198,
        discount: 0,
        serviceCharge: 0,
        total: 198,
        receivedAmount: 0,
        changeAmount: 0,
        paymentMethod: 'Bitmap Mode ✓',
      }, config.paperWidth);
    } else {
      // Text mode with Thai codepage
      const cols = config.paperWidth === 80 ? 48 : 32;
      const sep  = '-'.repeat(cols);
      const cp   = config.thaiCodepage ?? 21;
      const cpName = cp === 20 ? 'thai42' : cp === 21 ? 'thai11' : cp === 27 ? 'thai13' : 'cp874';
      bytes = new ReceiptPrinterEncoder({
        language: 'esc-pos',
        columns: cols,
        errors: 'relaxed',
        codepageMapping: { [cpName]: cp } as unknown as string,
      })
        .initialize()
        .codepage(cpName)
        .align('center')
        .bold(true).line('ทดสอบการพิมพ์').bold(false)
        .line('Test Print')
        .line(now)
        .line(sep)
        .line(config.name)
        .line(sep)
        .line('Printer OK')
        .newline(3)
        .cut('partial')
        .encode();
    }

    if (config.type === 'usb') {
      if (!config.usbVendorId || !config.usbProductId) throw new Error('ไม่พบข้อมูล USB');
      const device = await findPairedDevice(config.usbVendorId, config.usbProductId);
      if (!device) throw new Error('ไม่พบ printer USB');
      await sendUSB(device, bytes);
    } else if (config.type === 'android_bridge') {
      sendAndroidBridge(
        config.id, config.name,
        config.androidTarget ?? 'usb_otg',
        bytes, 'test', config.paperWidth,
        config.ipAddress, config.port,
      );
    } else {
      if (!config.ipAddress) throw new Error('ไม่พบ IP address');
      await sendNetwork(config.ipAddress, config.port ?? 9100, bytes);
    }

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'ทดสอบไม่สำเร็จ';
    return { ok: false, error };
  }
}

/* ─── Internals ──────────────────────────────────────────────────────────── */

function buildBytes(job: PrintJob, config: PrinterConfig): Uint8Array {
  const w = config.paperWidth;
  const cp = config.thaiCodepage ?? 21;
  switch (job.type) {
    case 'receipt':       return buildReceipt(job.payment, w, cp);
    case 'table_qr':      return buildTableQr(job.table, w, cp);
    case 'queue_qr':      return buildQueueQr(job.queueEntry, w, cp);
    case 'kitchen_order': return buildKitchenOrder(job.order, w, cp);
  }
}

async function buildBitmapBytes(job: PrintJob, config: PrinterConfig): Promise<Uint8Array> {
  const w = config.paperWidth;
  switch (job.type) {
    case 'receipt':       return buildBitmapReceipt(job.payment, w);
    case 'kitchen_order': return buildBitmapKitchenOrder(job.order, w);
    case 'queue_qr':      return buildBitmapQueueQr(job.queueEntry, w);
    case 'table_qr':      return buildBitmapTableQr(job.table, w);
  }
}

async function printViaBrowser(job: PrintJob): Promise<PrintResult> {
  try {
    let html: string;
    switch (job.type) {
      case 'receipt':       html = await renderReceiptHTML(job.payment);    break;
      case 'table_qr':      html = await renderTableQrHTML(job.table);      break;
      case 'queue_qr':      html = await renderQueueQrHTML(job.queueEntry); break;
      case 'kitchen_order': html = await renderKitchenOrderHTML(job.order); break;
    }
    const paperWidth = job.type === 'receipt' ? (job.payment.paperWidth ?? 80) : 80;
    printBrowser(html, paperWidth);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'พิมพ์ไม่สำเร็จ';
    return { ok: false, error };
  }
}
