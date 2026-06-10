'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, subDays } from 'date-fns';
import { th } from 'date-fns/locale';
import { CalendarDays, Plus, ChevronLeft, ChevronRight, Phone, Users, Clock, BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { getReservations, createReservationV2, updateReservationStatus } from '@/lib/actions/reservations';
import { searchCustomerByPhone, registerCustomer } from '@/lib/actions/customers';

type ReservationRow = NonNullable<Extract<Awaited<ReturnType<typeof getReservations>>, { ok: true }>['data']>[number];

const STATUS_LABEL: Record<string, string> = {
  pending:   'รอยืนยัน',
  confirmed: 'ยืนยันแล้ว',
  arrived:   'มาถึงแล้ว',
  seated:    'นั่งแล้ว',
  cancelled: 'ยกเลิก',
  no_show:   'ไม่มา',
};

const STATUS_COLOR: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  confirmed: 'bg-blue-100 text-blue-700',
  arrived:   'bg-emerald-100 text-emerald-700',
  seated:    'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
  no_show:   'bg-red-100 text-red-600',
};

interface Props {
  tables: { id: string; label: string; capacity: number }[];
}

export function ReservationsPage({ tables }: Props) {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [form, setForm] = useState({
    tableId: '',
    customerName: '',
    customerPhone: '',
    partySize: 2,
    reservationDate: format(new Date(), 'yyyy-MM-dd'),
    reservationTime: '18:00',
    depositAmount: 0,
    notes: '',
  });
  const [customerSearch, setCustomerSearch] = useState('');
  const [foundCustomerId, setFoundCustomerId] = useState<string | null>(null);
  const [lookupDone, setLookupDone] = useState(false);

  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ['reservations', selectedDate],
    queryFn: async () => {
      const r = await getReservations(selectedDate);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
  });

  const createMut = useMutation({
    mutationFn: () => createReservationV2({
      ...form,
      customerId: foundCustomerId,
    }),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('สร้างการจองสำเร็จ');
      qc.invalidateQueries({ queryKey: ['reservations'] });
      setShowCreate(false);
      resetForm();
    },
  });

  const statusMut = useMutation({
    mutationFn: (input: { id: string; status: string }) => updateReservationStatus(input),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.error); return; }
      qc.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  function resetForm() {
    setForm({
      tableId: '',
      customerName: '',
      customerPhone: '',
      partySize: 2,
      reservationDate: format(new Date(), 'yyyy-MM-dd'),
      reservationTime: '18:00',
      depositAmount: 0,
      notes: '',
    });
    setCustomerSearch('');
    setFoundCustomerId(null);
    setLookupDone(false);
  }

  async function handleCustomerLookup() {
    if (!customerSearch.trim()) return;
    const r = await searchCustomerByPhone(customerSearch.trim());
    setLookupDone(true);
    if (r.ok && r.data) {
      setFoundCustomerId(r.data.id);
      setForm((prev) => ({
        ...prev,
        customerName: r.data!.name ?? prev.customerName,
        customerPhone: r.data!.phone,
      }));
      toast.success(`พบสมาชิก: ${r.data.name ?? r.data.phone} (${r.data.loyaltyPoints} แต้ม)`);
    } else {
      setFoundCustomerId(null);
      toast.info('ไม่พบสมาชิก — สามารถกรอกชื่อใหม่ได้');
    }
  }

  const prevDay = () => setSelectedDate(format(subDays(new Date(selectedDate), 1), 'yyyy-MM-dd'));
  const nextDay = () => setSelectedDate(format(addDays(new Date(selectedDate), 1), 'yyyy-MM-dd'));

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={prevDay} aria-label="วันก่อนหน้า"
            className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <button type="button" onClick={nextDay} aria-label="วันถัดไป"
            className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
            <ChevronRight className="size-4" />
          </button>
          <span className="text-sm text-slate-500">
            {format(new Date(selectedDate + 'T00:00:00'), 'EEEE d MMMM yyyy', { locale: th })}
          </span>
        </div>
        <Button onClick={() => { resetForm(); setForm((f) => ({ ...f, reservationDate: selectedDate })); setShowCreate(true); }}>
          <Plus className="size-4 mr-1.5" />
          สร้างการจอง
        </Button>
      </div>

      {/* Reservations list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : reservations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white py-16 shadow-sm ring-1 ring-slate-900/5">
          <CalendarDays className="size-10 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">ไม่มีการจองในวันนี้</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reservations.map((r) => (
            <ReservationCard
              key={r.id}
              reservation={r}
              onStatusChange={(status) => statusMut.mutate({ id: r.id, status })}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>สร้างการจองโต๊ะ</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Customer lookup */}
            <div className="space-y-1.5">
              <Label>ค้นหาสมาชิก (เบอร์โทร)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="0812345678"
                  value={customerSearch}
                  onChange={(e) => { setCustomerSearch(e.target.value); setLookupDone(false); setFoundCustomerId(null); }}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleCustomerLookup}>ค้นหา</Button>
              </div>
              {lookupDone && foundCustomerId && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <BadgeCheck className="size-3.5" /> เชื่อมกับสมาชิกแล้ว
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>ชื่อลูกค้า *</Label>
                <Input
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                  placeholder="ชื่อ-นามสกุล"
                />
              </div>
              <div className="space-y-1.5">
                <Label>เบอร์โทร</Label>
                <Input
                  value={form.customerPhone}
                  onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
                  placeholder="08x-xxx-xxxx"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>วันที่ *</Label>
                <Input type="date" value={form.reservationDate}
                  onChange={(e) => setForm((f) => ({ ...f, reservationDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>เวลา *</Label>
                <Input type="time" value={form.reservationTime}
                  onChange={(e) => setForm((f) => ({ ...f, reservationTime: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>โต๊ะ *</Label>
                <Select value={form.tableId} onValueChange={(v) => setForm((f) => ({ ...f, tableId: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder="เลือกโต๊ะ" /></SelectTrigger>
                  <SelectContent>
                    {tables.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        โต๊ะ {t.label} ({t.capacity} ที่)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>จำนวนคน *</Label>
                <Input type="number" min={1} value={form.partySize}
                  onChange={(e) => setForm((f) => ({ ...f, partySize: Number(e.target.value) }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>มัดจำ (฿)</Label>
                <Input type="number" min={0} value={form.depositAmount}
                  onChange={(e) => setForm((f) => ({ ...f, depositAmount: Number(e.target.value) }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>หมายเหตุ</Label>
              <Input value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="แพ้อาหาร, วันเกิด ฯลฯ" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>ยกเลิก</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.tableId || !form.customerName}>
              {createMut.isPending ? 'กำลังบันทึก...' : 'บันทึกการจอง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReservationCard({
  reservation,
  onStatusChange,
}: {
  reservation: ReservationRow;
  onStatusChange: (status: string) => void;
}) {
  const { status } = reservation;

  const nextActions: { label: string; status: string; variant?: 'outline' | 'default' }[] = [];
  if (status === 'pending') {
    nextActions.push({ label: 'ยืนยัน', status: 'confirmed' });
    nextActions.push({ label: 'ยกเลิก', status: 'cancelled', variant: 'outline' });
  } else if (status === 'confirmed') {
    nextActions.push({ label: 'มาถึงแล้ว', status: 'arrived' });
    nextActions.push({ label: 'ไม่มา', status: 'no_show', variant: 'outline' });
  } else if (status === 'arrived') {
    nextActions.push({ label: 'นั่งแล้ว', status: 'seated' });
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex flex-wrap items-start gap-3">
        {/* Time & table */}
        <div className="flex flex-col items-center gap-0.5 rounded-lg bg-slate-50 px-3 py-2 min-w-[60px]">
          <Clock className="size-3.5 text-slate-400" />
          <span className="text-sm font-bold text-slate-800 tabular-nums">
            {reservation.reservationTime ?? '—'}
          </span>
          <span className="text-[10px] text-slate-400">โต๊ะ {reservation.table.label}</span>
        </div>

        {/* Guest info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-slate-900">{reservation.customerName}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status] ?? 'bg-slate-100 text-slate-500'}`}>
              {STATUS_LABEL[status] ?? status}
            </span>
            {reservation.customer && (
              <span className="text-xs text-purple-600 bg-purple-50 rounded-full px-2 py-0.5">
                สมาชิก {reservation.customer.loyaltyPoints} แต้ม
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {reservation.customerPhone && (
              <span className="flex items-center gap-1"><Phone className="size-3" />{reservation.customerPhone}</span>
            )}
            <span className="flex items-center gap-1"><Users className="size-3" />{reservation.partySize} คน</span>
            {reservation.reservationNo && (
              <span className="font-mono text-slate-400">{reservation.reservationNo}</span>
            )}
            {Number(reservation.depositAmount) > 0 && (
              <span className="text-green-600">มัดจำ ฿{Number(reservation.depositAmount).toLocaleString('th-TH')}</span>
            )}
          </div>
          {reservation.notes && (
            <p className="mt-1 text-xs text-slate-400 truncate">{reservation.notes}</p>
          )}
        </div>

        {/* Actions */}
        {nextActions.length > 0 && (
          <div className="flex gap-2 shrink-0">
            {nextActions.map((a) => (
              <Button
                key={a.status}
                size="sm"
                variant={a.variant ?? 'default'}
                onClick={() => onStatusChange(a.status)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
