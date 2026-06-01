'use client';

import { useEffect, useRef, useState } from 'react';
import { renderReceiptHTML } from '@/lib/printer/templates';
import { buildPrintCSS } from '@/lib/printer/transports/browser';
import type { ReceiptData } from '@/lib/printer/types';
import type { BillTypeLabel } from '@/lib/db/schema';

const SAMPLE_ITEMS: ReceiptData['items'] = [
  { name: 'ผู้ใหญ่', quantity: 2, total: 532 },
  { name: 'เด็ก',   quantity: 1, total:  89 },
];
const SAMPLE_SUBTOTAL = 621;

interface Props {
  paperWidth: 58 | 80;
  billTypeLabel: BillTypeLabel;
  /** 'preview' = food bill printed before payment; others = payment receipt */
  billTypeKey: 'preview' | 'main' | 'secondary' | 'taxInvoice';
  shopNameTh: string;
  shopNameEn?: string;
  companyName?: string;
  address?: string;
  phone?: string;
  taxId?: string;
  branch?: string;
  registerNo?: string;
  footerNote?: string;
  vatPercent: number;
  logoUrl?: string;
  logoHeight: number;
  receiptNo?: string;
  /** Fields hidden for this bill type */
  hiddenFields?: string[];
}

function buildSampleData(props: Props): ReceiptData {
  const hidden = new Set(props.hiddenFields ?? []);
  // 'preview' tab always prints a food-bill (receiptType='bill'), regardless of billTypeLabel.
  // Payment tabs (main/secondary/taxInvoice) always print a receipt (receiptType='receipt').
  const isReceipt = props.billTypeKey !== 'preview';
  const vat = hidden.has('vatPercent') ? 0 : props.vatPercent;
  const vatAmt = isReceipt && vat > 0 ? SAMPLE_SUBTOTAL * vat / (100 + vat) : 0;

  return {
    receiptType:   isReceipt ? 'receipt' : 'bill',
    billTypeLabel: props.billTypeLabel,
    paperWidth:    props.paperWidth,
    logoUrl:       hidden.has('logo')      ? undefined : props.logoUrl,
    logoHeight:    props.logoHeight,
    shopNameTh:    hidden.has('shopName')  ? '' : (props.shopNameTh || 'ชื่อร้าน'),
    shopNameEn:    hidden.has('shopName')  ? undefined : props.shopNameEn,
    companyName:   hidden.has('shopName')  ? undefined : props.companyName,
    shopAddress:   hidden.has('address')   ? undefined : props.address,
    phone:         props.phone,
    taxId:         hidden.has('taxId')     ? undefined : props.taxId,
    branch:        hidden.has('branch')    ? undefined : props.branch,
    registerNo:    props.registerNo,
    footerNote:    hidden.has('footerNote')? undefined : (props.footerNote || 'ขอบคุณและขอให้โชคดี'),
    vatPercent:    vat,
    receiptNo:     hidden.has('receiptNo') ? undefined : (props.receiptNo || '2605/00001'),
    tableNumber:   hidden.has('tableNo')   ? '' : 'T1',
    cashierName:   hidden.has('cashier')   ? '' : 'พนักงาน',
    paidAt:        hidden.has('date')      ? '' : new Date().toLocaleDateString('th-TH', { dateStyle: 'short' }) + ' 12:00',
    sessionId:     'preview',
    items:         SAMPLE_ITEMS,
    subtotal:      SAMPLE_SUBTOTAL,
    discount:      0,
    serviceCharge: 0,
    total:         SAMPLE_SUBTOTAL,
    receivedAmount: isReceipt ? 700 : 0,
    changeAmount:   isReceipt ? 79  : 0,
    paymentMethod: 'เงินสด',
    buyerInfo: props.billTypeLabel === 'tax_full' ? {
      companyName: 'บริษัท ตัวอย่าง จำกัด',
      address:     '1/1 ถ.ตัวอย่าง กรุงเทพฯ 10100',
      taxId:       '0105555012345',
    } : undefined,
  };
}

export function BillLivePreview(props: Props) {
  const [html, setHtml] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    renderReceiptHTML(buildSampleData(props)).then((h) => {
      if (!cancelled) setHtml(h);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.paperWidth, props.billTypeLabel, props.billTypeKey, props.shopNameTh, props.shopNameEn,
    props.companyName, props.address, props.phone, props.taxId, props.branch,
    props.registerNo, props.footerNote, props.vatPercent, props.logoUrl,
    props.logoHeight, props.receiptNo, JSON.stringify(props.hiddenFields),
  ]);

  const css = buildPrintCSS(props.paperWidth);
  const paperPx = props.paperWidth === 58 ? 219 : 303; // mm → px at 96dpi

  const fullHtml = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500&display=swap" rel="stylesheet"/>
<style>
${css}
body { margin: 0 auto; background: #fff; }
</style>
</head>
<body>${html}</body>
</html>`;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Paper label */}
      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">
        {props.paperWidth}mm · ตัวอย่างบิล
      </span>

      {/* Paper shadow frame */}
      <div
        className="bg-white shadow-md rounded"
        style={{ width: paperPx, minHeight: 200 }}
      >
        <iframe
          ref={iframeRef}
          srcDoc={fullHtml}
          title="ตัวอย่างบิล"
          scrolling="no"
          className="w-full border-0 rounded"
          style={{ width: paperPx, minHeight: 200 }}
          onLoad={() => {
            const iframe = iframeRef.current;
            if (iframe?.contentDocument?.body) {
              const h = iframe.contentDocument.body.scrollHeight;
              iframe.style.height = `${h + 8}px`;
            }
          }}
        />
      </div>

      <p className="text-[10px] text-slate-400">* รายการและยอดเงินเป็นข้อมูลตัวอย่าง *</p>
    </div>
  );
}
