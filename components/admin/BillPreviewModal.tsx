'use client';

import { X } from 'lucide-react';

const TAB_LABEL: Record<string, string> = {
  global:    'ข้อมูลหลัก',
  preview:   'บิลธรรมดา',
  main:      'บัญชีหลัก',
  secondary: 'บัญชีรอง',
};

const SAMPLE_ITEMS = [
  { name: 'ผู้ใหญ่', qty: 2, total: 532 },
  { name: 'เด็ก',   qty: 1, total:  89 },
];
const SAMPLE_SUBTOTAL = 621;
const SAMPLE_TOTAL    = 621;

type GlobalForm = {
  shopNameTh: string; shopNameEn: string; companyName: string;
  address: string; phone: string; taxId: string;
  branch: string; registerNo: string; footerNote: string; vatPercent: number;
};

interface Props {
  billType: string;
  globalForm: GlobalForm;
  billForm: Record<string, string>;
  billVisible: Record<string, boolean>;
  logoUrl: string;
  paperWidth: 58 | 80;
  onClose: () => void;
}

function resolveField(
  key: string,
  billForm: Record<string, string>,
  billVisible: Record<string, boolean>,
  globalForm: GlobalForm,
  isGlobal: boolean,
): string | undefined {
  if (isGlobal) return (globalForm as Record<string, string | number>)[key] as string || undefined;
  if (key in billVisible && !billVisible[key]) return undefined;
  return billForm[key] || ((globalForm as Record<string, string | number>)[key] as string) || undefined;
}

export function BillPreviewModal({ billType, globalForm, billForm, billVisible, logoUrl, paperWidth, onClose }: Props) {
  const isGlobal  = billType === 'global';
  const isReceipt = !isGlobal && billType !== 'preview';

  const r = (key: string) => resolveField(key, billForm, billVisible, globalForm, isGlobal);

  const shopNameTh  = r('shopNameTh') || 'ชื่อร้าน';
  const shopNameEn  = r('shopNameEn');
  const companyName = r('companyName');
  const address     = r('address');
  const phone       = r('phone');
  const taxId       = r('taxId');
  const branch      = r('branch');
  const registerNo  = r('registerNo');
  const footerNote  = r('footerNote') || 'ขอบคุณและขอให้โชคดี';

  const vatPctRaw  = r('vatPercent');
  const vatPercent = billVisible['vatPercent'] === false ? 0 : Number(vatPctRaw ?? globalForm.vatPercent ?? 7);
  const vatAmount  = isReceipt && vatPercent > 0 ? SAMPLE_TOTAL * vatPercent / (100 + vatPercent) : 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] overflow-y-auto rounded-2xl bg-slate-100 shadow-2xl"
        style={{ width: paperWidth === 58 ? 224 : 320 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-3 bg-white rounded-t-2xl border-b border-slate-100">
          <div>
            <p className="text-sm font-semibold text-slate-900">ตัวอย่างบิล</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-xs text-slate-400">{TAB_LABEL[billType] ?? billType}</p>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                {paperWidth}mm
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-100"
          >
            <X className="size-4 text-slate-500" />
          </button>
        </div>

        {/* Receipt paper */}
        <div className="p-3">
          <div
            className="bg-white rounded-lg p-3 shadow-sm text-[11px] leading-snug space-y-0.5"
            style={{ fontFamily: "'IBM Plex Sans Thai', 'TH Sarabun New', monospace" }}
          >
            {/* Logo */}
            {logoUrl && (
              <div className="flex justify-center mb-2">
                <img src={logoUrl} alt="โลโก้" className="max-h-14 max-w-full object-contain" />
              </div>
            )}

            {/* Shop header */}
            <p className="text-center font-bold text-sm">{shopNameTh}</p>
            {shopNameEn  && <p className="text-center">{shopNameEn}</p>}
            {companyName && <p className="text-center">{companyName}</p>}
            {address     && <p className="text-center text-[10px]">{address}</p>}
            {phone       && <p className="text-center">โทรศัพท์: {phone}</p>}
            {isReceipt && taxId       && <p className="text-center text-[10px]">เลขประจำตัวผู้เสียภาษี: {taxId}</p>}
            {isReceipt && branch      && <p className="text-center">สาขา: {branch}</p>}
            {isReceipt && registerNo  && <p className="text-center text-[10px]">Register No: {registerNo}</p>}

            <Divider />
            <p className="text-center font-bold">
              {isReceipt ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'บิลรายการอาหาร'}
            </p>
            {isReceipt && <p className="text-center text-[10px]">ราคารวมภาษีมูลค่าเพิ่มแล้ว</p>}

            <Divider />
            <Row label="โต๊ะ"        value="T1" />
            {isReceipt && <Row label="แคชเชียร์" value="ตัวอย่าง" />}
            <Row label="วันที่/เวลา" value="01/01/2568 12:00" />

            <Divider />
            <div className="flex gap-1">
              <span className="flex-1 font-bold">สินค้า</span>
              <span className="w-6 text-center font-bold">Qty</span>
              <span className="w-16 text-right font-bold">ราคารวม</span>
            </div>
            {SAMPLE_ITEMS.map((item, i) => (
              <div key={i} className="flex gap-1">
                <span className="flex-1">{item.name}</span>
                <span className="w-6 text-center">{item.qty}</span>
                <span className="w-16 text-right tabular-nums">{item.total.toFixed(2)}</span>
              </div>
            ))}

            <Divider />
            <Row label="ยอดรวม" value={`${SAMPLE_SUBTOTAL.toFixed(2)}`} />
            {vatAmount > 0 && (
              <Row label={`ภาษีมูลค่าเพิ่ม ${vatPercent}% (รวม)`} value={vatAmount.toFixed(2)} />
            )}
            <Row label="ทั้งหมด" value={`฿${SAMPLE_TOTAL.toFixed(2)}`} bold />

            {isReceipt && (
              <>
                <Divider />
                <Row label="เงินสด"   value="฿700.00" />
                <Row label="เงินทอน"  value="฿79.00" />
              </>
            )}

            <Divider />
            <p className="text-center">{footerNote}</p>
          </div>

          <p className="mt-2 text-center text-[10px] text-slate-400">
            * รายการและยอดเงินเป็นข้อมูลตัวอย่าง *
          </p>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-dashed border-slate-300 my-1" />;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-1 ${bold ? 'font-bold' : ''}`}>
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
