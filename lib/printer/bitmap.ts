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
import { buildThermalReceiptLines } from './thermal-layout';
import type { ThermalLine, ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

/* ─── Constants ──────────────────────────────────────────────────────────── */

const DOTS: Record<58 | 80, number> = { 58: 384, 80: 576 };
/** Printable body width in mm (matches buildPrintCSS in browser.ts) */
const BODY_MM: Record<58 | 80, number> = { 58: 54, 80: 76 };

const THAI_FONT = '"IBM Plex Sans Thai", "TH Sarabun New", "Noto Sans Thai", "Tahoma", sans-serif';
const FONT_SIZE = 26;
const LINE_H    = 36;
const PAD_X     = 14;
const PAD_Y     = 12;

/**
 * Convert a logo height expressed in CSS/screen pixels (96 dpi) to the
 * equivalent number of canvas dots at the thermal-printer dot density.
 */
function logoHeightToDots(heightPx: number, paperWidth: 58 | 80): number {
  const dotPerMm = DOTS[paperWidth] / BODY_MM[paperWidth];
  const pxPerMm  = 96 / 25.4;
  return Math.round(heightPx * dotPerMm / pxPerMm);
}

const STATION: Record<string, string> = {
  meat: 'เนื้อสัตว์', seafood: 'ทะเล', vegetable: 'ผัก',
  noodle: 'เส้น', dessert: 'ของหวาน', drink: 'เครื่องดื่ม', sauce: 'ซอส',
};

/* ─── Image loader helper ────────────────────────────────────────────────── */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('logo load failed'));
    img.src = src;
  });
}

/* ─── Canvas renderer ────────────────────────────────────────────────────── */

