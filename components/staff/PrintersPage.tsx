'use client';

import { useEffect, useState, useCallback } from 'react';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import {
  Printer, Star, Usb, Wifi, Monitor, Smartphone,
  Trash2, Pencil, FlaskConical, Plus, ChevronLeft, Info,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getAllPrinters, getDefaultPrinter, savePrinter, deletePrinter, setDefaultPrinter } from '@/lib/printer/store';
import { getCapabilities, isLocalhost } from '@/lib/printer/capabilities';
import { requestUSBDevice, findPairedDevice } from '@/lib/printer/transports/usb';
import { isAndroidBridgeAvailable } from '@/lib/printer/transports/android-bridge';
import { testPrint } from '@/lib/printer/service';
import type { PrinterConfig, PrinterType, AndroidBridgeTarget } from '@/lib/printer/types';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const TYPE_LABEL: Record<PrinterType, string> = {
  usb:            'USB',
  network:        'Network',
  browser:        'Browser',
  android_bridge: 'Android POS App',
};

const TYPE_BADGE_VARIANT: Record<PrinterType, BadgeVariant> = {
  usb:            'info',
  network:        'success',
  browser:        'neutral',
  android_bridge: 'purple',
};

const TYPE_ICON: Record<PrinterType, React.ReactNode> = {
  usb:            <Usb className="size-5" />,
  network:        <Wifi className="size-5" />,
  browser:        <Monitor className="size-5" />,
  android_bridge: <Smartphone className="size-5" />,
};

/* ─── Connection status ──────────────────────────────────────────────────── */

type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

function printerStatus(
  p: PrinterConfig,
  opts: { usbSupported: boolean; usbPaired?: boolean; bridgeAvailable: boolean; onLocalhost: boolean },
): { label: string; tone: StatusTone } {
  switch (p.type) {
    case 'browser':
      return { label: 'พร้อมใช้งาน — พิมพ์ผ่านหน้าต่าง Print ของอุปกรณ์', tone: 'success' };
    case 'android_bridge':
      return opts.bridgeAvailable
        ? { label: 'พร้อมใช้งานผ่านแอป Android POS', tone: 'success' }
        : { label: 'พิมพ์ได้เฉพาะเมื่อเปิดจากแอป Android POS', tone: 'warning' };
    case 'usb':
      if (!opts.usbSupported) return { label: 'เบราว์เซอร์นี้ไม่รองรับ WebUSB', tone: 'danger' };
      if (opts.usbPaired === undefined) return { label: 'กำลังตรวจสอบการเชื่อมต่อ…', tone: 'neutral' };
      return opts.usbPaired
        ? { label: 'เชื่อมต่ออยู่', tone: 'success' }
        : { label: 'ไม่พบอุปกรณ์ — ตรวจสอบสาย USB/OTG', tone: 'danger' };
    case 'network':
      return opts.onLocalhost
        ? { label: 'กด "ทดสอบ" เพื่อตรวจการเชื่อมต่อ', tone: 'neutral' }
        : { label: 'ใช้ไม่ได้บน production — แนะนำ Android POS App', tone: 'warning' };
  }
}

const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-[var(--status-success-fg)]',
  warning: 'text-[var(--status-warning-fg)]',
  danger:  'text-[var(--status-danger-fg)]',
  neutral: 'text-muted-foreground',
};

const TONE_DOT: Record<StatusTone, string> = {
  success: 'bg-[var(--status-success-fg)]',
  warning: 'bg-[var(--status-warning-fg)]',
  danger:  'bg-[var(--status-danger-fg)]',
  neutral: 'bg-muted-foreground/60',
};

