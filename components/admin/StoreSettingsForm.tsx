'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { updateStoreSettings } from '@/lib/actions/store';
import type { StoreSettingsData } from '@/lib/actions/store';
import type { BillConfig } from '@/lib/db/schema';

interface Props { initialData: StoreSettingsData; }

type Tab = 'global' | 'preview' | 'main' | 'secondary';

const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'global',    label: 'ข้อมูลหลัก',     desc: 'ค่าเริ่มต้นสำหรับทุกบิล' },
  { key: 'preview',  label: 'บิลธรรมดา',       desc: 'บิลแจกประจำโต๊ะ (ไม่แสดงภาษี/ชำระ)' },
  { key: 'main',     label: 'บัญชีหลัก',       desc: 'ใบเสร็จชำระเงินบัญชีหลัก' },
  { key: 'secondary',label: 'บัญชีรอง',        desc: 'ใบเสร็จชำระเงินบัญชีรอง' },
];

type GlobalForm = {
  shopNameTh: string; shopNameEn: string; companyName: string;
  address: string; phone: string; taxId: string;
  branch: string; registerNo: string; footerNote: string; vatPercent: number;
};

type BillForm = Omit<BillConfig, 'vatPercent' | 'hiddenFields'> & { vatPercent: string };

const GLOBAL_FIELDS: { key: keyof GlobalForm; label: string; placeholder?: string; type?: string; span?: boolean }[] = [
  { key: 'shopNameTh',  label: 'ชื่อร้าน (ไทย)',             placeholder: 'ร้านชาบู' },
  { key: 'shopNameEn',  label: 'ชื่อร้าน (English)',         placeholder: 'Shabu Buffet' },
  { key: 'companyName', label: 'ชื่อนิติบุคคล / บริษัท',    placeholder: 'หจก. ร้านชาบู' },
  { key: 'address',     label: 'ที่อยู่',                    placeholder: '1/1 ถ.xxx ต.xxx', span: true },
  { key: 'phone',       label: 'โทรศัพท์',                   placeholder: '0800000000' },
  { key: 'taxId',       label: 'เลขประจำตัวผู้เสียภาษี',    placeholder: '0503xxxxxxx' },
  { key: 'branch',      label: 'สาขา',                       placeholder: 'สำนักงานใหญ่' },
  { key: 'registerNo',  label: 'Register No',                 placeholder: '00001' },
  { key: 'footerNote',  label: 'ข้อความท้ายบิล',             placeholder: 'ขอบคุณและขอให้โชคดี' },
  { key: 'vatPercent',  label: 'ภาษีมูลค่าเพิ่ม (%)',        type: 'number' },
];

const BILL_FIELDS: { key: keyof BillForm; label: string; placeholder?: string; type?: string; span?: boolean; toggleable?: boolean }[] = [
  { key: 'shopNameTh',  label: 'ชื่อร้าน (ไทย)',             placeholder: '(ใช้ค่าหลัก)',  toggleable: false },
  { key: 'shopNameEn',  label: 'ชื่อร้าน (English)',         placeholder: '(ใช้ค่าหลัก)',  toggleable: true },
  { key: 'companyName', label: 'ชื่อนิติบุคคล / บริษัท',    placeholder: '(ใช้ค่าหลัก)',  toggleable: true },
  { key: 'address',     label: 'ที่อยู่',                    placeholder: '(ใช้ค่าหลัก)',  span: true, toggleable: true },
  { key: 'phone',       label: 'โทรศัพท์',                   placeholder: '(ใช้ค่าหลัก)',  toggleable: true },
  { key: 'taxId',       label: 'เลขประจำตัวผู้เสียภาษี',    placeholder: '(ใช้ค่าหลัก)',  toggleable: true },
  { key: 'branch',      label: 'สาขา',                       placeholder: '(ใช้ค่าหลัก)',  toggleable: true },
  { key: 'registerNo',  label: 'Register No',                 placeholder: '(ใช้ค่าหลัก)',  toggleable: true },
  { key: 'footerNote',  label: 'ข้อความท้ายบิล',             placeholder: '(ใช้ค่าหลัก)',  toggleable: true },
  { key: 'vatPercent',  label: 'ภาษีมูลค่าเพิ่ม (%)',        placeholder: '(ใช้ค่าหลัก)',  type: 'number', toggleable: true },
];

