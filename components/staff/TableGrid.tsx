'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
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
import { Printer } from 'lucide-react';
import { TableCard } from '@/components/staff/TableCard';
import { getTablesWithSessions, type TableData, type PackageData } from '@/lib/actions/tables';
import { print as printTableQr } from '@/lib/printer/service';
import type { TableQrData } from '@/lib/printer/types';
import {
  openSession,
  closeSession,
  extendSession,
  setTableAvailable,
} from '@/lib/actions/sessions';
import { openSessionSchema, type OpenSessionInput } from '@/lib/validations/sessions';

// ─── QR Display ──────────────────────────────────────────────────────────────

function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    import('qrcode').then(({ default: QRCode }) => {
      QRCode.toDataURL(url, { width: 220, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
        .then(setSrc)
        .catch(() => setSrc(''));
    });
  }, [url]);

  if (!src) {
    return (
      <div className="mx-auto h-[220px] w-[220px] animate-pulse rounded-lg bg-slate-100" />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="QR Code สำหรับลูกค้า" width={220} height={220} className="mx-auto rounded-lg" />
  );
}

// ─── Open Table Form ──────────────────────────────────────────────────────────

interface OpenTableFormProps {
  tableId: string;
  tableNumber: number;
  packages: PackageData[];
  onSuccess: (data: { sessionToken: string; tableQrToken: string; startedAt: string; endsAt: string; durationMinutes: number }) => void;
  onClose: () => void;
}

