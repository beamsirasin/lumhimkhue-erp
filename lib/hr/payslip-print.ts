/**
 * HR payslip printing — routes through the app's configured DEFAULT printer
 * (USB / Network / Android Bridge), same as receipts, instead of window.print().
 *
 * Byte transports always use the bitmap path (buildBitmapFromLines): payslips
 * are Thai-heavy and low-volume, and bitmap rendering is correct on every
 * ESC/POS printer regardless of Thai codepage support.
 *
 * Falls back to the browser print window only when no printer is configured
 * or the configured printer type is 'browser'.
 *
 * Client-side only (canvas, localStorage/idb printer store).
 */

import { getDefaultPrinter } from '@/lib/printer/store';
import { buildBitmapFromLines } from '@/lib/printer/bitmap';
import { findPairedDevice, sendUSB } from '@/lib/printer/transports/usb';
import { sendNetwork } from '@/lib/printer/transports/network';
import { sendAndroidBridge, isAndroidBridgeAvailable } from '@/lib/printer/transports/android-bridge';
import { printBrowser } from '@/lib/printer/transports/browser';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date-time';
import { deptLabelOf } from '@/lib/hr/departments';
import type { ThermalLine, PrinterConfig } from '@/lib/printer/types';
import type { PayrollCycle, PayrollItem, PayrollDeduction, PayrollAbsence, Employee, HrSettings } from '@/lib/db/schema';

export type PayslipItem = PayrollItem & {
  employee?: Employee;
  deductions: PayrollDeduction[];
  absences: PayrollAbsence[];
};

export type PayslipPrintResult = { ok: true } | { ok: false; error: string };

const PAID_METHOD_LABELS: Record<string, string> = {
  cash: 'เงินสด',
  transfer: 'โอน',
  mixed: 'เงินสด+โอน',
};

