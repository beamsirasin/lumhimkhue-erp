/**
 * ESC/POS command builders.
 *
 * Thai text note: printers that support cp874 (Thai) will render Thai
 * correctly.  On printers without a Thai codepage the encoder silently drops
 * unsupported characters (errors:'relaxed').  The browser-print fallback always
 * renders Thai perfectly via HTML/CSS.
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import type { ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

/* ─── Constants ─────────────────────────────────────────────────────────── */

/** Characters per line per paper width at font A */
const COLS: Record<58 | 80, number> = { 58: 32, 80: 48 };

const STATION_LABEL: Record<string, string> = {
  meat:      'เนื้อสัตว์',
  seafood:   'ทะเล',
  vegetable: 'ผัก',
  noodle:    'เส้น',
  dessert:   'ของหวาน',
  drink:     'เครื่องดื่ม',
  sauce:     'ซอส',
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Map ESC/POS page number to the library's internal Thai codepage name.
 * Each variant has a different byte layout for vowels/tone marks — using
 * the correct name ensures the encoder encodes characters to the right bytes.
 *
 * Epson mapping (also used by Xprinter and many generics):
 *   Page 20 = thai42, Page 21 = thai11, Page 27 = thai13
 * Star:
 *   Page 12-15 = star/cp874 (standard TIS-620)
 */
function getThaiCpName(page: number): string {
  switch (page) {
    case 20: return 'thai42';
    case 21: return 'thai11';
    case 27: return 'thai13';
    default: return 'cp874';
  }
}

function makeEncoder(paperWidth: 58 | 80, thaiCodepage: number): ReceiptPrinterEncoder {
  const cpName = getThaiCpName(thaiCodepage);
  return new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns: COLS[paperWidth],
    imageMode: 'raster',
    errors: 'relaxed',
    // Map the correct Thai codepage name to the printer's page number.
    // Using the exact variant (thai13 vs thai11 vs thai42) ensures vowels and
    // tone marks are encoded to bytes that match the printer's character table.
    codepageMapping: { [cpName]: thaiCodepage } as unknown as string,
  });
}

/**
 * Build a single padded row: `left` on the left edge, `right` flush-right.
 * Truncates `left` if both sides don't fit in `cols`.
 */
function row(left: string, right: string, cols: number): string {
  const gap = cols - left.length - right.length;
  if (gap <= 0) {
    // truncate left side, keep right intact
    return left.slice(0, cols - right.length - 1) + ' ' + right;
  }
  return left + ' '.repeat(gap) + right;
}

/** ASCII separator line */
function sep(cols: number): string {
  return '-'.repeat(cols);
}

/**
 * Split text into lines that fit within `cols` characters.
 * Breaks at spaces first; falls back to hard-break at col boundary.
 * Each Thai/ASCII character counts as 1 column (Thai codepage = 1 byte/char).
 */
function wrapLines(text: string, cols: number): string[] {
  if (text.length <= cols) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const chunk = word.slice(0, cols);
    if (!cur) {
      cur = chunk;
    } else if (cur.length + 1 + chunk.length <= cols) {
      cur += ' ' + chunk;
    } else {
      lines.push(cur);
      cur = chunk;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text.slice(0, cols)];
}

/* ─── Receipt ────────────────────────────────────────────────────────────── */

export function buildReceipt(data: ReceiptData, paperWidth: 58 | 80, thaiCodepage = 21): Uint8Array {
  const cols = COLS[paperWidth];
  const label = data.billTypeLabel ?? (data.receiptType === 'receipt' ? 'receipt_short' : 'food');
  const showTaxFields = data.receiptType === 'receipt' || label === 'tax_full';

  let e = makeEncoder(paperWidth, thaiCodepage)
    .initialize()
    .codepage(getThaiCpName(thaiCodepage))
    /* Shop header */
    .align('center');

  if (data.shopNameTh) e = e.bold(true).size(2, 2).line(data.shopNameTh).size(1, 1).bold(false);

  if (data.shopNameEn)  e = e.line(data.shopNameEn);
  if (data.companyName) e = e.line(data.companyName);
  if (data.shopAddress) for (const l of wrapLines(data.shopAddress, cols)) e = e.line(l);
  if (data.phone)       e = e.line(`โทรศัพท์: ${data.phone}`);
  if (data.taxId)       e = e.line(`เลขผู้เสียภาษี: ${data.taxId}`);
  if (data.branch)      e = e.line(`สาขา: ${data.branch}`);
  if (data.registerNo)  e = e.line(`Register No: ${data.registerNo}`);

  /* Buyer info (tax_full only) */
  if (label === 'tax_full' && data.buyerInfo) {
    e = e.line(sep(cols))
      .line('ข้อมูลผู้ซื้อ');
    for (const l of wrapLines(data.buyerInfo.companyName, cols)) e = e.line(l);
    for (const l of wrapLines(data.buyerInfo.address, cols)) e = e.line(l);
    e = e.line(`เลขผู้เสียภาษี: ${data.buyerInfo.taxId}`);
  }

  /* Document title */
  const docTitle =
    label === 'food'          ? 'บิลรายการอาหาร' :
    label === 'receipt_short' ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ' :
                                'ใบกำกับภาษี';

  e = e
    .line(sep(cols))
    .line(docTitle);
  if (label === 'receipt_short') e = e.line('ราคารวมภาษีมูลค่าเพิ่มแล้ว');

  e = e
    .line(sep(cols))
    /* Session info */
    .align('left');

  if (data.receiptNo)                    e = e.line(row('เลขที่',   data.receiptNo,   cols));
  if (data.tableNumber)                  e = e.line(row('โต๊ะ',     data.tableNumber, cols));
  if (data.cashierName) e = e.line(row('พนักงาน', data.cashierName, cols));
  if (data.paidAt)                       e = e.line(row('วันที่',   data.paidAt,      cols));
  e = e.line(sep(cols));

  /* Items */
  for (const item of data.items) {
    const right = `x${item.quantity}  ฿${item.total.toFixed(2)}`;
    const maxNameLen = cols - right.length - 1;
    if (item.name.length <= maxNameLen) {
      e = e.line(row(item.name, right, cols));
    } else {
      const nameLines = wrapLines(item.name, cols);
      for (let i = 0; i < nameLines.length - 1; i++) e = e.line(nameLines[i]);
      const last = nameLines[nameLines.length - 1] ?? '';
      e = last.length <= maxNameLen
        ? e.line(row(last, right, cols))
        : e.line(last).line(row('', right, cols));
    }
  }

  e = e.line(sep(cols));

  /* Totals */
  e = e.line(row('ยอดรวม', `฿${data.subtotal.toFixed(2)}`, cols));
  if (data.discount > 0) {
    e = e.line(row('ส่วนลด', `-฿${data.discount.toFixed(2)}`, cols));
  }
  if (data.serviceCharge > 0) {
    e = e.line(row('ค่าบริการ', `+฿${data.serviceCharge.toFixed(2)}`, cols));
  }
  if (showTaxFields) {
    const vat = data.vatPercent ?? 7;
    const vatAmt = data.total * vat / (100 + vat);
    if (vatAmt > 0) e = e.line(row(`ภาษีมูลค่าเพิ่ม ${vat}% (รวม)`, vatAmt.toFixed(2), cols));
  }
  e = e.bold(true).line(row('ทั้งหมด', `฿${data.total.toFixed(2)}`, cols)).bold(false);

  e = e
    .line(sep(cols))
    .align('center')
    .line(data.footerNote ?? 'ขอบคุณและขอให้โชคดี');

  if (data.receiptType === 'receipt') {
    e = e.qrcode(data.sessionId, 2, 4, 'm');
  }

  e = e.newline(3).cut('partial');

  return e.encode();
}

