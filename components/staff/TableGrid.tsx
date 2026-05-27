'use client';

import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { toast } from 'sonner';
import {
  Plus,
  Settings2,
  X,
  Printer,
  CalendarClock,
  Link2,
  MoveRight,
  ChevronRight,
  Users,
  Clock,
  BadgeCheck,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  requestBillFromTable,
  moveSession,
} from '@/lib/actions/sessions';
import { createReservation, cancelReservation } from '@/lib/actions/reservations';
import { print as printTableQr } from '@/lib/printer/service';
import type { TableQrData } from '@/lib/printer/types';
import { differenceInSeconds, formatDistanceToNowStrict, format } from 'date-fns';
import { th } from 'date-fns/locale';
import { PricingTile } from '@/components/staff/PricingTile';

/* ─── Status config ────────────────────────────────────────────────── */

type VisualStatus = 'available' | 'occupied' | 'closing' | 'reserved' | 'linked';

const STATUS_CONFIG: Record<VisualStatus, {
  bg: string; border: string; text: string; label: string; dot: string;
}> = {
  available: { bg: 'bg-green-100',  border: 'border-green-400',  text: 'text-green-800',  label: 'ว่าง',      dot: 'bg-green-500' },
  occupied:  { bg: 'bg-red-100',    border: 'border-red-400',    text: 'text-red-800',    label: 'มีลูกค้า',  dot: 'bg-red-500' },
  closing:   { bg: 'bg-amber-100',  border: 'border-amber-400',  text: 'text-amber-800',  label: 'รอบิล',     dot: 'bg-amber-500' },
  reserved:  { bg: 'bg-blue-100',   border: 'border-blue-400',   text: 'text-blue-800',   label: 'จอง',       dot: 'bg-blue-500' },
  linked:    { bg: 'bg-violet-100', border: 'border-violet-400', text: 'text-violet-800', label: 'เชื่อมโยง', dot: 'bg-violet-500' },
};

function getVisualStatus(table: TableData): VisualStatus {
  if (table.status === 'linked') return 'linked';
  if (table.activeSession?.status === 'closing') return 'closing';
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
      setElapsed(h > 0 ? `${h}ชม.${m}น.` : `${m}น.`);
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
}