function fmtMoney(n: number | string): string {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

/**
 * Payment channel display text incl. actual paid amounts,
 * e.g. "เงินสด ฿5,000.00 + โอน ฿3,000.00". Falls back to the plain method
 * label for records saved before amount tracking existed.
 */
export function paidChannelLabel(item: PayslipItem): string {
  if (!item.isPaid) return 'ยังไม่จ่าย';
  const cash = Number(item.paidCashAmount ?? 0);
  const transfer = Number(item.paidTransferAmount ?? 0);
  switch (item.paidMethod) {
    case 'cash':
      return cash > 0 ? `เงินสด ฿${fmtMoney(cash)}` : 'เงินสด';
    case 'transfer':
      return transfer > 0 ? `โอน ฿${fmtMoney(transfer)}` : 'โอน';
    case 'mixed':
      return cash > 0 || transfer > 0
        ? `เงินสด ฿${fmtMoney(cash)} + โอน ฿${fmtMoney(transfer)}`
        : 'เงินสด+โอน';
    default:
      return '-';
  }
}

const SIGN_DOTS = '.'.repeat(20);

/** Renderer-agnostic payslip layout — mirrors the on-screen PayslipContent. */
export function buildPayslipLines(item: PayslipItem, cycle: PayrollCycle, settings: HrSettings): ThermalLine[] {
  const emp = item.employee;
  const lines: ThermalLine[] = [];

  lines.push({ t: 'text', s: 'ใบจ่ายเงินเดือน', a: 'c', bold: true, big: true });
  lines.push({ t: 'text', s: `งวดจ่ายวันที่ ${formatThaiDate(cycle.payDate)}`, a: 'c' });
  lines.push({ t: 'text', s: `ช่วงงาน ${formatThaiDate(cycle.workStartDate)} – ${formatThaiDate(cycle.workEndDate)}`, a: 'c' });
  lines.push({ t: 'hr' });

  lines.push({ t: 'row', l: 'ชื่อ-สกุล', r: `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim() });
  lines.push({ t: 'row', l: 'แผนก', r: deptLabelOf(emp?.department) });
  lines.push({ t: 'row', l: 'ประเภท', r: item.employeeType === 'full_time' ? 'พนักงานประจำ' : 'พาร์ทไทม์' });
  lines.push({ t: 'row', l: 'ช่องทางจ่าย', r: paidChannelLabel(item) });
  lines.push({ t: 'hr' });

  lines.push({ t: 'text', s: 'รายได้', a: 'l', bold: true });
  if (item.employeeType === 'full_time') {
    lines.push({ t: 'row', l: 'เงินเดือนฐาน', r: `฿${fmtMoney(item.baseSalary)}` });
    lines.push({ t: 'row', l: `Incentive (${item.workDays} วัน × ฿${fmtMoney(item.incentivePerDay)})`, r: `฿${fmtMoney(item.incentiveTotal)}` });
  } else {
    lines.push({ t: 'row', l: `ชั่วโมง (${Number(item.totalHours).toFixed(2)} ชม. × ฿${fmtMoney(item.hourlyRate)})`, r: `฿${fmtMoney(item.hourlyTotal)}` });
  }
  lines.push({ t: 'row', l: 'รวมรายได้', r: `฿${fmtMoney(item.gross)}`, bold: true });

  if (Number(item.totalDeduction) > 0) {
    lines.push({ t: 'hr' });
    lines.push({ t: 'text', s: 'รายการหัก', a: 'l', bold: true });
    for (const d of item.deductions.filter((d) => d.type === 'advance')) {
      lines.push({ t: 'row', l: `เบิก: ${d.reason}`, r: `-฿${fmtMoney(d.amount)}` });
    }
    for (const d of item.deductions.filter((d) => d.type === 'damage')) {
      lines.push({ t: 'row', l: `เสียหาย: ${d.reason}`, r: `-฿${fmtMoney(d.amount)}` });
    }
    if (Number(item.absenceDeduction) > 0) {
      lines.push({ t: 'row', l: `ขาด ${item.absenceDays} วัน × ฿${fmtMoney(settings.absenceRatePerDay)}`, r: `-฿${fmtMoney(item.absenceDeduction)}` });
    }
    if (Number(item.lateDeduction) > 0) {
      lines.push({ t: 'row', l: `สาย ${item.lateMinutes} นาที × ฿${fmtMoney(settings.lateRatePerMinute)}`, r: `-฿${fmtMoney(item.lateDeduction)}` });
    }
    lines.push({ t: 'row', l: 'รวมหัก', r: `-฿${fmtMoney(item.totalDeduction)}`, bold: true });
  }

  lines.push({ t: 'hr' });
  lines.push({ t: 'row', l: 'เงินสุทธิ', r: `฿${fmtMoney(item.netPay)}`, bold: true });

  if (item.isPaid) {
    const when = item.paidAt ? ` เมื่อ ${formatThaiDateTime(item.paidAt)}` : '';
    lines.push({ t: 'text', s: `จ่ายแล้ว (${PAID_METHOD_LABELS[item.paidMethod ?? ''] ?? '-'})${when}`, a: 'c' });
  }

  // Signature block — payer left, receiver right, generous space to sign in.
  // No date line: the pay date is already printed in the slip header.
  lines.push({ t: 'sp', n: 3 });
  lines.push({ t: 'row', l: SIGN_DOTS, r: SIGN_DOTS });
  lines.push({ t: 'row', l: '   ผู้จ่ายเงิน', r: 'ผู้รับเงิน   ' });

  return lines;
}

/**
 * Print a payslip on the default configured printer.
 * `fallbackHtml` is used for the browser print window when no byte-capable
 * printer is configured.
 */
export async function printPayslip(
  item: PayslipItem,
  cycle: PayrollCycle,
  settings: HrSettings,
  fallbackHtml: string,
): Promise<PayslipPrintResult> {
  let config: PrinterConfig | null = null;
  try {
    config = await getDefaultPrinter();
  } catch {
    config = null;
  }

  if (!config || config.type === 'browser') {
    try {
      printBrowser(fallbackHtml, config?.paperWidth ?? 80);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'พิมพ์ไม่สำเร็จ' };
    }
  }

  try {
    const bytes = await buildBitmapFromLines(buildPayslipLines(item, cycle, settings), config.paperWidth);

    if (config.type === 'usb') {
      if (!config.usbVendorId || !config.usbProductId)
        throw new Error('ไม่พบข้อมูล USB (vendorId / productId)');
      const device = await findPairedDevice(config.usbVendorId, config.usbProductId);
      if (!device) throw new Error('ไม่พบ printer USB ที่จับคู่ไว้ กรุณาเสียบสาย OTG');
      await sendUSB(device, bytes);
    } else if (config.type === 'network') {
      if (!config.ipAddress) throw new Error('ไม่พบ IP address ของ printer');
      await sendNetwork(config.ipAddress, config.port ?? 9100, bytes);
    } else {
      // android_bridge
      if (!isAndroidBridgeAvailable())
        throw new Error('ต้องเปิดผ่าน Android POS App เพื่อพิมพ์ด้วยวิธีนี้');
      // jobType 'receipt': bytes are pre-encoded; the bridge uses jobType as metadata only.
      sendAndroidBridge(
        config.id,
        config.name,
        config.androidTarget ?? 'usb_otg',
        bytes,
        'receipt',
        config.paperWidth,
        config.ipAddress,
        config.port,
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'พิมพ์ไม่สำเร็จ' };
  }
}
