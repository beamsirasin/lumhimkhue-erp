'use client';

import { useState, useEffect, CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { toast } from 'sonner';
import {
  Plus,
  Settings2,
  X,
  Printer,
} from 'lucide-react';
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
  type PricingTierData,
  createTable,
  updateTablePosition,
  updateTableMeta,
  softDeleteTable,
  setTableReserved,
} from '@/lib/actions/tables';
import {
  openSession,
  closeSession,
  requestBillFromTable,
  setTableAvailable,
} from '@/lib/actions/sessions';
import { print as printTableQr } from '@/lib/printer/service';
import type { TableQrData } from '@/lib/printer/types';
import { differenceInSeconds, formatDistanceToNowStrict } from 'date-fns';
import { th } from 'date-fns/locale';

/* ─── Status config ────────────────────────────────────────────────────────── */

const STATUS_CONFIG = {
  available: {
    bg: 'bg-green-100',
    border: 'border-green-400',
    text: 'text-green-800',
    label: 'ว่าง',
    dot: 'bg-green-500',
  },
  occupied: {
    bg: 'bg-red-100',
    border: 'border-red-400',
    text: 'text-red-800',
    label: 'มีลูกค้า',
    dot: 'bg-red-500',
  },
  closing: {
    bg: 'bg-amber-100',
    border: 'border-amber-400',
    text: 'text-amber-800',
    label: 'รอบิล',
    dot: 'bg-amber-500',
  },
  reserved: {
    bg: 'bg-blue-100',
    border: 'border-blue-400',
    text: 'text-blue-800',
    label: 'จอง',
    dot: 'bg-blue-500',
  },
} as const;

