'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Check,
  ClipboardList,
  Clock,
  History,
  Loader2,
  MapPin,
  Minus,
  MoreVertical,
  Plus,
  Printer,
  SkipForward,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  getQueueList,
  getQueueHistory,
  addToQueue,
  updateQueue,
  updatePlannedTable,
  admitQueue,
  skipQueue,
  cancelQueue,
  toggleBillIssued,
} from '@/lib/actions/queue';
import {
  SOUP_OPTIONS,
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPE_SHORT,
  SIMPLIFIED_SEATING_UI,
  SKIP_REASON_PRESETS,
  seatingDisplayLabel,
  type CustomerType,
  type SeatingFit,
  type SoupOption,
} from '@/lib/validations/queue';
import type { AddQueueInput } from '@/lib/validations/queue';
import type { QueueEntry } from '@/lib/actions/queue';
import { print as printQueueQr } from '@/lib/printer/service';
import type { QueueQrData } from '@/lib/printer/types';
import { cn } from '@/lib/utils';

/* ─── Restaurant table layout (queue-only planning) ─────────────── */

const QUEUE_TABLES = [
  { id: 'big_1',   label: 'ใหญ่ 1', fullLabel: 'โต๊ะใหญ่ 1', type: 'big'   as const, cap: '6–8 คน' },
  { id: 'big_2',   label: 'ใหญ่ 2', fullLabel: 'โต๊ะใหญ่ 2', type: 'big'   as const, cap: '6–8 คน' },
  { id: 'big_3',   label: 'ใหญ่ 3', fullLabel: 'โต๊ะใหญ่ 3', type: 'big'   as const, cap: '6–8 คน' },
  { id: 'big_4',   label: 'ใหญ่ 4', fullLabel: 'โต๊ะใหญ่ 4', type: 'big'   as const, cap: '6–8 คน' },
  { id: 'small_1', label: 'เล็ก 1', fullLabel: 'โต๊ะเล็ก 1', type: 'small' as const, cap: '2–4 คน' },
  { id: 'small_2', label: 'เล็ก 2', fullLabel: 'โต๊ะเล็ก 2', type: 'small' as const, cap: '2–4 คน' },
] as const;

type QueueTableId = typeof QUEUE_TABLES[number]['id'];

function formatTableNote(ids: readonly QueueTableId[]): string {
  if (!ids.length) return '';
  return ids.map(id => QUEUE_TABLES.find(t => t.id === id)?.fullLabel ?? '').filter(Boolean).join(' + ');
}

function shortTableNote(note: string | null | undefined): string {
  if (!note) return '';
  return note.replace(/โต๊ะ/g, '').replace(/ \+ /g, '+');
}

/* ─── Soup chip styles (row display) ────────────────────────────── */

const SOUP_CHIP_STYLE: Record<string, string> = {
  'น้ำดำ':  'border-border bg-[var(--surface-2)] text-foreground',
  'น้ำใส':  'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
  'หมาล่า': 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
};

/* ─── Soup selector styles (form buttons) ───────────────────────── */

const SOUP_STYLE: Record<SoupOption, { sel: string; unsel: string }> = {
  'น้ำดำ': {
    sel:   'border-foreground/70 bg-foreground text-background',
    unsel: 'border-border bg-[var(--surface-2)] text-foreground',
  },
  'น้ำใส': {
    sel:   'border-[var(--status-info-border)] bg-[var(--status-info-fg)] text-white',
    unsel: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
  },
  'หมาล่า': {
    sel:   'border-[var(--status-danger-border)] bg-[var(--status-danger-fg)] text-white',
    unsel: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
  },
};

/* ─── Row status tones ───────────────────────────────────────────── */

type DisplayStatus = 'waiting' | 'waiting_suitable_table' | 'called' | 'admitted';

const ROW_TONE: Record<DisplayStatus, { label: string; badge: string; accentColor: string }> = {
  waiting: {
    label:       'รอ',
    badge:       'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
    accentColor: 'var(--status-warning-fg)',
  },
  waiting_suitable_table: {
    label:       'รอโต๊ะ',
    badge:       'border-[var(--status-orange-border)] bg-[var(--status-orange-bg)] text-[var(--status-orange-fg)]',
    accentColor: 'var(--status-orange-fg)',
  },
  called: {
    label:       'เรียกแล้ว',
    badge:       'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
    accentColor: 'var(--status-info-fg)',
  },
  admitted: {
    label:       'รับเข้าแล้ว',
    badge:       'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
    accentColor: 'var(--status-success-fg)',
  },
};

/* ─── History status display ─────────────────────────────────────── */

const HIST_LABEL: Record<string, string> = {
  admitted: 'รับเข้าแล้ว', seated: 'รับเข้าแล้ว', skipped: 'ข้าม',
  cancelled: 'ยกเลิก', called: 'เรียกแล้ว', left: 'ออก',
  waiting: 'รอ', waiting_suitable_table: 'รอโต๊ะ',
};

const HIST_CLS: Record<string, string> = {
  admitted: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
  seated:   'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
  skipped:  'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  cancelled:'border-border bg-muted/30 text-muted-foreground',
  left:     'border-border bg-muted/30 text-muted-foreground',
  called:   'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
  waiting:  'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  waiting_suitable_table: 'border-[var(--status-orange-border)] bg-[var(--status-orange-bg)] text-[var(--status-orange-fg)]',
};

