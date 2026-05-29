import type { BillConfig, StoreSettings } from '@/lib/db/schema';

export function resolveBillConfig(
  settings: StoreSettings,
  billType: 'preview' | 'main' | 'secondary',
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
  };

  const override: BillConfig | null | undefined =
    billType === 'preview'   ? settings.billPreviewConfig :
    billType === 'main'      ? settings.billMainConfig :
                               settings.billSecondaryConfig;

  if (!override) return global;

  const hidden = new Set(override.hiddenFields ?? []);

  return {
    shopNameTh:  hidden.has('shopNameTh')  ? undefined : (override.shopNameTh  || global.shopNameTh),
    shopNameEn:  hidden.has('shopNameEn')  ? undefined : (override.shopNameEn  ?? global.shopNameEn),
    companyName: hidden.has('companyName') ? undefined : (override.companyName ?? global.companyName),
    address:     hidden.has('address')     ? undefined : (override.address     ?? global.address),
    phone:       hidden.has('phone')       ? undefined : (override.phone       ?? global.phone),
    taxId:       hidden.has('taxId')       ? undefined : (override.taxId       ?? global.taxId),
    branch:      hidden.has('branch')      ? undefined : (override.branch      ?? global.branch),
    registerNo:  hidden.has('registerNo')  ? undefined : (override.registerNo  ?? global.registerNo),
    footerNote:  hidden.has('footerNote')  ? undefined : (override.footerNote  ?? global.footerNote),
    // vatPercent hidden → 0 so the VAT row doesn't render (template checks vatAmount > 0)
    vatPercent:  hidden.has('vatPercent')  ? 0         : (override.vatPercent  ?? global.vatPercent),
    hiddenFields: override.hiddenFields,
  };
}
