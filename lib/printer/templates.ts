/**
 * HTML templates for browser (window.print) fallback.
 */

import QRCode from 'qrcode';
import type { ReceiptData, TableQrData, QueueQrData, KitchenOrderData } from './types';

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

/** Three-column table row: name | qty | total */
function itemRow(name: string, qty: number, total: number): string {
  return `<div class="item-row"><span class="item-name">${esc(name)}</span><span class="item-qty">${qty}</span><span class="item-total">${total.toFixed(2)}</span></div>`;
}

const STATION_LABEL: Record<string, string> = {
  meat: 'เนื้อสัตว์', seafood: 'ทะเล', vegetable: 'ผัก',
  noodle: 'เส้น', dessert: 'ของหวาน', drink: 'เครื่องดื่ม', sauce: 'ซอส',
};

/* ─── Receipt / Bill ────────────────────────────────────────────────────── */

export async function renderReceiptHTML(data: ReceiptData): Promise<string> {
  const isReceipt = data.receiptType === 'receipt';
  const vat = data.vatPercent ?? 7;
  const vatAmount = isReceipt ? data.total * vat / (100 + vat) : 0;

  /* Header block */
  const header = `
<div class="center">
  ${data.logoUrl ? `<div class="logo-wrap"><img src="${data.logoUrl}" alt="logo" class="logo" /></div>` : ''}
  <div class="big bold">${esc(data.shopNameTh)}</div>
  ${data.shopNameEn ? `<div>${esc(data.shopNameEn)}</div>` : ''}
  ${data.companyName ? `<div>${esc(data.companyName)}</div>` : ''}
  ${data.shopAddress ? `<div class="small">${esc(data.shopAddress)}</div>` : ''}
  ${data.phone ? `<div>โทรศัพท์: ${esc(data.phone)}</div>` : ''}
  ${isReceipt && data.taxId ? `<div class="small">เลขประจำตัวผู้เสียภาษีอากร: ${esc(data.taxId)}</div>` : ''}
  ${isReceipt && data.branch ? `<div>สาขา: ${esc(data.branch)}</div>` : ''}
  ${isReceipt && data.registerNo ? `<div class="small">Register No: ${esc(data.registerNo)}</div>` : ''}
</div>`;

  /* Document type label */
  const docLabel = isReceipt
    ? `<div class="center bold">ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ</div>
       <div class="center small">ราคารวมภาษีมูลค่าเพิ่มแล้ว</div>`
    : `<div class="center bold">บิลรายการอาหาร</div>`;

  /* Transaction details */
  const txDetails = `
${data.receiptNo ? row('เลขที่', data.receiptNo) : ''}
${row(`โต๊ะ`, data.tableNumber)}
${isReceipt ? row('แคชเชียร์', data.cashierName) : ''}
${row('วันที่/เวลา', data.paidAt)}`;

  /* Items */
  const itemHeader = `<div class="item-row bold"><span class="item-name">สินค้า</span><span class="item-qty">Qty</span><span class="item-total">ราคารวม</span></div>`;
  const itemRows = data.items.map((i) => itemRow(i.name, i.quantity, i.total)).join('\n');

  /* Totals */
  const discountRow = data.discount > 0 ? row('ส่วนลด', `-฿${data.discount.toFixed(2)}`) : '';
  const totalsBlock = `
${row('ยอดรวม', `${data.subtotal.toFixed(2)}`)}
${discountRow}
${isReceipt && vatAmount > 0 ? row(`ภาษีมูลค่าเพิ่ม ${vat}% (รวม)`, vatAmount.toFixed(2)) : ''}
${row('ทั้งหมด', `฿${data.total.toFixed(2)}`, true)}`;

  /* Payment (receipt only) */
  const paymentBlock = isReceipt ? `
${hr()}
${row(data.paymentMethod, `฿${data.receivedAmount.toFixed(2)}`)}
${data.changeAmount > 0 ? row('เงินทอน', `฿${data.changeAmount.toFixed(2)}`) : ''}` : '';

  /* Footer */
  const footer = `<div class="center">${esc(data.footerNote ?? 'ขอบคุณและขอให้โชคดี')}</div>`;

  return `
${header}
${hr()}
${docLabel}
${hr()}
${txDetails}
${hr()}
${itemHeader}
${itemRows}
${hr()}
${totalsBlock}
${paymentBlock}
${hr()}
${footer}
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