function ElapsedBadge({ startedAt }: { startedAt: Date }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    function update() {
      const secs = differenceInSeconds(new Date(), new Date(startedAt));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      if (h > 0) setElapsed(`${h}ชม. ${m}น.`);
      else setElapsed(`${m}น.`);
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="tabular-nums text-[10px] text-current opacity-70">{elapsed}</span>;
}

/* ─── Draggable Table Node ─────────────────────────────────────────────────── */

interface TableNodeProps {
  table: TableData;
  editMode: boolean;
  onClickSession: (table: TableData) => void;
  onClickEdit: (table: TableData) => void;
}

function TableNode({ table, editMode, onClickSession, onClickEdit }: TableNodeProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: table.id,
    disabled: !editMode,
  });

  const cfg =
    STATUS_CONFIG[
      (table.activeSession?.status === 'closing' ? 'closing' : table.status) as keyof typeof STATUS_CONFIG
    ] ?? STATUS_CONFIG.available;

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
    cursor: editMode ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
  };

  const shape = table.shape === 'rectangle' ? 'rounded-md' : 'rounded-lg';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editMode ? { ...attributes, ...listeners } : {})}
      onClick={!editMode ? () => onClickSession(table) : undefined}
      className={`flex flex-col items-center justify-center border-2 shadow-sm select-none
        ${cfg.bg} ${cfg.border} ${shape}
        ${editMode ? 'ring-2 ring-offset-1 ring-slate-400' : 'hover:shadow-md transition-shadow'}
      `}
    >
      {/* Label */}
      <span className={`text-lg font-bold tabular-nums ${cfg.text}`}>{table.label}</span>

      {/* Status dot */}
      <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${cfg.dot}`} />

      {/* Elapsed if occupied */}
      {table.activeSession && (
        <ElapsedBadge startedAt={table.activeSession.startedAt} />
      )}

      {/* Edit button overlay */}
      {editMode && (
        <button
          type="button"
          aria-label="แก้ไขโต๊ะ"
          onClick={(e) => {
            e.stopPropagation();
            onClickEdit(table);
          }}
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white border border-slate-300 shadow hover:bg-slate-50"
        >
          <Settings2 className="h-3 w-3 text-slate-600" />
        </button>
      )}
    </div>
  );
}

/* ─── Open Table Dialog ─────────────────────────────────────────────────────── */

interface OpenTableDialogProps {
  open: boolean;
  table: TableData | null;
  pricingTiers: PricingTierData[];
  onClose: () => void;
  onSuccess: (data: { sessionToken: string; tableQrToken: string; tableLabel: string; startedAt: string }) => void;
}

function OpenTableDialog({ open, table, pricingTiers, onClose, onSuccess }: OpenTableDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setQuantities({});
      setNotes('');
    }
  }, [open]);

  const totalGuests = Object.values(quantities).reduce((s, q) => s + q, 0);

  const handleSubmit = async () => {
    if (!table) return;
    if (totalGuests === 0) {
      toast.error('ต้องมีผู้เข้าใช้บริการอย่างน้อย 1 คน');
      return;
    }
    setSubmitting(true);
    const guests = pricingTiers
      .map((t) => ({ pricingTierId: t.id, quantity: quantities[t.id] ?? 0 }))
      .filter((g) => g.quantity > 0);

    const result = await openSession({ tableId: table.id, guests, notes: notes || undefined });
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>เปิดโต๊ะ {table.label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Guest counts per tier */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">จำนวนผู้เข้าใช้บริการ</p>
            {pricingTiers.map((tier) => (
              <div key={tier.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{tier.name}</p>
                  <p className="text-xs text-slate-500">฿{Number(tier.price).toLocaleString('th-TH')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    aria-label="ลด"
                    onClick={() =>
                      setQuantities((prev) => ({
                        ...prev,
                        [tier.id]: Math.max(0, (prev[tier.id] ?? 0) - 1),
                      }))
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300"
                  >
                    −
                  </button>
                  <span className="w-6 text-center tabular-nums text-sm font-semibold">
                    {quantities[tier.id] ?? 0}
                  </span>
                  <button
                    type="button"
                    aria-label="เพิ่ม"
                    onClick={() =>
                      setQuantities((prev) => ({
                        ...prev,
                        [tier.id]: (prev[tier.id] ?? 0) + 1,
                      }))
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-white hover:bg-slate-700"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Total */}
          {totalGuests > 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">รวม </span>
              <span className="font-semibold text-slate-900">{totalGuests} คน</span>
              <span className="ml-2 text-slate-500">ยอดประมาณ </span>
              <span className="font-semibold text-slate-900">
                ฿{pricingTiers
                  .reduce((s, t) => s + Number(t.price) * (quantities[t.id] ?? 0), 0)
                  .toLocaleString('th-TH')}
              </span>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="table-notes">หมายเหตุ (ไม่บังคับ)</Label>
            <Input
              id="table-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="เช่น จองโต๊ะ, ลูกค้า VIP"
            />
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            ยกเลิก
          </button>
          <Button onClick={handleSubmit} disabled={submitting || totalGuests === 0}>
            {submitting ? 'กำลังเปิด...' : 'เปิดโต๊ะ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Session QR Dialog ──────────────────────────────────────────────────── */

function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(url, { width: 200, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
        .then(setSrc)
        .catch(() => setSrc(''));
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
  const sessionUrl = data
    ? `${appUrl}/t/${data.tableQrToken}/s/${data.sessionToken}`
    : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>โต๊ะ {data?.tableLabel} พร้อมแล้ว</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-center text-sm text-slate-500">ให้ลูกค้าสแกน QR นี้เพื่อสั่งอาหาร</p>
          <QrImage url={sessionUrl} />
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="break-all text-center font-mono text-xs text-slate-600 select-all">
              {sessionUrl}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(sessionUrl).catch(() => {});
              toast.success('คัดลอก URL แล้ว');
            }}
          >
            คัดลอก URL
          </Button>
          {data && (
            <Button
              variant="outline"
              onClick={() => {
                const qrData: TableQrData = {
                  tableNumber: data.tableLabel,
                  url: sessionUrl,
                  startedAt: data.startedAt,
                };
                void printTableQr({ type: 'table_qr', table: qrData });
              }}
            >
              <Printer className="mr-1.5 size-4" />
              พิมพ์ QR
            </Button>
          )}
          <Button onClick={onClose}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Table Action Dialog ───────────────────────────────────────────────────── */

interface TableActionDialogProps {
  open: boolean;
  table: TableData | null;
  onClose: () => void;
  onOpenTable: () => void;
  onRefetch: () => void;
}

function TableActionDialog({ open, table, onClose, onOpenTable, onRefetch }: TableActionDialogProps) {
  const [busy, setBusy] = useState(false);

  if (!table) return null;
  const sess = table.activeSession;
  const closingStatus = sess?.status === 'closing';

  const handleClose = async () => {
    if (!sess) return;
    setBusy(true);
    const result = await closeSession({ sessionId: sess.id });
    setBusy(false);
    if (result.ok) {
      toast.success(`ปิดโต๊ะ ${table.label} แล้ว`);
      onClose();
      onRefetch();
    } else {
      toast.error(result.error);
    }
  };

  const handleRequestBill = async () => {
    if (!sess) return;
    setBusy(true);
    const result = await requestBillFromTable({ sessionId: sess.id });
    setBusy(false);
    if (result.ok) {
      toast.success('แจ้งพนักงานรับบิลแล้ว');
      onClose();
      onRefetch();
    } else {
      toast.error(result.error);
    }
  };

  const handleMarkAvailable = async () => {
    setBusy(true);
    const result = await setTableAvailable({ tableId: table.id });
    setBusy(false);
    if (result.ok) {
      toast.success(`โต๊ะ ${table.label} พร้อมใช้งาน`);
      onClose();
      onRefetch();
    } else {
      toast.error(result.error);
    }
  };

  const handleReserve = async () => {
    setBusy(true);
    const result = await setTableReserved({ tableId: table.id });
    setBusy(false);
    if (result.ok) {
      toast.success(`จองโต๊ะ ${table.label} แล้ว`);
      onClose();
      onRefetch();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            โต๊ะ {table.label}
            {table.zone !== 'ทั่วไป' && (
              <span className="ml-2 text-sm font-normal text-slate-500">({table.zone})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* AVAILABLE */}
        {table.status === 'available' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">โต๊ะว่าง — {table.capacity} ที่นั่ง</p>
            <DialogFooter>
              <button
                type="button"
                onClick={handleReserve}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                จองโต๊ะ
              </button>
              <Button onClick={onOpenTable} disabled={busy}>
                เปิดโต๊ะ
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* OCCUPIED / CLOSING */}
        {(table.status === 'occupied' || table.status === 'reserved') && sess && (
          <div className="space-y-3">
            {/* Status badge */}
            {closingStatus && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <p className="text-xs font-medium text-amber-800">แจ้งรับบิลแล้ว — รอแคชเชียร์</p>
              </div>
            )}

            {/* Session info */}
            <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">เริ่มใช้บริการ</span>
                <span className="font-medium text-slate-900">
                  {new Date(sess.startedAt).toLocaleTimeString('th-TH', {
                    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">เวลาที่ผ่านมา</span>
                <span className="font-medium text-slate-900">
                  {formatDistanceToNowStrict(new Date(sess.startedAt), { locale: th })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">จำนวนคน</span>
                <span className="font-medium text-slate-900">{sess.totalGuests} คน</span>
              </div>
              {/* Guest breakdown */}
              {sess.guests.map((g) => (
                <div key={g.id} className="flex justify-between pl-3 text-xs">
                  <span className="text-slate-400">{g.pricingTier.name} ×{g.quantity}</span>
                  <span className="text-slate-500">
                    ฿{(Number(g.pricingTier.price) * g.quantity).toLocaleString('th-TH')}
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="text-slate-500">ยอด (ค่าอาหาร)</span>
                <span className="font-semibold text-slate-900">
                  ฿{sess.baseAmount.toLocaleString('th-TH')}
                </span>
              </div>
            </div>

            <DialogFooter>
              {!closingStatus && (
                <button
                  type="button"
                  onClick={handleRequestBill}
                  disabled={busy}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  เรียกเก็บเงิน
                </button>
              )}
              <Button
                variant="destructive"
                disabled={busy}
                onClick={handleClose}
              >
                บังคับปิดโต๊ะ
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* RESERVED (no session) */}
        {table.status === 'reserved' && !sess && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">โต๊ะนี้ถูกจองไว้</p>
            <DialogFooter>
              <Button onClick={handleMarkAvailable} disabled={busy}>
                ยกเลิกจอง (ว่าง)
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Table Edit Panel ──────────────────────────────────────────────────────── */

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
    const result = await updateTableMeta({
      tableId: table.id,
      label,
      capacity: Number(capacity) || 4,
      zone,
      shape,
      width: Number(width) || 80,
      height: Number(height) || 80,
    });
    setSaving(false);
    if (result.ok) {
      toast.success('บันทึกแล้ว');
      onSaved();
    } else {
      toast.error(result.error);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`ลบโต๊ะ ${table.label} ออกจากผัง?`)) return;
    setDeleting(true);
    const result = await softDeleteTable({ tableId: table.id });
    setDeleting(false);
    if (result.ok) {
      toast.success('ลบโต๊ะแล้ว');
      onDeleted();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div className="w-64 shrink-0 border-l border-slate-200 bg-white p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">แก้ไขโต๊ะ {table.label}</p>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="rounded p-0.5 hover:bg-slate-100"
        >
          <X className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-label">ชื่อโต๊ะ</Label>
        <Input id="edit-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-cap">จำนวนที่นั่ง</Label>
        <Input id="edit-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-zone">โซน</Label>
        <Input id="edit-zone" value={zone} onChange={(e) => setZone(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>รูปร่าง</Label>
        <Select value={shape} onValueChange={(v) => setShape(v as 'square' | 'rectangle')}>
          <SelectTrigger aria-label="เลือกรูปร่าง">
            <span>{shape === 'square' ? 'สี่เหลี่ยมจัตุรัส' : 'สี่เหลี่ยมผืนผ้า'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="square">สี่เหลี่ยมจัตุรัส</SelectItem>
            <SelectItem value="rectangle">สี่เหลี่ยมผืนผ้า</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-w">กว้าง (px)</Label>
          <Input id="edit-w" type="number" min={40} value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-h">สูง (px)</Label>
          <Input id="edit-h" type="number" min={40} value={height} onChange={(e) => setHeight(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? 'บันทึก...' : 'บันทึก'}
        </Button>
      </div>

      {table.status === 'available' && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="w-full rounded-lg border border-red-200 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          ลบโต๊ะนี้ออกจากผัง
        </button>
      )}
    </div>
  );
}

/* ─── Add Table Dialog ──────────────────────────────────────────────────────── */

interface AddTableDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function AddTableDialog({ open, onClose, onCreated }: AddTableDialogProps) {
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [zone, setZone] = useState('ทั่วไป');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!label.trim()) {
      toast.error('กรุณาระบุชื่อโต๊ะ');
      return;
    }
    setSubmitting(true);
    const result = await createTable({
      label: label.trim(),
      capacity: Number(capacity) || 4,
      zone: zone || 'ทั่วไป',
      positionX: 20,
      positionY: 20,
    });
    setSubmitting(false);
    if (result.ok) {
      toast.success(`เพิ่มโต๊ะ ${label} แล้ว`);
      onCreated();
      onClose();
      setLabel('');
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>เพิ่มโต๊ะใหม่</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-label">ชื่อโต๊ะ *</Label>
            <Input
              id="new-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="เช่น 1, A, VIP-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-cap">จำนวนที่นั่ง</Label>
              <Input id="new-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-zone">โซน</Label>
              <Input id="new-zone" value={zone} onChange={(e) => setZone(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            ยกเลิก
          </button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? 'กำลังเพิ่ม...' : 'เพิ่มโต๊ะ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main TableGrid (Floor Plan) ──────────────────────────────────────────── */

interface TableGridProps {
  initialTables: TableData[];
  pricingTiers: PricingTierData[];
}

export function TableGrid({ initialTables, pricingTiers }: TableGridProps) {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editingTable, setEditingTable] = useState<TableData | null>(null);
  const [actionTable, setActionTable] = useState<TableData | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [openDialogTable, setOpenDialogTable] = useState<TableData | null>(null);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [qrDialogData, setQrDialogData] = useState<{
    sessionToken: string;
    tableQrToken: string;
    tableLabel: string;
    startedAt: string;
  } | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

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

  const refetch = () => qc.invalidateQueries({ queryKey: ['tables'] });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, delta } = event;
    const table = tables.find((t) => t.id === active.id);
    if (!table) return;

    const newX = Math.max(0, table.positionX + Math.round(delta.x));
    const newY = Math.max(0, table.positionY + Math.round(delta.y));

    await updateTablePosition({ tableId: table.id, positionX: newX, positionY: newY });
    refetch();
  };

  // Canvas size: at least 1000×600, but expands to fit all tables
  const canvasW = Math.max(1000, ...tables.map((t) => t.positionX + t.width + 40));
  const canvasH = Math.max(600, ...tables.map((t) => t.positionY + t.height + 40));

  // Legend counts
  const counts = tables.reduce<Record<string, number>>(
    (acc, t) => {
      const key = t.activeSession?.status === 'closing' ? 'closing' : t.status;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-slate-900">ผังโต๊ะ</h1>
          {/* Legend */}
          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
            <LegendDot color="bg-green-500" label={`ว่าง (${counts.available ?? 0})`} />
            <LegendDot color="bg-red-500" label={`มีลูกค้า (${counts.occupied ?? 0})`} />
            <LegendDot color="bg-amber-500" label={`รอบิล (${counts.closing ?? 0})`} />
            <LegendDot color="bg-blue-500" label={`จอง (${counts.reserved ?? 0})`} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editMode && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="mr-1 size-3.5" />
              เพิ่มโต๊ะ
            </Button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditMode((e) => !e);
              setEditingTable(null);
            }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              editMode
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {editMode ? 'เสร็จสิ้น' : 'แก้ไขผัง'}
          </button>
        </div>
      </div>

      {/* Canvas + Edit Panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div
              className="relative bg-white rounded-xl shadow-inner border border-slate-200"
              style={{ width: canvasW, height: canvasH, minWidth: canvasW, minHeight: canvasH }}
              onClick={
                editMode
                  ? (e) => {
                      if (e.target === e.currentTarget) setEditingTable(null);
                    }
                  : undefined
              }
            >
              {/* Grid dots */}
              <svg
                className="absolute inset-0 pointer-events-none"
                width={canvasW}
                height={canvasH}
              >
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="0.8" fill="#e2e8f0" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>

              {tables.map((table) => (
                <TableNode
                  key={table.id}
                  table={table}
                  editMode={editMode}
                  onClickSession={(t) => {
                    setActionTable(t);
                    setActionOpen(true);
                  }}
                  onClickEdit={(t) => {
                    setEditingTable(editingTable?.id === t.id ? null : t);
                  }}
                />
              ))}
            </div>
          </DndContext>
        </div>

        {/* Edit Panel */}
        {editMode && editingTable && (
          <TableEditPanel
            key={editingTable.id}
            table={editingTable}
            onClose={() => setEditingTable(null)}
            onSaved={() => {
              setEditingTable(null);
              refetch();
            }}
            onDeleted={() => {
              setEditingTable(null);
              refetch();
            }}
          />
        )}
      </div>

      {/* Dialogs */}
      <TableActionDialog
        open={actionOpen}
        table={actionTable}
        onClose={() => {
          setActionOpen(false);
          setActionTable(null);
        }}
        onOpenTable={() => {
          setOpenDialogTable(actionTable);
          setOpenDialogOpen(true);
          setActionOpen(false);
          setActionTable(null);
        }}
        onRefetch={refetch}
      />

      <OpenTableDialog
        open={openDialogOpen}
        table={openDialogTable}
        pricingTiers={pricingTiers}
        onClose={() => {
          setOpenDialogOpen(false);
          setOpenDialogTable(null);
        }}
        onSuccess={(data) => {
          setQrDialogData(data);
          refetch();
        }}
      />

      <SessionQrDialog
        open={!!qrDialogData}
        data={qrDialogData}
        onClose={() => setQrDialogData(null)}
      />

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
