/**
 * HTML templates for the browser (window.print) fallback.
 * All functions are async because QR code generation is async.
 * The returned HTML is injected into the print window by printBrowser().
 *
 * CSS classes (center / right / bold / big / xl / row / name / value / hr / qr-wrap)
 * are defined in lib/printer/transports/browser.ts → PRINT_CSS.
 */

import QRCode from 'qrcode';
import type { ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

/* ─── QR helper ─────────────────────────────────────────────────────────── */

const QR_OPTS: QRCode.QRCodeToDataURLOptions = {
  width: 240,
  margin: 1,
  errorCorrectionLevel: 'M',
  color: { dark: '#000000', light: '#ffffff' },
};

async function qrImg(text: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(text, QR_OPTS);
  return `<div class="qr-wrap"><img src="${dataUrl}" alt="QR" /></div>`;
}

/* ─── Shared helpers ─────────────────────────────────────────────────────── */

function row(name: string, value: string, bold = false): string {
  const cls = bold ? ' bold' : '';
  return `<div class="row${cls}"><span class="name">${esc(name)}</span><span class="value">${esc(value)}</span></div>`;
}

function hr(): string {
  return '<hr />';
}

/** Escape HTML special characters */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATION_LABEL: Record<string, string> = {
  meat:      'เนื้อสัตว์',
  seafood:   'ทะเล',
  vegetable: 'ผัก',
  noodle:    'เส้น',
  dessert:   'ของหวาน',
  drink:     'เครื่องดื่ม',
  sauce:     'ซอส',
};

/* ─── Receipt ────────────────────────────────────────────────────────────── */

export async function renderReceiptHTML(data: ReceiptData): Promise<string> {
  const qr = await qrImg(data.sessionId);

  const itemRows = data.items
    .map((i) => row(i.name, `x${i.quantity}  ฿${i.total.toFixed(2)}`))
    .join('\n');

  const discountRow =
    data.discount > 0 ? row('ส่วนลด', `-฿${data.discount.toFixed(2)}`) : '';
  const serviceRow =
    data.serviceCharge > 0
      ? row('ค่าบริการ', `+฿${data.serviceCharge.toFixed(2)}`)
      : '';

  return `
<div class="center">
  <div class="big">${esc(data.shopName)}</div>
  ${data.shopAddress ? `<div>${esc(data.shopAddress)}</div>` : ''}
  ${data.taxId ? `<div>เลขที่ผู้เสียภาษี: ${esc(data.taxId)}</div>` : ''}
</div>
${hr()}
<div>โต๊ะ: ${data.tableNumber}&nbsp;&nbsp; พนักงาน: ${esc(data.cashierName)}</div>
<div>วันที่: ${esc(data.paidAt)}</div>
${hr()}
${itemRows}
${hr()}
${row('รวม', `฿${data.subtotal.toFixed(2)}`)}
${discountRow}
${serviceRow}
${row('ยอดชำระ', `฿${data.total.toFixed(2)}`, true)}
${hr()}
${row('รับเงิน', `฿${data.receivedAmount.toFixed(2)}`)}
${row('ทอน', `฿${data.changeAmount.toFixed(2)}`)}
<div>ชำระด้วย: ${esc(data.paymentMethod)}</div>
${hr()}
${qr}
<div class="center">ขอบคุณที่ใช้บริการ</div>
`.trim();
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

  return `
<div class="center">
  <div class="bold">ตั๋วคิว</div>
  <div class="xl">${esc(data.queueNumber)}</div>
  <div>จำนวน ${data.partySize} ท่าน</div>
</div>
${hr()}
${qr}
<div class="center">สแกนเพื่อติดตามคิว</div>
${hr()}
<div>เวลา: ${esc(data.createdAt)}</div>
`.trim();
}

/* ─── Kitchen Order ──────────────────────────────────────────────────────── */

export async function renderKitchenOrderHTML(data: KitchenOrderData): Promise<string> {
  const stationLabel = STATION_LABEL[data.station] ?? data.station;

  const itemRows = data.items
    .map((i) => {
      const noteRow = i.notes
        ? `<div style="padding-left:8px;color:#555;">→ ${esc(i.notes)}</div>`
        : '';
      return row(i.name, `x${i.quantity}`) + noteRow;
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
