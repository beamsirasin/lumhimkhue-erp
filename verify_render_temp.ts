import { resolveBillConfig } from './lib/utils/billConfig';
import { renderReceiptHTML } from './lib/printer/templates';

// Use the ACTUAL DB state after our test save
const settings: any = {
  id: 1,
  shopNameTh: "ลำ ฮิม คือ ชาบู บุฟเฟต์",
  shopNameEn: "",
  companyName: "หจก. ลำฮืมคือ",
  address: "61/4 ถ.อารักษ์ ต.พระสิงห์ อ.เมืองเชียงใหม่",
  phone: "0816714363",
  taxId: "0505556010124",
  branch: "สำนักงานใหญ่",
  registerNo: "00000",
  footerNote: "ขอบคุณและขอให้โชคดี",
  vatPercent: 7,
  billPaperWidth: 58,
  logoHeight: 100,
  logoUrl: "data:image/png;base64,TEST",
  taxInvoicePrefix: "LHK",
  receiptCounter: 0,
  receiptCounterDate: "",
  // Updated bill_main_config from save test above
  billMainConfig: { billTypeLabel: "food", hiddenFields: ["shopNameEn", "registerNo", "address"] },
  billPreviewConfig: { billTypeLabel: "food", hiddenFields: ["taxId", "branch", "registerNo"] },
  billSecondaryConfig: { billTypeLabel: "receipt_short", hiddenFields: ["vatPercent", "branch", "taxId"] },
  billTaxInvoiceConfig: null,
};

// Simulate handleSubmit buildShopInfo for main bill type
const cfg = resolveBillConfig(settings, 'main');
console.log('\n=== resolveBillConfig(settings, "main") ===');
console.log('billTypeLabel:', cfg.billTypeLabel);
console.log('address:', cfg.address);
console.log('shopNameTh:', cfg.shopNameTh);
console.log('registerNo:', cfg.registerNo);
console.log('hiddenFields:', cfg.hiddenFields);

const receiptData = {
  receiptType: 'receipt' as const,
  billTypeLabel: cfg.billTypeLabel,
  paperWidth: 58 as const,
  logoUrl: cfg.logoUrl,
  logoHeight: cfg.logoHeight,
  shopNameTh: cfg.shopNameTh ?? '',
  shopNameEn: cfg.shopNameEn,
  companyName: cfg.companyName,
  shopAddress: cfg.address,
  phone: cfg.phone,
  taxId: cfg.taxId,
  branch: cfg.branch,
  registerNo: cfg.registerNo,
  footerNote: cfg.footerNote,
  vatPercent: cfg.vatPercent ?? 7,
  receiptNo: '2605/00001',
  tableNumber: 'T1',
  cashierName: 'แคชเชียร์',
  paidAt: '1/6/68 12:00',
  sessionId: 'test',
  items: [
    { name: 'ผู้ใหญ่', quantity: 2, total: 532 },
    { name: 'เด็ก', quantity: 1, total: 89 },
  ],
  subtotal: 621,
  discount: 0,
  serviceCharge: 0,
  total: 621,
  receivedAmount: 700,
  changeAmount: 79,
  paymentMethod: 'เงินสด',
};

const html = await renderReceiptHTML(receiptData);
console.log('\n=== Rendered HTML (key parts) ===');

// Extract key sections
const docTitle = html.match(/<div class="center bold">([^<]+)<\/div>/)?.[1];
const hasAddress = html.includes('ถ.อารักษ์');
const hasRegisterNo = html.includes('Register No');
const hasTaxId = html.includes('เลขประจำตัวผู้เสียภาษี');
const hasBranch = html.includes('สาขา');
const hasLogo = html.includes('<img');
const hasVatRow = html.includes('ภาษีมูลค่าเพิ่ม');
const hasReceiptNo = html.includes('2605/00001');

console.log('Document title:', docTitle);
console.log('Has address?', hasAddress ? '✅ YES (should NOT show)' : '❌ NO (address hidden ✓)');
console.log('Has Register No?', hasRegisterNo ? '⚠️ YES' : '✓ hidden');
console.log('Has Tax ID?', hasTaxId ? '✅ YES' : '❌ hidden');
console.log('Has Branch?', hasBranch ? '✅ YES' : '❌ hidden');
console.log('Has Logo?', hasLogo ? '✅ YES' : '❌ hidden');
console.log('Has VAT row?', hasVatRow ? '✅ YES' : '❌ hidden');
console.log('Has Receipt No?', hasReceiptNo ? '✅ YES' : '❌ hidden');

// Expect: no address, no registerNo, title=บิลรายการอาหาร, has taxId, hasBranch
const pass = docTitle === 'บิลรายการอาหาร' && !hasAddress && !hasRegisterNo;
console.log('\n=== VERDICT ===');
console.log(pass ? '✅ TEMPLATE APPLIED CORRECTLY' : '❌ TEMPLATE NOT APPLIED');
if (!pass) {
  console.log('Expected: docTitle=บิลรายการอาหาร, no address, no registerNo');
  console.log('Got: docTitle='+docTitle+', hasAddress='+hasAddress+', hasRegisterNo='+hasRegisterNo);
}