/* ─── Helpers ────────────────────────────────────────────────────── */

function soupSummary(pots: Array<{ soups: string[] }> | null | undefined): string {
  if (!pots?.length) return '';
  return pots.map(p => p.soups.join('/')).join(' · ');
}

function buildQrData(
  entry: {
    queueNumber: string;
    partySize: number;
    adultCount: number;
    childCount: number;
    soupPots: unknown;
    publicToken: string;
  },
  createdAtStr: string,
  appUrl: string,
): QueueQrData {
  return {
    queueNumber: entry.queueNumber,
    partySize:   entry.partySize,
    adultCount:  entry.adultCount,
    childCount:  entry.childCount,
    soupSummary: soupSummary(entry.soupPots as Array<{ soups: string[] }> | null),
    url:         `${appUrl}/q/${entry.publicToken}`,
    createdAt:   createdAtStr,
  };
}

/* ─── SoupChips ──────────────────────────────────────────────────── */

function SoupChips({ pots }: { pots: Array<{ soups: string[] }> | null | undefined }) {
  if (!pots?.length) return null;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const pot of pots) {
    for (const soup of pot.soups) {
      if (!seen.has(soup)) { seen.add(soup); unique.push(soup); }
    }
  }
  if (!unique.length) return null;
  return (
    <>
      {unique.map(soup => (
        <span
          key={soup}
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 text-xs font-semibold leading-none',
            SOUP_CHIP_STYLE[soup] ?? SOUP_CHIP_STYLE['น้ำดำ'],
          )}
        >
          {soup}
        </span>
      ))}
    </>
  );
}

/* ─── QueueBoard ─────────────────────────────────────────────────── */

interface QueueBoardProps {
  initialEntries: QueueEntry[];
}

