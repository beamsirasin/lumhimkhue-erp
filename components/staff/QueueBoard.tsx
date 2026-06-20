'use client';

import { type ComponentType, useState } from 'react';
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
import { CheckCircle2, ClipboardList, Clock, Loader2, PhoneCall, Plus, Printer, UserPlus, Users, X, XCircle } from 'lucide-react';
import { print as printQueueQr } from '@/lib/printer/service';
import type { QueueQrData } from '@/lib/printer/types';
import { cn } from '@/lib/utils';

interface QueueBoardProps {
  initialEntries: QueueEntry[];
}

const QUEUE_TONE = {
  waiting: {
    dot: 'bg-[var(--status-warning-fg)]',
    card: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    badge: 'border-[var(--status-warning-border)] bg-[var(--surface-1)] text-[var(--status-warning-fg)]',
  },
  called: {
    dot: 'bg-[var(--status-info-fg)]',
    card: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)]',
    badge: 'border-[var(--status-info-border)] bg-[var(--surface-1)] text-[var(--status-info-fg)]',
  },
} as const;

const INPUT_CLASS = 'min-h-12 w-full rounded-lg border border-border bg-[var(--surface-1)] px-4 py-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/20';

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
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  const waiting = entries.filter((e) => e.status === 'waiting');
  const called = entries.filter((e) => e.status === 'called');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['queue-list'] });

  const { mutate: doCall, isPending: isCallingPending, variables: callingId } = useMutation({
    mutationFn: (id: string) => callQueue(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else invalidate();
    },
  });

  const { mutate: doSeat, isPending: isSeatingPending, variables: seatingId } = useMutation({
    mutationFn: (id: string) => seatQueue(id),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error);
      else invalidate();
    },
  });

  const { mutate: doRemove, isPending: isRemovingPending, variables: removingId } = useMutation({
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
    <div className="min-h-screen bg-[var(--surface-0)]">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-[var(--surface-1)] px-6 py-4 shadow-[var(--shadow-card)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]">
            <ClipboardList className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-foreground">จัดการคิว</h1>
            <p className="text-xs text-muted-foreground">
              รอ {waiting.length} กลุ่ม · เรียกแล้ว {called.length} กลุ่ม
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm(true); setAddedToken(null); }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" />
          เพิ่มคิว
        </button>
      </header>

      {/* Added token notice */}
      {addedToken && (
        <div className="mx-6 mt-4 flex items-center justify-between gap-4 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3 shadow-[var(--shadow-card)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--status-success-border)] bg-[var(--surface-1)] text-[var(--status-success-fg)]">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--status-success-fg)]">
                คิว {addedToken.queueNumber} — แจ้งลิงก์ให้ลูกค้า
              </p>
              <p className="mt-0.5 select-all truncate font-mono text-xs text-[var(--status-success-fg)]">
                /q/{addedToken.publicToken}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="พิมพ์ตั๋วซ้ำ"
              onClick={() => void printQueueQr({ type: 'queue_qr', queueEntry: addedToken.queueQrData })}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--status-success-border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--status-success-fg)] transition-colors hover:border-[var(--status-success-fg)]"
            >
              <Printer className="size-3.5" />
              พิมพ์ตั๋ว
            </button>
            <button
              type="button"
              aria-label="ปิด"
              onClick={() => setAddedToken(null)}
              className="flex size-9 items-center justify-center rounded-lg text-[var(--status-success-fg)] transition-colors hover:bg-[var(--surface-1)]"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Columns */}
      <main className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
        {/* Waiting */}
        <section className="rounded-xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-full', QUEUE_TONE.waiting.dot)} />
            รอเรียก
            <span className="ml-auto rounded-full border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--status-warning-fg)]">{waiting.length}</span>
          </h2>
          <div className="space-y-3">
            {waiting.length === 0 && (
              <EmptyQueueColumn icon={Users} title="ไม่มีคิวที่รอ" />
            )}
            {waiting.map((e, idx) => (
              <QueueCard
                key={e.id}
                entry={e}
                position={idx + 1}
                onCall={() => doCall(e.id)}
                onRemove={() => doRemove(e.id)}
                isCallPending={isCallingPending && callingId === e.id}
                isRemovePending={isRemovingPending && removingId === e.id}
              />
            ))}
          </div>
        </section>

        {/* Called */}
        <section className="rounded-xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-full', QUEUE_TONE.called.dot)} />
            เรียกแล้ว
            <span className="ml-auto rounded-full border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--status-info-fg)]">{called.length}</span>
          </h2>
          <div className="space-y-3">
            {called.length === 0 && (
              <EmptyQueueColumn icon={PhoneCall} title="ยังไม่มีคิวที่เรียก" />
            )}
            {called.map((e) => (
              <QueueCard
                key={e.id}
                entry={e}
                onSeat={() => doSeat(e.id)}
                onRemove={() => doRemove(e.id)}
                isSeatPending={isSeatingPending && seatingId === e.id}
                isRemovePending={isRemovingPending && removingId === e.id}
              />
            ))}
          </div>
        </section>
      </main>

      {/* Add form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/45 px-4 backdrop-blur-[2px]"
          onClick={() => setShowForm(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-[var(--surface-1)] p-8 shadow-[var(--shadow-dialog)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]">
                  <UserPlus className="size-5" />
                </div>
                <h2 className="truncate text-lg font-semibold text-foreground">เพิ่มคิวใหม่</h2>
              </div>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setShowForm(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit(onAddSubmit)} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  ชื่อลูกค้า <span className="text-destructive">*</span>
                </label>
                <input
                  {...register('customerName')}
                  placeholder="เช่น สมชาย"
                  className={INPUT_CLASS}
                />
                {errors.customerName && (
                  <p className="mt-1.5 text-sm text-destructive">{errors.customerName.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    จำนวนคน <span className="text-destructive">*</span>
                  </label>
                  <input
                    {...register('partySize', { valueAsNumber: true })}
                    type="number"
                    min={1}
                    max={99}
                    className={INPUT_CLASS}
                  />
                  {errors.partySize && (
                    <p className="mt-1.5 text-sm text-destructive">{errors.partySize.message}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    เบอร์โทร
                  </label>
                  <input
                    {...register('phone')}
                    placeholder="08x-xxx-xxxx"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">โซน</label>
                <input
                  {...register('preferredZone')}
                  placeholder="เช่น ในร่ม, ริมหน้าต่าง"
                  className={INPUT_CLASS}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex min-h-14 w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {isSubmitting ? 'กำลังเพิ่ม…' : 'เพิ่มคิว'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

interface EmptyQueueColumnProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
}

function EmptyQueueColumn({ icon: Icon, title }: EmptyQueueColumnProps) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-[var(--surface-2)] px-4 py-8 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium text-muted-foreground">{title}</p>
    </div>
  );
}

interface QueueCardProps {
  entry: QueueEntry;
  position?: number;
  onCall?: () => void;
  onSeat?: () => void;
  onRemove: () => void;
  isCallPending?: boolean;
  isSeatPending?: boolean;
  isRemovePending?: boolean;
}

function QueueCard({ entry, position, onCall, onSeat, onRemove, isCallPending, isSeatPending, isRemovePending }: QueueCardProps) {
  const tone = onSeat ? QUEUE_TONE.called : QUEUE_TONE.waiting;

  return (
    <div className={cn('rounded-xl border p-5 shadow-[var(--shadow-card)]', tone.card)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {position !== undefined && (
            <span className={cn('inline-flex min-h-7 items-center rounded-full border px-2 text-sm font-semibold tabular-nums', tone.badge)}>#{position}</span>
          )}
          <span className="truncate text-2xl font-bold tabular-nums text-foreground">
            {entry.queueNumber}
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm tabular-nums text-muted-foreground">
          <Clock className="size-3.5" />
          {formatDistanceToNowStrict(new Date(entry.createdAt), { locale: th, addSuffix: true })}
        </span>
      </div>

      <div className="mt-3 rounded-lg border border-border/70 bg-[var(--surface-1)] px-3 py-2.5">
        <p className="truncate text-base font-semibold text-foreground">{entry.customerName}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" />
            {entry.partySize} คน
          </span>
          {entry.preferredZone && <span>· {entry.preferredZone}</span>}
          {entry.phone && <span>· {entry.phone}</span>}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        {onCall && (
          <button
            type="button"
            onClick={onCall}
            disabled={isCallPending}
            className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] py-3 text-sm font-semibold text-[var(--status-info-fg)] transition-colors hover:border-[var(--status-info-fg)] disabled:opacity-60"
          >
            {isCallPending ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
            เรียก
          </button>
        )}
        {onSeat && (
          <button
            type="button"
            onClick={onSeat}
            disabled={isSeatPending}
            className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] py-3 text-sm font-semibold text-[var(--status-success-fg)] transition-colors hover:border-[var(--status-success-fg)] disabled:opacity-60"
          >
            {isSeatPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            เข้าที่นั่ง
          </button>
        )}
        <button
          type="button"
          aria-label="นำออกจากคิว"
          onClick={onRemove}
          disabled={isRemovePending}
          className="flex min-h-12 items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-1)] px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-[var(--status-danger-border)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)] disabled:opacity-60"
        >
          {isRemovePending ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
          นำออก
        </button>
      </div>
    </div>
  );
}
