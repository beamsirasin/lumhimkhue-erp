/**
 * HTML templates for browser (window.print) fallback.
 */

import QRCode from 'qrcode';
import { buildThermalReceiptLines } from './thermal-layout';
import type { ThermalLine, ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

const QR_OPTS: QRCode.QRCodeToDataURLOptions = {
  width: 200, margin: 1, errorCorrectionLevel: 'M',
  color: { dark: '#000000', light: '#ffffff' },
};

async function qrImg(text: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(text, QR_OPTS);
  return `<div class="qr-wrap"><img src="${dataUrl}" alt="QR" /></div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hr(): string { return '<hr />'; }

/** Two-column row */
function row(label: string, value: string, bold = false): string {
  const cls = bold ? ' bold' : '';
  return `<div class="row${cls}"><span class="name">${esc(label)}</span><span class="value">${esc(value)}</span></div>`;
}


const STATION_LABEL: Record<string, string> = {
  meat: 'เนื้อสัตว์', seafood: 'ทะเล', vegetable: 'ผัก',
  noodle: 'เส้น', dessert: 'ของหวาน', drink: 'เครื่องดื่ม', sauce: 'ซอส',
};

/* ─── Receipt / Bill ────────────────────────────────────────────────────── */

function renderThermalLinesToHtml(lines: ThermalLine[]): string {
  return lines.map((ln) => {
    switch (ln.t) {
      case 'hr':  return '<hr />';
      case 'gap': return '<div style="height:4px"></div>';
      case 'sp':  return '';
      case 'qr':  return '';
      case 'row': {
        const cls = ln.bold ? ' bold' : '';
        return `<div class="row${cls}"><span class="name">${esc(ln.l)}</span><span class="value">${esc(ln.r)}</span></div>`;
      }
      case 'text': {
        const classes = [
          ln.a === 'c' ? 'center' : ln.a === 'r' ? 'right' : '',
          ln.bold ? 'bold' : '',
          ln.big  ? 'big'  : '',
        ].filter(Boolean).join(' ');
        return classes
          ? `<div class="${classes}">${esc(ln.s)}</div>`
          : `<div>${esc(ln.s)}</div>`;
      }
    }
  }).filter(Boolean).join('\n');
}

export async function renderReceiptHTML(data: ReceiptData): Promise<string> {
  const logoStyle = data.logoHeight ? ` style="max-height:${data.logoHeight}px"` : '';
  const logoBlock = data.logoUrl
    ? `<div class="logo-wrap"><img src="${data.logoUrl}" alt="" class="logo"${logoStyle} /></div>\n`
    : '';
  const lines = buildThermalReceiptLines(data);
  return `${logoBlock}${renderThermalLinesToHtml(lines)}`.trim();
}

/* ─── Table QR ───────────────────────────────────────────────────────────── */

export async function renderTableQrHTML(data: TableQrData): Promise<string> {
  const qr = await qrImg(data.url);
  return `
<div class="center">
  <div class="big">โต๊ะ ${data.tableNumber}</div>
  <div>สแกน QR เพื่อสั่งอาหาร</div>
</div>
${hr()}
${qr}
${hr()}
<div>${row('เริ่ม', data.startedAt)}</div>
${data.endsAt ? `<div>${row('หมดเวลา', data.endsAt)}</div>` : ''}
${data.durationMinutes != null ? `<div>${row('บุฟเฟ่ต์', `${data.durationMinutes} นาที`)}</div>` : ''}
`.trim();
}

/* ─── Queue QR ───────────────────────────────────────────────────────────── */

export async function renderQueueQrHTML(data: QueueQrData): Promise<string> {
  const qr = await qrImg(data.url);
  const countLine = data.adultCount !== undefined && data.childCount !== undefined
    ? `ผู้ใหญ่ ${data.adultCount} / เด็ก ${data.childCount} ท่าน`
    : `จำนวน ${data.partySize} ท่าน`;
  const soupLine = data.soupSummary ? `<div>${esc(data.soupSummary)}</div>` : '';
  return `
<div class="center">
  <div class="bold">ตั๋วคิว — ลำฮิมคือ ชาบู บุฟเฟต์</div>
  <div class="xl">${esc(data.queueNumber)}</div>
  <div>${countLine}</div>
  ${soupLine}
</div>
${hr()}
${qr}
<div class="center">สแกนเพื่อติดตามคิวและยกเลิกคิว</div>
${hr()}
<div>เวลา: ${esc(data.createdAt)}</div>
<div style="font-size:10px;margin-top:4px;">การเรียกคิวขึ้นอยู่กับลำดับและขนาดโต๊ะที่ว่าง</div>
`.trim();
}

/* ─── Kitchen Order ──────────────────────────────────────────────────────── */

export async function renderKitchenOrderHTML(data: KitchenOrderData): Promise<string> {
  const stationLabel = STATION_LABEL[data.station] ?? data.station;
  const itemRows = data.items
    .map((i) => {
      const note = i.notes ? `<div style="padding-left:8px;color:#555;">→ ${esc(i.notes)}</div>` : '';
      return row(i.name, `x${i.quantity}`) + note;
    })
    .join('\n');

  return `
<div class="center bold big">*** ORDER ***</div>
${hr()}
<div>${row('โต๊ะ', String(data.tableNumber))}</div>
<div>${row('สถานี', stationLabel)}</div>
<div>${row('เวลา', data.orderedAt)}</div>
${hr()}
${itemRows}
${hr()}
`.trim();
}