function OpenTableForm({ tableId, tableNumber, packages, onSuccess, onClose }: OpenTableFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OpenSessionInput>({
    resolver: zodResolver(openSessionSchema),
    defaultValues: { tableId, packageId: '', adults: 1, children: 0, seniors: 0 },
  });

  const onSubmit = async (data: OpenSessionInput) => {
    const result = await openSession(data);
    if (result.ok) {
      toast.success(`เปิดโต๊ะ ${tableNumber} สำเร็จ`);
      onSuccess(result.data);
    } else {
      toast.error(result.error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Package */}
      <div className="space-y-1.5">
        <Label>แพ็กเกจ</Label>
        <Controller
          control={control}
          name="packageId"
          render={({ field }) => {
            const selected = packages.find((p) => p.id === field.value) ?? null;
            return (
              <Select
                value={field.value || null}
                onValueChange={(v) => field.onChange(v ?? '')}
              >
                <SelectTrigger className="w-full" aria-label="เลือกแพ็กเกจ">
                  <span className={`flex-1 text-left text-sm ${!selected ? 'text-muted-foreground' : ''}`}>
                    {selected
                      ? `${selected.name} — ฿${Number(selected.priceAdult).toLocaleString('th-TH')}`
                      : 'เลือกแพ็กเกจ'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {packages.map((pkg) => (
                    <SelectItem key={pkg.id} value={pkg.id}>
                      {pkg.name} — ฿{Number(pkg.priceAdult).toLocaleString('th-TH')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          }}
        />
        {errors.packageId && (
          <p className="text-xs text-destructive">{errors.packageId.message ?? 'กรุณาเลือกแพ็กเกจ'}</p>
        )}
      </div>

      {/* Guest counts */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="adults">ผู้ใหญ่</Label>
          <Input
            id="adults"
            type="number"
            min={1}
            aria-invalid={!!errors.adults}
            {...register('adults', { valueAsNumber: true })}
          />
          {errors.adults && (
            <p className="text-xs text-destructive">{errors.adults.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="children">เด็ก</Label>
          <Input
            id="children"
            type="number"
            min={0}
            aria-invalid={!!errors.children}
            {...register('children', { valueAsNumber: true })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="seniors">ผู้สูงอายุ</Label>
          <Input
            id="seniors"
            type="number"
            min={0}
            aria-invalid={!!errors.seniors}
            {...register('seniors', { valueAsNumber: true })}
          />
        </div>
      </div>

      <input type="hidden" {...register('tableId')} />

      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          ยกเลิก
        </button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'กำลังเปิดโต๊ะ...' : 'เปิดโต๊ะ'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Session QR Dialog ────────────────────────────────────────────────────────

interface SessionQrDialogProps {
  open: boolean;
  tableNumber: number;
  sessionUrl: string;
  tableQrData: TableQrData | null;
  onClose: () => void;
}

function SessionQrDialog({ open, tableNumber, sessionUrl, tableQrData, onClose }: SessionQrDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>โต๊ะ {tableNumber} พร้อมแล้ว</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-500 text-center">
            ให้ลูกค้าสแกน QR หรือเปิด URL นี้
          </p>
          <QrImage url={sessionUrl} />
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="break-all text-center text-xs text-slate-600 font-mono select-all">
              {sessionUrl}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(sessionUrl).catch(() => {});
              toast.success('คัดลอก URL แล้ว');
            }}
            variant="outline"
          >
            คัดลอก URL
          </Button>
          {tableQrData && (
            <Button
              variant="outline"
              onClick={() => void printTableQr({ type: 'table_qr', table: tableQrData })}
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

// ─── Table Action Dialog ──────────────────────────────────────────────────────

interface TableActionDialogProps {
  open: boolean;
  table: TableData | null;
  packages: PackageData[];
  onClose: () => void;
  onSessionCreated: (data: { sessionToken: string; tableQrToken: string; tableNumber: number; startedAt: string; endsAt: string; durationMinutes: number }) => void;
}

function TableActionDialog({
  open,
  table,
  packages,
  onClose,
  onSessionCreated,
}: TableActionDialogProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (!table) return null;

  const refetch = () => qc.invalidateQueries({ queryKey: ['tables'] });

  const handleCloseSession = async () => {
    if (!table.activeSession) return;
    setBusy(true);
    const result = await closeSession({ sessionId: table.activeSession.id });
    setBusy(false);
    if (result.ok) {
      toast.success('ปิดบิลและย้ายโต๊ะเป็นทำความสะอาดแล้ว');
      onClose();
      refetch();
    } else {
      toast.error(result.error);
    }
  };

  const handleExtend = async () => {
    if (!table.activeSession) return;
    setBusy(true);
    const result = await extendSession({ sessionId: table.activeSession.id, minutes: 15 });
    setBusy(false);
    if (result.ok) {
      toast.success('เพิ่มเวลา 15 นาทีแล้ว');
      refetch();
    } else {
      toast.error(result.error);
    }
  };

  const handleMarkAvailable = async () => {
    setBusy(true);
    const result = await setTableAvailable({ tableId: table.id });
    setBusy(false);
    if (result.ok) {
      toast.success(`โต๊ะ ${table.number} พร้อมใช้งานแล้ว`);
      onClose();
      refetch();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            โต๊ะ {table.number}
            {table.zone !== 'ทั่วไป' && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({table.zone})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* available */}
        {table.status === 'available' && (
          <OpenTableForm
            tableId={table.id}
            tableNumber={table.number}
            packages={packages}
            onSuccess={(data) => {
              onClose();
              onSessionCreated({ ...data, tableNumber: table.number });
            }}
            onClose={onClose}
          />
        )}

        {/* occupied */}
        {table.status === 'occupied' && table.activeSession && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1.5">
              <Row label="แพ็กเกจ" value={table.activeSession.package.name} />
              <Row
                label="จำนวนคน"
                value={`${table.activeSession.adults + table.activeSession.children + table.activeSession.seniors} คน`}
              />
              <Row
                label="ยอดประมาณ"
                value={`฿${(
                  Number(table.activeSession.package.priceAdult) * table.activeSession.adults +
                  Number(table.activeSession.package.priceChild) * table.activeSession.children +
                  Number(table.activeSession.package.priceSenior) * table.activeSession.seniors
                ).toLocaleString('th-TH')}`}
              />
            </div>
            <DialogFooter className="-mx-0 -mb-0 border-t-0 bg-transparent p-0 pt-2">
              <button
                type="button"
                onClick={handleExtend}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                +15 นาที
              </button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={handleCloseSession}
              >
                ปิดบิล
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* cleaning */}
        {table.status === 'cleaning' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              โต๊ะนี้อยู่ระหว่างการทำความสะอาด กดปุ่มด้านล่างเมื่อพร้อมแล้ว
            </p>
            <DialogFooter className="-mx-0 -mb-0 border-t-0 bg-transparent p-0">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <Button disabled={busy} onClick={handleMarkAvailable}>
                พร้อมใช้งาน
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* reserved */}
        {table.status === 'reserved' && (
          <p className="text-sm text-slate-500">โต๊ะนี้ถูกจองไว้</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

// ─── Main TableGrid ───────────────────────────────────────────────────────────

interface TableGridProps {
  initialTables: TableData[];
  packages: PackageData[];
}

export function TableGrid({ initialTables, packages }: TableGridProps) {
  const [selectedTable, setSelectedTable] = useState<TableData | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrData, setQrData] = useState<{
    sessionToken: string;
    tableQrToken: string;
    tableNumber: number;
    startedAt: string;
    endsAt: string;
    durationMinutes: number;
  } | null>(null);

  const { data: tables = initialTables } = useQuery({
    queryKey: ['tables'],
    queryFn: async () => {
      const res = await getTablesWithSessions();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    initialData: initialTables,
    refetchInterval: 5_000,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Group tables by zone
  const zones = tables.reduce<Record<string, TableData[]>>((acc, t) => {
    (acc[t.zone] ??= []).push(t);
    return acc;
  }, {});

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const sessionUrl = qrData
    ? `${appUrl}/t/${qrData.tableQrToken}/s/${qrData.sessionToken}`
    : '';
  const tableQrData: TableQrData | null = qrData
    ? {
        tableNumber: qrData.tableNumber,
        url: sessionUrl,
        startedAt: qrData.startedAt,
        endsAt: qrData.endsAt,
        durationMinutes: qrData.durationMinutes,
      }
    : null;

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-medium text-slate-900">จัดการโต๊ะ</h1>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <LegendDot color="bg-green-500" label="ว่าง" />
            <LegendDot color="bg-red-500" label="มีลูกค้า" />
            <LegendDot color="bg-amber-500" label="ทำความสะอาด" />
            <LegendDot color="bg-blue-500" label="จอง" />
          </div>
        </div>

        {/* Zones */}
        {Object.entries(zones).map(([zone, zoneTables]) => (
          <section key={zone}>
            <h2 className="mb-3 text-sm font-medium text-slate-500">โซน {zone}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {zoneTables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  onClick={() => {
                    setSelectedTable(table);
                    setDialogOpen(true);
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Table action dialog */}
      <TableActionDialog
        open={dialogOpen}
        table={selectedTable}
        packages={packages}
        onClose={() => {
          setDialogOpen(false);
          setSelectedTable(null);
        }}
        onSessionCreated={(data) => {
          setQrData(data);
        }}
      />

      {/* Session QR dialog */}
      <SessionQrDialog
        open={!!qrData}
        tableNumber={qrData?.tableNumber ?? 0}
        sessionUrl={sessionUrl}
        tableQrData={tableQrData}
        onClose={() => setQrData(null)}
      />
    </>
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
