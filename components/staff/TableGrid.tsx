'use client';

import { useState, useEffect, useCallback, useRef, useContext, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, type Modifier } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { toast } from 'sonner';
import {
  Plus,
  Settings2,
  X,
  Printer,
  Link2,
  MoveRight,
  ChevronRight,
  Users,
  Clock,
  CheckCircle2,
  Pencil,
  Loader2,
  Eye,
  Receipt,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  getTablesWithSessions,
  type TableData,
  type PricingTileData,
  createTable,
  updateTablePosition,
  updateTableMeta,
  softDeleteTable,
} from '@/lib/actions/tables';
import {
  openSession,
  closeSession,
  closeSingleSession,
  transferPrimary,
  moveSession,
  updateSessionGuests,
  setTableAvailable,
} from '@/lib/actions/sessions';
import { print as printTableQr } from '@/lib/printer/service';
import type { TableQrData } from '@/lib/printer/types';
import { differenceInSeconds, formatDistanceToNowStrict } from 'date-fns';
import { th } from 'date-fns/locale';
import { PricingTile } from '@/components/staff/PricingTile';
import { CashierHeaderSlotContext } from '@/components/shared/SidebarLayout';

/* ─── Status config ────────────────────────────────────────────────── */

type VisualStatus = 'available' | 'occupied' | 'reserved' | 'linked' | 'paid' | 'partial';

const STATUS_CONFIG: Record<VisualStatus, {
  bg: string; border: string; text: string; label: string; dot: string;
}> = {
  available: {
    bg:     'bg-[var(--status-success-bg)]',
    border: 'border-[var(--status-success-border)]',
    text:   'text-[var(--status-success-fg)]',
    label:  'ว่าง',
    dot:    'bg-[var(--status-success-fg)]',
  },
  occupied: {
    bg:     'bg-[var(--status-danger-bg)]',
    border: 'border-[var(--status-danger-border)]',
    text:   'text-[var(--status-danger-fg)]',
    label:  'มีลูกค้า',
    dot:    'bg-[var(--status-danger-fg)]',
  },
  reserved: {
    bg:     'bg-[var(--status-info-bg)]',
    border: 'border-[var(--status-info-border)]',
    text:   'text-[var(--status-info-fg)]',
    label:  'จอง',
    dot:    'bg-[var(--status-info-fg)]',
  },
  linked: {
    bg:     'bg-[var(--status-purple-bg)]',
    border: 'border-[var(--status-purple-border)]',
    text:   'text-[var(--status-purple-fg)]',
    label:  'เชื่อมโยง',
    dot:    'bg-[var(--status-purple-fg)]',
  },
  paid: {
    bg:     'bg-[var(--status-danger-bg)]',
    border: 'border-[var(--status-danger-border)]',
    text:   'text-[var(--status-danger-fg)]',
    label:  'จ่ายแล้ว',
    dot:    'bg-[var(--status-danger-fg)]',
  },
  partial: {
    bg:     'bg-[var(--status-warning-bg)]',
    border: 'border-[var(--status-warning-border)]',
    text:   'text-[var(--status-warning-fg)]',
    label:  'ชำระบางส่วน',
    dot:    'bg-[var(--status-warning-fg)]',
  },
};

/* Color palette for linked-table groups — each group gets a unique color */
const LINK_PALETTE = [
  { bg: 'bg-[var(--status-purple-bg)]', border: 'border-[var(--status-purple-border)]', text: 'text-[var(--status-purple-fg)]', dot: 'bg-[var(--status-purple-fg)]', hex: 'oklch(0.55 0.18 300)' },
  { bg: 'bg-[var(--status-orange-bg)]', border: 'border-[var(--status-orange-border)]', text: 'text-[var(--status-orange-fg)]', dot: 'bg-[var(--status-orange-fg)]', hex: 'oklch(0.60 0.18 50)' },
  { bg: 'bg-[var(--status-cyan-bg)]',   border: 'border-[var(--status-cyan-border)]',   text: 'text-[var(--status-cyan-fg)]',   dot: 'bg-[var(--status-cyan-fg)]',   hex: 'oklch(0.55 0.16 200)' },
  { bg: 'bg-[var(--status-warning-bg)]',border: 'border-[var(--status-warning-border)]',text: 'text-[var(--status-warning-fg)]',dot: 'bg-[var(--status-warning-fg)]', hex: 'oklch(0.60 0.16 65)' },
  { bg: 'bg-[var(--status-info-bg)]',   border: 'border-[var(--status-info-border)]',   text: 'text-[var(--status-info-fg)]',   dot: 'bg-[var(--status-info-fg)]',   hex: 'oklch(0.45 0.14 248)' },
  { bg: 'bg-[var(--status-success-bg)]',border: 'border-[var(--status-success-border)]',text: 'text-[var(--status-success-fg)]',dot: 'bg-[var(--status-success-fg)]', hex: 'oklch(0.50 0.14 145)' },
] as const;

type LinkColor = typeof LINK_PALETTE[number];

