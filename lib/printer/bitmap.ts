/**
 * Bitmap-based Thai printing.
 *
 * Renders receipt / kitchen / queue content to an HTML Canvas using the
 * browser's own text engine (which handles Thai glyph shaping correctly),
 * then encodes the result as an ESC/POS GS v 0 raster image command.
 *
 * Use this for printers that lack a Thai glyph-shaping engine and produce
 * "raw character rendering" (สระ/วรรณยุกต์ appear as separate characters).
 */

import type { ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

/* ─── Constants ──────────────────────────────────────────────────────────── */

const DOTS: Record<58 | 80, number> = { 58: 384, 80: 576 };
const FONT = '"IBM Plex Sans Thai", "TH Sarabun New", "Tahoma", sans-serif';
const FS = 22;          // base font size px
const LH = 30;          // base line height px
const PAD = 6;          // horizontal padding px

/* ─── Line descriptors ───────────────────────────────────────────────────── */

type Line =
  | { k: 'txt'; text: string; align: 'l' | 'c' | 'r'; bold?: boolean; big?: boolean }
  | { k: 'row'; left: string; right: string; bold?: boolean }
  | { k: 'hr' }
  | { k: 'gap'; n?: number };

/* ─── Canvas → ESC/POS GS v 0 ───────────────────────────────────────────── */

function canvasToEscpos(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  const widthBytes = Math.ceil(width / 8);
  const bitmap: number[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < widthBytes; col++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = col * 8 + bit;
        if (x < width) {
          const i = (row * width + x) * 4;
          const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          if (lum < 180) byte |= 1 << (7 - bit); // dark pixel → print
        }
      }
      bitmap.push(byte);
    }
  }

  // GS v 0 (raster image)
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;

  return new Uint8Array([
    0x1b, 0x40,                                    // ESC @ — init
    0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH,       // GS v 0 — raster image
    ...bitmap,
    0x0a, 0x0a, 0x0a,                              // feed
    0x1d, 0x56, 0x01,                              // GS V 1 — partial cut
  ]);
}

/* ─── Canvas renderer ────────────────────────────────────────────────────── */

function renderLines(lines: Line[], paperWidth: 58 | 80): Uint8Array {
  const W = DOTS[paperWidth];

  // Pass 1: measure total height
  let totalH = PAD;
  for (const ln of lines) {
    if (ln.k === 'hr')  totalH += 12;
    else if (ln.k === 'gap') totalH += (ln.n ?? 1) * LH;
    else if (ln.k === 'txt' && ln.big) totalH += LH * 2;
    else totalH += LH;
  }
  totalH += PAD;

  // Pass 2: draw
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = totalH;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, totalH);
  ctx.fillStyle = '#000';

  let y = PAD;

  for (const ln of lines) {
    if (ln.k === 'hr') {
      const mid = y + 6;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD, mid);
      ctx.lineTo(W - PAD, mid);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      y += 12;
    } else if (ln.k === 'gap') {
      y += (ln.n ?? 1) * LH;
    } else if (ln.k === 'row') {
      const fs = ln.bold ? `bold ${FS}px ${FONT}` : `${FS}px ${FONT}`;
      ctx.font = fs;
      const baseline = y + FS + 2;
      ctx.textAlign = 'left';
      ctx.fillText(ln.left,  PAD,     baseline);
      ctx.textAlign = 'right';
      ctx.fillText(ln.right, W - PAD, baseline);
      y += LH;
    } else {
      const size = ln.big ? FS * 1.8 : FS;
      const lh   = ln.big ? LH * 2 : LH;
      ctx.font = `${ln.bold ? 'bold ' : ''}${size}px ${FONT}`;
      const baseline = y + size + 2;
      const x = ln.align === 'c' ? W / 2 : ln.align === 'r' ? W - PAD : PAD;
      ctx.textAlign = ln.align === 'c' ? 'center' : ln.align === 'r' ? 'right' : 'left';
      ctx.fillText(ln.text, x, baseline);
      y += lh;
    }
  }

  return canvasToEscpos(canvas);
}

/* ─── Receipt ────────────────────────────────────────────────────────────── */

