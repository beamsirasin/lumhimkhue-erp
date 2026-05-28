/**
 * Print service — public API for the rest of the app.
 *
 * Usage:
 *   import { print } from '@/lib/printer/service';
 *   await print({ type: 'receipt', payment: receiptData });
 *
 * Resolution order:
 *   1. Use printerId if supplied, else load default printer
 *   2. No config → browser fallback (window.print)
 *   3. USB / Network → ESC/POS bytes
 *   4. Any transport error → toast + automatic browser fallback
 */

import { toast } from 'sonner';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

import { getDefaultPrinter, getPrinter } from './store';
import { buildReceipt, buildTableQr, buildQueueQr, buildKitchenOrder } from './escpos';
import { findPairedDevice, sendUSB } from './transports/usb';
import { sendNetwork } from './transports/network';
import { printBrowser } from './transports/browser';
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
 * Falls back to browser print silently on transport failure.
 */
export async function print(
  job: PrintJob,
  printerId?: string,
): Promise<PrintResult> {
  const config = printerId
    ? await getPrinter(printerId)
    : await getDefaultPrinter();

  // No printer configured → go straight to browser
  if (!config) {
    return printViaBrowser(job);
  }

  try {
    if (config.type === 'usb') {
      const bytes = buildBytes(job, config);

      if (!config.usbVendorId || !config.usbProductId) {
        throw new Error('ไม่พบข้อมูล USB (vendorId / productId)');
      }
      const device = await findPairedDevice(config.usbVendorId, config.usbProductId);
      if (!device) throw new Error('ไม่พบ printer USB ที่จับคู่ไว้ กรุณาเสียบสาย OTG');

      await sendUSB(device, bytes);
      return { ok: true };
    }

    if (config.type === 'network') {
      if (!config.ipAddress) throw new Error('ไม่พบ IP address ของ printer');
      const bytes = buildBytes(job, config);
      await sendNetwork(config.ipAddress, config.port ?? 9100, bytes);
      return { ok: true };
    }

    // type === 'browser'
    return printViaBrowser(job);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'พิมพ์ไม่สำเร็จ';
    toast.error(`${msg} — ใช้การพิมพ์ผ่าน Browser แทน`);
    return printViaBrowser(job);
  }
}

/* ─── Test print ─────────────────────────────────────────────────────────── */

/**
 * Send a test-print to verify a printer config works.
 * Uses ESC/POS for USB/Network, browser print for browser type.
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
    const cols = config.paperWidth === 80 ? 48 : 32;
    const sep = '-'.repeat(cols);

    const cp = config.thaiCodepage ?? 21;
    const bytes = new ReceiptPrinterEncoder({
      language: 'esc-pos',
      columns: cols,
      errors: 'relaxed',
      codepageMapping: { cp874: cp } as unknown as string,
    })
      .initialize()
      .codepage('cp874')
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

    if (config.type === 'usb') {
      if (!config.usbVendorId || !config.usbProductId) {
        throw new Error('ไม่พบข้อมูล USB');
      }
      const device = await findPairedDevice(config.usbVendorId, config.usbProductId);
      if (!device) throw new Error('ไม่พบ printer USB');
      await sendUSB(device, bytes);
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

async function printViaBrowser(job: PrintJob): Promise<PrintResult> {
  try {
    let html: string;
    switch (job.type) {
      case 'receipt':       html = await renderReceiptHTML(job.payment);    break;
      case 'table_qr':      html = await renderTableQrHTML(job.table);      break;
      case 'queue_qr':      html = await renderQueueQrHTML(job.queueEntry); break;
      case 'kitchen_order': html = await renderKitchenOrderHTML(job.order); break;
    }
    printBrowser(html);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'พิมพ์ไม่สำเร็จ';
    return { ok: false, error };
  }
}