function getVisualStatus(table: TableData): VisualStatus {
  if (table.status === 'linked') return 'linked';
  if (table.status === 'paid') return 'paid';
  // Continuation session from partial split payment: same table, session has parentSessionId
  if (table.status === 'occupied' && table.activeSession?.parentSessionId) return 'partial';
  if (table.activeSession) return 'occupied';
  return table.status as VisualStatus;
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function ElapsedBadge({ startedAt }: { startedAt: Date }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    function update() {
      const secs = differenceInSeconds(new Date(), new Date(startedAt));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      setElapsed(`${h}:${String(m).padStart(2, '0')}`);
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="tabular-nums text-[10px] text-current opacity-70">{elapsed}</span>;
}

/* ─── Tile guest picker ────────────────────────────────────────────── */

interface TilePickerProps {
  tiles: PricingTileData[];
  quantities: Record<string, number>;
  onChange: (tileId: string, qty: number) => void;
  tileSize?: 'sm' | 'lg';
}

function TilePicker({ tiles, quantities, onChange, tileSize = 'sm' }: TilePickerProps) {
  if (tiles.length === 0)
    return <p className="text-sm text-muted-foreground">ไม่มี pricing tile ที่ active — กรุณาตั้งค่า pricing tiles ก่อน</p>;
  return (
    <div className={`flex flex-wrap ${tileSize === 'lg' ? 'gap-4' : 'gap-3'}`}>
      {tiles.map((tile) => (
        <PricingTile
          key={tile.id}
          tile={tile}
          mode="tap"
          size={tileSize}
          quantity={quantities[tile.id] ?? 0}
          onIncrement={() => onChange(tile.id, (quantities[tile.id] ?? 0) + 1)}
        />
      ))}
    </div>
  );
}

/* ─── Tile Summary Panel (shared by open + edit dialogs) ───────────── */

interface TileSummaryPanelProps {
  pricingTiles: PricingTileData[];
  quantities: Record<string, number>;
  onChange: (tileId: string, qty: number) => void;
}

function TileSummaryPanel({ pricingTiles, quantities, onChange }: TileSummaryPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const totalGuests = Object.values(quantities).reduce((s, q) => s + q, 0);
  const totalAmount = pricingTiles.reduce((s, t) => s + Number(t.price) * (quantities[t.id] ?? 0), 0);
  const selected = pricingTiles.filter((t) => (quantities[t.id] ?? 0) > 0);

  const editingTile = editingId ? pricingTiles.find((t) => t.id === editingId) ?? null : null;
  const editingQty = editingId ? (quantities[editingId] ?? 0) : 0;

  return (
    <div className="w-full md:w-64 shrink-0 rounded-xl border border-border bg-muted/40 p-3 flex flex-col md:h-full">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">รายการ</p>
      {selected.length === 0 ? (
        <p className="flex-1 flex items-center justify-center text-center text-xs text-muted-foreground leading-relaxed">
          แตะ tile<br />เพื่อเพิ่ม
        </p>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
          {selected.map((t) => {
            const qty = quantities[t.id] ?? 0;
            const subtotal = Number(t.price) * qty;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setEditingId(t.id)}
                className="w-full rounded-lg bg-card border border-border px-2.5 py-2 text-left hover:bg-muted/50 active:bg-muted transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{t.name}</span>
                  <span className="shrink-0 ml-2 text-sm font-bold text-foreground tabular-nums">×{qty}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px] text-muted-foreground">฿{Number(t.price).toLocaleString('th-TH')} / คน</span>
                  <span className="text-xs font-medium text-foreground">฿{subtotal.toLocaleString('th-TH')}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {totalGuests > 0 && (
        <div className="mt-3 border-t border-border pt-3 space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">รวม</span>
            <span className="font-bold text-foreground">{totalGuests} คน</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">ยอดรวม</span>
            <span className="font-bold text-foreground">฿{totalAmount.toLocaleString('th-TH')}</span>
          </div>
        </div>
      )}

      {/* Quantity edit popup */}
      {editingTile && (
        <>
          <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm" onClick={() => setEditingId(null)} />
          <div className="fixed left-1/2 top-1/2 z-[101] w-72 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border p-6 shadow-2xl">
            <p className="text-center text-base font-semibold text-foreground">{editingTile.name}</p>
            <p className="mt-0.5 text-center text-sm text-muted-foreground">฿{Number(editingTile.price).toLocaleString('th-TH')} / คน</p>
            <div className="mt-5 flex items-center justify-center gap-6">
              <button
                type="button"
                aria-label="ลด"
                onClick={() => {
                  const next = Math.max(0, editingQty - 1);
                  onChange(editingId!, next);
                  if (next === 0) setEditingId(null);
                }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl font-bold text-foreground hover:bg-red-100 hover:text-red-700 active:scale-95 transition-all"
              >−</button>
              <span className="w-12 text-center text-3xl font-bold tabular-nums text-foreground">{editingQty}</span>
              <button
                type="button"
                aria-label="เพิ่ม"
                onClick={() => onChange(editingId!, editingQty + 1)}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all"
              >+</button>
            </div>
            <p className="mt-3 text-center text-sm font-semibold text-foreground">
              รวม ฿{(Number(editingTile.price) * editingQty).toLocaleString('th-TH')}
            </p>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >ปิด</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Linked-table picker ──────────────────────────────────────────── */

interface LinkedTablePickerProps {
  tables: TableData[];
  primaryTableId: string;
  selected: string[];
  onToggle: (id: string) => void;
}

function LinkedTablePicker({ tables, primaryTableId, selected, onToggle }: LinkedTablePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const availableIds = new Set(
    tables
      .filter((t) => t.id !== primaryTableId && (t.status === 'available' || selected.includes(t.id)))
      .map((t) => t.id),
  );

  const PAD = 24;
  const canvasW = Math.max(400, ...tables.map((t) => t.positionX + t.width  + PAD));
  const canvasH = Math.max(300, ...tables.map((t) => t.positionY + t.height + PAD));

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setScale(Math.min(width / canvasW, height / canvasH, 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [canvasW, canvasH]);

  return (
    <div ref={containerRef} className="relative w-full flex-1 min-h-0 overflow-hidden rounded-xl border border-border bg-slate-50/80">
      {/* dot grid */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="lp-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lp-dots)" />
      </svg>

      {/* centered, scaled canvas */}
      <div
        className="absolute"
        style={{
          left: '50%',
          top: '50%',
          width: canvasW * scale,
          height: canvasH * scale,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: canvasW, height: canvasH, transform: `scale(${scale})` }}
        >
          {tables.map((t) => {
            const isPrimary  = t.id === primaryTableId;
            const isSelected = selected.includes(t.id);
            const isPickable = availableIds.has(t.id);

            let cls = 'border-border bg-[var(--surface-2)]/60 text-muted-foreground/40 cursor-not-allowed';
            if (isPrimary)
              cls = 'border-primary bg-primary text-primary-foreground cursor-default shadow-[var(--shadow-raised)]';
            else if (isSelected)
              cls = 'border-primary bg-[var(--surface-primary-subtle)] text-primary cursor-pointer ring-2 ring-primary/40 shadow-sm';
            else if (isPickable)
              cls = 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)] cursor-pointer hover:shadow-[var(--shadow-raised)] active:scale-[0.97] transition-all duration-150';

            return (
              <button
                key={t.id}
                type="button"
                disabled={!isPickable && !isPrimary}
                onClick={() => isPickable && onToggle(t.id)}
                className={`absolute flex flex-col items-center justify-center rounded-xl border-2 font-semibold transition-all select-none ${cls}`}
                style={{ left: t.positionX, top: t.positionY, width: t.width, height: t.height }}
              >
                <span className="text-base leading-tight">{t.label}</span>
                {isSelected && <span className="text-[11px] font-normal opacity-75 mt-0.5">✓ เลือก</span>}
                {isPrimary && <span className="text-[11px] font-normal opacity-75 mt-0.5">โต๊ะนี้</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Types for session-open result ───────────────────────────────── */

interface SessionOpenResult {
  sessionId: string;
  sessionToken: string;
  tableQrToken: string;
  tableLabel: string;
  startedAt: string;
  linkedTables: Array<{
    sessionToken: string;
    tableQrToken: string;
    tableLabel: string;
  }>;
}

/* ─── QR View Modal (show on screen) ──────────────────────────────── */

function QrViewModal({ url, label, onClose }: { url: string | null; label: string; onClose: () => void }) {
  const [qrSrc, setQrSrc] = useState('');

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } })
      .then(setQrSrc)
      .catch(() => {});
  }, [url]);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-2xl text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <p className="text-lg font-semibold text-foreground">QR โต๊ะ {label}</p>
          <button type="button" onClick={onClose} aria-label="ปิด" className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="size-6" />
          </button>
        </div>
        {qrSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrSrc} alt={`QR โต๊ะ ${label}`} className="mx-auto rounded-xl" width={280} height={280} />
        ) : (
          <div className="flex h-72 w-72 mx-auto items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground break-all line-clamp-2">{url}</p>
      </div>
    </div>
  );
}

/* ─── Open Table Flow ──────────────────────────────────────────────── */

type OpenStep = 'tiles' | 'link';

interface OpenTableFlowProps {
  open: boolean;
  table: TableData | null;
  allTables: TableData[];
  pricingTiles: PricingTileData[];
  prefillGuests?: Record<string, number>;
  onClose: () => void;
  onSuccess: (data: SessionOpenResult) => void | Promise<void>;
}

function OpenTableFlow({ open, table, allTables, pricingTiles, prefillGuests, onClose, onSuccess }: OpenTableFlowProps) {
  const [step, setStep] = useState<OpenStep>('tiles');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep('tiles');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuantities(prefillGuests ?? {});
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedIds([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotes('');
    }
  }, [open, prefillGuests]);

  const totalGuests = Object.values(quantities).reduce((s, q) => s + q, 0);
  const totalAmount = pricingTiles.reduce((s, t) => s + Number(t.price) * (quantities[t.id] ?? 0), 0);

  const handleSubmit = async () => {
    if (!table || submitting) return;
    setSubmitting(true);
    try {
      const guests = pricingTiles
        .map((t) => ({ pricingTileId: t.id, quantity: quantities[t.id] ?? 0 }))
        .filter((g) => g.quantity > 0);
      const result = await openSession({
        tableId: table.id,
        linkedTableIds: linkedIds,
        guests,
        notes: notes || undefined,
      });
      if (result.ok) {
        toast.success(`เปิดโต๊ะ ${table.label} สำเร็จ`);
        onClose();
        await onSuccess(result.data);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error('[OpenTableFlow] Error', error);
      toast.error('เปิดโต๊ะไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  if (!table) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={step === 'link'
        ? 'flex flex-col sm:max-w-[96vw] w-[96vw] h-[92dvh] max-h-[92dvh] p-0 gap-0 overflow-hidden'
        : 'sm:max-w-[92vw] max-h-[82dvh] overflow-y-auto'
      }>

        {step === 'link' ? (
          <>
            {/* Link step header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0 bg-[var(--surface-1)]">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-primary-subtle)] text-primary">
                  <Link2 className="size-4" />
                </div>
                <div>
                  <p className="text-base font-bold text-foreground leading-tight">เชื่อมโต๊ะกับโต๊ะ {table.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">คลิกโต๊ะสีเขียวเพื่อเลือก — คลิกซ้ำเพื่อยกเลิก (ไม่บังคับ)</p>
                </div>
              </div>
              {linkedIds.length > 0 && (
                <span className="rounded-full bg-[var(--surface-primary-subtle)] px-3 py-1 text-sm font-semibold text-primary">
                  เลือก {linkedIds.length} โต๊ะ
                </span>
              )}
            </div>

            {/* Canvas area */}
            <div className="flex-1 min-h-0 p-4 flex">
              <LinkedTablePicker
                tables={allTables}
                primaryTableId={table.id}
                selected={linkedIds}
                onToggle={(id) => setLinkedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
              />
            </div>

            {/* Link step footer */}
            <div className="flex items-center justify-between border-t border-border bg-[var(--surface-2)] px-6 py-4 shrink-0">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-3.5 rounded-md border-2 border-primary bg-primary" />โต๊ะที่เปิด
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-3.5 rounded-md border-2 border-[var(--status-success-border)] bg-[var(--status-success-bg)]" />ว่าง (เลือกได้)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-3.5 rounded-md border-2 border-border bg-[var(--surface-2)] opacity-50" />ไม่ว่าง
                </span>
              </div>
              <div className="flex gap-2.5">
                <button type="button" onClick={() => setStep('tiles')} className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
                  ย้อนกลับ
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {submitting ? 'กำลังเปิด...' : 'เปิดโต๊ะ'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="border-b border-border px-6 pt-4 pb-4">
              <DialogTitle className="text-xl font-bold leading-tight">
                เปิดโต๊ะ {table.label}
              </DialogTitle>
              {table.capacity > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">{table.capacity} ที่นั่ง — เลือกประเภทผู้เข้าใช้</p>
              )}
            </DialogHeader>

            <div className="flex flex-col md:flex-row gap-3 md:gap-4 md:h-[52dvh]">
              <div className="flex-1 min-w-0 min-h-0 overflow-y-auto space-y-4 pr-1">
                <TilePicker
                  tiles={pricingTiles}
                  quantities={quantities}
                  onChange={(id, qty) => setQuantities((p) => ({ ...p, [id]: qty }))}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="open-notes">หมายเหตุ (ไม่บังคับ)</Label>
                  <Input id="open-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="เช่น ลูกค้า VIP" />
                </div>
              </div>
              <TileSummaryPanel
                pricingTiles={pricingTiles}
                quantities={quantities}
                onChange={(id, qty) => setQuantities((p) => ({ ...p, [id]: qty }))}
              />
            </div>

            <DialogFooter className="flex-row items-center gap-3 border-t border-border bg-[var(--surface-2)] px-6 py-3 sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                {totalGuests > 0 ? (
                  <>
                    <span className="text-muted-foreground">{totalGuests} คน</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-bold tabular-nums text-foreground">฿{totalAmount.toLocaleString('th-TH')}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">เลือกประเภทผู้เข้าใช้</span>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">ยกเลิก</button>
                <button
                  type="button"
                  onClick={() => setStep('link')}
                  className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Link2 className="size-4" />เชื่อมโต๊ะ
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || totalGuests === 0}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {submitting ? 'กำลังเปิด...' : 'เปิดโต๊ะ'}
                </button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Move Table Flow ──────────────────────────────────────────────── */

interface MoveTableFlowProps {
  active: boolean;
  sessionId: string | null;
  sessionLabel: string;
  onCancel: () => void;
  onMoved: () => void;
}

// This is an in-canvas overlay mode — the parent controls which table is selected
function MoveTableBanner({ sessionLabel, onCancel }: { sessionLabel: string; onCancel: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
      <MoveRight className="size-5 text-amber-600 shrink-0" />
      <p className="text-sm font-medium text-amber-800">
        โหมดย้ายโต๊ะ — <span className="font-bold">{sessionLabel}</span> — คลิกโต๊ะว่างเพื่อย้าย
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="ml-auto rounded-lg border border-amber-300 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100"
      >
        ยกเลิก
      </button>
    </div>
  );
}

/* ─── Edit Session Guests Dialog ───────────────────────────────────── */

interface EditGuestsDialogProps {
  open: boolean;
  sessionId: string | null;
  currentGuests: { pricingTileId: string; quantity: number }[];
  pricingTiles: PricingTileData[];
  onClose: () => void;
  onSuccess: () => void;
}

function EditGuestsDialog({ open, sessionId, currentGuests, pricingTiles, onClose, onSuccess }: EditGuestsDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const init: Record<string, number> = {};
      for (const g of currentGuests) init[g.pricingTileId] = g.quantity;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuantities(init);
    }
  }, [open, currentGuests]);

  const totalGuests = Object.values(quantities).reduce((s, q) => s + q, 0);

  const handleSubmit = async () => {
    if (!sessionId || submitting) return;
    setSubmitting(true);
    const guests = pricingTiles
      .map((t) => ({ pricingTileId: t.id, quantity: quantities[t.id] ?? 0 }))
      .filter((g) => g.quantity > 0);
    const result = await updateSessionGuests({ sessionId, guests });
    setSubmitting(false);
    if (result.ok) {
      toast.success('แก้ไขข้อมูลลูกค้าแล้ว');
      onSuccess();
      onClose();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[92vw] max-h-[95dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>แก้ไขประเภทผู้เข้าใช้</DialogTitle></DialogHeader>
        <div className="flex flex-col md:flex-row gap-4 md:gap-5 md:h-[75dvh]">
          {/* ── Left: tile picker ── */}
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto pr-1">
            <TilePicker
              tiles={pricingTiles}
              quantities={quantities}
              onChange={(id, qty) => setQuantities((p) => ({ ...p, [id]: qty }))}
              tileSize="lg"
            />
          </div>

          {/* ── Right: shared summary panel with +/- ── */}
          <TileSummaryPanel
            pricingTiles={pricingTiles}
            quantities={quantities}
            onChange={(id, qty) => setQuantities((p) => ({ ...p, [id]: qty }))}
          />
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">ยกเลิก</button>
          <Button onClick={handleSubmit} disabled={submitting || totalGuests === 0}>
            {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Table Sheet Panel ────────────────────────────────────────────── */

interface TableSheetProps {
  open: boolean;
  table: TableData | null;
  allTables: TableData[];
  pricingTiles: PricingTileData[];
  onClose: () => void;
  onRefetch: () => void;
  onOpenTable: (table: TableData, prefillGuests?: Record<string, number>) => void;
  onMoveTable: (sessionId: string, tableLabel: string) => void;
  onEditGuests: (sessionId: string, currentGuests: { pricingTileId: string; quantity: number }[]) => void;
}

function TableSheet({
  open,
  table,
  allTables,
  pricingTiles,
  onClose,
  onRefetch,
  onOpenTable,
  onMoveTable,
  onEditGuests,
}: TableSheetProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [qrView, setQrView] = useState<{ url: string; label: string } | null>(null);
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  if (!table) return null;
  const sess = table.activeSession;
  const visualStatus = getVisualStatus(table);


  // Whether this table is part of a linked group (primary or secondary)
  const isInLinkedGroup = sess
    ? !!sess.parentSessionId || allTables.some((t) => t.activeSession?.parentSessionId === sess.id)
    : false;

  const handleCloseAll = () => {
    if (!sess) return;
    openConfirm(`ปิดโต๊ะทั้งกลุ่มพร้อมกัน?`, async () => {
      setBusy(true);
      const r = await closeSession({ sessionId: sess.id });
      setBusy(false);
      if (r.ok) { toast.success('ปิดทุกโต๊ะในกลุ่มแล้ว'); onClose(); onRefetch(); }
      else toast.error(r.error);
    });
  };

  const handleCloseSingle = () => {
    if (!sess) return;
    openConfirm(`ปิดเฉพาะโต๊ะ ${table.label}?`, async () => {
      setBusy(true);
      const r = await closeSingleSession({ sessionId: sess.id });
      setBusy(false);
      if (r.ok) { toast.success(`ปิดโต๊ะ ${table.label} แล้ว`); onClose(); onRefetch(); }
      else toast.error(r.error);
    });
  };

  const handleForceClose = () => {
    if (!sess) return;
    const doClose = async () => {
      setBusy(true);
      const r = await closeSession({ sessionId: sess.id });
      setBusy(false);
      if (r.ok) { toast.success(`ปิดโต๊ะ ${table.label} แล้ว`); onClose(); onRefetch(); }
      else toast.error(r.error);
    };
    if (visualStatus !== 'paid') {
      openConfirm(`บังคับปิดโต๊ะ ${table.label}?`, doClose);
    } else {
      doClose();
    }
  };

  const handleForceSingle = async () => {
    if (!sess) return;
    setBusy(true);
    const r = await closeSingleSession({ sessionId: sess.id });
    setBusy(false);
    if (r.ok) { toast.success(`ปิดโต๊ะ ${table.label} แล้ว`); onClose(); onRefetch(); }
    else toast.error(r.error);
  };

  const handleTransferPrimary = async (newPrimarySessionId: string) => {
    setBusy(true);
    const r = await transferPrimary({ newPrimarySessionId });
    setBusy(false);
    if (r.ok) { toast.success('เปลี่ยนโต๊ะหลักแล้ว'); onClose(); onRefetch(); }
    else toast.error(r.error);
  };

  return (
    <>
      {confirmDialog}
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 flex flex-col max-h-[90dvh]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_CONFIG[visualStatus].dot}`} />
            <DialogTitle className="text-base">
              โต๊ะ {table.label}
            </DialogTitle>
            {/* เปลี่ยนโต๊ะหลัก — shown only on truly linked secondary tables, not partial-payment continuations */}
            {visualStatus === 'linked' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => handleTransferPrimary(sess!.id)}
                className="ml-auto rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-200 disabled:opacity-50 transition-colors"
              >
                ตั้งเป็นหลัก
              </button>
            ) : (
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                visualStatus === 'paid'
                  ? 'bg-emerald-100 text-emerald-700'
                  : `${STATUS_CONFIG[visualStatus].bg} ${STATUS_CONFIG[visualStatus].text}`
              }`}>
                {STATUS_CONFIG[visualStatus].label}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-6 py-5">
          {/* ── AVAILABLE ── */}
          {visualStatus === 'available' && (
            <>
              <p className="text-sm text-muted-foreground">{table.capacity} ที่นั่ง — พร้อมรับลูกค้า</p>
              <button
                type="button"
                onClick={() => { onClose(); onOpenTable(table); }}
                className="flex w-full items-center justify-between rounded-xl border-2 border-primary bg-primary px-4 py-4 text-left text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <div>
                  <p className="font-semibold">เปิดโต๊ะ</p>
                  <p className="text-xs text-primary-foreground/70">เริ่ม session และเลือกประเภทผู้เข้าใช้</p>
                </div>
                <ChevronRight className="size-5 shrink-0" />
              </button>
            </>
          )}

          {/* ── OCCUPIED / PARTIAL ── */}
          {(visualStatus === 'occupied' || visualStatus === 'partial') && sess && (
            <>
              {/* Partial payment notice banner */}
              {visualStatus === 'partial' && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-700">ชำระบางส่วนแล้ว</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    ยังค้างชำระ {sess.totalGuests} คน · ฿{sess.baseAmount.toLocaleString('th-TH')} — กดบิลเพื่อชำระส่วนที่เหลือ
                  </p>
                </div>
              )}
              {(() => {
                // If this is a secondary (linked) table, resolve the primary for display.
                // Actions (move, edit, close) still use the clicked table's own session.
                const primaryTable = sess.parentSessionId
                  ? allTables.find((t) => t.activeSession?.id === sess.parentSessionId) ?? null
                  : null;
                const displaySess = primaryTable?.activeSession ?? sess;
                const displayTable = primaryTable ?? table;

                const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
                const startedAtStr = new Date(displaySess.startedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

                // Build Link/QR entries: primary first, then all linked children
                const linkedChildren = allTables.filter(
                  (t) => t.activeSession?.parentSessionId === displaySess.id,
                );
                const entries = [
                  { label: displayTable.label, qrToken: displayTable.qrToken, sessionToken: displaySess.sessionToken },
                  ...linkedChildren.map((t) => ({
                    label: t.label,
                    qrToken: t.qrToken,
                    sessionToken: t.activeSession!.sessionToken,
                  })),
                ];
                const isMultiple = entries.length > 1;

                return (
                  <>
                    {/* Session info — always from primary */}
                    <div className="rounded-xl bg-muted/50 border border-border p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="size-3.5" />เริ่ม</span>
                        <span className="font-medium">{new Date(displaySess.startedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">เวลาที่ผ่านมา</span>
                        <span className="font-medium">{formatDistanceToNowStrict(new Date(displaySess.startedAt), { locale: th })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><Users className="size-3.5" />จำนวนคน</span>
                        <span className="font-medium">{displaySess.totalGuests} คน</span>
                      </div>
                      {displaySess.guests.map((g) => (
                        <div key={g.id} className="flex justify-between pl-3 text-xs text-muted-foreground">
                          <span>{g.pricingTile.name} ×{g.quantity}</span>
                          <span>฿{(Number(g.pricingTile.price) * g.quantity).toLocaleString('th-TH')}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-border pt-1.5">
                        <span className="text-muted-foreground">ยอดค่าอาหาร</span>
                        <span className="font-semibold text-foreground">฿{displaySess.baseAmount.toLocaleString('th-TH')}</span>
                      </div>
                      {displaySess.notes && <p className="text-xs text-muted-foreground italic">{displaySess.notes}</p>}
                    </div>

                    {/* Link + QR — all tables in the group */}
                    <div className="space-y-1.5">
                      {entries.map((entry) => {
                        const url = `${appUrl}/t/${entry.qrToken}/s/${entry.sessionToken}`;
                        return (
                          <div key={entry.sessionToken} className="flex items-center gap-2">
                            {isMultiple && (
                              <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">
                                โต๊ะ {entry.label}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => window.open(url, '_blank')}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                            >
                              <Link2 className="size-3.5" />Link
                            </button>
                            <button
                              type="button"
                              onClick={() => setQrView({ url, label: entry.label })}
                              aria-label="ดู QR"
                              className="flex items-center justify-center rounded-xl border border-border px-3 py-2.5 text-foreground hover:bg-muted/50 transition-colors"
                            >
                              <Eye className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const qrPrint: TableQrData = { tableNumber: entry.label, url, startedAt: startedAtStr };
                                void printTableQr({ type: 'table_qr', table: qrPrint });
                              }}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                            >
                              <Printer className="size-3.5" />พิมพ์ QR
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    // Reuse POS' existing ?session= selection path so the bill opens as if selected in POS.
                    const posSessionId = visualStatus === 'partial' ? sess.id : (sess.parentSessionId ?? sess.id);
                    router.push(`/pos?session=${encodeURIComponent(posSessionId)}`);
                  }}
                  disabled={busy || !sess.id}
                  className="w-full rounded-xl border border-border px-4 py-4 text-base font-medium text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors"
                >
                  <span className="flex items-center justify-center gap-2"><Receipt className="size-5" />บิล</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEditGuests(sess.id, sess.guests.map((g) => ({ pricingTileId: g.pricingTile.id, quantity: g.quantity })));
                  }}
                  disabled={busy}
                  className="w-full rounded-xl border border-border px-4 py-4 text-base font-medium text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors"
                >
                  <span className="flex items-center justify-center gap-2"><Pencil className="size-5" />แก้ไข</span>
                </button>
                <button
                  type="button"
                  onClick={() => { onClose(); onMoveTable(sess.id, table.label); }}
                  disabled={busy}
                  className="w-full rounded-xl border border-border px-4 py-4 text-base font-medium text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors"
                >
                  <span className="flex items-center justify-center gap-2"><MoveRight className="size-5" />ย้ายโต๊ะ</span>
                </button>

                {isInLinkedGroup ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={handleCloseSingle} disabled={busy}
                      className="rounded-xl border border-red-200 px-4 py-4 text-base font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                      ปิดโต๊ะนี้
                    </button>
                    <button type="button" onClick={handleCloseAll} disabled={busy}
                      className="rounded-xl border border-red-400 bg-red-50 px-4 py-4 text-base font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors">
                      ปิดทั้งหมด
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={handleForceClose} disabled={busy}
                    className="w-full rounded-xl border border-red-200 px-4 py-4 text-base font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                    บังคับปิดโต๊ะ
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── RESERVED ── */}
          {visualStatus === 'reserved' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">โต๊ะนี้ถูกจองไว้</p>
              <button
                type="button"
                onClick={() => { onClose(); onOpenTable(table); }}
                className="flex w-full items-center justify-between rounded-xl border-2 border-primary bg-primary px-4 py-4 text-left text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <div>
                  <p className="font-semibold">เปิดโต๊ะ</p>
                </div>
                <ChevronRight className="size-5 shrink-0" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => openConfirm(`ยกเลิกการจองโต๊ะ ${table.label}?`, async () => {
                  setBusy(true);
                  const r = await setTableAvailable({ tableId: table.id });
                  setBusy(false);
                  if (r.ok) { toast.success('ยกเลิกการจองแล้ว'); onClose(); onRefetch(); }
                  else toast.error(r.error);
                })}
                className="w-full rounded-xl border border-red-200 px-4 py-4 text-base font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                ยกเลิกจอง
              </button>
            </div>
          )}

          {/* ── PAID (no session — table stuck in paid state) ── */}
          {visualStatus === 'paid' && !sess && (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-700">
                ชำระเงินแล้ว — กรุณาเคลียร์โต๊ะ
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await setTableAvailable({ tableId: table.id });
                  setBusy(false);
                  if (r.ok) { toast.success(`เคลียร์โต๊ะ ${table.label} แล้ว`); onClose(); onRefetch(); }
                  else toast.error(r.error);
                }}
                className="w-full rounded-xl border-2 border-primary bg-primary px-4 py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {busy ? 'กำลังเคลียร์…' : 'เคลียร์โต๊ะ'}
              </button>
            </div>
          )}

          {/* ── PAID ── */}
          {visualStatus === 'paid' && sess && (() => {
            const paidLinked = allTables.filter(
              (t) => t.activeSession?.parentSessionId === sess.id,
            );
            const hasGroup = paidLinked.length > 0;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
            const startedAtStr = new Date(sess.startedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
            const paidUrl = `${appUrl}/t/${table.qrToken}/s/${sess.sessionToken}`;
            return (
              <>
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-emerald-700 font-medium">
                    <CheckCircle2 className="size-4 shrink-0" />
                    ชำระเงินแล้ว — รอเคลียร์โต๊ะ
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">เริ่ม</span>
                    <span className="font-medium">{new Date(sess.startedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">จำนวนคน</span>
                    <span className="font-medium">{sess.totalGuests} คน</span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-emerald-100 pt-1.5">
                    <span className="text-muted-foreground">ยอดรวม</span>
                    <span className="font-semibold text-emerald-800">฿{sess.baseAmount.toLocaleString('th-TH')}</span>
                  </div>
                  {hasGroup && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {[table, ...paidLinked].map((t) => (
                        <span key={t.id} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          โต๊ะ {t.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Link / QR buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => { await navigator.clipboard.writeText(paidUrl).catch(() => {}); toast.success('คัดลอก URL แล้ว'); }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Link2 className="size-3.5" />Link
                  </button>
                  <button
                    type="button"
                    aria-label="ดู QR"
                    onClick={() => setQrView({ url: paidUrl, label: table.label })}
                    className="flex items-center justify-center rounded-xl border border-border px-3 py-2.5 text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Eye className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { const qr: TableQrData = { tableNumber: table.label, url: paidUrl, startedAt: startedAtStr }; void printTableQr({ type: 'table_qr', table: qr }); }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Printer className="size-3.5" />พิมพ์ QR
                  </button>
                </div>
                {hasGroup ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleForceSingle}
                      disabled={busy}
                      className="rounded-xl border border-border px-4 py-4 text-base font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
                    >
                      ปิดโต๊ะนี้
                    </button>
                    <button
                      type="button"
                      onClick={handleForceClose}
                      disabled={busy}
                      className="rounded-xl border-2 border-primary bg-primary px-4 py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      ปิดทั้งหมด
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleForceClose}
                    disabled={busy}
                    className="w-full rounded-xl border-2 border-primary bg-primary px-4 py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    ปิดโต๊ะ / เคลียร์โต๊ะ
                  </button>
                )}
              </>
            );
          })()}

          {/* ── LINKED (secondary table) — show same full view as primary ── */}
          {visualStatus === 'linked' && sess && (
            <>
              {(() => {
                const primaryTable = allTables.find((t) => t.activeSession?.id === sess.parentSessionId) ?? null;
                const displaySess = primaryTable?.activeSession ?? sess;
                const displayTable = primaryTable ?? table;

                const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
                const startedAtStr = new Date(displaySess.startedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
                const linkedChildren = allTables.filter((t) => t.activeSession?.parentSessionId === displaySess.id);
                const entries = [
                  { label: displayTable.label, qrToken: displayTable.qrToken, sessionToken: displaySess.sessionToken },
                  ...linkedChildren.map((t) => ({ label: t.label, qrToken: t.qrToken, sessionToken: t.activeSession!.sessionToken })),
                ];
                const isMultiple = entries.length > 1;

                return (
                  <>
                    <div className="rounded-xl bg-muted/50 border border-border p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="size-3.5" />เริ่ม</span>
                        <span className="font-medium">{new Date(displaySess.startedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">เวลาที่ผ่านมา</span>
                        <span className="font-medium">{formatDistanceToNowStrict(new Date(displaySess.startedAt), { locale: th })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><Users className="size-3.5" />จำนวนคน</span>
                        <span className="font-medium">{displaySess.totalGuests} คน</span>
                      </div>
                      {displaySess.guests.map((g) => (
                        <div key={g.id} className="flex justify-between pl-3 text-xs text-muted-foreground">
                          <span>{g.pricingTile.name} ×{g.quantity}</span>
                          <span>฿{(Number(g.pricingTile.price) * g.quantity).toLocaleString('th-TH')}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-border pt-1.5">
                        <span className="text-muted-foreground">ยอดค่าอาหาร</span>
                        <span className="font-semibold text-foreground">฿{displaySess.baseAmount.toLocaleString('th-TH')}</span>
                      </div>
                      {displaySess.notes && <p className="text-xs text-muted-foreground italic">{displaySess.notes}</p>}
                    </div>

                    <div className="space-y-1.5">
                      {entries.map((entry) => {
                        const url = `${appUrl}/t/${entry.qrToken}/s/${entry.sessionToken}`;
                        return (
                          <div key={entry.sessionToken} className="flex items-center gap-2">
                            {isMultiple && <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">โต๊ะ {entry.label}</span>}
                            <button type="button" onClick={() => window.open(url, '_blank')}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
                              <Link2 className="size-3.5" />Link
                            </button>
                            <button type="button" onClick={() => { const qr: TableQrData = { tableNumber: entry.label, url, startedAt: startedAtStr }; void printTableQr({ type: 'table_qr', table: qr }); }}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
                              <Printer className="size-3.5" />พิมพ์ QR
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              <div className="space-y-2">
                <button type="button"
                  onClick={() => { onClose(); router.push(`/pos?session=${encodeURIComponent(sess.parentSessionId ?? sess.id)}`); }}
                  disabled={busy || !sess.id}
                  className="w-full rounded-xl border border-border px-4 py-4 text-base font-medium text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors">
                  <span className="flex items-center justify-center gap-2"><Receipt className="size-5" />บิล</span>
                </button>
                <button type="button"
                  onClick={() => { onClose(); onEditGuests(sess.id, sess.guests.map((g) => ({ pricingTileId: g.pricingTile.id, quantity: g.quantity }))); }}
                  disabled={busy}
                  className="w-full rounded-xl border border-border px-4 py-4 text-base font-medium text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors">
                  <span className="flex items-center justify-center gap-2"><Pencil className="size-5" />แก้ไข</span>
                </button>
                <button type="button"
                  onClick={() => { onClose(); onMoveTable(sess.id, table.label); }}
                  disabled={busy}
                  className="w-full rounded-xl border border-border px-4 py-4 text-base font-medium text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors">
                  <span className="flex items-center justify-center gap-2"><MoveRight className="size-5" />ย้ายโต๊ะ</span>
                </button>

                {sess.parentSessionId ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={handleCloseSingle} disabled={busy}
                      className="rounded-xl border border-red-200 px-4 py-4 text-base font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                      ปิดโต๊ะนี้
                    </button>
                    <button type="button" onClick={handleCloseAll} disabled={busy}
                      className="rounded-xl border border-red-400 bg-red-50 px-4 py-4 text-base font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors">
                      ปิดทั้งหมด
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={handleForceClose} disabled={busy}
                    className="w-full rounded-xl border border-red-200 px-4 py-4 text-base font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                    บังคับปิดโต๊ะ
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <QrViewModal
      url={qrView?.url ?? null}
      label={qrView?.label ?? ''}
      onClose={() => setQrView(null)}
    />
    </>
  );
}

/* ─── Table Node (draggable) ───────────────────────────────────────── */

interface TableNodeProps {
  table: TableData;
  editMode: boolean;
  moveMode: boolean;
  /** Per-group color override for linked table sets */
  colorOverride?: LinkColor;
  /** Labels of child (linked) tables — shown on the primary occupied table */
  linkedTableLabels?: string[];
  /** Label of the primary table — shown on a linked child table */
  linkedToLabel?: string;
  onClickSession: (table: TableData) => void;
  onClickEdit: (table: TableData) => void;
  onClickMove: (table: TableData) => void;
}

function TableNode({ table, editMode, moveMode, colorOverride, linkedTableLabels, linkedToLabel, onClickSession, onClickEdit, onClickMove }: TableNodeProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: table.id,
    disabled: !editMode,
  });

  const vs = getVisualStatus(table);
  const cfg = colorOverride ?? STATUS_CONFIG[vs] ?? STATUS_CONFIG.available;
  const isMoveTarget = moveMode && table.status === 'available';

  const style: CSSProperties = {
    position: 'absolute',
    left: table.positionX,
    top: table.positionY,
    width: table.width,
    height: table.height,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 100 : 2,
    touchAction: 'none',
    userSelect: 'none',
    cursor: editMode ? (isDragging ? 'grabbing' : 'grab') : moveMode ? (isMoveTarget ? 'pointer' : 'not-allowed') : 'pointer',
  };

  const shape = table.shape === 'rectangle' ? 'rounded-md' : 'rounded-lg';

  const handleClick = () => {
    if (editMode) return;
    if (moveMode) {
      if (isMoveTarget) onClickMove(table);
      return;
    }
    onClickSession(table);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editMode ? { ...attributes, ...listeners } : {})}
      onClick={!editMode ? handleClick : undefined}
      className={`flex flex-col items-center justify-center border-2 select-none shadow-[var(--shadow-card)]
        ${cfg.bg} ${cfg.border} ${shape}
        ${editMode ? 'ring-2 ring-offset-1 ring-primary/50' : ''}
        ${isMoveTarget && moveMode ? 'ring-2 ring-[var(--status-success-border)] animate-pulse' : ''}
        ${moveMode && !isMoveTarget ? 'opacity-40' : 'hover:shadow-[var(--shadow-raised)] active:scale-[0.97] transition-all duration-150'}
      `}
    >
      <span className={`text-lg font-bold tabular-nums ${cfg.text}`}>{table.label}</span>
      <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {vs === 'paid' ? (
        <span className="mt-0.5 rounded-sm bg-red-200 px-1 py-0.5 text-[8px] font-bold leading-none text-red-700">
          จ่ายแล้ว
        </span>
      ) : vs === 'partial' ? (
        <>
          <span className="mt-0.5 rounded-sm bg-amber-200 px-1 py-0.5 text-[8px] font-bold leading-none text-amber-800">
            ชำระบางส่วน
          </span>
          <ElapsedBadge startedAt={table.activeSession!.startedAt} />
        </>
      ) : (
        table.activeSession && !table.activeSession.parentSessionId && (
          <ElapsedBadge startedAt={table.activeSession.startedAt} />
        )
      )}

      {/* Link badge — shown on primary (has children) and on linked children */}
      {(linkedToLabel || (linkedTableLabels && linkedTableLabels.length > 0)) && (
        <div className={`mt-0.5 flex items-center gap-0.5 text-[9px] font-bold leading-tight ${colorOverride ? colorOverride.text : 'text-violet-700'}`}>
          <Link2 className="size-2.5 shrink-0" />
          <span>{linkedToLabel ?? linkedTableLabels!.join(', ')}</span>
        </div>
      )}

      {editMode && (
        <button
          type="button"
          aria-label="แก้ไขโต๊ะ"
          onClick={(e) => { e.stopPropagation(); onClickEdit(table); }}
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-card border border-border shadow hover:bg-muted/50 transition-colors"
        >
          <Settings2 className="h-3 w-3 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

/* ─── Table Edit Panel ─────────────────────────────────────────────── */

interface TableEditPanelProps {
  table: TableData;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

function TableEditPanel({ table, onClose, onSaved, onDeleted }: TableEditPanelProps) {
  const [label, setLabel] = useState(table.label);
  const [capacity, setCapacity] = useState(String(table.capacity));
  const [shape, setShape] = useState<'square' | 'rectangle'>(table.shape);
  const [width, setWidth] = useState(String(table.width));
  const [height, setHeight] = useState(String(table.height));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { openConfirm, dialog: confirmDialog } = useConfirm();

  const handleSave = async () => {
    setSaving(true);
    const r = await updateTableMeta({ tableId: table.id, label, capacity: Number(capacity) || 4, zone: table.zone, shape, width: Number(width) || 80, height: Number(height) || 80 });
    setSaving(false);
    if (r.ok) { toast.success('บันทึกแล้ว'); onSaved(); }
    else toast.error(r.error);
  };

  const handleDelete = () => {
    openConfirm(`ลบโต๊ะ ${table.label} ออกจากผัง?`, async () => {
      setDeleting(true);
      const r = await softDeleteTable({ tableId: table.id });
      setDeleting(false);
      if (r.ok) { toast.success('ลบโต๊ะแล้ว'); onDeleted(); }
      else toast.error(r.error);
    });
  };

  return (
    <>
      {confirmDialog}
      <div className="w-64 shrink-0 border-l border-border bg-card p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">แก้ไขโต๊ะ {table.label}</p>
        <button type="button" aria-label="ปิด" onClick={onClose} className="rounded p-0.5 hover:bg-muted/50 transition-colors"><X className="h-4 w-4 text-muted-foreground" /></button>
      </div>
      <div className="space-y-1.5"><Label htmlFor="el">ชื่อโต๊ะ</Label><Input id="el" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="ec">จำนวนที่นั่ง</Label><Input id="ec" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
      <div className="space-y-1.5">
        <Label>รูปร่าง</Label>
        <Select value={shape} onValueChange={(v) => setShape(v as 'square' | 'rectangle')}>
          <SelectTrigger aria-label="เลือกรูปร่าง"><span>{shape === 'square' ? 'สี่เหลี่ยมจัตุรัส' : 'สี่เหลี่ยมผืนผ้า'}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="square">สี่เหลี่ยมจัตุรัส</SelectItem>
            <SelectItem value="rectangle">สี่เหลี่ยมผืนผ้า</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5"><Label htmlFor="ew">กว้าง (px)</Label><Input id="ew" type="number" min={40} value={width} onChange={(e) => setWidth(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="eh">สูง (px)</Label><Input id="eh" type="number" min={40} value={height} onChange={(e) => setHeight(e.target.value)} /></div>
      </div>
      <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? 'บันทึก...' : 'บันทึก'}</Button>
      {table.status === 'available' && (
        <button type="button" onClick={handleDelete} disabled={deleting} className="w-full rounded-lg border border-red-200 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">ลบโต๊ะนี้ออกจากผัง</button>
      )}
    </div>
    </>
  );
}

/* ─── Add Table Dialog ─────────────────────────────────────────────── */

interface AddTableDialogProps { open: boolean; onClose: () => void; onCreated: () => void; }

function AddTableDialog({ open, onClose, onCreated }: AddTableDialogProps) {
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!label.trim()) { toast.error('กรุณาระบุชื่อโต๊ะ'); return; }
    setSubmitting(true);
    const r = await createTable({ label: label.trim(), capacity: Number(capacity) || 4, zone: 'ทั่วไป', positionX: 20, positionY: 20 });
    setSubmitting(false);
    if (r.ok) { toast.success(`เพิ่มโต๊ะ ${label} แล้ว`); onCreated(); onClose(); setLabel(''); }
    else toast.error(r.error);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>เพิ่มโต๊ะใหม่</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="nl">ชื่อโต๊ะ *</Label><Input id="nl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="เช่น 1, A, VIP-1" /></div>
          <div className="space-y-1.5"><Label htmlFor="nc">จำนวนที่นั่ง</Label><Input id="nc" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">ยกเลิก</button>
          <Button onClick={handleCreate} disabled={submitting}>{submitting ? 'กำลังเพิ่ม...' : 'เพิ่มโต๊ะ'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main TableGrid ───────────────────────────────────────────────── */

export interface TableGridProps {
  initialTables: TableData[];
  pricingTiles: PricingTileData[];
}

export function TableGrid({ initialTables, pricingTiles }: TableGridProps) {
  const qc = useQueryClient();

  // Floor plan state
  const [editMode, setEditMode] = useState(false);
  const [editingTable, setEditingTable] = useState<TableData | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Sheet state
  const [sheetTable, setSheetTable] = useState<TableData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // OpenTable flow
  const [openFlowTable, setOpenFlowTable] = useState<TableData | null>(null);
  const [openFlowPrefill, setOpenFlowPrefill] = useState<Record<string, number> | undefined>();
  const [openFlowOpen, setOpenFlowOpen] = useState(false);

  // Move table
  const [moveSessionId, setMoveSessionId] = useState<string | null>(null);
  const [moveSessionLabel, setMoveSessionLabel] = useState('');

  // Edit session guests
  const [editGuestsSessionId, setEditGuestsSessionId] = useState<string | null>(null);
  const [editGuestsCurrentGuests, setEditGuestsCurrentGuests] = useState<{ pricingTileId: string; quantity: number }[]>([]);

  const { data: tables = initialTables } = useQuery({
    queryKey: ['tables'],
    queryFn: async () => {
      const res = await getTablesWithSessions();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    initialData: initialTables,
    refetchInterval: editMode ? 0 : 5_000,
    staleTime: 2_000,
    refetchOnWindowFocus: !editMode,
  });

  const refetch = useCallback(() => qc.invalidateQueries({ queryKey: ['tables'] }), [qc]);
  const fetchFreshTables = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['tables'] });
    const res = await getTablesWithSessions();
    if (!res.ok) throw new Error(res.error);
    qc.setQueryData(['tables'], res.data);
    return res.data;
  }, [qc]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Auto-fit: measure the canvas container and compute a scale so all tables are visible
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const GRID = 20;
  const PAD = 24; // breathing room around the canvas

  const canvasW = Math.max(1000, ...tables.map((t) => t.positionX + t.width + 40));
  const canvasH = Math.max(600,  ...tables.map((t) => t.positionY + t.height + 40));

  const scale = containerSize.w > 0 && containerSize.h > 0
    ? Math.min(
        (containerSize.w - PAD) / canvasW,
        (containerSize.h - PAD) / canvasH,
        1,          // never scale up beyond 100%
      )
    : 1;

  // Live snap modifier — delta is in screen coords; convert to logical, snap, convert back
  const snapModifier = useCallback<Modifier>(({ transform, active }) => {
    if (!active) return transform;
    const table = tables.find((t) => t.id === String(active.id));
    if (!table) return transform;
    const logX = table.positionX + transform.x / scale;
    const logY = table.positionY + transform.y / scale;
    return {
      ...transform,
      x: Math.round(logX / GRID) * GRID - table.positionX,
      y: Math.round(logY / GRID) * GRID - table.positionY,
    };
  }, [tables, scale]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, delta } = event;
    const table = tables.find((t) => t.id === active.id);
    if (!table) return;
    // delta is in screen px; divide by scale to get logical px
    const newX = Math.max(0, Math.round((table.positionX + delta.x / scale) / GRID) * GRID);
    const newY = Math.max(0, Math.round((table.positionY + delta.y / scale) / GRID) * GRID);
    await updateTablePosition({ tableId: table.id, positionX: newX, positionY: newY });
    refetch();
  };

  const handleMoveConfirm = async (targetTable: TableData) => {
    if (!moveSessionId) return;
    const r = await moveSession({ sessionId: moveSessionId, newTableId: targetTable.id });
    if (r.ok) {
      toast.success(`ย้ายโต๊ะไปยัง ${targetTable.label} สำเร็จ`);
      setMoveSessionId(null);
      setMoveSessionLabel('');
      refetch();
    } else {
      toast.error(r.error);
    }
  };

  const counts = tables.reduce<Record<string, number>>((acc, t) => {
    const key = getVisualStatus(t);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Inject status legend + edit controls into the CashierLayout header when in touchscreen mode
  const setCashierHeaderSlot = useContext(CashierHeaderSlotContext);
  useEffect(() => {
    if (!setCashierHeaderSlot) return;
    setCashierHeaderSlot(
      <div className="flex flex-1 items-center justify-between min-w-0 gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <LegendDot color="bg-green-500" label={`ว่าง (${counts.available ?? 0})`} />
          <LegendDot color="bg-red-500" label={`มีลูกค้า (${counts.occupied ?? 0})`} />
          <LegendDot color="bg-blue-500" label={`จอง (${counts.reserved ?? 0})`} />
          {(counts.linked ?? 0) > 0 && (
            <LegendDot color="bg-violet-500" label={`เชื่อมโยง (${counts.linked})`} />
          )}
          {(counts.partial ?? 0) > 0 && (
            <LegendDot color="bg-amber-500" label={`ชำระบางส่วน (${counts.partial})`} />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {editMode && (
            <Button size="sm" variant="outline" onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-1 size-3.5" />เพิ่มโต๊ะ
            </Button>
          )}
          <button
            type="button"
            onClick={() => { setEditMode((e) => !e); setEditingTable(null); }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              editMode ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted/50'
            }`}
          >
            {editMode ? 'เสร็จสิ้น' : 'แก้ไขผัง'}
          </button>
        </div>
      </div>
    );
    return () => setCashierHeaderSlot(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCashierHeaderSlot, editMode, counts.available, counts.occupied, counts.reserved, counts.linked]);

  // Compute linked-table relationships for SVG lines + node badges
  const linkPairs: { from: TableData; to: TableData; colorHex: string }[] = [];
  const sessionLinkedLabels = new Map<string, string[]>(); // primarySessionId → child labels
  const sessionLinkedFromLabel = new Map<string, string>(); // childSessionId → primary label
  const tableColorOverride = new Map<string, LinkColor>(); // tableId → per-group color

  let paletteIdx = 0;
  for (const t of tables) {
    if (!t.activeSession || t.activeSession.parentSessionId) continue;
    const children = tables.filter(
      (lt) => lt.activeSession?.parentSessionId === t.activeSession!.id,
    );
    if (children.length > 0) {
      const color = LINK_PALETTE[paletteIdx % LINK_PALETTE.length];
      paletteIdx++;
      sessionLinkedLabels.set(t.activeSession.id, children.map((c) => c.label));
      tableColorOverride.set(t.id, color);
      for (const c of children) {
        linkPairs.push({ from: t, to: c, colorHex: color.hex });
        tableColorOverride.set(c.id, color);
      }
    }
  }
  for (const t of tables) {
    if (!t.activeSession?.parentSessionId) continue;
    const primary = tables.find((pt) => pt.activeSession?.id === t.activeSession!.parentSessionId);
    if (primary) sessionLinkedFromLabel.set(t.activeSession.id, primary.label);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar — shown only in standard sidebar layout (touchscreen uses the header slot) */}
      {!setCashierHeaderSlot && (
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-3 gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-base font-bold tracking-tight text-foreground">ผังโต๊ะ</h1>
            <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
              <LegendDot color="bg-green-500" label={`ว่าง (${counts.available ?? 0})`} />
              <LegendDot color="bg-red-500" label={`มีลูกค้า (${counts.occupied ?? 0})`} />
              <LegendDot color="bg-blue-500" label={`จอง (${counts.reserved ?? 0})`} />
              {(counts.linked ?? 0) > 0 && <LegendDot color="bg-violet-500" label={`เชื่อมโยง (${counts.linked})`} />}
              {(counts.partial ?? 0) > 0 && <LegendDot color="bg-amber-500" label={`ชำระบางส่วน (${counts.partial})`} />}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editMode && (
              <Button size="sm" variant="outline" onClick={() => setAddDialogOpen(true)}>
                <Plus className="mr-1 size-3.5" />เพิ่มโต๊ะ
              </Button>
            )}
            <button
              type="button"
              onClick={() => { setEditMode((e) => !e); setEditingTable(null); }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                editMode ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted/50'
              }`}
            >
              {editMode ? 'เสร็จสิ้น' : 'แก้ไขผัง'}
            </button>
          </div>
        </div>
      )}

      {/* Move mode banner */}
      {moveSessionId && (
        <div className="flex shrink-0 items-center justify-center border-b border-amber-200 bg-amber-50 px-4 py-2">
          <MoveTableBanner
            sessionLabel={moveSessionLabel}
            onCancel={() => { setMoveSessionId(null); setMoveSessionLabel(''); }}
          />
        </div>
      )}

      {/* Canvas + Edit Panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area: measures itself, scales canvas to fit without scrolling */}
        <div ref={containerRef} className="flex-1 overflow-hidden bg-muted/50 flex items-center justify-center">
          {/* Spacer: occupies the scaled dimensions so centering works correctly */}
          <div style={{ width: canvasW * scale, height: canvasH * scale, flexShrink: 0 }}>
          <DndContext sensors={sensors} modifiers={[snapModifier]} onDragEnd={handleDragEnd}>
            <div
              className="relative bg-card rounded-xl shadow-inner border border-border"
              style={{ width: canvasW, height: canvasH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
              onClick={editMode ? (e) => { if (e.target === e.currentTarget) setEditingTable(null); } : undefined}
            >
              <svg className="absolute inset-0 pointer-events-none" width={canvasW} height={canvasH}>
                <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#e2e8f0" /></pattern></defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
                {/* Dashed lines connecting linked table groups — color per group */}
                {linkPairs.map(({ from, to, colorHex }) => (
                  <line
                    key={`link-${from.id}-${to.id}`}
                    x1={from.positionX + from.width / 2}
                    y1={from.positionY + from.height / 2}
                    x2={to.positionX + to.width / 2}
                    y2={to.positionY + to.height / 2}
                    stroke={colorHex}
                    strokeWidth={2.5}
                    strokeDasharray="8 4"
                    strokeLinecap="round"
                  />
                ))}
              </svg>
              {tables.map((table) => (
                <TableNode
                  key={table.id}
                  table={table}
                  editMode={editMode}
                  moveMode={!!moveSessionId}
                  colorOverride={tableColorOverride.get(table.id)}
                  linkedTableLabels={
                    table.activeSession && !table.activeSession.parentSessionId
                      ? sessionLinkedLabels.get(table.activeSession.id)
                      : undefined
                  }
                  linkedToLabel={
                    table.activeSession?.parentSessionId
                      ? sessionLinkedFromLabel.get(table.activeSession.id)
                      : undefined
                  }
                  onClickSession={(t) => {
                    setSheetTable(t);
                    setSheetOpen(true);
                  }}
                  onClickEdit={(t) => setEditingTable(editingTable?.id === t.id ? null : t)}
                  onClickMove={handleMoveConfirm}
                />
              ))}
            </div>
          </DndContext>
          </div>
        </div>

        {editMode && editingTable && (
          <TableEditPanel
            key={editingTable.id}
            table={editingTable}
            onClose={() => setEditingTable(null)}
            onSaved={() => { setEditingTable(null); refetch(); }}
            onDeleted={() => { setEditingTable(null); refetch(); }}
          />
        )}
      </div>

      {/* Table action Sheet */}
      <TableSheet
        open={sheetOpen}
        table={sheetTable}
        allTables={tables}
        pricingTiles={pricingTiles}
        onClose={() => { setSheetOpen(false); }}
        onRefetch={refetch}
        onOpenTable={(t, prefill) => {
          setOpenFlowTable(t);
          setOpenFlowPrefill(prefill);
          setOpenFlowOpen(true);
        }}
        onMoveTable={(sessionId, label) => {
          setMoveSessionId(sessionId);
          setMoveSessionLabel(label);
        }}
        onEditGuests={(sessionId, guests) => {
          setEditGuestsSessionId(sessionId);
          setEditGuestsCurrentGuests(guests);
        }}
      />

      {/* Edit Session Guests Dialog */}
      <EditGuestsDialog
        open={!!editGuestsSessionId}
        sessionId={editGuestsSessionId}
        currentGuests={editGuestsCurrentGuests}
        pricingTiles={pricingTiles}
        onClose={() => setEditGuestsSessionId(null)}
        onSuccess={refetch}
      />

      {/* Open Table Flow */}
      <OpenTableFlow
        open={openFlowOpen}
        table={openFlowTable}
        allTables={tables}
        pricingTiles={pricingTiles}
        prefillGuests={openFlowPrefill}
        onClose={() => { setOpenFlowOpen(false); setOpenFlowTable(null); }}
        onSuccess={async (data) => {
          try {
            const freshTables = await fetchFreshTables();
            const openedTable = freshTables.find((t) => t.activeSession?.id === data.sessionId)
              ?? freshTables.find((t) => t.label === data.tableLabel)
              ?? null;
            if (!openedTable) {
              toast.error('เปิดโต๊ะสำเร็จ แต่โหลดรายละเอียดโต๊ะไม่สำเร็จ');
              return;
            }
            setSheetTable(openedTable);
            setSheetOpen(true);
          } catch (error) {
            console.error('[TableGrid] Failed to load opened table detail', error);
            toast.error('เปิดโต๊ะสำเร็จ แต่โหลดรายละเอียดโต๊ะไม่สำเร็จ');
          }
        }}
      />

      {/* Add Table Dialog */}
      <AddTableDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onCreated={refetch}
      />

    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