export async function buildBitmapReceipt(
  data: ReceiptData,
  paperWidth: 58 | 80,
): Promise<Uint8Array> {
  await document.fonts.ready;

  const cols = paperWidth === 58 ? 32 : 48;
  const sep = '-'.repeat(cols);
  const lines: Line[] = [];

  // Header
  lines.push({ k: 'txt', text: data.shopNameTh, align: 'c', bold: true, big: true });
  if (data.shopNameEn)  lines.push({ k: 'txt', text: data.shopNameEn,  align: 'c' });
  if (data.companyName) lines.push({ k: 'txt', text: data.companyName, align: 'c' });
  if (data.shopAddress) lines.push({ k: 'txt', text: data.shopAddress, align: 'c' });
  if (data.phone)       lines.push({ k: 'txt', text: `โทร: ${data.phone}`, align: 'c' });
  if (data.receiptType === 'receipt') {
    if (data.taxId)      lines.push({ k: 'txt', text: `เลขผู้เสียภาษี: ${data.taxId}`, align: 'c' });
    if (data.branch)     lines.push({ k: 'txt', text: `สาขา: ${data.branch}`, align: 'c' });
  }

  lines.push({ k: 'hr' });
  lines.push({ k: 'row', left: `โต๊ะ: ${data.tableNumber}`, right: data.cashierName });
  lines.push({ k: 'txt', text: `วันที่: ${data.paidAt}`, align: 'l' });
  lines.push({ k: 'hr' });

  // Items
  for (const item of data.items) {
    lines.push({
      k: 'row',
      left: item.name,
      right: `x${item.quantity}  ฿${item.total.toFixed(2)}`,
    });
  }
  lines.push({ k: 'hr' });

  // Totals
  lines.push({ k: 'row', left: 'รวม', right: `฿${data.subtotal.toFixed(2)}` });
  if (data.discount > 0)
    lines.push({ k: 'row', left: 'ส่วนลด', right: `-฿${data.discount.toFixed(2)}` });
  if (data.serviceCharge > 0)
    lines.push({ k: 'row', left: 'ค่าบริการ', right: `+฿${data.serviceCharge.toFixed(2)}` });
  if (data.receiptType === 'receipt') {
    const vat = data.vatPercent ?? 7;
    const vatAmt = data.total * vat / (100 + vat);
    lines.push({ k: 'row', left: `VAT ${vat}% (รวม)`, right: vatAmt.toFixed(2) });
  }
  lines.push({ k: 'row', left: 'ทั้งหมด', right: `฿${data.total.toFixed(2)}`, bold: true });

  if (data.receiptType === 'receipt') {
    lines.push({ k: 'hr' });
    lines.push({ k: 'row', left: data.paymentMethod, right: `฿${data.receivedAmount.toFixed(2)}` });
    if (data.changeAmount > 0)
      lines.push({ k: 'row', left: 'เงินทอน', right: `฿${data.changeAmount.toFixed(2)}` });
  }

  lines.push({ k: 'hr' });
  lines.push({ k: 'txt', text: data.footerNote ?? 'ขอบคุณและขอให้โชคดี', align: 'c' });
  lines.push({ k: 'gap', n: 2 });

  return renderLines(lines, paperWidth);
}

/* ─── Kitchen Order ──────────────────────────────────────────────────────── */

const STATION_LABEL: Record<string, string> = {
  meat: 'เนื้อสัตว์', seafood: 'ทะเล', vegetable: 'ผัก',
  noodle: 'เส้น', dessert: 'ของหวาน', drink: 'เครื่องดื่ม', sauce: 'ซอส',
};

export async function buildBitmapKitchenOrder(
  data: KitchenOrderData,
  paperWidth: 58 | 80,
): Promise<Uint8Array> {
  await document.fonts.ready;

  const lines: Line[] = [
    { k: 'txt', text: '*** ORDER ***', align: 'c', bold: true, big: true },
    { k: 'hr' },
    { k: 'row', left: `โต๊ะ: ${data.tableNumber}`, right: STATION_LABEL[data.station] ?? data.station },
    { k: 'txt', text: `เวลา: ${data.orderedAt}`, align: 'l' },
    { k: 'hr' },
  ];

  for (const item of data.items) {
    lines.push({ k: 'row', left: item.name, right: `x${item.quantity}`, bold: true });
    if (item.notes) lines.push({ k: 'txt', text: `  → ${item.notes}`, align: 'l' });
  }

  lines.push({ k: 'hr' });
  lines.push({ k: 'gap', n: 1 });

  return renderLines(lines, paperWidth);
}

/* ─── Queue QR label ─────────────────────────────────────────────────────── */

export async function buildBitmapQueueQr(
  data: QueueQrData,
  paperWidth: 58 | 80,
): Promise<Uint8Array> {
  await document.fonts.ready;

  const lines: Line[] = [
    { k: 'txt', text: 'ตั๋วคิว', align: 'c', bold: true },
    { k: 'txt', text: data.queueNumber, align: 'c', bold: true, big: true },
    { k: 'txt', text: `จำนวน ${data.partySize} ท่าน`, align: 'c' },
    { k: 'hr' },
    { k: 'txt', text: `เวลา: ${data.createdAt}`, align: 'c' },
    { k: 'gap', n: 1 },
  ];

  return renderLines(lines, paperWidth);
}

/* ─── Table QR label ─────────────────────────────────────────────────────── */

export async function buildBitmapTableQr(
  data: TableQrData,
  paperWidth: 58 | 80,
): Promise<Uint8Array> {
  await document.fonts.ready;

  const lines: Line[] = [
    { k: 'txt', text: `โต๊ะ ${data.tableNumber}`, align: 'c', bold: true, big: true },
    { k: 'txt', text: 'สแกน QR เพื่อสั่งอาหาร', align: 'c' },
    { k: 'hr' },
    { k: 'txt', text: `เริ่ม: ${data.startedAt}`, align: 'l' },
    ...(data.endsAt ? [{ k: 'txt' as const, text: `หมดเวลา: ${data.endsAt}`, align: 'l' as const }] : []),
    { k: 'gap', n: 1 },
  ];

  return renderLines(lines, paperWidth);
}
