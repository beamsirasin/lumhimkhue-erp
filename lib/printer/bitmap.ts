/**
 * Bitmap-based Thai printing.
 *
 * Renders content to an HTML Canvas using the browser's own text engine
 * (which handles Thai glyph shaping correctly: สระ/วรรณยุกต์ stack properly),
 * then encodes the canvas as an ESC/POS raster image via ReceiptPrinterEncoder.
 *
 * Use for printers that lack Thai glyph shaping ("raw character rendering").
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import type { ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

/* ─── Layout constants ───────────────────────────────────────────────────── */

// Dots width per paper size at 203 DPI
const DOTS: Record<58 | 80, number> = { 58: 384, 80: 576 };

const THAI_FONT = '"IBM Plex Sans Thai", "TH Sarabun New", "Tahoma", sans-serif';
const FONT_SIZE = 24;
const LINE_H    = 32;
const PAD_X     = 8;   // horizontal padding
const PAD_Y     = 8;   // top/bottom padding

const STATION: Record<string, string> = {
  meat: 'เนื้อสัตว์', seafood: 'ทะเล', vegetable: 'ผัก',
  noodle: 'เส้น', dessert: 'ของหวาน', drink: 'เครื่องดื่ม', sauce: 'ซอส',
};

/* ─── Line descriptor ────────────────────────────────────────────────────── */

type Ln =
  | { t: 'text'; s: string; a: 'l' | 'c' | 'r'; bold?: boolean; big?: boolean }
  | { t: 'row';  l: string; r: string; bold?: boolean }
  | { t: 'hr' }
  | { t: 'sp';   n?: number };

/* ─── Canvas renderer ────────────────────────────────────────────────────── */

async function drawToCanvas(lines: Ln[], paperWidth: 58 | 80): Promise<HTMLCanvasElement> {
  const W = DOTS[paperWidth];

  // Explicitly load the font so canvas has it before drawing
  await document.fonts.load(`${FONT_SIZE}px ${THAI_FONT}`);
  await document.fonts.load(`bold ${FONT_SIZE}px ${THAI_FONT}`);
  await document.fonts.load(`${FONT_SIZE * 1.8}px ${THAI_FONT}`);

  // Measure total height
  let h = PAD_Y;
  for (const ln of lines) {
    if      (ln.t === 'hr') h += 14;
    else if (ln.t === 'sp') h += (ln.n ?? 1) * LINE_H;
    else if (ln.t === 'text' && ln.big) h += Math.round(FONT_SIZE * 1.8) + 8;
    else h += LINE_H;
  }
  h += PAD_Y;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = h;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, h);
  ctx.fillStyle = '#000000';

  // Debug marker — a solid black bar at the very top confirms bitmap mode is active
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = '#000000';

  let y = PAD_Y + 4;

  for (const ln of lines) {
    if (ln.t === 'hr') {
      const mid = y + 7;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_X, mid);
      ctx.lineTo(W - PAD_X, mid);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      y += 14;

    } else if (ln.t === 'sp') {
      y += (ln.n ?? 1) * LINE_H;

    } else if (ln.t === 'row') {
      const fs = FONT_SIZE;
      ctx.font = `${ln.bold ? 'bold ' : ''}${fs}px ${THAI_FONT}`;
      const baseline = y + fs;
      ctx.textAlign = 'left';
      ctx.fillText(ln.l, PAD_X, baseline);
      ctx.textAlign = 'right';
      ctx.fillText(ln.r, W - PAD_X, baseline);
      y += LINE_H;

    } else {
      // text
      const fs = ln.big ? Math.round(FONT_SIZE * 1.8) : FONT_SIZE;
      ctx.font = `${ln.bold ? 'bold ' : ''}${fs}px ${THAI_FONT}`;
      const baseline = y + fs;
      ctx.textAlign = ln.a === 'c' ? 'center' : ln.a === 'r' ? 'right' : 'left';
      const x = ln.a === 'c' ? W / 2 : ln.a === 'r' ? W - PAD_X : PAD_X;
      ctx.fillText(ln.s, x, baseline);
      y += ln.big ? fs + 8 : LINE_H;
    }
  }

  return canvas;
}

/* ─── Canvas → ESC/POS via ReceiptPrinterEncoder ────────────────────────── */

function encodeCanvasToEscpos(canvas: HTMLCanvasElement, paperWidth: 58 | 80): Uint8Array {
  const cols = paperWidth === 58 ? 32 : 48;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enc = new (ReceiptPrinterEncoder as any)({
    language: 'esc-pos',
    columns: cols,
    imageMode: 'raster',
    createCanvas: (w: number, hh: number) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = hh;
      return c;
    },
  });

  return enc
    .initialize()
    .image(canvas, canvas.width, canvas.height, 'threshold')
    .newline(3)
    .cut('partial')
    .encode() as Uint8Array;
}

async function render(lines: Ln[], paperWidth: 58 | 80): Promise<Uint8Array> {
  const canvas = await drawToCanvas(lines, paperWidth);
  return encodeCanvasToEscpos(canvas, paperWidth);
}

/* ─── Receipt ────────────────────────────────────────────────────────────── */

