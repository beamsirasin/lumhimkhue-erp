'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { ImagePlus, X } from 'lucide-react';
import { updateStoreSettings } from '@/lib/actions/store';
import type { StoreSettingsData } from '@/lib/actions/store';
import type { BillConfig, BillTypeLabel } from '@/lib/db/schema';
import { BillLivePreview } from '@/components/admin/BillLivePreview';

interface Props { initialData: StoreSettingsData; }

// ─── Bill type tabs ───────────────────────────────────────────────────────────

type BillTab = 'global' | 'preview' | 'main' | 'secondary' | 'taxInvoice';

const BILL_TABS: { key: BillTab; label: string }[] = [
  { key: 'global',     label: 'ข้อมูลหลัก' },
  { key: 'preview',    label: 'บิลรายการอาหาร' },
  { key: 'main',       label: 'บัญชีหลัก' },
  { key: 'secondary',  label: 'บัญชีรอง' },
  { key: 'taxInvoice', label: 'ใบกำกับภาษี' },
];

// ─── Section toggles ──────────────────────────────────────────────────────────

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

// ─── Per-bill config state ────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

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
  const [logoUrl,    setLogoUrl]    = useState(initialData.logoUrl ?? '');
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

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('กรุณาเลือกไฟล์รูปภาพ'); return; }
    if (file.size > 500_000) { toast.error('ไฟล์ใหญ่เกิน 500 KB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') setLogoUrl(ev.target.result);
    };
    reader.readAsDataURL(file);
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

  // ─── Preview props (resolved for current tab) ───────────────────────────────

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

  const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 transition-colors';

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left: Form ──────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="w-[420px] shrink-0 space-y-4">
        {/* Tabs */}
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {BILL_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === t.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Global Tab ──────────────────────────────────────────────── */}
        {activeTab === 'global' && (
          <div className="space-y-5">
            {/* Logo */}
            <Section title="โลโก้หัวบิล">
              {logoUrl ? (
                <div className="flex items-start gap-4">
                  <img src={logoUrl} alt="โลโก้" style={{ height: logoHeight }} className="max-w-[160px] object-contain rounded border border-slate-200 bg-white p-1" />
                  <div className="space-y-2 flex-1">
                    <div className="flex gap-2">
                      <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                        <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                        เปลี่ยนรูป
                      </label>
                      <button type="button" onClick={() => setLogoUrl('')}
                        className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
                        <X className="size-3" />ลบโลโก้
                      </button>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">ความสูงโลโก้: {logoHeight}px</label>
                      <input type="range" min={20} max={200} value={logoHeight}
                        onChange={e => setLogoHeight(Number(e.target.value))}
                        className="w-full accent-slate-800" />
                    </div>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 cursor-pointer group">
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 group-hover:bg-slate-100 transition-colors w-full justify-center">
                    <ImagePlus className="size-4 text-slate-400" />
                    เลือกรูปภาพ (PNG / JPG / SVG)
                  </div>
                  <p className="text-[10px] text-slate-400">แนะนำขนาดไม่เกิน 200 KB</p>
                </label>
              )}
            </Section>

            {/* Paper width */}
            <Section title="ขนาดกระดาษบิล">
              <div className="flex gap-2">
                {([58, 80] as const).map((w) => (
                  <button key={w} type="button" onClick={() => { setPaperWidth(w); setPreviewWidth(w); }}
                    className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors ${
                      paperWidth === w ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                    {w} mm
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400">58mm — เครื่องพิมพ์ขนาดเล็ก · 80mm — เครื่องพิมพ์มาตรฐาน</p>
            </Section>

            {/* Info fields */}
            <Section title="ข้อมูลร้าน">
              <div className="grid grid-cols-2 gap-3">
                <Field label="ชื่อร้าน (ไทย) *" span>
                  <input className={INPUT} value={shopNameTh} onChange={e => setShopNameTh(e.target.value)} placeholder="ร้านชาบู" />
                </Field>
                <Field label="ชื่อร้าน (English)">
                  <input className={INPUT} value={shopNameEn} onChange={e => setShopNameEn(e.target.value)} placeholder="Shabu Buffet" />
                </Field>
                <Field label="ชื่อนิติบุคคล / บริษัท" span>
                  <input className={INPUT} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="หจก. ร้านชาบู" />
                </Field>
                <Field label="ที่อยู่" span>
                  <textarea className={INPUT} rows={2} value={address} onChange={e => setAddress(e.target.value)} placeholder="1/1 ถ.xxx ต.xxx" />
                </Field>
                <Field label="โทรศัพท์">
                  <input className={INPUT} value={phone} onChange={e => setPhone(e.target.value)} placeholder="0800000000" />
                </Field>
                <Field label="เลขประจำตัวผู้เสียภาษี">
                  <input className={INPUT} value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="0503xxxxxxx" />
                </Field>
                <Field label="สาขา">
                  <input className={INPUT} value={branch} onChange={e => setBranch(e.target.value)} placeholder="สำนักงานใหญ่" />
                </Field>
                <Field label="Register No">
                  <input className={INPUT} value={registerNo} onChange={e => setRegisterNo(e.target.value)} placeholder="00001" />
                </Field>
                <Field label="ข้อความท้ายบิล" span>
                  <input className={INPUT} value={footerNote} onChange={e => setFooterNote(e.target.value)} placeholder="ขอบคุณและขอให้โชคดี" />
                </Field>
                <Field label="ภาษีมูลค่าเพิ่ม (%)">
                  <input type="number" min={0} max={100} className={INPUT} value={vatPercent} onChange={e => setVatPercent(Number(e.target.value))} />
                </Field>
              </div>
            </Section>

            {/* Tax invoice settings */}
            <Section title="ตั้งค่าใบกำกับภาษี">
              <Field label={`Prefix เลขที่บิล (เช่น "LHK" → LHK03060001)`} span>
                <input className={INPUT} value={taxInvoicePrefix} onChange={e => setTaxInvoicePrefix(e.target.value)} placeholder="LHK" maxLength={20} />
              </Field>
              <p className="text-[10px] text-slate-400 mt-1">รูปแบบ: {taxInvoicePrefix || 'LHK'}{'{DDMM}'}{'{0001}'} — เลขที่ reset ทุกวัน เช่น {taxInvoicePrefix || 'LHK'}03060001, {taxInvoicePrefix || 'LHK'}03060002, …</p>
            </Section>
          </div>
        )}

        {/* ── Per-bill tabs ────────────────────────────────────────────── */}
        {activeTab !== 'global' && billState && (
          <div className="space-y-4">
            {/* Document type selector */}
            <Section title="ประเภทเอกสาร">
              <div className="flex flex-col gap-2">
                {BILL_TYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`billType-${activeTab}`}
                      checked={billState.billTypeLabel === opt.value}
                      onChange={() => setBillTypeLabel(activeTab, opt.value)}
                      className="accent-slate-800"
                    />
                    <span className="text-sm text-slate-700">{opt.label}</span>
                  </label>
                ))}
              </div>
            </Section>

            {/* Section toggles */}
            <Section title="แสดง / ซ่อน แต่ละส่วน">
              <div className="divide-y divide-slate-100">
                {SECTIONS.map((s) => {
                  const isHidden = billState.hiddenFields.has(s.key);
                  return (
                    <label key={s.key} className="flex items-center justify-between py-2.5 cursor-pointer group">
                      <span className={`text-sm transition-colors ${isHidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                        {s.label}
                      </span>
                      <div
                        onClick={() => toggleSection(activeTab, s.key)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          isHidden ? 'bg-slate-200' : 'bg-slate-800'
                        }`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                          isHidden ? 'translate-x-1' : 'translate-x-4.5'
                        }`} />
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 pt-2">ปิดสวิตช์ = ซ่อน section นั้นออกจากบิลประเภทนี้</p>
            </Section>
          </div>
        )}

        <button type="submit" disabled={saving}
          className="w-full rounded-lg bg-slate-800 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors">
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>

      {/* ── Right: Live Preview ──────────────────────────────────────── */}
      <div className="flex-1 min-w-0 sticky top-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          {/* Paper width toggle for preview */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">ตัวอย่างบิล</p>
            <div className="flex gap-1 rounded-lg bg-white border border-slate-200 p-0.5">
              {([58, 80] as const).map((w) => (
                <button key={w} type="button" onClick={() => setPreviewWidth(w)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    previewWidth === w ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  {w}mm
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-auto">
            <BillLivePreview {...previewProps} paperWidth={previewWidth} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