function StatusDot({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${TONE_TEXT[tone]}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  );
}

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
  /* step 2 — Android POS App bridge */
  androidTarget: AndroidBridgeTarget;
  androidIpAddress: string;  // used when androidTarget === 'network'
  androidPort: string;
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
      ipAddress: existing.type === 'network' ? (existing.ipAddress ?? '') : '',
      port: existing.type === 'network' ? String(existing.port ?? 9100) : '9100',
      androidTarget: existing.androidTarget ?? 'usb_otg',
      androidIpAddress: existing.type === 'android_bridge' ? (existing.ipAddress ?? '') : '',
      androidPort: existing.type === 'android_bridge' ? String(existing.port ?? 9100) : '9100',
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
    androidTarget: 'usb_otg', androidIpAddress: '', androidPort: '9100',
    name: '', paperWidth: 80, thaiCodepage: 21, thaiImageMode: false, isDefault: false,
  };
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export function PrintersPage() {
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  // Actual default = the printer:__default__ key that print() resolves — the
  // per-config isDefault flag is only a form convenience and can go stale.
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [usbPaired, setUsbPaired] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm('add'));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null); // id being tested

  const caps = getCapabilities();
  const onLocalhost = isLocalhost();
  const bridgeAvailable = isAndroidBridgeAvailable();
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  /* Load from IndexedDB */
  const refresh = useCallback(async () => {
    const [list, def] = await Promise.all([getAllPrinters(), getDefaultPrinter()]);
    setPrinters(list);
    setDefaultId(def?.id ?? null);
  }, []);

  useEffect(() => {
    Promise.all([getAllPrinters(), getDefaultPrinter()]).then(([list, def]) => {
      setPrinters(list);
      setDefaultId(def?.id ?? null);
      setLoading(false);
    });
  }, []);

  /* Check which paired USB devices are actually connected right now */
  useEffect(() => {
    if (!caps.usb) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, boolean> = {};
      for (const p of printers) {
        if (p.type !== 'usb' || !p.usbVendorId || !p.usbProductId) continue;
        try {
          map[p.id] = !!(await findPairedDevice(p.usbVendorId, p.usbProductId));
        } catch {
          map[p.id] = false;
        }
      }
      if (!cancelled) setUsbPaired(map);
    })();
    return () => { cancelled = true; };
  }, [printers, caps.usb]);

  function openAdd() {
    setForm(defaultForm('add'));
    setModalOpen(true);
  }

  function openEdit(p: PrinterConfig) {
    // isDefault in the form must reflect the real default key, not the stale flag
    setForm({ ...defaultForm('edit', p), isDefault: p.id === defaultId });
    setModalOpen(true);
  }

  function handleDelete(p: PrinterConfig) {
    openConfirm(`ลบ "${p.name}" ออกจากรายการ?`, async () => {
      await deletePrinter(p.id);
      await refresh();
      toast.success('ลบเครื่องพิมพ์แล้ว');
    });
  }

  async function handleSetDefault(p: PrinterConfig) {
    await setDefaultPrinter(p.id);
    await refresh();
    toast.success(`ตั้ง "${p.name}" เป็นเครื่องพิมพ์หลักของเครื่องนี้แล้ว`);
  }

  async function handleTest(p: PrinterConfig) {
    // For Android bridge, check if the bridge is available before attempting
    if (p.type === 'android_bridge' && !isAndroidBridgeAvailable()) {
      toast.warning('ต้องเปิดผ่าน Android POS App เพื่อพิมพ์ด้วยวิธีนี้');
      return;
    }
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
      ...(type === 'android_bridge'
        ? {
            androidTarget: form.androidTarget,
            ...(form.androidTarget === 'network' && form.androidIpAddress
              ? { ipAddress: form.androidIpAddress, port: parseInt(form.androidPort, 10) || 9100 }
              : {}),
          }
        : {}),
    };

    setSaving(true);
    await savePrinter(config);
    if (isDefault) await setDefaultPrinter(config.id);
    setSaving(false);
    await refresh();
    setModalOpen(false);
    toast.success(form.mode === 'edit' ? 'แก้ไขข้อมูลแล้ว' : 'เพิ่มเครื่องพิมพ์แล้ว');

    if (andTest) {
      setTimeout(() => handleTest(config), 300);
    }
  }

  return (
    <AppShell>
      {confirmDialog}

      <PageHeader
        title="เครื่องพิมพ์"
        subtitle="จัดการเครื่องพิมพ์ใบเสร็จและสลิปครัว — ตั้งค่าครั้งเดียวต่อเครื่อง ไม่ต้องตั้งใหม่เมื่อเข้า-ออกระบบ"
        actions={
          <Button onClick={openAdd}>
            <Plus className="size-4 mr-1.5" />
            เพิ่มเครื่องพิมพ์
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-2xl" />
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
        </div>
      ) : printers.length === 0 ? (
        <EmptyState
          icon={<Printer className="size-5" />}
          title="ยังไม่มีเครื่องพิมพ์"
          description="เพิ่มเครื่องพิมพ์เพื่อเริ่มพิมพ์ใบเสร็จและสลิปครัว — เครื่องแรกที่เพิ่มจะเป็นเครื่องหลักโดยอัตโนมัติ"
          action={
            <Button size="sm" onClick={openAdd}>
              <Plus className="size-4 mr-1.5" />
              เพิ่มเครื่องพิมพ์
            </Button>
          }
        />
      ) : (
        (() => {
          const defaultPrinter = printers.find((p) => p.id === defaultId) ?? null;
          const others = printers.filter((p) => p.id !== defaultId);
          return (
            <div className="space-y-5">
              {/* ── Active (default) printer hero ── */}
              {defaultPrinter ? (
                (() => {
                  const status = printerStatus(defaultPrinter, {
                    usbSupported: caps.usb,
                    usbPaired: usbPaired[defaultPrinter.id],
                    bridgeAvailable,
                    onLocalhost,
                  });
                  return (
                    <section
                      aria-label="เครื่องพิมพ์ที่ใช้งานอยู่"
                      className="rounded-2xl border border-primary/25 bg-[var(--surface-primary-subtle)] p-5 shadow-[var(--shadow-card)]"
                    >
                      <div className="flex flex-wrap items-start gap-4">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                          {TYPE_ICON[defaultPrinter.type]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                            <Star className="size-3 fill-current" />
                            เครื่องพิมพ์หลักของเครื่องนี้
                          </p>
                          <h2 className="mt-1 truncate text-lg font-bold text-foreground">{defaultPrinter.name}</h2>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <StatusBadge label={TYPE_LABEL[defaultPrinter.type]} variant={TYPE_BADGE_VARIANT[defaultPrinter.type]} />
                            <span className="text-xs text-muted-foreground">กระดาษ {defaultPrinter.paperWidth} mm</span>
                            {defaultPrinter.thaiImageMode && (
                              <span className="text-xs text-muted-foreground">พิมพ์ไทยแบบ Bitmap</span>
                            )}
                            <StatusDot tone={status.tone} label={status.label} />
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(defaultPrinter)}>
                            <Pencil className="size-3.5 mr-1" />
                            แก้ไข
                          </Button>
                          <Button size="sm" disabled={!!testing} onClick={() => handleTest(defaultPrinter)}>
                            <FlaskConical className="size-3.5 mr-1" />
                            {testing === defaultPrinter.id ? 'กำลังทดสอบ…' : 'ทดสอบพิมพ์'}
                          </Button>
                        </div>
                      </div>
                      <p className="mt-3.5 border-t border-primary/15 pt-3 text-xs leading-relaxed text-muted-foreground">
                        ใบเสร็จและสลิปครัวที่สั่งจากเครื่องนี้จะพิมพ์ออกที่เครื่องพิมพ์นี้โดยอัตโนมัติ
                      </p>
                    </section>
                  );
                })()
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-4 text-sm text-[var(--status-warning-fg)]">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <p>
                    ยังไม่ได้เลือกเครื่องพิมพ์หลัก — กด &ldquo;ตั้งเป็นเครื่องหลัก&rdquo; ที่เครื่องพิมพ์ด้านล่าง
                    เพื่อให้ระบบรู้ว่าต้องพิมพ์ออกเครื่องไหน
                  </p>
                </div>
              )}

              {/* ── Other printers ── */}
              {others.length > 0 && (
                <section aria-label="เครื่องพิมพ์อื่น">
                  <h3 className="mb-2.5 text-sm font-semibold text-foreground">
                    เครื่องพิมพ์อื่น <span className="font-normal text-muted-foreground">({others.length})</span>
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {others.map((p) => {
                      const status = printerStatus(p, {
                        usbSupported: caps.usb,
                        usbPaired: usbPaired[p.id],
                        bridgeAvailable,
                        onLocalhost,
                      });
                      return (
                        <div
                          key={p.id}
                          className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-muted-foreground">
                              {TYPE_ICON[p.type]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-semibold text-foreground">{p.name}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <StatusBadge label={TYPE_LABEL[p.type]} variant={TYPE_BADGE_VARIANT[p.type]} />
                                <span className="text-xs text-muted-foreground">{p.paperWidth} mm</span>
                                {p.thaiImageMode && <span className="text-xs text-muted-foreground">Bitmap ไทย</span>}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEdit(p)}
                                aria-label={`แก้ไข ${p.name}`}
                                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(p)}
                                aria-label={`ลบ ${p.name}`}
                                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-2.5">
                            <StatusDot tone={status.tone} label={status.label} />
                          </div>
                          <div className="mt-3 flex gap-2 border-t border-border pt-3">
                            <Button variant="outline" size="sm" className="flex-1" onClick={() => handleSetDefault(p)}>
                              <Star className="size-3.5 mr-1" />
                              ตั้งเป็นเครื่องหลัก
                            </Button>
                            <Button variant="ghost" size="sm" disabled={!!testing} onClick={() => handleTest(p)}>
                              <FlaskConical className="size-3.5 mr-1" />
                              {testing === p.id ? 'ทดสอบ…' : 'ทดสอบ'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Device-local note ── */}
              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-[var(--surface-1)] p-3.5 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p>
                  การตั้งค่าเครื่องพิมพ์และเครื่องหลักถูกบันทึกไว้กับ<span className="font-semibold text-foreground">เครื่องนี้</span>{' '}
                  ไม่ผูกกับบัญชีผู้ใช้ — เข้า-ออกระบบหรือสลับผู้ใช้ ค่าเดิมยังอยู่ครบ
                  แต่หากเปลี่ยนเครื่องหรือเบราว์เซอร์ใหม่จะต้องตั้งค่าอีกครั้ง
                </p>
              </div>
            </div>
          );
        })()
      )}

      {/* Printer config wizard — Dialog kept for multi-step flow */}
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

          {form.step === 2 && form.type === 'android_bridge' && (
            <StepAndroidBridge
              androidTarget={form.androidTarget}
              androidIpAddress={form.androidIpAddress}
              androidPort={form.androidPort}
              onAndroidTargetChange={(v) => setForm((f) => ({ ...f, androidTarget: v }))}
              onAndroidIpChange={(v) => setForm((f) => ({ ...f, androidIpAddress: v }))}
              onAndroidPortChange={(v) => setForm((f) => ({ ...f, androidPort: v }))}
              onNext={() => setForm((f) => ({ ...f, step: 3 }))}
            />
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
    </AppShell>
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
  const options: { type: PrinterType; icon: React.ReactNode; title: string; desc: string; note?: string }[] = [
    {
      type: 'usb',
      icon: <Usb className="size-5" />,
      title: 'USB / OTG',
      desc: 'เชื่อมต่อด้วยสาย USB หรือ OTG (แนะนำสำหรับ Chrome บน PC/Android)',
    },
    {
      type: 'network',
      icon: <Wifi className="size-5" />,
      title: 'Network',
      // Clarify that direct network printing is localhost/dev only — not Vercel production
      desc: 'Printer ใน WiFi/LAN เดียวกัน',
      note: 'ใช้ได้เฉพาะ localhost/dev เท่านั้น — Vercel ไม่สามารถเข้าถึง IP ใน LAN ของร้าน',
    },
    {
      type: 'browser',
      icon: <Monitor className="size-5" />,
      title: 'Browser',
      desc: 'ใช้ระบบพิมพ์ของอุปกรณ์ (ทำงานได้ทุกที่)',
    },
    {
      type: 'android_bridge',
      icon: <Smartphone className="size-5" />,
      title: 'Android POS App',
      // Production-safe method for one-tablet Android POS: app receives ESC/POS bytes
      // and forwards them to the printer over USB OTG or LAN/WiFi on-device.
      desc: 'ปริ้นผ่านแอป POS บน Android เครื่องนี้',
      note: caps.androidBridge
        ? undefined
        : 'ตรวจพบว่าไม่ได้เปิดจาก Android POS App — ตั้งค่าไว้ก่อนได้ แต่พิมพ์ได้เฉพาะในแอป',
    },
  ];

  return (
    <div className="space-y-2.5 py-1">
      <p className="text-sm text-muted-foreground">เลือกวิธีเชื่อมต่อเครื่องพิมพ์</p>
      {options.map(({ type, icon, title, desc, note }) => {
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
              {note && (
                <p className="text-xs text-[var(--status-warning-fg)] mt-0.5">{note}</p>
              )}
              {disabled && (
                <p className="text-xs text-[var(--status-danger-fg)] mt-0.5">Browser ของคุณไม่รองรับ WebUSB</p>
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
        <div className="rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-3 text-sm text-[var(--status-success-fg)]">
          ✓ {usbLabel}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">กด &ldquo;เลือกอุปกรณ์ USB&rdquo; แล้วเลือก printer ในรายการที่ปรากฏ</p>
      )}
      {error && <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>}
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
        <div className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-xs text-[var(--status-warning-fg)] leading-relaxed">
          ⚠️ <strong>Network printer ใช้งานได้เฉพาะ localhost / dev / local-agent เท่านั้น</strong><br />
          ใน production (Vercel) server อยู่บน cloud ไม่สามารถเข้าถึง IP ใน LAN ของร้านได้<br />
          สำหรับ Android tablet POS จริง — ใช้วิธี <strong>Android POS App</strong> แทน
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
        {ip && !ipValid && <p className="mt-1 text-xs text-[var(--status-danger-fg)]">รูปแบบ IP ไม่ถูกต้อง</p>}
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

/**
 * Step 2 for android_bridge printers.
 *
 * The user chooses whether the Android POS App should connect to the physical
 * printer via USB OTG (cable attached to the tablet) or over LAN/WiFi.
 * If LAN/WiFi is chosen, the IP and port of the printer are collected here.
 *
 * This is the production-safe printing method for one-tablet Android POS:
 * - Vercel server cannot reach private LAN printer IPs.
 * - USB/OTG (WebUSB) remains supported for direct Chrome connections.
 * - This bridge lets the Android wrapper app handle the physical connection.
 */
function StepAndroidBridge({
  androidTarget,
  androidIpAddress,
  androidPort,
  onAndroidTargetChange,
  onAndroidIpChange,
  onAndroidPortChange,
  onNext,
}: {
  androidTarget: AndroidBridgeTarget;
  androidIpAddress: string;
  androidPort: string;
  onAndroidTargetChange: (v: AndroidBridgeTarget) => void;
  onAndroidIpChange: (v: string) => void;
  onAndroidPortChange: (v: string) => void;
  onNext: () => void;
}) {
  const bridgeAvailable = isAndroidBridgeAvailable();
  const ipValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(androidIpAddress);
  const canProceed = androidTarget === 'usb_otg' || ipValid;

  return (
    <div className="space-y-4 py-1">
      {/* Explain how the bridge works */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground mb-1.5">📱 Android POS App</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>เว็บแอปส่ง ESC/POS bytes ไปยัง Android POS App</li>
          <li>แอป Android จัดการส่งข้อมูลถึง printer โดยตรงบนเครื่อง</li>
          <li>ปลอดภัยสำหรับ production — Vercel ไม่ต้องเข้าถึง IP ใน LAN</li>
        </ul>
      </div>

      {/* Warning if not currently inside the Android app */}
      {!bridgeAvailable && (
        <div className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-xs text-[var(--status-warning-fg)] leading-relaxed">
          ⚠️ ขณะนี้ไม่ได้เปิดจาก Android POS App — ตั้งค่าไว้ล่วงหน้าได้ แต่จะพิมพ์จริงได้เฉพาะในแอป
        </div>
      )}

      {/* Target selection */}
      <div>
        <p className="text-xs font-medium text-foreground mb-2">Printer เชื่อมต่อกับ Android ด้วยวิธีใด?</p>
        <div className="space-y-2">
          {([
            { value: 'usb_otg' as AndroidBridgeTarget, label: 'USB / OTG', desc: 'ต่อสาย OTG จาก tablet ไปที่ printer' },
            { value: 'network' as AndroidBridgeTarget, label: 'Network LAN / WiFi', desc: 'Printer อยู่ใน WiFi/LAN เดียวกับ tablet' },
          ] as const).map(({ value, label, desc }) => (
            <label key={value} className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-border p-3 hover:bg-muted/30">
              <input
                type="radio"
                checked={androidTarget === value}
                onChange={() => onAndroidTargetChange(value)}
                className="mt-0.5 accent-slate-800"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Network target: collect IP and port */}
      {androidTarget === 'network' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">IP Address ของ Printer</label>
            <input
              value={androidIpAddress}
              onChange={(e) => onAndroidIpChange(e.target.value)}
              placeholder="192.168.1.100"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {androidIpAddress && !ipValid && (
              <p className="mt-1 text-xs text-[var(--status-danger-fg)]">รูปแบบ IP ไม่ถูกต้อง</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Port</label>
            <input
              value={androidPort}
              onChange={(e) => onAndroidPortChange(e.target.value)}
              placeholder="9100"
              type="number"
              min={1}
              max={65535}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!canProceed}
        onClick={onNext}
        className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
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

      <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3">
        <input
          type="checkbox"
          checked={thaiImageMode}
          onChange={(e) => onThaiImageModeChange(e.target.checked)}
          className="mt-0.5 rounded accent-[var(--status-warning-fg)]"
        />
        <div>
          <span className="text-sm font-medium text-[var(--status-warning-fg)]">พิมพ์ไทยแบบ Bitmap (แก้ปัญหาสระ-วรรณยุกต์)</span>
          <p className="mt-0.5 text-[11px] text-[var(--status-warning-fg)] leading-relaxed">
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
        <span className="text-sm text-foreground">ตั้งเป็นเครื่องพิมพ์หลักของเครื่องนี้ (ใช้พิมพ์อัตโนมัติ)</span>
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