function emptyBillForm(cfg: BillConfig | null | undefined): Record<string, string> {
  if (!cfg) return {};
  return {
    shopNameTh:  cfg.shopNameTh  ?? '',
    shopNameEn:  cfg.shopNameEn  ?? '',
    companyName: cfg.companyName ?? '',
    address:     cfg.address     ?? '',
    phone:       cfg.phone       ?? '',
    taxId:       cfg.taxId       ?? '',
    branch:      cfg.branch      ?? '',
    registerNo:  cfg.registerNo  ?? '',
    footerNote:  cfg.footerNote  ?? '',
    vatPercent:  cfg.vatPercent != null ? String(cfg.vatPercent) : '',
  };
}

function initVisible(cfg: BillConfig | null | undefined): Record<string, boolean> {
  const hidden = new Set(cfg?.hiddenFields ?? []);
  const result: Record<string, boolean> = {};
  for (const f of BILL_FIELDS.filter((f) => f.toggleable)) {
    result[f.key] = !hidden.has(f.key);
  }
  return result;
}

export function StoreSettingsForm({ initialData }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('global');
  const [saving, setSaving] = useState(false);

  const [global, setGlobal] = useState<GlobalForm>({
    shopNameTh:  initialData.shopNameTh ?? '',
    shopNameEn:  initialData.shopNameEn ?? '',
    companyName: initialData.companyName ?? '',
    address:     initialData.address ?? '',
    phone:       initialData.phone ?? '',
    taxId:       initialData.taxId ?? '',
    branch:      initialData.branch ?? '',
    registerNo:  initialData.registerNo ?? '',
    footerNote:  initialData.footerNote ?? '',
    vatPercent:  initialData.vatPercent ?? 7,
  });

  const [billForms, setBillForms] = useState<Record<string, Record<string, string>>>({
    preview:   emptyBillForm(initialData.billPreviewConfig),
    main:      emptyBillForm(initialData.billMainConfig),
    secondary: emptyBillForm(initialData.billSecondaryConfig),
  });

  const [billVisible, setBillVisible] = useState<Record<string, Record<string, boolean>>>({
    preview:   initVisible(initialData.billPreviewConfig),
    main:      initVisible(initialData.billMainConfig),
    secondary: initVisible(initialData.billSecondaryConfig),
  });

  function setBillField(tab: string, key: string, val: string) {
    setBillForms((p) => ({ ...p, [tab]: { ...(p[tab] ?? {}), [key]: val } }));
  }

  function toggleVisible(tab: string, key: string) {
    setBillVisible((p) => ({
      ...p,
      [tab]: { ...(p[tab] ?? {}), [key]: !(p[tab]?.[key] ?? true) },
    }));
  }

  function toConfig(form: Record<string, string>, visible: Record<string, boolean>): BillConfig | null {
    const hiddenFields = BILL_FIELDS
      .filter((f) => f.toggleable && !(visible[f.key] ?? true))
      .map((f) => f.key);

    const hasAny = Object.values(form).some((v) => v !== '') || hiddenFields.length > 0;
    if (!hasAny) return null;
    return {
      shopNameTh:  form.shopNameTh  || undefined,
      shopNameEn:  form.shopNameEn  || undefined,
      companyName: form.companyName || undefined,
      address:     form.address     || undefined,
      phone:       form.phone       || undefined,
      taxId:       form.taxId       || undefined,
      branch:      form.branch      || undefined,
      registerNo:  form.registerNo  || undefined,
      footerNote:  form.footerNote  || undefined,
      vatPercent:  form.vatPercent !== '' ? Number(form.vatPercent) : undefined,
      hiddenFields: hiddenFields.length > 0 ? hiddenFields : undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await updateStoreSettings({
      ...global,
      vatPercent: Number(global.vatPercent),
      billPreviewConfig:   toConfig(billForms.preview   ?? {}, billVisible.preview   ?? {}),
      billMainConfig:      toConfig(billForms.main      ?? {}, billVisible.main      ?? {}),
      billSecondaryConfig: toConfig(billForms.secondary ?? {}, billVisible.secondary ?? {}),
    });
    setSaving(false);
    if (!result.ok) toast.error(result.error);
    else toast.success('บันทึกแล้ว');
  }

  const INPUT_BASE = 'w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors';
  const INPUT_ON   = `${INPUT_BASE} border-slate-300 focus:border-slate-500`;
  const INPUT_OFF  = `${INPUT_BASE} border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
              activeTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab description */}
      <p className="text-xs text-slate-400">
        {TABS.find((t) => t.key === activeTab)?.desc}
        {activeTab !== 'global' && ' — เว้นว่างเพื่อใช้ค่าจาก "ข้อมูลหลัก"'}
      </p>

      {/* Global tab */}
      {activeTab === 'global' && (
        <div className="grid grid-cols-2 gap-3">
          {GLOBAL_FIELDS.map(({ key, label, placeholder, type, span }) => (
            <div key={key} className={span ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input type={type ?? 'text'} value={String(global[key] ?? '')}
                onChange={(e) => setGlobal((p) => ({ ...p, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                placeholder={placeholder} className={INPUT_ON}
                min={type === 'number' ? 0 : undefined} max={type === 'number' ? 100 : undefined} />
            </div>
          ))}
        </div>
      )}

      {/* Per-bill tabs */}
      {(activeTab === 'preview' || activeTab === 'main' || activeTab === 'secondary') && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {BILL_FIELDS.map(({ key, label, placeholder, type, span, toggleable }) => {
              const isVisible = !toggleable || (billVisible[activeTab]?.[key] ?? true);
              const inputId = `field-${activeTab}-${key}`;
              return (
                <div key={key} className={span ? 'col-span-2' : ''}>
                  <div className="flex items-center gap-2 mb-1">
                    {toggleable ? (
                      <input
                        type="checkbox"
                        id={`vis-${activeTab}-${key}`}
                        checked={isVisible}
                        onChange={() => toggleVisible(activeTab, key)}
                        className="h-3.5 w-3.5 shrink-0 accent-slate-800 cursor-pointer"
                      />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <label
                      htmlFor={toggleable ? `vis-${activeTab}-${key}` : inputId}
                      className={`text-xs font-medium select-none ${isVisible ? 'text-slate-600' : 'text-slate-400'} ${toggleable ? 'cursor-pointer' : ''}`}
                    >
                      {label}
                      {!isVisible && (
                        <span className="ml-1.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-500">ซ่อน</span>
                      )}
                    </label>
                  </div>
                  <input
                    id={inputId}
                    type={type ?? 'text'}
                    value={(billForms[activeTab] ?? {})[key] ?? ''}
                    onChange={(e) => setBillField(activeTab, key, e.target.value)}
                    placeholder={isVisible ? placeholder : 'ไม่แสดงในบิล'}
                    disabled={!isVisible}
                    className={isVisible ? INPUT_ON : INPUT_OFF}
                    min={type === 'number' ? 0 : undefined}
                    max={type === 'number' ? 100 : undefined}
                  />
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            💡 ช่องที่เว้นว่างจะดึงค่าจาก &quot;ข้อมูลหลัก&quot; อัตโนมัติ · ยกเลิกติ๊กเพื่อซ่อน field นั้นออกจากบิล
          </p>
        </div>
      )}

      <button type="submit" disabled={saving}
        className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {saving ? 'กำลังบันทึก…' : 'บันทึก'}
      </button>
    </form>
  );
}