export function QueueBoard({ initialEntries }: QueueBoardProps) {
  const [formMode, setFormMode]         = useState<'add' | 'edit' | null>(null);
  const [editingEntry, setEditingEntry] = useState<QueueEntry | null>(null);
  const [admitTarget, setAdmitTarget]   = useState<QueueEntry | null>(null);
  const [skipTarget, setSkipTarget]     = useState<QueueEntry | null>(null);
  const [cancelTarget, setCancelTarget] = useState<QueueEntry | null>(null);
  const [tableTarget, setTableTarget]   = useState<QueueEntry | null>(null);
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [lastAdded, setLastAdded]       = useState<QueueQrData | null>(null);

  const queryClient = useQueryClient();
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const { data: entries = [] } = useQuery({
    queryKey: ['queue-list'],
    queryFn: () => getQueueList().then(r => r.ok ? r.data : []),
    initialData: initialEntries,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  const { data: todayHistory = [] } = useQuery({
    queryKey: ['queue-history', todayStr],
    queryFn: () => getQueueHistory(todayStr).then(r => r.ok ? r.data : []),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Board sections
  const WAITING_SET = new Set(['waiting', 'waiting_suitable_table', 'called']);
  const waitingEntries  = entries.filter(e => WAITING_SET.has(e.status));
  const admittedEntries = entries.filter(e => e.status === 'admitted' && !e.billIssued);

  // Status counters
  const waitingCount   = waitingEntries.length;
  const admittedCount  = admittedEntries.length;
  const billedToday    = todayHistory.filter(e => e.status === 'admitted' && e.billIssued).length;
  const skippedToday   = todayHistory.filter(e => e.status === 'skipped').length;
  const cancelledToday = todayHistory.filter(e => e.status === 'cancelled').length;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['queue-list'] });
    queryClient.invalidateQueries({ queryKey: ['queue-history', todayStr] });
  }, [queryClient, todayStr]);

  const { mutate: doToggleBill } = useMutation({
    mutationFn: ({ id, issued }: { id: string; issued: boolean }) =>
      toggleBillIssued(id, issued),
    onSuccess: r => { if (!r.ok) toast.error(r.error); else invalidate(); },
  });

  const appUrl =
    typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin)
      : '';

  async function handleFormSuccess(
    data: {
      queueNumber: string;
      publicToken: string;
      partySize: number;
      adultCount: number;
      childCount: number;
      soupPots: Array<{ soups: SoupOption[] }>;
    } | null,
  ) {
    invalidate();
    if (data) {
      const createdAt = new Date().toLocaleString('th-TH', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok',
      });
      const qrData = buildQrData(data, createdAt, appUrl);
      setLastAdded(qrData);
      void printQueueQr({ type: 'queue_qr', queueEntry: qrData });
    }
    setFormMode(null);
    setEditingEntry(null);
  }

  function getPrintHandler(entry: QueueEntry) {
    return () => {
      const createdAt = format(new Date(entry.createdAt), 'dd/MM/yy HH:mm น.', { locale: th });
      void printQueueQr({ type: 'queue_qr', queueEntry: buildQrData(entry, createdAt, appUrl) });
    };
  }

  const isEmpty = waitingEntries.length === 0 && admittedEntries.length === 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--surface-0)]">

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-[var(--surface-1)] px-4 py-3 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <ClipboardList className="size-5 shrink-0 text-primary" />
          <span className="text-lg font-bold text-foreground">คิว</span>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
            <Counter label="รอ"       count={waitingCount}   cls="text-[var(--status-warning-fg)] bg-[var(--status-warning-bg)] border-[var(--status-warning-border)]" />
            <Counter label="รับเข้า" count={admittedCount}  cls="text-[var(--status-success-fg)] bg-[var(--status-success-bg)] border-[var(--status-success-border)]" />
            <Counter label="ออกบิล" count={billedToday}    cls="text-[var(--status-info-fg)] bg-[var(--status-info-bg)] border-[var(--status-info-border)]" />
            <Counter label="ข้าม"    count={skippedToday}   cls="text-muted-foreground bg-muted/30 border-border" />
            <Counter label="ยกเลิก"  count={cancelledToday} cls="text-muted-foreground bg-muted/30 border-border" />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-2)] px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <History className="size-3.5" />
              ประวัติ
            </button>
            <button
              type="button"
              onClick={() => { setEditingEntry(null); setFormMode('add'); }}
              className="flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
            >
              <Plus className="size-4" />
              เพิ่มคิว
            </button>
          </div>
        </div>
      </header>

      {/* ── Last-added notice ──────────────────────────────────── */}
      {lastAdded && (
        <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2">
          <span className="text-sm font-semibold text-[var(--status-success-fg)]">
            คิว {lastAdded.queueNumber} เพิ่มสำเร็จ
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void printQueueQr({ type: 'queue_qr', queueEntry: lastAdded })}
              className="flex min-h-8 items-center gap-1 rounded-lg border border-[var(--status-success-border)] px-2.5 text-xs font-semibold text-[var(--status-success-fg)] hover:bg-[var(--surface-1)]"
            >
              <Printer className="size-3" />
              พิมพ์ซ้ำ
            </button>
            <button type="button" aria-label="ปิด" onClick={() => setLastAdded(null)}
              className="flex size-8 items-center justify-center rounded-lg text-[var(--status-success-fg)] hover:bg-[var(--surface-1)]">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Board ──────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-[var(--surface-2)]">
              <ClipboardList className="size-6 text-muted-foreground/60" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">ยังไม่มีคิวที่รอ</p>
              <p className="mt-0.5 text-xs text-muted-foreground">เริ่มเพิ่มคิวสำหรับลูกค้าที่มาถึง</p>
            </div>
            <button
              type="button"
              onClick={() => { setEditingEntry(null); setFormMode('add'); }}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
            >
              <Plus className="size-4" />
              เพิ่มคิว
            </button>
          </div>
        ) : (
          <div className="space-y-0 px-3 pb-3 pt-2">

            {/* Section 1 — Waiting */}
            {waitingEntries.length > 0 && (
              <div>
                <SectionLabel label="รอเข้า" count={waitingEntries.length} />
                <div className="space-y-2">
                  {waitingEntries.map(entry => (
                    <QueueRow
                      key={entry.id}
                      entry={entry}
                      onEdit={() => { setEditingEntry(entry); setFormMode('edit'); }}
                      onPickTable={() => setTableTarget(entry)}
                      onAdmit={() => setAdmitTarget(entry)}
                      onSkip={() => setSkipTarget(entry)}
                      onCancel={() => setCancelTarget(entry)}
                      onPrint={getPrintHandler(entry)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Section 2 — Admitted, not billed */}
            {admittedEntries.length > 0 && (
              <div className={waitingEntries.length > 0 ? 'mt-4' : ''}>
                <SectionLabel
                  label="รับเข้าแล้ว / รอออกบิล"
                  count={admittedEntries.length}
                  cls="text-[var(--status-success-fg)]"
                />
                <div className="space-y-2">
                  {admittedEntries.map(entry => (
                    <AdmittedRow
                      key={entry.id}
                      entry={entry}
                      onEdit={() => { setEditingEntry(entry); setFormMode('edit'); }}
                      onPickTable={() => setTableTarget(entry)}
                      onBillIssued={() => doToggleBill({ id: entry.id, issued: true })}
                      onCancel={() => setCancelTarget(entry)}
                      onPrint={getPrintHandler(entry)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Overlays ───────────────────────────────────────────── */}
      {tableTarget && (
        <TablePickerModal
          entry={tableTarget}
          onClose={() => setTableTarget(null)}
          onSaved={() => { setTableTarget(null); invalidate(); }}
        />
      )}
      {formMode && (
        <QueueFormModal
          mode={formMode}
          entry={editingEntry}
          onClose={() => { setFormMode(null); setEditingEntry(null); }}
          onSuccess={handleFormSuccess}
        />
      )}
      {admitTarget && (
        <AdmitDialog
          entry={admitTarget}
          onClose={() => setAdmitTarget(null)}
          onSuccess={() => { setAdmitTarget(null); invalidate(); }}
        />
      )}
      {skipTarget && (
        <SkipDialog
          entry={skipTarget}
          onClose={() => setSkipTarget(null)}
          onSuccess={() => { setSkipTarget(null); invalidate(); }}
        />
      )}
      {cancelTarget && (
        <ConfirmCancelDialog
          entry={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onSuccess={() => { setCancelTarget(null); invalidate(); }}
        />
      )}
      {historyOpen && (
        <HistoryModal todayStr={todayStr} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}

/* ─── Counter chip ───────────────────────────────────────────────── */

function Counter({ label, count, cls }: { label: string; count: number; cls: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold', cls)}>
      {label} {count}
    </span>
  );
}

/* ─── SectionLabel ───────────────────────────────────────────────── */

function SectionLabel({
  label, count, cls = 'text-muted-foreground',
}: {
  label: string; count: number; cls?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={cn('text-xs font-bold uppercase tracking-wide', cls)}>{label}</span>
      <span className="rounded-full border border-border bg-[var(--surface-2)] px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
        {count}
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

/* ─── QueueRow — waiting/called ──────────────────────────────────── */

interface QueueRowProps {
  entry: QueueEntry;
  onEdit: () => void;
  onPickTable: () => void;
  onAdmit: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onPrint: () => void;
}

function QueueRow({ entry, onEdit, onPickTable, onAdmit, onSkip, onCancel, onPrint }: QueueRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tone       = ROW_TONE[entry.status as DisplayStatus] ?? ROW_TONE.waiting;
  const seating    = seatingDisplayLabel(entry.seatingFit);
  const isNonNormal = entry.customerType && entry.customerType !== 'normal';
  const tableNote  = entry.plannedTableNote;

  return (
    <div className="relative flex items-stretch overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-1)] shadow-[var(--shadow-card)]">
      <div className="w-[3px] shrink-0" style={{ backgroundColor: tone.accentColor }} aria-hidden="true" />

      {/* Tappable info area */}
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 flex-col justify-center gap-1 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]/50"
      >
        {/* Line 1 */}
        <div className="flex items-center gap-2">
          <span className="w-[3.5rem] shrink-0 text-xl font-black tabular-nums leading-none text-foreground">
            {entry.queueNumber}
          </span>
          <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold leading-none', tone.badge)}>
            {tone.label}
          </span>
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Clock className="size-3 shrink-0" />
            {formatDistanceToNowStrict(new Date(entry.createdAt), { locale: th, addSuffix: true })}
          </span>
        </div>
        {/* Line 2 */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className="shrink-0 font-semibold text-foreground/80">ผ{entry.adultCount}/ด{entry.childCount}</span>
          <SoupChips pots={entry.soupPots as Array<{ soups: string[] }> | null} />
          {seating && <span className="shrink-0 text-muted-foreground">{seating}</span>}
          {tableNote && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-1.5 py-0.5 font-semibold text-[var(--status-info-fg)]">
              <MapPin className="size-2.5" />
              {tableNote}
            </span>
          )}
          {isNonNormal && (
            <span className="shrink-0 rounded border border-border bg-[var(--surface-2)] px-1.5 py-0.5 font-medium text-muted-foreground">
              {CUSTOMER_TYPE_SHORT[entry.customerType as CustomerType]}
            </span>
          )}
        </div>
      </button>

      {/* Actions — stop propagation */}
      <div className="flex shrink-0 items-center gap-1.5 pr-2.5" onClick={e => e.stopPropagation()}>
        {/* เลือกโต๊ะ — neutral when empty, info tint when table set */}
        <button
          type="button"
          onClick={onPickTable}
          aria-label="เลือกโต๊ะ"
          className={cn(
            'flex min-h-9 items-center gap-1 rounded-lg border px-2 text-xs font-semibold transition-colors active:scale-95',
            tableNote
              ? 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]'
              : 'border-border bg-[var(--surface-2)] text-muted-foreground hover:border-primary/40 hover:text-foreground',
          )}
        >
          <MapPin className="size-3.5 shrink-0" />
          {tableNote ? shortTableNote(tableNote) : 'โต๊ะ'}
        </button>

        {/* รับเข้า */}
        <button
          type="button"
          onClick={onAdmit}
          className="flex min-h-9 items-center gap-1 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-2.5 text-xs font-semibold text-[var(--status-success-fg)] transition-colors hover:border-[var(--status-success-fg)] active:scale-95"
        >
          <UserCheck className="size-3.5 shrink-0" />
          รับเข้า
        </button>

        {/* ข้าม — icon only */}
        <button
          type="button"
          onClick={onSkip}
          aria-label="ข้ามคิว"
          className="flex size-9 items-center justify-center rounded-lg border border-[var(--status-warning-border)] text-[var(--status-warning-fg)] transition-colors hover:bg-[var(--status-warning-bg)] active:scale-95"
        >
          <SkipForward className="size-4" />
        </button>

        {/* Overflow */}
        <div className="relative">
          <button
            type="button"
            aria-label="เมนูเพิ่มเติม"
            onClick={() => setMenuOpen(v => !v)}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted"
          >
            <MoreVertical className="size-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-[var(--surface-raised)] shadow-[var(--shadow-raised)]">
                <button type="button" onClick={() => { setMenuOpen(false); onPrint(); }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted">
                  <Printer className="size-3.5 text-muted-foreground" />พิมพ์ตั๋วซ้ำ
                </button>
                <div className="border-t border-border" />
                <button type="button" onClick={() => { setMenuOpen(false); onCancel(); }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)]">
                  <Trash2 className="size-3.5" />ยกเลิกคิว
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── AdmittedRow — รับเข้าแล้ว / รอออกบิล ─────────────────────── */

interface AdmittedRowProps {
  entry: QueueEntry;
  onEdit: () => void;
  onPickTable: () => void;
  onBillIssued: () => void;
  onCancel: () => void;
  onPrint: () => void;
}

function AdmittedRow({ entry, onEdit, onPickTable, onBillIssued, onCancel, onPrint }: AdmittedRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tone     = ROW_TONE.admitted;
  const seating  = seatingDisplayLabel(entry.seatingFit);
  const tableNote = entry.plannedTableNote;
  const timeRef   = (entry.admittedAt ?? entry.createdAt) as Date | string;

  return (
    <div className="relative flex items-stretch overflow-hidden rounded-xl border border-[var(--status-success-border)]/40 bg-[var(--status-success-bg)]/20 shadow-[var(--shadow-card)]">
      <div className="w-[3px] shrink-0" style={{ backgroundColor: tone.accentColor }} aria-hidden="true" />

      {/* Tappable info area */}
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 flex-col justify-center gap-1 px-3 py-2.5 text-left transition-colors hover:bg-[var(--status-success-bg)]/20"
      >
        {/* Line 1 */}
        <div className="flex items-center gap-2">
          <span className="w-[3.5rem] shrink-0 text-xl font-black tabular-nums leading-none text-foreground">
            {entry.queueNumber}
          </span>
          <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold leading-none', tone.badge)}>
            {tone.label}
          </span>
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Clock className="size-3 shrink-0" />
            {formatDistanceToNowStrict(new Date(timeRef), { locale: th, addSuffix: true })}
          </span>
        </div>
        {/* Line 2 */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className="shrink-0 font-semibold text-foreground/80">ผ{entry.adultCount}/ด{entry.childCount}</span>
          <SoupChips pots={entry.soupPots as Array<{ soups: string[] }> | null} />
          {seating && <span className="shrink-0 text-muted-foreground">{seating}</span>}
          {tableNote && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-1.5 py-0.5 font-semibold text-[var(--status-success-fg)]">
              <MapPin className="size-2.5" />
              {tableNote}
            </span>
          )}
        </div>
      </button>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5 pr-2.5" onClick={e => e.stopPropagation()}>
        {/* เลือกโต๊ะ */}
        <button
          type="button"
          onClick={onPickTable}
          aria-label="เลือกโต๊ะ"
          className={cn(
            'flex min-h-9 items-center gap-1 rounded-lg border px-2 text-xs font-semibold transition-colors active:scale-95',
            tableNote
              ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
              : 'border-border bg-[var(--surface-2)] text-muted-foreground hover:border-primary/40 hover:text-foreground',
          )}
        >
          <MapPin className="size-3.5 shrink-0" />
          {tableNote ? shortTableNote(tableNote) : 'โต๊ะ'}
        </button>

        {/* ออกบิลแล้ว — primary action for admitted row */}
        <button
          type="button"
          onClick={onBillIssued}
          className="flex min-h-9 items-center gap-1 rounded-lg border border-primary bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
        >
          <Check className="size-3.5 shrink-0" />
          ออกบิล
        </button>

        {/* Overflow */}
        <div className="relative">
          <button
            type="button"
            aria-label="เมนูเพิ่มเติม"
            onClick={() => setMenuOpen(v => !v)}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted"
          >
            <MoreVertical className="size-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-[var(--surface-raised)] shadow-[var(--shadow-raised)]">
                <button type="button" onClick={() => { setMenuOpen(false); onPrint(); }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted">
                  <Printer className="size-3.5 text-muted-foreground" />พิมพ์ตั๋วซ้ำ
                </button>
                <div className="border-t border-border" />
                <button type="button" onClick={() => { setMenuOpen(false); onCancel(); }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)]">
                  <Trash2 className="size-3.5" />ยกเลิกคิว
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── TablePickerModal ───────────────────────────────────────────── */

function TablePickerModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: QueueEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<QueueTableId>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function toggle(id: QueueTableId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    const note = formatTableNote([...selected] as QueueTableId[]);
    setSubmitting(true);
    const result = await updatePlannedTable({ id: entry.id, plannedTableNote: note || '-' });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(note ? `บันทึก ${note}` : 'ล้างการจองโต๊ะ');
    onSaved();
  }

  async function handleClear() {
    setSubmitting(true);
    const result = await updatePlannedTable({ id: entry.id, plannedTableNote: '-' });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success('ล้างการเลือกโต๊ะ');
    onSaved();
  }

  const bigTables   = QUEUE_TABLES.filter(t => t.type === 'big');
  const smallTables = QUEUE_TABLES.filter(t => t.type === 'small');
  const notePreview = formatTableNote([...selected] as QueueTableId[]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/30 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-dialog)] sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>

        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-foreground">เลือกโต๊ะ — {entry.queueNumber}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">ผ{entry.adultCount}/ด{entry.childCount} · ข้อมูลนี้ใช้สำหรับวางแผนเท่านั้น</p>
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-5 pb-5 pt-4">
          {/* Large tables */}
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            โต๊ะใหญ่
          </p>
          <div className="grid grid-cols-2 gap-2">
            {bigTables.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={cn(
                  'flex h-[72px] flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-sm font-bold transition-all active:scale-95',
                  selected.has(t.id)
                    ? 'border-primary bg-primary text-primary-foreground shadow-md'
                    : 'border-border bg-[var(--surface-2)] text-foreground hover:border-primary/40 hover:bg-[var(--surface-primary-subtle)]',
                )}
              >
                <span>{t.label}</span>
                <span className={cn('text-xs font-normal', selected.has(t.id) ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                  {t.cap}
                </span>
              </button>
            ))}
          </div>

          {/* Small tables */}
          <p className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            โต๊ะเล็ก
          </p>
          <div className="grid grid-cols-2 gap-2">
            {smallTables.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={cn(
                  'flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-sm font-bold transition-all active:scale-95',
                  selected.has(t.id)
                    ? 'border-primary bg-primary text-primary-foreground shadow-md'
                    : 'border-border bg-[var(--surface-2)] text-foreground hover:border-primary/40 hover:bg-[var(--surface-primary-subtle)]',
                )}
              >
                <span>{t.label}</span>
                <span className={cn('text-xs font-normal', selected.has(t.id) ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                  {t.cap}
                </span>
              </button>
            ))}
          </div>

          {/* Preview + actions */}
          {notePreview ? (
            <div className="mt-3 rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2.5 text-sm font-semibold text-[var(--status-info-fg)]">
              <MapPin className="mr-1.5 inline size-3.5" />
              {notePreview}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-border bg-[var(--surface-2)] px-3 py-2.5 text-sm text-muted-foreground">
              เลือกโต๊ะด้านบน (เลือกได้มากกว่า 1)
            </div>
          )}

          <div className="mt-3 flex gap-2">
            {entry.plannedTableNote && entry.plannedTableNote !== '-' && (
              <button type="button" onClick={handleClear} disabled={submitting}
                className="flex min-h-10 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] px-4 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60">
                ล้าง
              </button>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || selected.size === 0}
              className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              ยืนยัน
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Compact Stepper ────────────────────────────────────────────── */

function Stepper({ label, value, onChange, min = 0 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`ลด ${label}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="flex size-11 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] text-foreground transition-colors active:scale-95 disabled:opacity-40">
          <Minus className="size-4" />
        </button>
        <span className="w-9 text-center text-2xl font-bold tabular-nums text-foreground">{value}</span>
        <button type="button" aria-label={`เพิ่ม ${label}`}
          onClick={() => onChange(Math.min(99, value + 1))}
          disabled={value >= 99}
          className="flex size-11 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] text-foreground transition-colors active:scale-95 disabled:opacity-40">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ─── SoupPotSelector ────────────────────────────────────────────── */

function SoupPotSelector({
  pots, onChange,
}: {
  pots: Array<{ soups: SoupOption[] }>;
  onChange: (v: Array<{ soups: SoupOption[] }>) => void;
}) {
  function toggleSoup(potIdx: number, soup: SoupOption) {
    const next = pots.map((p, i) => {
      if (i !== potIdx) return p;
      const has = p.soups.includes(soup);
      if (has) return { soups: p.soups.filter(s => s !== soup) };
      if (p.soups.length >= 2) return p;
      return { soups: [...p.soups, soup] };
    });
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {pots.map((pot, potIdx) => (
        <div key={potIdx} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-xs font-semibold text-muted-foreground">หม้อ{potIdx + 1}</span>
          <div className="flex flex-1 gap-2">
            {SOUP_OPTIONS.map(soup => {
              const selected = pot.soups.includes(soup);
              const maxed = !selected && pot.soups.length >= 2;
              return (
                <button key={soup} type="button" onClick={() => toggleSoup(potIdx, soup)} disabled={maxed}
                  className={cn(
                    'flex min-h-11 flex-1 items-center justify-center rounded-xl border text-sm font-semibold transition-colors active:scale-95 disabled:opacity-40',
                    selected ? SOUP_STYLE[soup].sel : SOUP_STYLE[soup].unsel,
                  )}>
                  {soup}
                </button>
              );
            })}
          </div>
          {pots.length > 1 && (
            <button type="button" aria-label={`ลบหม้อ ${potIdx + 1}`}
              onClick={() => onChange(pots.filter((_, i) => i !== potIdx))}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {pots.length < 4 && (
        <button type="button"
          onClick={() => onChange([...pots, { soups: ['น้ำดำ' as SoupOption] }])}
          className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/50 bg-[var(--surface-primary-subtle)] text-sm font-medium text-primary transition-colors hover:bg-[var(--surface-primary-muted)]">
          <Plus className="size-3.5" />เพิ่มหม้อ
        </button>
      )}
    </div>
  );
}

/* ─── QueueFormModal ─────────────────────────────────────────────── */

interface QueueFormModalProps {
  mode: 'add' | 'edit';
  entry: QueueEntry | null;
  onClose: () => void;
  onSuccess: (data: {
    queueNumber: string; publicToken: string; partySize: number;
    adultCount: number; childCount: number; soupPots: Array<{ soups: SoupOption[] }>;
  } | null) => void;
}

function QueueFormModal({ mode, entry, onClose, onSuccess }: QueueFormModalProps) {
  const [adultCount, setAdultCount]   = useState(entry?.adultCount ?? 1);
  const [childCount, setChildCount]   = useState(entry?.childCount ?? 0);
  const [customerType, setCustomerType] = useState<CustomerType>(
    (entry?.customerType as CustomerType) ?? 'normal',
  );
  const [soupPots, setSoupPots] = useState<Array<{ soups: SoupOption[] }>>(
    (entry?.soupPots as Array<{ soups: SoupOption[] }> | null) ?? [{ soups: ['น้ำดำ' as SoupOption] }],
  );
  const [seatingFit, setSeatingFit] = useState<SeatingFit | undefined>(
    (entry?.seatingFit as SeatingFit | undefined) ?? undefined,
  );
  const [error, setError]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const total = adultCount + childCount;

  function suggestSeating(adult: number, child: number) {
    if (seatingFit) return;
    const t = adult + child;
    if (t >= 1) setSeatingFit(t <= 4 ? 'need_big' : t <= 6 ? 'need_adjacent' : 'split_ok');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (total === 0)                              { setError('กรุณากรอกจำนวนคน'); return; }
    if (soupPots.some(p => p.soups.length === 0)) { setError('กรุณาเลือกน้ำซุปอย่างน้อย 1 อย่างต่อหม้อ'); return; }
    const payload: AddQueueInput = { adultCount, childCount, customerType, soupPots, seatingFit };
    setSubmitting(true); setError('');
    try {
      if (mode === 'add') {
        const result = await addToQueue(payload);
        if (!result.ok) { setError(result.error); return; }
        toast.success(`เพิ่มคิว ${result.data.queueNumber}`);
        onSuccess({
          queueNumber: result.data.queueNumber, publicToken: result.data.publicToken,
          partySize: result.data.partySize, adultCount: result.data.adultCount,
          childCount: result.data.childCount, soupPots: result.data.soupPots,
        });
      } else {
        if (!entry) return;
        const result = await updateQueue({ ...payload, id: entry.id });
        if (!result.ok) { setError(result.error); return; }
        toast.success('อัปเดตคิวสำเร็จ'); onSuccess(null);
      }
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/30 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-dialog)] sm:rounded-2xl"
        style={{ maxHeight: '92dvh' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-[var(--surface-1)] px-5 py-3.5">
          <h2 className="text-base font-bold text-foreground">{mode === 'add' ? 'เพิ่มคิวใหม่' : 'แก้ไขคิว'}</h2>
          <button type="button" aria-label="ปิด" onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 pb-6 pt-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">จำนวนคน · รวม {total} คน</p>
            <div className="flex gap-4 rounded-xl border border-border bg-[var(--surface-2)] px-4 py-3">
              <Stepper label="ผู้ใหญ่" value={adultCount} onChange={v => { setAdultCount(v); suggestSeating(v, childCount); }} />
              <div className="w-px bg-border" />
              <Stepper label="เด็ก" value={childCount} onChange={v => { setChildCount(v); suggestSeating(adultCount, v); }} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ประเภทลูกค้า</p>
            <div className="flex gap-2">
              {(['normal', 'foreigner', 'staff'] as CustomerType[]).map(type => (
                <button key={type} type="button" onClick={() => setCustomerType(type)}
                  className={cn(
                    'flex min-h-10 flex-1 items-center justify-center rounded-xl border text-sm font-semibold transition-colors active:scale-95',
                    customerType === type
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-[var(--surface-2)] text-foreground hover:border-primary/50',
                  )}>
                  {CUSTOMER_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">น้ำซุป (เลือกได้ 1–2 อย่าง/หม้อ)</p>
            <SoupPotSelector pots={soupPots} onChange={setSoupPots} />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">การจัดที่นั่ง</p>
            <div className="grid grid-cols-2 gap-2">
              {SIMPLIFIED_SEATING_UI.map(({ label, value }) => (
                <button key={value} type="button" onClick={() => setSeatingFit(value)}
                  className={cn(
                    'flex min-h-10 items-center justify-center rounded-xl border text-sm font-semibold transition-colors active:scale-95',
                    seatingFit === value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-[var(--surface-2)] text-foreground hover:border-primary/50',
                  )}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="rounded-lg bg-[var(--status-danger-bg)] px-3 py-2.5 text-sm font-medium text-[var(--status-danger-fg)]">{error}</p>}
          <button type="submit" disabled={submitting}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:opacity-60">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? 'กำลังบันทึก…' : mode === 'add' ? `เพิ่มคิว${total > 0 ? ` · ${total} คน` : ''}` : 'บันทึกการแก้ไข'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── AdmitDialog ────────────────────────────────────────────────── */

function AdmitDialog({ entry, onClose, onSuccess }: {
  entry: QueueEntry; onClose: () => void; onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const total = entry.adultCount + entry.childCount || entry.partySize;
  const soup  = soupSummary(entry.soupPots as Array<{ soups: string[] }> | null);

  async function handleAdmit() {
    setSubmitting(true);
    const result = await admitQueue({ id: entry.id, billIssued: false });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(`รับคิว ${entry.queueNumber} เข้าแล้ว`);
    onSuccess();
  }

  return (
    <ModalShell title={`รับเข้า — ${entry.queueNumber}`} onClose={onClose}>
      <div className="mb-4 rounded-xl border border-border bg-[var(--surface-2)] px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">{total} คน (ผ{entry.adultCount}/ด{entry.childCount})</p>
        {soup && <p className="mt-0.5 text-muted-foreground">{soup}</p>}
        {entry.plannedTableNote && entry.plannedTableNote !== '-' && (
          <p className="mt-1 flex items-center gap-1 font-semibold text-[var(--status-info-fg)]">
            <MapPin className="size-3" />{entry.plannedTableNote}
          </p>
        )}
        {entry.seatingFit && (
          <p className="mt-0.5 text-muted-foreground">{seatingDisplayLabel(entry.seatingFit)}</p>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] text-sm font-semibold text-foreground hover:bg-muted">
          ยกเลิก
        </button>
        <button type="button" onClick={handleAdmit} disabled={submitting}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-sm font-semibold text-[var(--status-success-fg)] hover:border-[var(--status-success-fg)] disabled:opacity-60">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          <UserCheck className="size-4" />ยืนยันรับเข้า
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── SkipDialog ─────────────────────────────────────────────────── */

function SkipDialog({ entry, onClose, onSuccess }: {
  entry: QueueEntry; onClose: () => void; onSuccess: () => void;
}) {
  const [reason, setReason]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSkip() {
    setSubmitting(true);
    const result = await skipQueue({ id: entry.id, skipReason: reason || undefined });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(`ข้ามคิว ${entry.queueNumber}`);
    onSuccess();
  }

  return (
    <ModalShell title={`ข้ามคิว ${entry.queueNumber}`} onClose={onClose}>
      <p className="mb-3 text-xs text-muted-foreground">เหตุผล (ไม่บังคับ)</p>
      <div className="flex flex-wrap gap-2">
        {SKIP_REASON_PRESETS.filter(r => r !== 'อื่น ๆ').map(r => (
          <button key={r} type="button" onClick={() => setReason(reason === r ? '' : r)}
            className={cn(
              'min-h-10 rounded-xl border px-3 text-sm font-medium transition-colors',
              reason === r
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-[var(--surface-2)] text-foreground hover:border-primary/40',
            )}>
            {r}
          </button>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose}
          className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] text-sm font-semibold text-foreground hover:bg-muted">
          ยกเลิก
        </button>
        <button type="button" onClick={handleSkip} disabled={submitting}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-sm font-semibold text-[var(--status-warning-fg)] hover:border-[var(--status-warning-fg)] disabled:opacity-60">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          ยืนยันข้าม
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── ConfirmCancelDialog ────────────────────────────────────────── */

function ConfirmCancelDialog({ entry, onClose, onSuccess }: {
  entry: QueueEntry; onClose: () => void; onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleCancel() {
    setSubmitting(true);
    const result = await cancelQueue(entry.id);
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(`ยกเลิกคิว ${entry.queueNumber}`);
    onSuccess();
  }

  return (
    <ModalShell title="ยืนยันยกเลิกคิว" onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        คิว <span className="font-bold text-foreground">{entry.queueNumber}</span> จะถูกยกเลิก
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] text-sm font-semibold text-foreground hover:bg-muted">
          ไม่ยกเลิก
        </button>
        <button type="button" onClick={handleCancel} disabled={submitting}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-sm font-semibold text-[var(--status-danger-fg)] hover:border-[var(--status-danger-fg)] disabled:opacity-60">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          ยืนยันยกเลิก
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── HistoryModal ───────────────────────────────────────────────── */

function HistoryModal({ todayStr, onClose }: { todayStr: string; onClose: () => void }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['queue-history', todayStr],
    queryFn:  () => getQueueHistory(todayStr).then(r => r.ok ? r.data : []),
    staleTime: 15_000,
  });

  // Show in history: skipped, cancelled, admitted+billed, seated, left
  // Exclude: still-active (waiting/called/waiting_suitable_table) and admitted-not-billed
  const completed = [...history]
    .filter(e => {
      if (['waiting', 'waiting_suitable_table', 'called'].includes(e.status)) return false;
      if (e.status === 'admitted' && !e.billIssued) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/30 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-t-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-dialog)] sm:rounded-2xl"
        style={{ maxHeight: '88dvh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            <h2 className="text-base font-bold text-foreground">ประวัติคิวประจำวัน</h2>
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : completed.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <ClipboardList className="size-7 opacity-40" />
              <p className="text-sm">ยังไม่มีประวัติวันนี้</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completed.map(e => {
                const statusCls   = HIST_CLS[e.status] ?? HIST_CLS.cancelled;
                const statusLabel = e.status === 'admitted' && e.billIssued
                  ? 'ออกบิลแล้ว'
                  : (HIST_LABEL[e.status] ?? e.status);
                const total = e.adultCount + e.childCount || e.partySize;
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-[var(--surface-2)] px-3 py-2.5">
                    <span className="w-10 shrink-0 text-lg font-bold tabular-nums text-foreground">{e.queueNumber}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', statusCls)}>{statusLabel}</span>
                        <span className="text-muted-foreground">ผ{e.adultCount}/ด{e.childCount} ({total} คน)</span>
                        <SoupChips pots={e.soupPots as Array<{ soups: string[] }> | null} />
                        {e.plannedTableNote && e.plannedTableNote !== '-' && (
                          <span className="inline-flex items-center gap-0.5 rounded border border-border bg-[var(--surface-2)] px-1.5 py-0.5 text-xs text-muted-foreground">
                            <MapPin className="size-2.5" />{e.plannedTableNote}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {format(new Date(e.createdAt), 'HH:mm น.', { locale: th })}
                        {e.skipReason ? ` · ${e.skipReason}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── ModalShell ─────────────────────────────────────────────────── */

function ModalShell({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-2xl border border-border bg-[var(--surface-raised)] shadow-[var(--shadow-dialog)] sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <button type="button" aria-label="ปิด" onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 pb-5 pt-4">{children}</div>
      </div>
    </div>
  );
}
