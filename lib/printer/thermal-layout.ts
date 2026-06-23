/**
 * Shared thermal receipt layout builder.
 *
 * Produces a renderer-agnostic ThermalLine[] from ReceiptData.
 * All three renderers (ESC/POS, bitmap, HTML) consume the same output,
 * so preview and actual print always share identical structure, labels,
 * section order, and hidden-field behaviour.
 */

import { RECEIPT_ITEM_COLUMNS } from './types';
import type { ReceiptData, ThermalLine } from './types';

export function buildThermalReceiptLines(data: ReceiptData): ThermalLine[] {
  const lines: ThermalLine[] = [];
  const isReceipt     = data.receiptType === 'receipt';
  const label         = data.billTypeLabel ?? (isReceipt ? 'receipt_short' : 'food');
  const isTaxFull     = label === 'tax_full';
  const showTax       = isReceipt || isTaxFull;
  const vat           = data.vatPercent ?? 7;
  const vatAmt        = showTax && vat > 0 ? data.total * vat / (100 + vat) : 0;
  const isPaymentEvent = data.receiptKind === 'payment_event';
  const isFullBill    = data.receiptKind === 'full_bill';

  /* ── Shop header ── */
  if (data.shopNameTh)  lines.push({ t: 'text', s: data.shopNameTh,  a: 'c', bold: true, big: true });
  if (data.shopNameEn)  lines.push({ t: 'text', s: data.shopNameEn,  a: 'c' });
  if (data.companyName) lines.push({ t: 'text', s: data.companyName, a: 'c' });
  if (data.shopAddress) lines.push({ t: 'text', s: data.shopAddress, a: 'c' });
  if (data.phone)       lines.push({ t: 'text', s: `โทรศัพท์: ${data.phone}`, a: 'c' });
  if (data.taxId)       lines.push({ t: 'text', s: `เลขผู้เสียภาษี: ${data.taxId}`, a: 'c' });
  if (data.branch)      lines.push({ t: 'text', s: `สาขา: ${data.branch}`, a: 'c' });
  if (data.registerNo)  lines.push({ t: 'text', s: `Register No: ${data.registerNo}`, a: 'c' });

  /* ── Buyer info (tax invoice only) ── */
  if (isTaxFull && data.buyerInfo) {
    lines.push({ t: 'hr' });
    lines.push({ t: 'text', s: 'ข้อมูลผู้ซื้อ', a: 'c', bold: true });
    lines.push({ t: 'text', s: data.buyerInfo.companyName, a: 'l' });
    lines.push({ t: 'text', s: data.buyerInfo.address,     a: 'l' });
    lines.push({ t: 'text', s: `เลขผู้เสียภาษี: ${data.buyerInfo.taxId}`, a: 'l' });
  }

  /* ── Document title ── */
  lines.push({ t: 'hr' });
  const baseTitle =
    label === 'food'          ? 'บิลรายการอาหาร' :
    label === 'receipt_short' ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ' :
                                'ใบกำกับภาษี';
  const docTitle =
    isFullBill                                              ? 'ใบเสร็จรวม / ใบสรุปบิล' :
    isPaymentEvent && data.settlementType === 'partial'     ? 'ใบรับชำระ / ใบรับชำระบางส่วน' :
    isPaymentEvent && data.settlementType === 'final'       ? 'ใบเสร็จรับเงิน / ใบปิดบิล' :
    baseTitle;
  lines.push({ t: 'text', s: docTitle, a: 'c', bold: true });
  if (label === 'receipt_short' && !isPaymentEvent && !isFullBill)
    lines.push({ t: 'text', s: 'ราคารวมภาษีมูลค่าเพิ่มแล้ว', a: 'c' });

  /* ── Transaction metadata ── */
  lines.push({ t: 'hr' });
  if (data.receiptNo)   lines.push({ t: 'row', l: 'เลขที่',      r: data.receiptNo });
  if (data.tableNumber) lines.push({ t: 'row', l: 'โต๊ะ',        r: data.tableNumber });
  if (data.cashierName) lines.push({ t: 'row', l: 'แคชเชียร์',   r: data.cashierName });
  if (data.paidAt)      lines.push({ t: 'row', l: 'วันที่/เวลา', r: data.paidAt });

  /* ── Item table ── */
  lines.push({ t: 'hr' });
  lines.push({ t: 'row', l: RECEIPT_ITEM_COLUMNS.name, r: `${RECEIPT_ITEM_COLUMNS.qty}   ${RECEIPT_ITEM_COLUMNS.total}`, bold: true });
  for (const item of data.items)
    lines.push({ t: 'row', l: item.name, r: `x${item.quantity}  ฿${item.total.toFixed(2)}` });

  /* ── Totals ── */
  lines.push({ t: 'hr' });
  lines.push({ t: 'row', l: 'ยอดรวม',    r: `฿${data.subtotal.toFixed(2)}` });
  if (data.discount > 0)
    lines.push({ t: 'row', l: 'ส่วนลด',   r: `-฿${data.discount.toFixed(2)}` });
  if (data.serviceCharge > 0)
    lines.push({ t: 'row', l: 'ค่าบริการ', r: `+฿${data.serviceCharge.toFixed(2)}` });
  if (showTax && vatAmt > 0)
    lines.push({ t: 'row', l: `VAT ${vat}% (รวม)`, r: vatAmt.toFixed(2) });
  lines.push({ t: 'row', l: 'ทั้งหมด',   r: `฿${data.total.toFixed(2)}`, bold: true });

  /* ── Footer ── */
  if (data.footerNote) {
    lines.push({ t: 'hr' });
    lines.push({ t: 'text', s: data.footerNote, a: 'c' });
  }

  lines.push({ t: 'sp' });
  return lines;
}
