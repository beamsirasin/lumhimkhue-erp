import type { BillConfig, BillTypeLabel, StoreSettings } from '@/lib/db/schema';

export type BillTypeKey = 'preview' | 'main' | 'secondary' | 'taxInvoice' | `account:${string}`;

export function resolveBillConfig(
  settings: StoreSettings,
  billType: BillTypeKey,
): BillConfig {
  const global: BillConfig = {
    shopNameTh:  settings.shopNameTh,
    shopNameEn:  settings.shopNameEn ?? undefined,
    companyName: settings.companyName ?? undefined,
    address:     settings.address ?? undefined,
    phone:       settings.phone ?? undefined,
    taxId:       settings.taxId ?? undefined,
    branch:      settings.branch ?? undefined,
    registerNo:  settings.registerNo ?? undefined,
    footerNote:  settings.footerNote ?? undefined,
    vatPercent:  settings.vatPercent ?? 7,
    logoUrl:     settings.logoUrl ?? undefined,
    logoHeight:  settings.logoHeight ?? 56,
  };

  let override: BillConfig | null | undefined;

  if (billType.startsWith('account:')) {
    const code = billType.slice(8);
    const accountCfgs = settings.billAccountConfigs as Record<string, BillConfig> | null | undefined;
    // First check per-account config; fall back to legacy main/secondary for known codes
    override = accountCfgs?.[code] ??
      (code === 'bank_cash_a' ? settings.billMainConfig :
       code === 'bank_cash_b' ? settings.billSecondaryConfig :
       null);
  } else {
    override =
      billType === 'preview'   ? settings.billPreviewConfig :
      billType === 'main'      ? settings.billMainConfig :
      billType === 'secondary' ? settings.billSecondaryConfig :
                                 settings.billTaxInvoiceConfig;
  }

  const DEFAULT_FOOTER = 'ขอบคุณและขอให้โชคดี';
  const defaultLabel = defaultBillTypeLabel(billType);

  if (!override) {
    return {
      ...global,
      // When no per-bill override exists, ensure the footer falls back to the
      // standard thank-you text so the toggle OFF signal (undefined) stays
      // distinguishable from "no text configured" (non-empty string).
      footerNote: global.footerNote || DEFAULT_FOOTER,
      billTypeLabel: defaultLabel,
    };
  }

  const hidden = new Set(override.hiddenFields ?? []);

  return {
    shopNameTh:    hidden.has('shopName')    ? undefined : (override.shopNameTh  || global.shopNameTh),
    shopNameEn:    hidden.has('shopName')    ? undefined : (override.shopNameEn  ?? global.shopNameEn),
    companyName:   hidden.has('companyName') ? undefined : (override.companyName ?? global.companyName),
    address:       hidden.has('address')   ? undefined : (override.address     ?? global.address),
    phone:         hidden.has('phone')     ? undefined : (override.phone       ?? global.phone),
    taxId:         hidden.has('taxId')     ? undefined : (override.taxId       ?? global.taxId),
    branch:        hidden.has('branch')    ? undefined : (override.branch      ?? global.branch),
    registerNo:    hidden.has('registerNo')? undefined : (override.registerNo  ?? global.registerNo),
    // footerNote: undefined = hidden (toggle OFF). Non-empty string = show.
    // Default text applied here so renderers never need a ?? fallback.
    footerNote:    hidden.has('footerNote') ? undefined : (override.footerNote ?? global.footerNote ?? DEFAULT_FOOTER),
    // vatPercent hidden → 0 so the VAT row doesn't render (template checks vatAmount > 0)
    vatPercent:    hidden.has('vatPercent')? 0         : (override.vatPercent  ?? global.vatPercent),
    logoUrl:       hidden.has('logo')      ? undefined : global.logoUrl,
    logoHeight:    override.logoHeight ?? global.logoHeight,
    billTypeLabel: override.billTypeLabel,
    hiddenFields:  override.hiddenFields,
  };
}

/** Default billTypeLabel per bill type if not explicitly set */
export function defaultBillTypeLabel(billType: BillTypeKey): BillTypeLabel {
  if (billType === 'preview')    return 'food';
  if (billType === 'taxInvoice') return 'tax_full';
  return 'receipt_short';
}

/** Human-readable document title for printing */
export function billDocTitle(label: BillTypeLabel): string {
  if (label === 'food')          return 'บิลรายการอาหาร';
  if (label === 'receipt_short') return 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ';
  return 'ใบกำกับภาษี';
}

export function billDocSubtitle(label: BillTypeLabel): string | undefined {
  if (label === 'receipt_short') return 'ราคารวมภาษีมูลค่าเพิ่มแล้ว';
  return undefined;
}