export async function buildBitmapReceipt(data: ReceiptData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const lines: Ln[] = [];

  lines.push({ t: 'text', s: data.shopNameTh, a: 'c', bold: true, big: true });
  if (data.shopNameEn)  lines.push({ t: 'text', s: data.shopNameEn, a: 'c' });
  if (data.companyName) lines.push({ t: 'text', s: data.companyName, a: 'c' });
  if (data.shopAddress) lines.push({ t: 'text', s: data.shopAddress, a: 'c' });
  if (data.phone)       lines.push({ t: 'text', s: `โทร: ${data.phone}`, a: 'c' });
  if (data.receiptType === 'receipt') {
    if (data.taxId)    lines.push({ t: 'text', s: `เลขผู้เสียภาษี: ${data.taxId}`, a: 'c' });
    if (data.branch)   lines.push({ t: 'text', s: `สาขา: ${data.branch}`, a: 'c' });
  }

  lines.push({ t: 'hr' });
  lines.push({ t: 'row', l: `โต๊ะ: ${data.tableNumber}`, r: data.cashierName });
  lines.push({ t: 'text', s: `วันที่: ${data.paidAt}`, a: 'l' });
  lines.push({ t: 'hr' });

  for (const item of data.items) {
    lines.push({ t: 'row', l: item.name, r: `x${item.quantity}  ฿${item.total.toFixed(2)}` });
  }
  lines.push({ t: 'hr' });

  lines.push({ t: 'row', l: 'รวม',     r: `฿${data.subtotal.toFixed(2)}` });
  if (data.discount > 0)
    lines.push({ t: 'row', l: 'ส่วนลด', r: `-฿${data.discount.toFixed(2)}` });
  if (data.serviceCharge > 0)
    lines.push({ t: 'row', l: 'ค่าบริการ', r: `+฿${data.serviceCharge.toFixed(2)}` });
  if (data.receiptType === 'receipt') {
    const vat = data.vatPercent ?? 7;
    const vatAmt = data.total * vat / (100 + vat);
    lines.push({ t: 'row', l: `VAT ${vat}% (รวม)`, r: vatAmt.toFixed(2) });
  }
  lines.push({ t: 'row', l: 'ทั้งหมด', r: `฿${data.total.toFixed(2)}`, bold: true });

  if (data.receiptType === 'receipt') {
    lines.push({ t: 'hr' });
    lines.push({ t: 'row', l: data.paymentMethod, r: `฿${data.receivedAmount.toFixed(2)}` });
    if (data.changeAmount > 0)
      lines.push({ t: 'row', l: 'เงินทอน', r: `฿${data.changeAmount.toFixed(2)}` });
  }

  lines.push({ t: 'hr' });
  lines.push({ t: 'text', s: data.footerNote ?? 'ขอบคุณและขอให้โชคดี', a: 'c' });
  lines.push({ t: 'sp', n: 1 });

  return render(lines, paperWidth);
}

/* ─── Kitchen Order ──────────────────────────────────────────────────────── */

export async function buildBitmapKitchenOrder(data: KitchenOrderData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const lines: Ln[] = [
    { t: 'text', s: '*** ORDER ***', a: 'c', bold: true, big: true },
    { t: 'hr' },
    { t: 'row', l: `โต๊ะ: ${data.tableNumber}`, r: STATION[data.station] ?? data.station },
    { t: 'text', s: `เวลา: ${data.orderedAt}`, a: 'l' },
    { t: 'hr' },
  ];
  for (const item of data.items) {
    lines.push({ t: 'row', l: item.name, r: `x${item.quantity}`, bold: true });
    if (item.notes) lines.push({ t: 'text', s: `  → ${item.notes}`, a: 'l' });
  }
  lines.push({ t: 'hr' }, { t: 'sp' });
  return render(lines, paperWidth);
}

/* ─── Queue QR ───────────────────────────────────────────────────────────── */

export async function buildBitmapQueueQr(data: QueueQrData, paperWidth: 58 | 80): Promise<Uint8Array> {
  return render([
    { t: 'text', s: 'ตั๋วคิว',  a: 'c', bold: true },
    { t: 'text', s: data.queueNumber, a: 'c', bold: true, big: true },
    { t: 'text', s: `จำนวน ${data.partySize} ท่าน`, a: 'c' },
    { t: 'hr' },
    { t: 'text', s: `เวลา: ${data.createdAt}`, a: 'c' },
    { t: 'sp' },
  ], paperWidth);
}

/* ─── Table QR ───────────────────────────────────────────────────────────── */

export async function buildBitmapTableQr(data: TableQrData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const lines: Ln[] = [
    { t: 'text', s: `โต๊ะ ${data.tableNumber}`, a: 'c', bold: true, big: true },
    { t: 'text', s: 'สแกน QR เพื่อสั่งอาหาร', a: 'c' },
    { t: 'hr' },
    { t: 'text', s: `เริ่ม: ${data.startedAt}`, a: 'l' },
  ];
  if (data.endsAt) lines.push({ t: 'text', s: `หมดเวลา: ${data.endsAt}`, a: 'l' });
  lines.push({ t: 'sp' });
  return render(lines, paperWidth);
}
