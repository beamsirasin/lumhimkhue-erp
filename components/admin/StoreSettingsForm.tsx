'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, X, Save } from 'lucide-react';
import { updateStoreSettings } from '@/lib/actions/store';
import type { StoreSettingsData } from '@/lib/actions/store';
import type { BillConfig, BillTypeLabel } from '@/lib/db/schema';
import { BillLivePreview } from '@/components/admin/BillLivePreview';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { FormSection, FormRow } from '@/components/ui/form-section';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props { initialData: StoreSettingsData; }

/* ─── Bill type tabs ─────────────────────────────────────────── */

type BillTab = 'global' | 'preview' | 'main' | 'secondary' | 'taxInvoice';

const BILL_TABS: { key: BillTab; label: string }[] = [
  { key: 'global',     label: 'ข้อมูลหลัก' },
  { key: 'preview',    label: 'บิลรายการอาหาร' },
  { key: 'main',       label: 'บัญชีหลัก' },
  { key: 'secondary',  label: 'บัญชีรอง' },
  { key: 'taxInvoice', label: 'ใบกำกับภาษี' },
];

/* ─── Section toggles ────────────────────────────────────────── */

type SectionKey =
  | 'logo' | 'shopName' | 'companyName' | 'branch' | 'address' | 'taxId' | 'registerNo'
  | 'receiptNo' | 'tableNo' | 'cashier' | 'date' | 'vatPercent' | 'footerNote';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'logo',        label: 'โลโก้' },
  { key: 'shopName',    label: 'ชื่อร้าน' },
  { key: 'companyName', label: 'บริษัท / นิติบุคคล' },
  { key: 'branch',      label: 'สาขา' },
  { key: 'address',     label: 'ที่อยู่' },
  { key: 'taxId',       label: 'เลขประจำตัวผู้เสียภาษีอากร' },
  { key: 'registerNo',  label: 'Register No' },
  { key: 'receiptNo',   label: 'เลขที่บิล' },
  { key: 'tableNo',     label: 'โต๊ะ' },
  { key: 'cashier',     label: 'พนักงาน' },
  { key: 'date',        label: 'วันที่ / เวลา' },
  { key: 'vatPercent',  label: 'ภาษีมูลค่าเพิ่ม' },
  { key: 'footerNote',  label: 'ข้อความท้ายบิล' },
];

