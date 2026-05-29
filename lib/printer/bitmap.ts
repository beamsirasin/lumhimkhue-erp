/**
 * Bitmap-based Thai printing via canvas fillText().
 *
 * Canvas uses the browser's OS text engine (DirectWrite / HarfBuzz) for
 * fillText(), which applies Thai glyph shaping correctly — as long as the
 * font is loaded before drawing. We wait explicitly with document.fonts.load().
 *
 * SVG foreignObject was tried but Chrome permanently taints the canvas when
 * drawImage() receives an SVG with <foreignObject>, making getImageData()
 * impossible (Chromium bug #294129, Won't Fix).
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import QRCode from 'qrcode';
import type { ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

/* ─── Constants ──────────────────────────────────────────────────────────── */

const DOTS: Record<58 | 80, number> = { 58: 384, 80: 576 };

const THAI_FONT = '"IBM Plex Sans Thai", "TH Sarabun New", "Noto Sans Thai", "Tahoma", sans-serif';
const FONT_SIZE = 26;
const LINE_H    = 36;
const PAD_X     = 14;
const PAD_Y     = 12;

const STATION: Record<string, string> = {
  meat: 'เนื้อสัตว์', seafood: 'ทะเล', vegetable: 'ผัก',
  noodle: 'เส้น', dessert: 'ของหวาน', drink: 'เครื่องดื่ม', sauce: 'ซอส',
};

/* ─── Line descriptor ────────────────────────────────────────────────────── */

type Ln =
  | { t: 'text'; s: string; a: 'l' | 'c' | 'r'; bold?: boolean; big?: boolean }
  | { t: 'row';  l: string; r: string; bold?: boolean }
  | { t: 'hr' }
  | { t: 'sp';   n?: number }
  | { t: 'qr';   url: string };

/* ─── Canvas renderer ────────────────────────────────────────────────────── */

async function drawToCanvas(lines: Ln[], paperWidth: 58 | 80): Promise<HTMLCanvasElement> {
  const W   = DOTS[paperWidth];
  const BIG = Math.round(FONT_SIZE * 1.4);

  // Wait for ALL fonts, then explicitly load the sizes we need
  await document.fonts.ready;
  await Promise.allSettled([
    document.fonts.load(`400 ${FONT_SIZE}px "IBM Plex Sans Thai"`),
    document.fonts.load(`bold ${FONT_SIZE}px "IBM Plex Sans Thai"`),
    document.fonts.load(`400 ${BIG}px "IBM Plex Sans Thai"`),
    document.fonts.load(`bold ${BIG}px "IBM Plex Sans Thai"`),
  ]);

  const QR_SIZE = W - PAD_X * 2; // QR code fills printable width

  // Measure total height
  let h = PAD_Y;
  for (const ln of lines) {
    if      (ln.t === 'hr') h += 16;
    else if (ln.t === 'sp') h += (ln.n ?? 1) * LINE_H;
    else if (ln.t === 'qr') h += QR_SIZE + 8;
    else if (ln.t === 'text' && ln.big) h += BIG + 8;
    else h += LINE_H;
  }
  h += PAD_Y;
  h = Math.ceil(h / 8) * 8; // ESC/POS raster: height must be multiple of 8

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, h);

  // Black bar confirms bitmap mode is active
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, 4);

  let y = PAD_Y + 4;

  for (const ln of lines) {
    ctx.fillStyle = '#000000';

    if (ln.t === 'hr') {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_X, y + 8);
      ctx.lineTo(W - PAD_X, y + 8);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.restore();
      y += 16;

    } else if (ln.t === 'sp') {
      y += (ln.n ?? 1) * LINE_H;

    } else if (ln.t === 'qr') {
      const qrCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrCanvas, ln.url, {
        width: QR_SIZE,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
      ctx.drawImage(qrCanvas, PAD_X, y);
      y += QR_SIZE + 8;

    } else if (ln.t === 'row') {
      ctx.font          = `${ln.bold ? 'bold ' : ''}${FONT_SIZE}px ${THAI_FONT}`;
      ctx.textBaseline  = 'top';
      ctx.textAlign     = 'left';
      ctx.fillText(ln.l, PAD_X, y);
      ctx.textAlign     = 'right';
      ctx.fillText(ln.r, W - PAD_X, y);
      y += LINE_H;

    } else {
      const fs = ln.big ? BIG : FONT_SIZE;
      ctx.font         = `${ln.bold ? 'bold ' : ''}${fs}px ${THAI_FONT}`;
      ctx.textBaseline = 'top';
      ctx.textAlign    = ln.a === 'c' ? 'center' : ln.a === 'r' ? 'right' : 'left';
      const x          = ln.a === 'c' ? W / 2 : ln.a === 'r' ? W - PAD_X : PAD_X;
      ctx.fillText(ln.s, x, y);
      y += ln.big ? BIG + 8 : LINE_H;
    }
  }

  return canvas;
}

/* ─── Canvas → ESC/POS raster ───────────────────────────────────────────── */

