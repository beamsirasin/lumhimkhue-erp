'use client';

import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import {
  Printer, Star, StarOff, Usb, Wifi, Monitor,
  Trash2, Pencil, FlaskConical, Plus, ChevronLeft,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { getAllPrinters, savePrinter, deletePrinter, setDefaultPrinter } from '@/lib/printer/store';
import { getCapabilities, isLocalhost } from '@/lib/printer/capabilities';
import { requestUSBDevice } from '@/lib/printer/transports/usb';
import { testPrint, printByteMap } from '@/lib/printer/service';
import type { PrinterConfig, PrinterType } from '@/lib/printer/types';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const TYPE_LABEL: Record<PrinterType, string> = {
  usb:     'USB',
  network: 'Network',
  browser: 'Browser',
};

const TYPE_BADGE: Record<PrinterType, string> = {
  usb:     'bg-blue-100 text-blue-700',
  network: 'bg-green-100 text-green-700',
  browser: 'bg-muted/50 text-muted-foreground',
};

/* ─── Form state ─────────────────────────────────────────────────────────── */

interface FormState {
  mode: 'add' | 'edit';
  step: 1 | 2 | 3;
  editingId?: string;
  /* step 1 */
  type: PrinterType | null;
  /* step 2 — USB */
  usbVendorId: number | null;
  usbProductId: number | null;
  usbLabel: string;          // e.g. "XPrinter (04b8:0e28)"
  /* step 2 — Network */
  ipAddress: string;
  port: string;
  /* step 3 */
  name: string;
  paperWidth: 58 | 80;
  thaiCodepage: number;
  thaiImageMode: boolean;
  isDefault: boolean;
}

function defaultForm(mode: 'add' | 'edit', existing?: PrinterConfig): FormState {
  if (mode === 'edit' && existing) {
    return {
      mode: 'edit',
      step: 3,
      editingId: existing.id,
      type: existing.type,
      usbVendorId: existing.usbVendorId ?? null,
      usbProductId: existing.usbProductId ?? null,
      usbLabel: existing.usbVendorId
        ? `${existing.name} (${existing.usbVendorId.toString(16)}:${existing.usbProductId?.toString(16)})`
        : '',
      ipAddress: existing.ipAddress ?? '',
      port: String(existing.port ?? 9100),
      name: existing.name,
      paperWidth: existing.paperWidth,
      thaiCodepage: existing.thaiCodepage ?? 21,
      thaiImageMode: existing.thaiImageMode ?? false,
      isDefault: existing.isDefault,
    };
  }
  return {
    mode: 'add', step: 1, type: null,
    usbVendorId: null, usbProductId: null, usbLabel: '',
    ipAddress: '', port: '9100',
    name: '', paperWidth: 80, thaiCodepage: 21, thaiImageMode: false, isDefault: false,
  };
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export function PrintersPage() {
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm('add'));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null); // id being tested

  const caps = getCapabilities();
  const onLocalhost = isLocalhost();
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  /* Load from IndexedDB */
  useEffect(() => {
    getAllPrinters().then((list) => { setPrinters(list); setLoading(false); });
  }, []);

  function refresh() {
    getAllPrinters().then(setPrinters);
  }

  function openAdd() {
    setForm(defaultForm('add'));
    setModalOpen(true);
  }

  function openEdit(p: PrinterConfig) {
    setForm(defaultForm('edit', p));
    setModalOpen(true);
  }

  function handleDelete(p: PrinterConfig) {
    openConfirm(`ลบ "${p.name}" ออกจากรายการ?`, async () => {
      await deletePrinter(p.id);
      refresh();
      toast.success('ลบเครื่องพิมพ์แล้ว');
    });
  }

  async function handleSetDefault(p: PrinterConfig) {
    await setDefaultPrinter(p.id);
    refresh();
    toast.success(`ตั้ง "${p.name}" เป็นค่าเริ่มต้นแล้ว`);
  }

  async function handleTest(p: PrinterConfig) {
    setTesting(p.id);
    const result = await testPrint(p);
    setTesting(null);
    if (result.ok) {
      toast.success('ส่งคำสั่งพิมพ์ทดสอบแล้ว');
    } else {
      toast.error(`ทดสอบไม่สำเร็จ: ${result.error}`);
    }
  }

  /* ── Modal: save ── */
  async function handleSave(andTest = false) {
    const { type, name, paperWidth, isDefault } = form;
    if (!type || !name.trim()) {
      toast.error('กรุณากรอกข้อมูลให้ครบ');
      return;
    }

    const config: PrinterConfig = {
      id: form.editingId ?? nanoid(),
      name: name.trim(),
      type,
      paperWidth,
      thaiCodepage: form.thaiCodepage,
      thaiImageMode: form.thaiImageMode,
      isDefault,
      ...(type === 'usb' && form.usbVendorId != null
        ? { usbVendorId: form.usbVendorId, usbProductId: form.usbProductId ?? undefined }
        : {}),
      ...(type === 'network'
        ? { ipAddress: form.ipAddress, port: parseInt(form.port, 10) || 9100 }
        : {}),
    };

    setSaving(true);
    await savePrinter(config);
    if (isDefault) await setDefaultPrinter(config.id);
    setSaving(false);
    refresh();
    setModalOpen(false);
    toast.success(form.mode === 'edit' ? 'แก้ไขข้อมูลแล้ว' : 'เพิ่มเครื่องพิมพ์แล้ว');

    if (andTest) {
      setTimeout(() => handleTest(config), 300);
    }
  }

  return (
    <div className="page-shell">
      {confirmDialog}
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">เครื่องพิมพ์</h1>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          เพิ่มเครื่องพิมพ์
        </button>
      </div>

      {/* Printer list */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">กำลังโหลด…</div>
      ) : printers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 gap-3">
          <Printer className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">ยังไม่มีเครื่องพิมพ์</p>
          <button
            type="button"
            onClick={openAdd}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            เพิ่มเครื่องพิมพ์ตัวแรก
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">ชื่อ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">ประเภท</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">กระดาษ</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">ค่าเริ่มต้น</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {printers.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_BADGE[p.type]}`}>
                      {TYPE_LABEL[p.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.paperWidth} mm</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      aria-label={p.isDefault ? 'ค่าเริ่มต้น' : 'ตั้งเป็นค่าเริ่มต้น'}
                      onClick={() => !p.isDefault && handleSetDefault(p)}
                      className={p.isDefault ? 'text-amber-500' : 'text-muted-foreground/60 hover:text-amber-400'}
                    >
                      {p.isDefault ? <Star className="size-4 fill-current" /> : <StarOff className="size-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleTest(p)}
                        disabled={!!testing}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <FlaskConical className="size-3" />
                        {testing === p.id ? 'ทดสอบ…' : 'ทดสอบ'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        aria-label="แก้ไข"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        aria-label="ลบ"
                        className="text-muted-foreground hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) setModalOpen(false); }}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center gap-2">
              {form.step > 1 && (
                <button
                  type="button"
                  aria-label="ย้อนกลับ"
                  onClick={() => setForm((f) => ({ ...f, step: (f.step - 1) as 1 | 2 | 3 }))}
                  className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                >
                  <ChevronLeft className="size-4" />
                </button>
              )}
              <DialogTitle>
                {form.mode === 'edit' ? 'แก้ไขเครื่องพิมพ์' : 'เพิ่มเครื่องพิมพ์'}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ขั้นที่ {form.step}/3
                </span>
              </DialogTitle>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setModalOpen(false)}
                className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              >
                ×
              </button>
            </div>
          </DialogHeader>

          {form.step === 1 && (
            <StepType
              caps={caps}
              selected={form.type}
              onSelect={(type) => setForm((f) => ({ ...f, type, step: 2 }))}
            />
          )}

          {form.step === 2 && form.type === 'usb' && (
            <StepUsb
              caps={caps}
              usbLabel={form.usbLabel}
              onPicked={(v, p, label) =>
                setForm((f) => ({ ...f, usbVendorId: v, usbProductId: p, usbLabel: label,
                  name: f.name || label, step: 3 }))
              }
            />
          )}

          {form.step === 2 && form.type === 'network' && (
            <StepNetwork
              onLocalhost={onLocalhost}
              ip={form.ipAddress}
              port={form.port}
              onIpChange={(v) => setForm((f) => ({ ...f, ipAddress: v }))}
              onPortChange={(v) => setForm((f) => ({ ...f, port: v }))}
              onNext={() => setForm((f) => ({ ...f, step: 3 }))}
            />
          )}

          {form.step === 2 && form.type === 'browser' && (
            <StepBrowser onNext={() => setForm((f) => ({ ...f, step: 3 }))} />
          )}

          {form.step === 3 && (
            <StepGeneral
              name={form.name}
              paperWidth={form.paperWidth}
              thaiCodepage={form.thaiCodepage}
              thaiImageMode={form.thaiImageMode}
              isDefault={form.isDefault}
              saving={saving}
              onNameChange={(v) => setForm((f) => ({ ...f, name: v }))}
              onPaperWidthChange={(v) => setForm((f) => ({ ...f, paperWidth: v }))}
              onThaiCodepageChange={(v) => setForm((f) => ({ ...f, thaiCodepage: v }))}
              onThaiImageModeChange={(v) => setForm((f) => ({ ...f, thaiImageMode: v }))}
              onDefaultChange={(v) => setForm((f) => ({ ...f, isDefault: v }))}
              onSave={() => handleSave(false)}
              onSaveAndTest={() => handleSave(true)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Modal steps ────────────────────────────────────────────────────────── */

function StepType({
  caps,
  selected,
  onSelect,
}: {
  caps: ReturnType<typeof getCapabilities>;
  selected: PrinterType | null;
  onSelect: (t: PrinterType) => void;
}) {
  const options: { type: PrinterType; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      type: 'usb',
      icon: <Usb className="size-5" />,
      title: 'USB / OTG',
      desc: 'เชื่อมต่อด้วยสาย USB หรือ OTG (แนะนำ)',
    },
    {
      type: 'network',
      icon: <Wifi className="size-5" />,
      title: 'Network',
      desc: 'Printer ใน WiFi/LAN เดียวกัน (dev mode เท่านั้น)',
    },
    {
      type: 'browser',
      icon: <Monitor className="size-5" />,
      title: 'Browser',
      desc: 'ใช้ระบบพิมพ์ของอุปกรณ์ (ทำงานได้ทุกที่)',
    },
  ];

  return (
    <div className="space-y-2.5 py-1">
      <p className="text-sm text-muted-foreground">เลือกวิธีเชื่อมต่อเครื่องพิมพ์</p>
      {options.map(({ type, icon, title, desc }) => {
        const disabled = type === 'usb' && !caps.usb;
        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(type)}
            className={`w-full flex items-start gap-3 rounded-xl border p-4 text-left transition-colors
              ${selected === type ? 'border-primary bg-muted/30' : 'border-border hover:border-border'}
              ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              {disabled && (
                <p className="text-xs text-red-500 mt-0.5">Browser ของคุณไม่รองรับ WebUSB</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function StepUsb({
  caps,
  usbLabel,
  onPicked,
}: {
  caps: ReturnType<typeof getCapabilities>;
  usbLabel: string;
  onPicked: (vendorId: number, productId: number, label: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');

  async function pick() {
    if (!caps.usb) { setError('Browser ไม่รองรับ WebUSB'); return; }
    setPicking(true);
    setError('');
    try {
      const device = await requestUSBDevice();
      if (!device) { setError('ยกเลิกการเลือกอุปกรณ์'); return; }
      const label = [
        device.manufacturerName,
        device.productName,
        `(${device.vendorId.toString(16).padStart(4,'0')}:${device.productId.toString(16).padStart(4,'0')})`,
      ].filter(Boolean).join(' ');
      onPicked(device.vendorId, device.productId, label);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="space-y-4 py-1">
      {usbLabel ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          ✓ {usbLabel}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">กด &ldquo;เลือกอุปกรณ์ USB&rdquo; แล้วเลือก printer ในรายการที่ปรากฏ</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={pick}
        disabled={picking}
        className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
      >
        {picking ? 'กำลังเปิดตัวเลือก…' : usbLabel ? 'เลือกใหม่' : 'เลือกอุปกรณ์ USB'}
      </button>
    </div>
  );
}

function StepNetwork({
  onLocalhost,
  ip,
  port,
  onIpChange,
  onPortChange,
  onNext,
}: {
  onLocalhost: boolean;
  ip: string;
  port: string;
  onIpChange: (v: string) => void;
  onPortChange: (v: string) => void;
  onNext: () => void;
}) {
  const ipValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);

  return (
    <div className="space-y-4 py-1">
      {!onLocalhost && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          ⚠️ <strong>Network printer ใช้งานได้เฉพาะ dev mode (localhost)</strong><br />
          ใน production (Vercel) server อยู่บน cloud ไม่สามารถเข้าถึง IP ใน LAN ของร้านได้
          กรุณาใช้ USB แทน
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">IP Address</label>
        <input
          value={ip}
          onChange={(e) => onIpChange(e.target.value)}
          placeholder="192.168.1.100"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {ip && !ipValid && <p className="mt-1 text-xs text-red-600">รูปแบบ IP ไม่ถูกต้อง</p>}
      </div>
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">Port</label>
        <input
          value={port}
          onChange={(e) => onPortChange(e.target.value)}
          placeholder="9100"
          type="number"
          min={1}
          max={65535}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>
      <button
        type="button"
        disabled={!ipValid}
        onClick={onNext}
        className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
      >
        ถัดไป
      </button>
    </div>
  );
}

function StepBrowser({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-4 py-1">
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground mb-2">🖨️ พิมพ์ผ่าน Browser</p>
        <ul className="space-y-1 text-xs list-disc list-inside">
          <li>เมื่อสั่งพิมพ์ จะเปิดหน้าต่าง Print ของระบบปฏิบัติการขึ้นมา</li>
          <li>เลือก printer ที่ต้องการในกล่องโต้ตอบ</li>
          <li>รองรับภาษาไทยเต็มรูปแบบ</li>
          <li>ใช้ได้ทุกอุปกรณ์ ไม่ต้องติดตั้งเพิ่ม</li>
        </ul>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary/90"
      >
        ถัดไป
      </button>
    </div>
  );
}

const THAI_CODEPAGE_PRESETS = [
  { value: 21, label: 'หน้า 21 — Epson / ทั่วไป (แนะนำ)' },
  { value: 20, label: 'หน้า 20 — Xprinter / Generic จีน' },
  { value: 13, label: 'หน้า 13 — Star Micronics' },
  { value: 18, label: 'หน้า 18 — Citizen / Bixolon' },
  { value: 27, label: 'หน้า 27 — Epson Thai13' },
];

function StepGeneral({
  name, paperWidth, thaiCodepage, thaiImageMode, isDefault, saving,
  onNameChange, onPaperWidthChange, onThaiCodepageChange, onThaiImageModeChange, onDefaultChange,
  onSave, onSaveAndTest,
}: {
  name: string;
  paperWidth: 58 | 80;
  thaiCodepage: number;
  thaiImageMode: boolean;
  isDefault: boolean;
  saving: boolean;
  onNameChange: (v: string) => void;
  onPaperWidthChange: (v: 58 | 80) => void;
  onThaiCodepageChange: (v: number) => void;
  onThaiImageModeChange: (v: boolean) => void;
  onDefaultChange: (v: boolean) => void;
  onSave: () => void;
  onSaveAndTest: () => void;
}) {
  const isCustom = !THAI_CODEPAGE_PRESETS.some((p) => p.value === thaiCodepage);

  return (
    <div className="space-y-4 py-1">
      <div>
        <label className="block text-xs font-medium text-foreground mb-1">ชื่อเครื่องพิมพ์</label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="เช่น Xprinter ห้องครัว"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-2">ขนาดกระดาษ</label>
        <div className="flex gap-3">
          {([58, 80] as const).map((w) => (
            <label key={w} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={paperWidth === w}
                onChange={() => onPaperWidthChange(w)}
                className="accent-slate-800"
              />
              <span className="text-sm text-foreground">{w} mm</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1">
          Codepage ภาษาไทย (CP874)
        </label>
        <select
          value={isCustom ? 'custom' : thaiCodepage}
          onChange={(e) => {
            if (e.target.value !== 'custom') onThaiCodepageChange(Number(e.target.value));
          }}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary bg-card"
        >
          {THAI_CODEPAGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          {isCustom && <option value="custom">กำหนดเอง: {thaiCodepage}</option>}
        </select>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">หรือกำหนดเลขเอง:</span>
          <input
            type="number"
            min={0}
            max={255}
            value={thaiCodepage}
            onChange={(e) => onThaiCodepageChange(Number(e.target.value))}
            className="w-20 rounded border border-border px-2 py-1 text-xs outline-none focus:border-border"
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          ถ้าภาษาไทยออกมาเป็นตัวอักษรแปลก ให้ลองหน้า 20 หรือ 21 สลับกัน
        </p>
      </div>

      <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-amber-200 bg-amber-50 p-3">
        <input
          type="checkbox"
          checked={thaiImageMode}
          onChange={(e) => onThaiImageModeChange(e.target.checked)}
          className="mt-0.5 rounded accent-amber-600"
        />
        <div>
          <span className="text-sm font-medium text-amber-800">พิมพ์ไทยแบบ Bitmap (แก้ปัญหาสระ-วรรณยุกต์)</span>
          <p className="mt-0.5 text-[11px] text-amber-700 leading-relaxed">
            เปิดเมื่อ printer ไม่มี Thai Glyph Shaping — render ข้อความเป็นรูปภาพในบราวเซอร์ก่อนส่งปริ้น สระและวรรณยุกต์จะซ้อนบน/ล่างถูกต้อง
          </p>
        </div>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => onDefaultChange(e.target.checked)}
          className="rounded accent-slate-800"
        />
        <span className="text-sm text-foreground">ตั้งเป็นเครื่องพิมพ์เริ่มต้น</span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={onSave}
          className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 disabled:opacity-50"
        >
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={onSaveAndTest}
          className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          บันทึกและทดสอบ
        </button>
      </div>
    </div>
  );
}