/* ─── Table QR ───────────────────────────────────────────────────────────── */

export function buildTableQr(data: TableQrData, paperWidth: 58 | 80, thaiCodepage = 21): Uint8Array {
  const cols = COLS[paperWidth];
  return makeEncoder(paperWidth, thaiCodepage)
    .initialize()
    .codepage(getThaiCpName(thaiCodepage))
    .align('center')
    .bold(true).size(2, 2).line(`โต๊ะ ${data.tableNumber}`).size(1, 1).bold(false)
    .line('สแกน QR เพื่อสั่งอาหาร')
    .line(sep(cols))
    .qrcode(data.url, 2, 6, 'm')
    .line(sep(cols))
    .align('left')
    .line(`เริ่ม:     ${data.startedAt}`)
    .line(data.endsAt ? `หมดเวลา:   ${data.endsAt}` : 'ไม่มีเวลาสิ้นสุด (บุฟเฟ่ต์ไม่อั้น)')
    .line(data.durationMinutes != null ? `ระยะเวลา:  บุฟเฟ่ต์ ${data.durationMinutes} นาที` : '')
    .newline(3)
    .cut('partial')
    .encode();
}

/* ─── Queue QR ───────────────────────────────────────────────────────────── */

export function buildQueueQr(data: QueueQrData, paperWidth: 58 | 80, thaiCodepage = 21): Uint8Array {
  const cols = COLS[paperWidth];
  const adultLine = data.adultCount !== undefined && data.childCount !== undefined
    ? `ผู้ใหญ่ ${data.adultCount} / เด็ก ${data.childCount} ท่าน`
    : `จำนวน ${data.partySize} ท่าน`;
  let enc = makeEncoder(paperWidth, thaiCodepage)
    .initialize()
    .codepage(getThaiCpName(thaiCodepage))
    .align('center')
    .bold(true).line('ตั๋วคิว — ลำฮิมคือ ชาบู บุฟเฟต์').bold(false)
    .size(2, 2).bold(true).line(data.queueNumber).bold(false).size(1, 1)
    .line(adultLine);
  if (data.soupSummary) {
    enc = enc.line(data.soupSummary);
  }
  enc = enc
    .line(sep(cols))
    .qrcode(data.url, 2, 5, 'm')
    .line('สแกนเพื่อติดตามคิวและยกเลิกคิว')
    .line(sep(cols))
    .line(`เวลา: ${data.createdAt}`)
    .align('left')
    .line('หมายเหตุ: การเรียกคิวขึ้นอยู่กับลำดับ')
    .line('และขนาดโต๊ะที่ว่าง')
    .newline(3)
    .cut('partial');
  return enc.encode();
}

/* ─── Kitchen Order ──────────────────────────────────────────────────────── */

export function buildKitchenOrder(data: KitchenOrderData, paperWidth: 58 | 80, thaiCodepage = 21): Uint8Array {
  const cols = COLS[paperWidth];
  let e = makeEncoder(paperWidth, thaiCodepage)
    .initialize()
    .codepage(getThaiCpName(thaiCodepage))
    .align('center')
    .bold(true).size(2, 1).line('*** ORDER ***').size(1, 1).bold(false)
    .line(sep(cols))
    .align('left')
    .line(`โต๊ะ: ${data.tableNumber}   สถานี: ${STATION_LABEL[data.station] ?? data.station}`)
    .line(`เวลา: ${data.orderedAt}`)
    .line(sep(cols));

  for (const item of data.items) {
    e = e.line(row(item.name, `x${item.quantity}`, cols));
    if (item.notes) e = e.line(`  → ${item.notes}`);
  }

  return e
    .line(sep(cols))
    .newline(3)
    .cut('partial')
    .encode();
}