async function drawToCanvas(lines: ThermalLine[], paperWidth: 58 | 80): Promise<HTMLCanvasElement> {
  const W          = DOTS[paperWidth];
  const BIG        = Math.round(FONT_SIZE * 1.4);
  const PRINTABLE  = W - PAD_X * 2;
  const QR_SIZE    = PRINTABLE;

  await document.fonts.ready;
  await Promise.allSettled([
    document.fonts.load(`400 ${FONT_SIZE}px "IBM Plex Sans Thai"`),
    document.fonts.load(`bold ${FONT_SIZE}px "IBM Plex Sans Thai"`),
    document.fonts.load(`400 ${BIG}px "IBM Plex Sans Thai"`),
    document.fonts.load(`bold ${BIG}px "IBM Plex Sans Thai"`),
  ]);

  /* Use a 1-pixel-tall off-screen canvas to measure text widths */
  const mcanvas = document.createElement('canvas');
  mcanvas.width  = W;
  mcanvas.height = 1;
  const mctx = mcanvas.getContext('2d')!;

  function wrapText(s: string, bold: boolean, big: boolean): string[] {
    const fs = big ? BIG : FONT_SIZE;
    mctx.font = `${bold ? 'bold ' : ''}${fs}px ${THAI_FONT}`;
    if (mctx.measureText(s).width <= PRINTABLE) return [s];
    const segments: string[] = [];
    let cur = '';
    for (const ch of s) {
      const test = cur + ch;
      if (mctx.measureText(test).width > PRINTABLE) {
        if (cur) segments.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) segments.push(cur);
    return segments.length ? segments : [s];
  }

  /* Expand text lines that exceed the printable width */
  const expanded: ThermalLine[] = [];
  for (const ln of lines) {
    if (ln.t === 'text') {
      for (const seg of wrapText(ln.s, ln.bold ?? false, ln.big ?? false)) {
        expanded.push({ ...ln, s: seg });
      }
    } else {
      expanded.push(ln);
    }
  }

  /* Measure total canvas height using the expanded line list */
  let h = PAD_Y;
  for (const ln of expanded) {
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

  let y = PAD_Y;

  for (const ln of expanded) {
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

async function render(lines: ThermalLine[], paperWidth: 58 | 80): Promise<Uint8Array> {
  const canvas = await drawToCanvas(lines, paperWidth);
  return encodeToEscpos(canvas, paperWidth);
}

/* ─── Receipt ────────────────────────────────────────────────────────────── */

export async function buildBitmapReceipt(data: ReceiptData, paperWidth: 58 | 80): Promise<Uint8Array> {
  if (data.logoUrl) {
    try {
      const img   = await loadImage(data.logoUrl);
      const W     = DOTS[paperWidth];
      const maxH  = logoHeightToDots(data.logoHeight ?? 56, paperWidth);
      const ratio = Math.min(1, maxH / img.naturalHeight, (W - PAD_X * 2) / img.naturalWidth);
      const imgW  = Math.round(img.naturalWidth  * ratio);
      const imgH  = Math.round(img.naturalHeight * ratio);
      return await renderWithLogo(data, img, imgW, imgH, paperWidth);
    } catch {
      // logo load failed — fall through to text-only render
    }
  }
  return render(buildThermalReceiptLines(data), paperWidth);
}

/** Two-pass render: logo block drawn on canvas above the shared thermal lines. */
async function renderWithLogo(
  data: ReceiptData,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  paperWidth: 58 | 80,
): Promise<Uint8Array> {
  const W    = DOTS[paperWidth];
  const cols = paperWidth === 58 ? 32 : 48;

  await document.fonts.ready;
  await Promise.allSettled([
    document.fonts.load(`400 ${FONT_SIZE}px "IBM Plex Sans Thai"`),
    document.fonts.load(`bold ${FONT_SIZE}px "IBM Plex Sans Thai"`),
  ]);

  const bodyCanvas = await drawToCanvas(buildThermalReceiptLines(data), paperWidth);

  const logoBlockH = imgH + PAD_Y * 2;
  const totalH     = Math.ceil((logoBlockH + bodyCanvas.height) / 8) * 8;
  const combined   = document.createElement('canvas');
  combined.width   = W;
  combined.height  = totalH;
  const ctx        = combined.getContext('2d')!;
  ctx.fillStyle    = '#ffffff';
  ctx.fillRect(0, 0, W, totalH);
  ctx.drawImage(img, Math.floor((W - imgW) / 2), PAD_Y, imgW, imgH);
  ctx.drawImage(bodyCanvas, 0, logoBlockH);

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
    .image(combined, combined.width, combined.height, 'threshold')
    .newline(3)
    .cut('partial')
    .encode() as Uint8Array;
}

/* ─── Kitchen Order ──────────────────────────────────────────────────────── */

export async function buildBitmapKitchenOrder(data: KitchenOrderData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const lines: ThermalLine[] = [
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
  const countLine = data.adultCount !== undefined && data.childCount !== undefined
    ? `ผู้ใหญ่ ${data.adultCount} / เด็ก ${data.childCount} ท่าน`
    : `จำนวน ${data.partySize} ท่าน`;
  const lines: ThermalLine[] = [
    { t: 'text', s: 'ตั๋วคิว — ลำฮิมคือ ชาบู บุฟเฟต์', a: 'c', bold: true },
    { t: 'text', s: data.queueNumber,  a: 'c', bold: true, big: true },
    { t: 'text', s: countLine,         a: 'c' },
  ];
  if (data.soupSummary) {
    lines.push({ t: 'text', s: data.soupSummary, a: 'c' });
  }
  lines.push(
    { t: 'hr' },
    { t: 'qr',  url: data.url },
    { t: 'text', s: 'สแกนเพื่อติดตามคิวและยกเลิกคิว', a: 'c' },
    { t: 'hr' },
    { t: 'text', s: `เวลา: ${data.createdAt}`, a: 'c' },
    { t: 'text', s: 'หมายเหตุ: การเรียกคิวขึ้นอยู่กับลำดับ', a: 'l' },
    { t: 'text', s: 'และขนาดโต๊ะที่ว่าง', a: 'l' },
    { t: 'sp' },
  );
  return render(lines, paperWidth);
}

/* ─── Table QR ───────────────────────────────────────────────────────────── */

export async function buildBitmapTableQr(data: TableQrData, paperWidth: 58 | 80): Promise<Uint8Array> {
  const lines: ThermalLine[] = [
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