function encodeToEscpos(canvas: HTMLCanvasElement, paperWidth: 58 | 80): Uint8Array {
  const cols = paperWidth === 58 ? 32 : 48;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enc = new (ReceiptPrinterEncoder as any)({
    language: 'esc-pos',
    columns: cols,
    imageMode: 'raster',
    createCanvas: (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h; return c;
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
  return encodeToEscpos(canvas, paperWidth);
}

/* ─── Receipt ────────────────────────────────────────────────────────────── */

export async function buildBitmapReceipt(data: ReceiptData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const isReceipt = data.receiptType === 'receipt';
  const vat    = data.vatPercent ?? 7;
  const vatAmt = isReceipt ? data.total * vat / (100 + vat) : 0;
  const lines: Ln[] = [];

  lines.push({ t: 'text', s: data.shopNameTh,  a: 'c', bold: true, big: true });
  if (data.shopNameEn)  lines.push({ t: 'text', s: data.shopNameEn,  a: 'c' });
  if (data.companyName) lines.push({ t: 'text', s: data.companyName, a: 'c' });
  if (data.shopAddress) lines.push({ t: 'text', s: data.shopAddress, a: 'c' });
  if (data.phone)       lines.push({ t: 'text', s: `โทร: ${data.phone}`, a: 'c' });
  if (isReceipt) {
    if (data.taxId)  lines.push({ t: 'text', s: `เลขผู้เสียภาษี: ${data.taxId}`, a: 'c' });
    if (data.branch) lines.push({ t: 'text', s: `สาขา: ${data.branch}`, a: 'c' });
  }

  lines.push({ t: 'hr' });
  lines.push({ t: 'row',  l: `โต๊ะ: ${data.tableNumber}`, r: data.cashierName });
  lines.push({ t: 'text', s: `วันที่: ${data.paidAt}`, a: 'l' });
  lines.push({ t: 'hr' });

  for (const item of data.items) {
    lines.push({ t: 'row', l: item.name, r: `x${item.quantity}  ฿${item.total.toFixed(2)}` });
  }

  lines.push({ t: 'hr' });
  lines.push({ t: 'row', l: 'รวม',       r: `฿${data.subtotal.toFixed(2)}` });
  if (data.discount > 0)
    lines.push({ t: 'row', l: 'ส่วนลด',   r: `-฿${data.discount.toFixed(2)}` });
  if (data.serviceCharge > 0)
    lines.push({ t: 'row', l: 'ค่าบริการ', r: `+฿${data.serviceCharge.toFixed(2)}` });
  if (isReceipt && vatAmt > 0)
    lines.push({ t: 'row', l: `VAT ${vat}% (รวม)`, r: vatAmt.toFixed(2) });
  lines.push({ t: 'row', l: 'ทั้งหมด',   r: `฿${data.total.toFixed(2)}`, bold: true });

  if (isReceipt) {
    lines.push({ t: 'hr' });
    lines.push({ t: 'row', l: data.paymentMethod, r: `฿${data.receivedAmount.toFixed(2)}` });
    if (data.changeAmount > 0)
      lines.push({ t: 'row', l: 'เงินทอน', r: `฿${data.changeAmount.toFixed(2)}` });
  }

  lines.push({ t: 'hr' });
  lines.push({ t: 'text', s: data.footerNote ?? 'ขอบคุณและขอให้โชคดี', a: 'c' });
  lines.push({ t: 'sp' });

  return render(lines, paperWidth);
}

/* ─── Kitchen Order ──────────────────────────────────────────────────────── */

export async function buildBitmapKitchenOrder(data: KitchenOrderData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const lines: Ln[] = [
    { t: 'text', s: '*** ORDER ***', a: 'c', bold: true, big: true },
    { t: 'hr' },
    { t: 'row',  l: `โต๊ะ: ${data.tableNumber}`, r: STATION[data.station] ?? data.station },
    { t: 'text', s: `เวลา: ${data.orderedAt}`, a: 'l' },
    { t: 'hr' },
  ];

  for (const item of data.items) {
    lines.push({ t: 'row',  l: item.name, r: `x${item.quantity}`, bold: true });
    if (item.notes) lines.push({ t: 'text', s: `  → ${item.notes}`, a: 'l' });
  }

  lines.push({ t: 'hr' }, { t: 'sp' });
  return render(lines, paperWidth);
}

/* ─── Queue QR ───────────────────────────────────────────────────────────── */

export async function buildBitmapQueueQr(data: QueueQrData, paperWidth: 58 | 80): Promise<Uint8Array> {
  return render([
    { t: 'text', s: 'ตั๋วคิว',           a: 'c', bold: true },
    { t: 'text', s: data.queueNumber,     a: 'c', bold: true, big: true },
    { t: 'text', s: `จำนวน ${data.partySize} ท่าน`, a: 'c' },
    { t: 'hr' },
    { t: 'qr',   url: data.url },
    { t: 'hr' },
    { t: 'text', s: `เวลา: ${data.createdAt}`, a: 'c' },
    { t: 'sp' },
  ], paperWidth);
}

/* ─── Table QR ───────────────────────────────────────────────────────────── */

export async function buildBitmapTableQr(data: TableQrData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const lines: Ln[] = [
    { t: 'text', s: `โต๊ะ ${data.tableNumber}`, a: 'c', bold: true, big: true },
    { t: 'text', s: 'สแกน QR เพื่อสั่งอาหาร',   a: 'c' },
    { t: 'hr' },
    { t: 'qr',   url: data.url },
    { t: 'hr' },
    { t: 'text', s: `เริ่ม: ${data.startedAt}`,  a: 'l' },
  ];
  if (data.endsAt) lines.push({ t: 'text', s: `หมดเวลา: ${data.endsAt}`, a: 'l' });
  lines.push({ t: 'sp' });
  return render(lines, paperWidth);
}
