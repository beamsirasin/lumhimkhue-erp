'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDistanceToNowStrict } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  getQueueList,
  addToQueue,
  callQueue,
  seatQueue,
  removeFromQueue,
} from '@/lib/actions/queue';
import { addQueueSchema, type AddQueueInput } from '@/lib/validations/queue';
import type { QueueEntry } from '@/lib/actions/queue';
import { Printer } from 'lucide-react';
import { print as printQueueQr } from '@/lib/printer/service';
import type { QueueQrData } from '@/lib/printer/types';

interface QueueBoardProps {
  initialEntries: QueueEntry[];
}

export function QueueBoard({ initialEntries }: QueueBoardProps) {
  const [showForm, setShowForm] = useState(false);
  const [addedToken, setAddedToken] = useState<{
    queueNumber: string;
    publicToken: string;
    queueQrData: QueueQrData;
  } | null>(null);

  const queryClient = useQueryClient();

  const { data: entries = [] } = useQuery({
    queryKey: ['queue-list'],
    queryFn: () => getQueueList().then((r) => (r.ok ? r.data : [])),
    initialData: initialEntries,
    initialDataUpdatedAt: Date.now(),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  const waiting = entries.filter((e) => e.status === 'waiting');
  const called = entries.filter((e) => e.status === 'called');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['queue-list'] });

  const { mutate: doCall } = useMutation({
    mutationFn: (id: string) => callQueue(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else invalidate();
    },
  });

  const { mutate: doSeat } = useMutation({
    mutationFn: (id: string) => seatQueue(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else invalidate();
    },
  });

  const { mutate: doRemove } = useMutation({
    mutationFn: (id: string) => removeFromQueue(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else invalidate();
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddQueueInput>({
    resolver: zodResolver(addQueueSchema),
    defaultValues: { partySize: 2 },
  });

  async function onAddSubmit(data: AddQueueInput) {
    const result = await addToQueue(data);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const queueQrData: QueueQrData = {
      queueNumber: result.data.queueNumber,
      partySize: data.partySize,
      url: `${appUrl}/q/${result.data.publicToken}`,
      createdAt: new Date().toLocaleString('th-TH', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Bangkok',
      }),
    };

    reset();
    setShowForm(false);
    setAddedToken({
      queueNumber: result.data.queueNumber,
      publicToken: result.data.publicToken,
      queueQrData,
    });
    invalidate();
    toast.success(`เพิ่มคิว ${result.data.queueNumber} สำเร็จ`);

    // Auto-print queue ticket
    void printQueueQr({ type: 'queue_qr', queueEntry: queueQrData });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">จัดการคิว</h1>
          <p className="text-xs text-slate-500">
            รอ {waiting.length} กลุ่ม · เรียกแล้ว {called.length} กลุ่ม
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm(true); setAddedToken(null); }}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          + เพิ่มคิว
        </button>
      </header>

      {/* Added token notice */}
      {addedToken && (
        <div className="mx-6 mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-green-800">
              คิว {addedToken.queueNumber} — แจ้งลิงก์ให้ลูกค้า
            </p>
            <p className="mt-0.5 select-all font-mono text-xs text-green-700">
              /q/{addedToken.publicToken}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="พิมพ์ตั๋วซ้ำ"
              onClick={() => void printQueueQr({ type: 'queue_qr', queueEntry: addedToken.queueQrData })}
              className="flex items-center gap-1.5 rounded-md border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50"
            >
              <Printer className="size-3.5" />
              พิมพ์ตั๋ว
            </button>
            <button
              type="button"
              aria-label="ปิด"
              onClick={() => setAddedToken(null)}
              className="text-green-600 hover:text-green-800 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Columns */}
      <main className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
        {/* Waiting */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            รอเรียก
            <span className="ml-auto tabular-nums text-slate-400">{waiting.length}</span>
          </h2>
          <div className="space-y-3">
            {waiting.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">ไม่มีคิวที่รอ</p>
            )}
            {waiting.map((e, idx) => (
              <QueueCard
                key={e.id}
                entry={e}
                position={idx + 1}
                onCall={() => doCall(e.id)}
                onRemove={() => doRemove(e.id)}
              />
            ))}
          </div>
        </section>

        {/* Called */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            เรียกแล้ว
            <span className="ml-auto tabular-nums text-slate-400">{called.length}</span>
          </h2>
          <div className="space-y-3">
            {called.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">ยังไม่มีคิวที่เรียก</p>
            )}
            {called.map((e) => (
              <QueueCard
                key={e.id}
                entry={e}
                onSeat={() => doSeat(e.id)}
                onRemove={() => doRemove(e.id)}
              />
            ))}
          </div>
        </section>
      </main>

      {/* Add form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">เพิ่มคิวใหม่</h2>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit(onAddSubmit)} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ชื่อลูกค้า <span className="text-red-500">*</span>
                </label>
                <input
                  {...register('customerName')}
                  placeholder="เช่น สมชาย"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
                {errors.customerName && (
                  <p className="mt-1 text-xs text-red-600">{errors.customerName.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    จำนวนคน <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register('partySize', { valueAsNumber: true })}
                    type="number"
                    min={1}
                    max={99}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                  {errors.partySize && (
                    <p className="mt-1 text-xs text-red-600">{errors.partySize.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    เบอร์โทร
                  </label>
                  <input
                    {...register('phone')}
                    placeholder="08x-xxx-xxxx"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">โซน</label>
                <input
                  {...register('preferredZone')}
                  placeholder="เช่น ในร่ม, ริมหน้าต่าง"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-slate-800 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {isSubmitting ? 'กำลังเพิ่ม…' : 'เพิ่มคิว'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

interface QueueCardProps {
  entry: QueueEntry;
  position?: number;
  onCall?: () => void;
  onSeat?: () => void;
  onRemove: () => void;
}

function QueueCard({ entry, position, onCall, onSeat, onRemove }: QueueCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {position !== undefined && (
            <span className="text-xs tabular-nums text-slate-400">#{position}</span>
          )}
          <span className="text-xl font-bold tabular-nums text-slate-900">
            {entry.queueNumber}
          </span>
        </div>
        <span className="text-xs tabular-nums text-slate-500">
          {formatDistanceToNowStrict(new Date(entry.createdAt), { locale: th, addSuffix: true })}
        </span>
      </div>

      <div className="mt-2">
        <p className="text-sm font-medium text-slate-900">{entry.customerName}</p>
        <p className="text-xs text-slate-500">
          {entry.partySize} คน
          {entry.preferredZone && ` · ${entry.preferredZone}`}
          {entry.phone && ` · ${entry.phone}`}
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        {onCall && (
          <button
            type="button"
            onClick={onCall}
            className="flex-1 rounded-md bg-blue-600 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            เรียก
          </button>
        )}
        {onSeat && (
          <button
            type="button"
            onClick={onSeat}
            className="flex-1 rounded-md bg-green-600 py-1.5 text-xs font-medium text-white hover:bg-green-700"
          >
            เข้าที่นั่ง
          </button>
        )}
        <button
          type="button"
          aria-label="นำออกจากคิว"
          onClick={onRemove}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
        >
          นำออก
        </button>
      </div>
    </div>
  );
}