const BILL_TYPE_OPTIONS: { value: BillTypeLabel; label: string }[] = [
  { value: 'food',          label: 'บิลรายการอาหาร' },
  { value: 'receipt_short', label: 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' },
  { value: 'tax_full',      label: 'ใบกำกับภาษี' },
];

/* ─── Per-bill config state ──────────────────────────────────── */

type BillTabState = {
  billTypeLabel: BillTypeLabel;
  hiddenFields: Set<SectionKey>;
};

function defaultBillTypeLabel(tab: BillTab): BillTypeLabel {
  if (tab === 'preview') return 'food';
  if (tab === 'taxInvoice') return 'tax_full';
  return 'receipt_short';
}

const VALID_SECTION_KEYS = new Set<string>(SECTIONS.map((s) => s.key));

function initBillState(cfg: BillConfig | null | undefined, tab: BillTab): BillTabState {
  return {
    billTypeLabel: cfg?.billTypeLabel ?? defaultBillTypeLabel(tab),
    hiddenFields: new Set(
      (cfg?.hiddenFields ?? []).filter((k) => VALID_SECTION_KEYS.has(k)) as SectionKey[],
    ),
  };
}

function toBillConfig(state: BillTabState, tab: Exclude<BillTab, 'global'>): BillConfig | null {
  const hiddenArr = [...state.hiddenFields];
  const billTypeKey = tab === 'preview' ? 'preview' : tab === 'main' ? 'main' : tab === 'secondary' ? 'secondary' : 'taxInvoice';
  if (hiddenArr.length === 0 && state.billTypeLabel === defaultBillTypeLabel(billTypeKey)) return null;
  return {
    billTypeLabel: state.billTypeLabel,
    hiddenFields: hiddenArr.length > 0 ? hiddenArr : undefined,
  };
}

/* ─── Shared input style ─────────────────────────────────────── */

const FIELD_INPUT =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 transition-colors';

/* ─── Component ──────────────────────────────────────────────── */

export function StoreSettingsForm({ initialData }: Props) {
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<BillTab>('global');
  const [previewWidth, setPreviewWidth] = useState<58 | 80>((initialData.billPaperWidth as 58 | 80) ?? 80);

  // Global fields
  const [shopNameTh,  setShopNameTh]  = useState(initialData.shopNameTh ?? '');
  const [shopNameEn,  setShopNameEn]  = useState(initialData.shopNameEn ?? '');
  const [companyName, setCompanyName] = useState(initialData.companyName ?? '');
  const [address,     setAddress]     = useState(initialData.address ?? '');
  const [phone,       setPhone]       = useState(initialData.phone ?? '');
  const [taxId,       setTaxId]       = useState(initialData.taxId ?? '');
  const [branch,      setBranch]      = useState(initialData.branch ?? '');
  const [registerNo,  setRegisterNo]  = useState(initialData.registerNo ?? '');
  const [footerNote,  setFooterNote]  = useState(initialData.footerNote ?? '');
  const [vatPercent,  setVatPercent]  = useState(initialData.vatPercent ?? 7);
  const [taxInvoicePrefix, setTaxInvoicePrefix] = useState(initialData.taxInvoicePrefix ?? 'LHK');

  // Logo
  const [logoUrl,         setLogoUrl]         = useState(initialData.logoUrl ?? '');
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [logoHeight, setLogoHeight] = useState(initialData.logoHeight ?? 56);
  const [paperWidth, setPaperWidth] = useState<58 | 80>((initialData.billPaperWidth as 58 | 80) ?? 80);

  // Per-bill tab states
  const [billStates, setBillStates] = useState<Record<string, BillTabState>>({
    preview:    initBillState(initialData.billPreviewConfig,    'preview'),
    main:       initBillState(initialData.billMainConfig,       'main'),
    secondary:  initBillState(initialData.billSecondaryConfig,  'secondary'),
    taxInvoice: initBillState(initialData.billTaxInvoiceConfig, 'taxInvoice'),
  });

  const billState = billStates[activeTab as string] as BillTabState | undefined;

  function setBillTypeLabel(tab: string, label: BillTypeLabel) {
    setBillStates(p => ({ ...p, [tab]: { ...p[tab], billTypeLabel: label } }));
  }

  function toggleSection(tab: string, key: SectionKey) {
    setBillStates(p => {
      const cur = new Set(p[tab].hiddenFields);
      cur.has(key) ? cur.delete(key) : cur.add(key);
      return { ...p, [tab]: { ...p[tab], hiddenFields: cur } };
    });
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('กรุณาเลือกไฟล์รูปภาพ'); return; }
    if (file.size > 500_000) { toast.error('ไฟล์ใหญ่เกิน 500 KB'); return; }
    const form = new FormData();
    form.append('file', file);
    setIsLogoUploading(true);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload failed');
      const { url } = await res.json() as { url: string };
      setLogoUrl(url);
    } catch { toast.error('อัปโหลดโลโก้ไม่ได้'); }
    finally { setIsLogoUploading(false); }
    e.target.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await updateStoreSettings({
      shopNameTh, shopNameEn, companyName, address, phone, taxId,
      branch, registerNo, footerNote, vatPercent,
      logoUrl: logoUrl || null,
      logoHeight,
      billPaperWidth: paperWidth,
      taxInvoicePrefix,
      billPreviewConfig:    toBillConfig(billStates.preview,    'preview'),
      billMainConfig:       toBillConfig(billStates.main,        'main'),
      billSecondaryConfig:  toBillConfig(billStates.secondary,   'secondary'),
      billTaxInvoiceConfig: toBillConfig(billStates.taxInvoice,  'taxInvoice'),
    });
    setSaving(false);
    if (!result.ok) toast.error(result.error);
    else toast.success('บันทึกแล้ว');
  }

  /* ─── Preview props ─── */

  const previewTabKey = activeTab === 'global' ? 'preview' : activeTab;
  const previewState = billStates[previewTabKey];

  const previewProps = {
    paperWidth: previewWidth,
    billTypeLabel: previewState?.billTypeLabel ?? 'food',
    billTypeKey: previewTabKey as 'preview' | 'main' | 'secondary' | 'taxInvoice',
    shopNameTh,
    shopNameEn: shopNameEn || undefined,
    companyName: companyName || undefined,
    address: address || undefined,
    phone: phone || undefined,
    taxId: taxId || undefined,
    branch: branch || undefined,
    registerNo: registerNo || undefined,
    footerNote: footerNote || undefined,
    vatPercent,
    logoUrl: logoUrl || undefined,
    logoHeight,
    hiddenFields: [...(previewState?.hiddenFields ?? [])],
  };

  return (
    <AppShell>
      <PageHeader
        title="ตั้งค่าบิล"
        subtitle="ข้อมูลร้าน กระดาษบิล โลโก้ และการตั้งค่าภาษี"
        actions={
          <Button
            type="submit"
            form="settings-form"
            disabled={saving}
          >
            <Save className="size-4" />
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        }
      />

      <div className="flex items-start gap-6">

        {/* ── Left: Form ──────────────────────────────────────────── */}
        <form
          id="settings-form"
          onSubmit={handleSubmit}
          className="w-[480px] shrink-0 space-y-4"
        >
          {/* Tab bar */}
          <div className="flex flex-wrap gap-px rounded-lg bg-muted p-1">
            {BILL_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150',
                  activeTab === t.key
                    ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Global Tab ────────────────────────────────────────── */}
          {activeTab === 'global' && (
            <div className="space-y-4">

              {/* Logo + Paper width */}
              <DataCard title="โลโก้และกระดาษบิล">
                <FormSection>
                  {/* Logo upload */}
                  {logoUrl ? (
                    <div className="flex items-start gap-4">
                      <img
                        src={logoUrl}
                        alt="โลโก้"
                        style={{ height: logoHeight }}
                        className="max-w-[140px] rounded-lg border border-border bg-[var(--surface-2)] object-contain p-1"
                      />
                      <div className="flex-1 space-y-2">
                        <div className="flex gap-2">
                          <label className={cn(
                            'cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40',
                            isLogoUploading && 'pointer-events-none opacity-50',
                          )}>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleLogoUpload}
                              disabled={isLogoUploading}
                            />
                            {isLogoUploading ? 'กำลังอัปโหลด…' : 'เปลี่ยนรูป'}
                          </label>
                          <button
                            type="button"
                            onClick={() => setLogoUrl('')}
                            className="flex items-center gap-1 rounded-lg border border-[var(--status-danger-border)] px-3 py-1.5 text-xs font-medium text-[var(--status-danger-fg)] transition-colors hover:bg-[var(--status-danger-bg)]"
                          >
                            <X className="size-3" />
                            ลบโลโก้
                          </button>
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] text-muted-foreground">ความสูงโลโก้: {logoHeight}px</p>
                          <input
                            type="range"
                            min={20}
                            max={200}
                            value={logoHeight}
                            onChange={(e) => setLogoHeight(Number(e.target.value))}
                            className="w-full accent-primary"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label className={cn(
                      'flex w-full cursor-pointer flex-col items-center gap-2',
                      isLogoUploading && 'pointer-events-none opacity-50',
                    )}>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoUpload}
                        disabled={isLogoUploading}
                      />
                      <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-[var(--surface-2)] px-4 py-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50">
                        <ImagePlus className="size-4 shrink-0" />
                        {isLogoUploading ? 'กำลังอัปโหลด…' : 'เลือกรูปภาพ (PNG / JPG / SVG)'}
                      </div>
                      <p className="text-[10px] text-muted-foreground">แนะนำขนาดไม่เกิน 200 KB</p>
                    </label>
                  )}

                  {/* Paper width */}
                  <div>
                    <p className="mb-2 text-xs font-semibold text-foreground">ขนาดกระดาษบิล</p>
                    <div className="flex gap-2">
                      {([58, 80] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => { setPaperWidth(w); setPreviewWidth(w); }}
                          className={cn(
                            'flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors',
                            paperWidth === w
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-muted-foreground hover:bg-muted/40',
                          )}
                        >
                          {w} mm
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      58mm — เครื่องพิมพ์ขนาดเล็ก · 80mm — เครื่องพิมพ์มาตรฐาน
                    </p>
                  </div>
                </FormSection>
              </DataCard>

              {/* Store info */}
              <DataCard title="ข้อมูลร้าน">
                <div className="grid grid-cols-2 gap-4">
                  <FormRow label="ชื่อร้าน (ไทย)" required className="col-span-2">
                    <input
                      className={FIELD_INPUT}
                      value={shopNameTh}
                      onChange={(e) => setShopNameTh(e.target.value)}
                      placeholder="ร้านชาบู"
                    />
                  </FormRow>
                  <FormRow label="ชื่อร้าน (English)">
                    <input
                      className={FIELD_INPUT}
                      value={shopNameEn}
                      onChange={(e) => setShopNameEn(e.target.value)}
                      placeholder="Shabu Buffet"
                    />
                  </FormRow>
                  <FormRow label="สาขา">
                    <input
                      className={FIELD_INPUT}
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="สำนักงานใหญ่"
                    />
                  </FormRow>
                  <FormRow label="ชื่อนิติบุคคล / บริษัท" className="col-span-2">
                    <input
                      className={FIELD_INPUT}
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="หจก. ร้านชาบู"
                    />
                  </FormRow>
                  <FormRow label="ที่อยู่" className="col-span-2">
                    <textarea
                      className={FIELD_INPUT}
                      rows={2}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="1/1 ถ.xxx ต.xxx"
                    />
                  </FormRow>
                  <FormRow label="โทรศัพท์">
                    <input
                      className={FIELD_INPUT}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0800000000"
                    />
                  </FormRow>
                  <FormRow label="Register No">
                    <input
                      className={FIELD_INPUT}
                      value={registerNo}
                      onChange={(e) => setRegisterNo(e.target.value)}
                      placeholder="00001"
                    />
                  </FormRow>
                  <FormRow label="เลขประจำตัวผู้เสียภาษี" className="col-span-2">
                    <input
                      className={FIELD_INPUT}
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      placeholder="0503xxxxxxx"
                    />
                  </FormRow>
                  <FormRow label="ข้อความท้ายบิล" className="col-span-2">
                    <input
                      className={FIELD_INPUT}
                      value={footerNote}
                      onChange={(e) => setFooterNote(e.target.value)}
                      placeholder="ขอบคุณและขอให้โชคดี"
                    />
                  </FormRow>
                </div>
              </DataCard>

              {/* Tax & invoice settings */}
              <DataCard title="ภาษีและหมายเลขบิล">
                <div className="grid grid-cols-2 gap-4">
                  <FormRow label="ภาษีมูลค่าเพิ่ม (%)">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className={FIELD_INPUT}
                      value={vatPercent}
                      onChange={(e) => setVatPercent(Number(e.target.value))}
                    />
                  </FormRow>
                  <FormRow
                    label={`Prefix เลขที่บิล`}
                    hint={`เช่น "${taxInvoicePrefix || 'LHK'}" → ${taxInvoicePrefix || 'LHK'}03060001`}
                  >
                    <input
                      className={FIELD_INPUT}
                      value={taxInvoicePrefix}
                      onChange={(e) => setTaxInvoicePrefix(e.target.value)}
                      placeholder="LHK"
                      maxLength={20}
                    />
                  </FormRow>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  รูปแบบ: {taxInvoicePrefix || 'LHK'}{'{DDMM}'}{'{0001}'} — เลขที่ reset ทุกวัน
                </p>
              </DataCard>

            </div>
          )}

          {/* ── Per-bill tabs ─────────────────────────────────────── */}
          {activeTab !== 'global' && billState && (
            <div className="space-y-4">

              {/* Document type */}
              <DataCard title="ประเภทเอกสาร">
                <div className="space-y-3">
                  {BILL_TYPE_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-3">
                      <input
                        type="radio"
                        name={`billType-${activeTab}`}
                        checked={billState.billTypeLabel === opt.value}
                        onChange={() => setBillTypeLabel(activeTab, opt.value)}
                        className="size-4 accent-primary"
                      />
                      <span className="text-sm text-foreground">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </DataCard>

              {/* Section show/hide toggles */}
              <DataCard
                title="แสดง / ซ่อน ส่วนต่างๆ"
                subtitle="ปิดสวิตช์ = ซ่อน section นั้นออกจากบิลประเภทนี้"
              >
                <div className="divide-y divide-border">
                  {SECTIONS.map((s) => {
                    const isHidden = billState.hiddenFields.has(s.key);
                    return (
                      <label
                        key={s.key}
                        className="flex cursor-pointer items-center justify-between py-2.5"
                      >
                        <span className={cn(
                          'text-sm transition-colors',
                          isHidden ? 'text-muted-foreground line-through' : 'text-foreground',
                        )}>
                          {s.label}
                        </span>
                        <div
                          onClick={() => toggleSection(activeTab, s.key)}
                          className={cn(
                            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                            isHidden ? 'bg-muted' : 'bg-primary',
                          )}
                        >
                          <span className={cn(
                            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform',
                            isHidden ? 'translate-x-1' : 'translate-x-[18px]',
                          )} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              </DataCard>

            </div>
          )}

          {/* Save (bottom) */}
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </form>

        {/* ── Right: Live Preview ──────────────────────────────── */}
        <div className="flex-1 min-w-0 sticky top-6">
          <DataCard
            title="ตัวอย่างบิล"
            actions={
              <div className="flex gap-0.5 rounded-lg border border-border bg-[var(--surface-2)] p-0.5">
                {([58, 80] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setPreviewWidth(w)}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      previewWidth === w
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {w}mm
                  </button>
                ))}
              </div>
            }
          >
            <div className="overflow-auto">
              <BillLivePreview {...previewProps} paperWidth={previewWidth} />
            </div>
          </DataCard>
        </div>

      </div>
    </AppShell>
  );
}