function TilePicker({ tiles, quantities, onChange }: TilePickerProps) {
  if (tiles.length === 0)
    return <p className="text-sm text-slate-400">ไม่มี pricing tile ที่ active — กรุณาตั้งค่า pricing tiles ก่อน</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {tiles.map((tile) => (
        <PricingTile
          key={tile.id}
          tile={tile}
          mode="select"
          quantity={quantities[tile.id] ?? 0}
          onIncrement={() => onChange(tile.id, (quantities[tile.id] ?? 0) + 1)}
          onDecrement={() => onChange(tile.id, Math.max(0, (quantities[tile.id] ?? 0) - 1))}
        />
      ))}
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
  const available = tables.filter(
    (t) => t.id !== primaryTableId && (t.status === 'available' || selected.includes(t.id)),
  );

  if (available.length === 0)
    return <p className="text-sm text-slate-400">ไม่มีโต๊ะว่างอื่นให้เชื่อมโยง</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {available.map((t) => {
        const active = selected.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onToggle(t.id)}
            className={`flex h-10 min-w-[48px] items-center justify-center rounded-lg border-2 px-3 text-sm font-semibold transition-colors ${
              active
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-200 text-slate-700 hover:border-slate-400'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── QR Dialog ────────────────────────────────────────────────────── */

function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(url, { width: 200, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
        .then(setSrc).catch(() => setSrc(''));
    });
  }, [url]);
  if (!src) return <div className="mx-auto h-[200px] w-[200px] animate-pulse rounded-lg bg-slate-100" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="QR Code" width={200} height={200} className="mx-auto rounded-lg" />;
}

interface QrDialogProps {
  open: boolean;
  data: { sessionToken: string; tableQrToken: string; tableLabel: string; startedAt: string } | null;
  onClose: () => void;
}

function SessionQrDialog({ open, data, onClose }: QrDialogProps) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const sessionUrl = data ? `${appUrl}/t/${data.tableQrToken}/s/${data.sessionToken}` : '';
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>โต๊ะ {data?.tableLabel} พร้อมแล้ว</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-center text-sm text-slate-500">ให้ลูกค้าสแกน QR นี้เพื่อสั่งอาหาร</p>
          <QrImage url={sessionUrl} />
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="break-all text-center font-mono text-xs text-slate-600 select-all">{sessionUrl}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(sessionUrl).catch(() => {}); toast.success('คัดลอก URL แล้ว'); }}>คัดลอก URL</Button>
          {data && (
            <Button variant="outline" onClick={() => {
              const qrData: TableQrData = { tableNumber: data.tableLabel, url: sessionUrl, startedAt: data.startedAt };
              void printTableQr({ type: 'table_qr', table: qrData });
            }}>
              <Printer className="mr-1.5 size-4" />พิมพ์ QR
            </Button>
          )}
          <Button onClick={onClose}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Open Table Flow ──────────────────────────────────────────────── */

type OpenStep = 'tiles' | 'link';

interface OpenTableFlowProps {
  open: boolean;
  table: TableData | null;
  allTables: TableData[];
  pricingTiles: PricingTileData[];
  reservationId?: string;     // if opening from reservation
  prefillGuests?: Record<string, number>;
  onClose: () => void;
  onSuccess: (data: { sessionToken: string; tableQrToken: string; tableLabel: string; startedAt: string }) => void;
}

function OpenTableFlow({ open, table, allTables, pricingTiles, reservationId, prefillGuests, onClose, onSuccess }: OpenTableFlowProps) {
  const [step, setStep] = useState<OpenStep>('tiles');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('tiles');
      setQuantities(prefillGuests ?? {});
      setLinkedIds([]);
      setNotes('');
    }
  }, [open, prefillGuests]);

  const totalGuests = Object.values(quantities).reduce((s, q) => s + q, 0);
  const totalAmount = pricingTiles.reduce((s, t) => s + Number(t.price) * (quantities[t.id] ?? 0), 0);

  const handleSubmit = async () => {
    if (!table) return;
    setSubmitting(true);
    const guests = pricingTiles
      .map((t) => ({ pricingTileId: t.id, quantity: quantities[t.id] ?? 0 }))
      .filter((g) => g.quantity > 0);
    const result = await openSession({
      tableId: table.id,
      linkedTableIds: linkedIds,
      guests,
      notes: notes || undefined,
      reservationId,
    });
    setSubmitting(false);
    if (result.ok) {
      toast.success(`เปิดโต๊ะ ${table.label} สำเร็จ`);
      onSuccess(result.data);
      onClose();
    } else {
      toast.error(result.error);
    }
  };

  if (!table) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            เปิดโต๊ะ {table.label}
            {reservationId && <span className="ml-2 text-sm font-normal text-blue-600">(จากการจอง)</span>}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-0.5 font-medium ${step === 'tiles' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>1 จำนวนคน</span>
          <ChevronRight className="size-3 text-slate-400" />
          <span className={`rounded-full px-2.5 py-0.5 font-medium ${step === 'link' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>2 เชื่อมโยงโต๊ะ</span>
        </div>

        {step === 'tiles' && (
          <div className="space-y-4">
            <TilePicker
              tiles={pricingTiles}
              quantities={quantities}
              onChange={(id, qty) => setQuantities((p) => ({ ...p, [id]: qty }))}
            />
            {totalGuests > 0 && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">รวม </span>
                <span className="font-semibold text-slate-900">{totalGuests} คน</span>
                <span className="ml-2 text-slate-400">ยอดประมาณ </span>
                <span className="font-semibold text-slate-900">฿{totalAmount.toLocaleString('th-TH')}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="open-notes">หมายเหตุ (ไม่บังคับ)</Label>
              <Input id="open-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="เช่น ลูกค้า VIP" />
            </div>
          </div>
        )}

        {step === 'link' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">เลือกโต๊ะที่ต้องการเชื่อมโยงกับโต๊ะ {table.label} (ไม่บังคับ)</p>
            <LinkedTablePicker
              tables={allTables}
              primaryTableId={table.id}
              selected={linkedIds}
              onToggle={(id) => setLinkedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            />
            {linkedIds.length > 0 && (
              <p className="text-xs text-slate-500">เชื่อมโยง {linkedIds.length} โต๊ะ — นับรวมเป็น session เดียวกัน</p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'tiles' ? (
            <>
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">ยกเลิก</button>
              <Button onClick={() => setStep('link')} disabled={totalGuests === 0}>ถัดไป <ChevronRight className="ml-1 size-4" /></Button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep('tiles')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">ย้อนกลับ</button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'กำลังเปิด...' : 'เปิดโต๊ะ'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Reservation Flow ─────────────────────────────────────────────── */

type ReserveStep = 'customer' | 'tiles' | 'link';

interface ReservationFlowProps {
  open: boolean;
  table: TableData | null;
  allTables: TableData[];
  pricingTiles: PricingTileData[];
  onClose: () => void;
  onSuccess: () => void;
}

function ReservationFlow({ open, table, allTables, pricingTiles, onClose, onSuccess }: ReservationFlowProps) {
  const [step, setStep] = useState<ReserveStep>('customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState('2');
  // default: tomorrow same hour
  const [reservedAt, setReservedAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('customer');
      setName(''); setPhone(''); setPartySize('2'); setNotes('');
      setQuantities({}); setLinkedIds([]);
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setSeconds(0, 0);
      setReservedAt(d.toISOString().slice(0, 16));
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!table) return;
    setSubmitting(true);
    const guests = pricingTiles
      .map((t) => ({ pricingTileId: t.id, quantity: quantities[t.id] ?? 0 }))
      .filter((g) => g.quantity > 0);
    const result = await createReservation({
      primaryTableId: table.id,
      linkedTableIds: linkedIds,
      customerName: name.trim(),
      customerPhone: phone.trim() || undefined,
      partySize: Number(partySize) || 1,
      reservedAt: new Date(reservedAt).toISOString(),
      notes: notes.trim() || undefined,
      guests,
    });
    setSubmitting(false);
    if (result.ok) {
      toast.success(`จองโต๊ะ ${table.label} สำเร็จ`);
      onSuccess();
      onClose();
    } else {
      toast.error(result.error);
    }
  };

  if (!table) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>จองโต๊ะ {table.label}</DialogTitle></DialogHeader>

        <div className="flex items-center gap-2 text-xs">
          {(['customer', 'tiles', 'link'] as ReserveStep[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="size-3 text-slate-400" />}
              <span className={`rounded-full px-2.5 py-0.5 font-medium ${step === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {i + 1} {s === 'customer' ? 'ข้อมูลลูกค้า' : s === 'tiles' ? 'ประเภทลูกค้า' : 'เชื่อมโยงโต๊ะ'}
              </span>
            </span>
          ))}
        </div>

        {step === 'customer' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-name">ชื่อลูกค้า *</Label>
              <Input id="res-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="คุณสมชาย" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="res-phone">เบอร์โทร</Label>
                <Input id="res-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="081-xxx-xxxx" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-party">จำนวนคน</Label>
                <Input id="res-party" type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-dt">วันเวลาที่จอง</Label>
              <Input id="res-dt" type="datetime-local" value={reservedAt} onChange={(e) => setReservedAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-notes">หมายเหตุ</Label>
              <Input id="res-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        {step === 'tiles' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">ระบุประเภทผู้เข้าใช้ล่วงหน้า (ไม่บังคับ)</p>
            <TilePicker
              tiles={pricingTiles}
              quantities={quantities}
              onChange={(id, qty) => setQuantities((p) => ({ ...p, [id]: qty }))}
            />
          </div>
        )}

        {step === 'link' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">เลือกโต๊ะที่ต้องการจองร่วมกัน (ไม่บังคับ)</p>
            <LinkedTablePicker
              tables={allTables}
              primaryTableId={table.id}
              selected={linkedIds}
              onToggle={(id) => setLinkedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            />
          </div>
        )}

        <DialogFooter>
          {step === 'customer' && (
            <>
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">ยกเลิก</button>
              <Button onClick={() => setStep('tiles')} disabled={!name.trim()}>ถัดไป <ChevronRight className="ml-1 size-4" /></Button>
            </>
          )}
          {step === 'tiles' && (
            <>
              <button type="button" onClick={() => setStep('customer')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">ย้อนกลับ</button>
              <Button onClick={() => setStep('link')}>ถัดไป <ChevronRight className="ml-1 size-4" /></Button>
            </>
          )}
          {step === 'link' && (
            <>
              <button type="button" onClick={() => setStep('tiles')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">ย้อนกลับ</button>
              <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'กำลังจอง...' : 'ยืนยันจอง'}</Button>
            </>
          )}
        </DialogFooter>
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

/* ─── Table Sheet Panel ────────────────────────────────────────────── */

interface TableSheetProps {
  open: boolean;
  table: TableData | null;
  allTables: TableData[];
  pricingTiles: PricingTileData[];
  onClose: () => void;
  onRefetch: () => void;
  onOpenTable: (table: TableData, reservationId?: string, prefillGuests?: Record<string, number>) => void;
  onReserveTable: (table: TableData) => void;
  onMoveTable: (sessionId: string, tableLabel: string) => void;
}

function TableSheet({
  open,
  table,
  allTables,
  pricingTiles,
  onClose,
  onRefetch,
  onOpenTable,
  onReserveTable,
  onMoveTable,
}: TableSheetProps) {
  const [busy, setBusy] = useState(false);

  if (!table) return null;
  const sess = table.activeSession;
  const resv = table.activeReservation;
  const visualStatus = getVisualStatus(table);

  const handleRequestBill = async () => {
    if (!sess) return;
    setBusy(true);
    const r = await requestBillFromTable({ sessionId: sess.id });
    setBusy(false);
    if (r.ok) { toast.success('แจ้งรับบิลแล้ว'); onClose(); onRefetch(); }
    else toast.error(r.error);
  };

  const handleForceClose = async () => {
    if (!sess) return;
    if (!confirm(`บังคับปิดโต๊ะ ${table.label}?`)) return;
    setBusy(true);
    const r = await closeSession({ sessionId: sess.id });
    setBusy(false);
    if (r.ok) { toast.success(`ปิดโต๊ะ ${table.label} แล้ว`); onClose(); onRefetch(); }
    else toast.error(r.error);
  };

  const handleCancelReservation = async () => {
    if (!resv) return;
    if (!confirm(`ยกเลิกการจองโต๊ะ ${table.label}?`)) return;
    setBusy(true);
    const r = await cancelReservation(resv.id);
    setBusy(false);
    if (r.ok) { toast.success('ยกเลิกการจองแล้ว'); onClose(); onRefetch(); }
    else toast.error(r.error);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-80 sm:max-w-sm overflow-y-auto p-0">
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_CONFIG[visualStatus].dot}`} />
            <SheetTitle className="text-base">
              โต๊ะ {table.label}
              {table.zone !== 'ทั่วไป' && <span className="ml-1.5 text-sm font-normal text-slate-500">({table.zone})</span>}
            </SheetTitle>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CONFIG[visualStatus].bg} ${STATUS_CONFIG[visualStatus].text}`}>
              {STATUS_CONFIG[visualStatus].label}
            </span>
          </div>
        </SheetHeader>

        <div className="space-y-4 px-5 py-4">
          {/* ── AVAILABLE ── */}
          {visualStatus === 'available' && (
            <>
              <p className="text-sm text-slate-500">{table.capacity} ที่นั่ง — พร้อมรับลูกค้า</p>
              <button
                type="button"
                onClick={() => { onClose(); onOpenTable(table); }}
                className="flex w-full items-center justify-between rounded-xl border-2 border-slate-800 bg-slate-800 px-4 py-4 text-left text-white hover:bg-slate-700 transition-colors"
              >
                <div>
                  <p className="font-semibold">เปิดโต๊ะ</p>
                  <p className="text-xs text-slate-300">เริ่ม session และเลือกประเภทผู้เข้าใช้</p>
                </div>
                <ChevronRight className="size-5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => { onClose(); onReserveTable(table); }}
                className="flex w-full items-center justify-between rounded-xl border-2 border-blue-600 bg-blue-50 px-4 py-4 text-left text-blue-800 hover:bg-blue-100 transition-colors"
              >
                <div>
                  <p className="font-semibold">จองโต๊ะล่วงหน้า</p>
                  <p className="text-xs text-blue-600">บันทึกข้อมูลลูกค้าและวันเวลา</p>
                </div>
                <CalendarClock className="size-5 shrink-0" />
              </button>
            </>
          )}

          {/* ── OCCUPIED / CLOSING ── */}
          {(visualStatus === 'occupied' || visualStatus === 'closing') && sess && (
            <>
              {visualStatus === 'closing' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-medium text-amber-800">แจ้งรับบิลแล้ว — รอแคชเชียร์</p>
                </div>
              )}

              {/* Session info */}
              <div className="rounded-xl bg-slate-50 p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5 text-slate-500"><Clock className="size-3.5" />เริ่ม</span>
                  <span className="font-medium">{new Date(sess.startedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">เวลาที่ผ่านมา</span>
                  <span className="font-medium">{formatDistanceToNowStrict(new Date(sess.startedAt), { locale: th })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5 text-slate-500"><Users className="size-3.5" />จำนวนคน</span>
                  <span className="font-medium">{sess.totalGuests} คน</span>
                </div>
                {sess.guests.map((g) => (
                  <div key={g.id} className="flex justify-between pl-3 text-xs text-slate-400">
                    <span>{g.pricingTile.name} ×{g.quantity}</span>
                    <span>฿{(Number(g.pricingTile.price) * g.quantity).toLocaleString('th-TH')}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-slate-500">ยอดค่าอาหาร</span>
                  <span className="font-semibold text-slate-900">฿{sess.baseAmount.toLocaleString('th-TH')}</span>
                </div>
                {sess.parentSessionId && (
                  <p className="text-xs text-violet-600 flex items-center gap-1"><Link2 className="size-3" />โต๊ะลิงก์</p>
                )}
                {sess.notes && <p className="text-xs text-slate-400 italic">{sess.notes}</p>}
              </div>

              <div className="space-y-2">
                {visualStatus === 'occupied' && (
                  <button
                    type="button"
                    onClick={handleRequestBill}
                    disabled={busy}
                    className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                  >
                    เรียกเก็บเงิน
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { onClose(); onMoveTable(sess.id, table.label); }}
                  disabled={busy || !!sess.parentSessionId}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  <span className="flex items-center justify-center gap-2"><MoveRight className="size-4" />ย้ายโต๊ะ</span>
                </button>
                <button
                  type="button"
                  onClick={handleForceClose}
                  disabled={busy}
                  className="w-full rounded-xl border border-red-200 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  บังคับปิดโต๊ะ
                </button>
              </div>
            </>
          )}

          {/* ── RESERVED ── */}
          {visualStatus === 'reserved' && (
            <>
              {resv ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-blue-50 p-3 space-y-2 text-sm border border-blue-100">
                    <div className="flex items-center gap-2">
                      <BadgeCheck className="size-4 text-blue-600 shrink-0" />
                      <span className="font-semibold text-blue-900">{resv.customerName}</span>
                      {resv.customerPhone && (
                        <span className="text-xs text-blue-600">{resv.customerPhone}</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">วันเวลา</span>
                      <span className="font-medium text-slate-900">
                        {format(new Date(resv.reservedAt), 'd MMM HH:mm', { locale: th })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">จำนวน</span>
                      <span className="font-medium">{resv.partySize} คน</span>
                    </div>
                    {resv.notes && <p className="text-xs text-slate-400 italic">{resv.notes}</p>}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenTable(table, resv.id);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border-2 border-slate-800 bg-slate-800 px-4 py-4 text-left text-white hover:bg-slate-700 transition-colors"
                  >
                    <div>
                      <p className="font-semibold">ลูกค้ามาแล้ว — เปิดโต๊ะ</p>
                      <p className="text-xs text-slate-300">เริ่ม session จากการจองนี้</p>
                    </div>
                    <ChevronRight className="size-5 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelReservation}
                    disabled={busy}
                    className="w-full rounded-xl border border-red-200 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    ยกเลิกการจอง
                  </button>
                </div>
              ) : (
                // Reserved via old setTableReserved (no reservation record)
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">โต๊ะนี้ถูกจองไว้ (ไม่มีข้อมูลการจอง)</p>
                  <button
                    type="button"
                    onClick={() => { onClose(); onOpenTable(table); }}
                    className="flex w-full items-center justify-between rounded-xl border-2 border-slate-800 bg-slate-800 px-4 py-4 text-left text-white hover:bg-slate-700 transition-colors"
                  >
                    <div>
                      <p className="font-semibold">เปิดโต๊ะ</p>
                    </div>
                    <ChevronRight className="size-5 shrink-0" />
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── LINKED ── */}
          {visualStatus === 'linked' && sess && (
            <>
              <div className="rounded-xl bg-violet-50 p-3 border border-violet-100 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Link2 className="size-4 text-violet-600 shrink-0" />
                  <p className="font-medium text-violet-900">โต๊ะนี้ถูกเชื่อมโยงกับ session อื่น</p>
                </div>
                <p className="text-xs text-slate-500">จัดการผ่านโต๊ะหลักที่เปิด session</p>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">เริ่ม</span>
                  <span className="font-medium">{new Date(sess.startedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">เวลาที่ผ่านมา</span>
                  <span>{formatDistanceToNowStrict(new Date(sess.startedAt), { locale: th })}</span>
                </div>
              </div>
              {/* Find the primary table and highlight it */}
              {(() => {
                const primaryTable = allTables.find(
                  (t) => t.activeSession?.id === sess.parentSessionId,
                );
                return primaryTable ? (
                  <p className="text-xs text-slate-500">
                    โต๊ะหลัก: <span className="font-semibold text-slate-800">{primaryTable.label}</span>
                  </p>
                ) : null;
              })()}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Table Node (draggable) ───────────────────────────────────────── */

interface TableNodeProps {
  table: TableData;
  editMode: boolean;
  moveMode: boolean;
  onClickSession: (table: TableData) => void;
  onClickEdit: (table: TableData) => void;
  onClickMove: (table: TableData) => void;
}

function TableNode({ table, editMode, moveMode, onClickSession, onClickEdit, onClickMove }: TableNodeProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: table.id,
    disabled: !editMode,
  });

  const vs = getVisualStatus(table);
  const cfg = STATUS_CONFIG[vs] ?? STATUS_CONFIG.available;
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
      className={`flex flex-col items-center justify-center border-2 shadow-sm select-none
        ${cfg.bg} ${cfg.border} ${shape}
        ${editMode ? 'ring-2 ring-offset-1 ring-slate-400' : ''}
        ${isMoveTarget && moveMode ? 'ring-2 ring-green-500 animate-pulse' : ''}
        ${moveMode && !isMoveTarget ? 'opacity-40' : 'hover:shadow-md transition-shadow'}
      `}
    >
      <span className={`text-lg font-bold tabular-nums ${cfg.text}`}>{table.label}</span>
      <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {table.activeSession && !table.activeSession.parentSessionId && (
        <ElapsedBadge startedAt={table.activeSession.startedAt} />
      )}

      {editMode && (
        <button
          type="button"
          aria-label="แก้ไขโต๊ะ"
          onClick={(e) => { e.stopPropagation(); onClickEdit(table); }}
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white border border-slate-300 shadow hover:bg-slate-50"
        >
          <Settings2 className="h-3 w-3 text-slate-600" />
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
  const [zone, setZone] = useState(table.zone);
  const [shape, setShape] = useState<'square' | 'rectangle'>(table.shape);
  const [width, setWidth] = useState(String(table.width));
  const [height, setHeight] = useState(String(table.height));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const r = await updateTableMeta({ tableId: table.id, label, capacity: Number(capacity) || 4, zone, shape, width: Number(width) || 80, height: Number(height) || 80 });
    setSaving(false);
    if (r.ok) { toast.success('บันทึกแล้ว'); onSaved(); }
    else toast.error(r.error);
  };

  const handleDelete = async () => {
    if (!confirm(`ลบโต๊ะ ${table.label} ออกจากผัง?`)) return;
    setDeleting(true);
    const r = await softDeleteTable({ tableId: table.id });
    setDeleting(false);
    if (r.ok) { toast.success('ลบโต๊ะแล้ว'); onDeleted(); }
    else toast.error(r.error);
  };

  return (
    <div className="w-64 shrink-0 border-l border-slate-200 bg-white p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">แก้ไขโต๊ะ {table.label}</p>
        <button type="button" aria-label="ปิด" onClick={onClose} className="rounded p-0.5 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
      </div>
      <div className="space-y-1.5"><Label htmlFor="el">ชื่อโต๊ะ</Label><Input id="el" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="ec">จำนวนที่นั่ง</Label><Input id="ec" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="ez">โซน</Label><Input id="ez" value={zone} onChange={(e) => setZone(e.target.value)} /></div>
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
  );
}

/* ─── Add Table Dialog ─────────────────────────────────────────────── */

interface AddTableDialogProps { open: boolean; onClose: () => void; onCreated: () => void; }

function AddTableDialog({ open, onClose, onCreated }: AddTableDialogProps) {
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [zone, setZone] = useState('ทั่วไป');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!label.trim()) { toast.error('กรุณาระบุชื่อโต๊ะ'); return; }
    setSubmitting(true);
    const r = await createTable({ label: label.trim(), capacity: Number(capacity) || 4, zone: zone || 'ทั่วไป', positionX: 20, positionY: 20 });
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
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label htmlFor="nc">จำนวนที่นั่ง</Label><Input id="nc" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="nz">โซน</Label><Input id="nz" value={zone} onChange={(e) => setZone(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">ยกเลิก</button>
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
  const [openFlowReservationId, setOpenFlowReservationId] = useState<string | undefined>();
  const [openFlowPrefill, setOpenFlowPrefill] = useState<Record<string, number> | undefined>();
  const [openFlowOpen, setOpenFlowOpen] = useState(false);

  // Reservation flow
  const [reserveFlowTable, setReserveFlowTable] = useState<TableData | null>(null);
  const [reserveFlowOpen, setReserveFlowOpen] = useState(false);

  // Move table
  const [moveSessionId, setMoveSessionId] = useState<string | null>(null);
  const [moveSessionLabel, setMoveSessionLabel] = useState('');

  // QR dialog
  const [qrData, setQrData] = useState<{
    sessionToken: string; tableQrToken: string; tableLabel: string; startedAt: string;
  } | null>(null);

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, delta } = event;
    const table = tables.find((t) => t.id === active.id);
    if (!table) return;
    const newX = Math.max(0, table.positionX + Math.round(delta.x));
    const newY = Math.max(0, table.positionY + Math.round(delta.y));
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

  const canvasW = Math.max(1000, ...tables.map((t) => t.positionX + t.width + 40));
  const canvasH = Math.max(600, ...tables.map((t) => t.positionY + t.height + 40));

  const counts = tables.reduce<Record<string, number>>((acc, t) => {
    const key = t.activeSession?.status === 'closing' ? 'closing' : t.status;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-slate-900">ผังโต๊ะ</h1>
          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
            <LegendDot color="bg-green-500" label={`ว่าง (${counts.available ?? 0})`} />
            <LegendDot color="bg-red-500" label={`มีลูกค้า (${counts.occupied ?? 0})`} />
            <LegendDot color="bg-amber-500" label={`รอบิล (${counts.closing ?? 0})`} />
            <LegendDot color="bg-blue-500" label={`จอง (${counts.reserved ?? 0})`} />
            {(counts.linked ?? 0) > 0 && <LegendDot color="bg-violet-500" label={`เชื่อมโยง (${counts.linked})`} />}
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
              editMode ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {editMode ? 'เสร็จสิ้น' : 'แก้ไขผัง'}
          </button>
        </div>
      </div>

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
        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div
              className="relative bg-white rounded-xl shadow-inner border border-slate-200"
              style={{ width: canvasW, height: canvasH }}
              onClick={editMode ? (e) => { if (e.target === e.currentTarget) setEditingTable(null); } : undefined}
            >
              <svg className="absolute inset-0 pointer-events-none" width={canvasW} height={canvasH}>
                <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#e2e8f0" /></pattern></defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
              {tables.map((table) => (
                <TableNode
                  key={table.id}
                  table={table}
                  editMode={editMode}
                  moveMode={!!moveSessionId}
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
        onOpenTable={(t, resId, prefill) => {
          setOpenFlowTable(t);
          setOpenFlowReservationId(resId);
          setOpenFlowPrefill(prefill);
          setOpenFlowOpen(true);
        }}
        onReserveTable={(t) => {
          setReserveFlowTable(t);
          setReserveFlowOpen(true);
        }}
        onMoveTable={(sessionId, label) => {
          setMoveSessionId(sessionId);
          setMoveSessionLabel(label);
        }}
      />

      {/* Open Table Flow */}
      <OpenTableFlow
        open={openFlowOpen}
        table={openFlowTable}
        allTables={tables}
        pricingTiles={pricingTiles}
        reservationId={openFlowReservationId}
        prefillGuests={openFlowPrefill}
        onClose={() => { setOpenFlowOpen(false); setOpenFlowTable(null); }}
        onSuccess={(data) => {
          setQrData(data);
          refetch();
        }}
      />

      {/* Reservation Flow */}
      <ReservationFlow
        open={reserveFlowOpen}
        table={reserveFlowTable}
        allTables={tables}
        pricingTiles={pricingTiles}
        onClose={() => { setReserveFlowOpen(false); setReserveFlowTable(null); }}
        onSuccess={refetch}
      />

      {/* QR Dialog */}
      <SessionQrDialog
        open={!!qrData}
        data={qrData}
        onClose={() => setQrData(null)}
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
