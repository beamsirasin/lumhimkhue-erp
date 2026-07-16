'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date-time';
import {
  Check,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Minus,
  MoreVertical,
  Plus,
  Printer,
  QrCode,
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
  SKIP_REASON_PRESETS,
  seatingDisplayLabel,
  type CustomerType,
  type SoupOption,
} from '@/lib/validations/queue';
import type { AddQueueInput } from '@/lib/validations/queue';
import type { QueueEntry } from '@/lib/actions/queue';
import { print as printQueueQr } from '@/lib/printer/service';
import type { QueueQrData } from '@/lib/printer/types';
import { getTablesLayout, type TableLayoutItem } from '@/lib/actions/tables';
import { cn } from '@/lib/utils';

/* ─── Table note helpers (queue-only, no real table/session state) ─── */

function formatTableNote(ids: Set<string>, layout: TableLayoutItem[]): string {
  return layout.filter(t => ids.has(t.id)).map(t => `โต๊ะ ${t.label}`).join(' + ');
}

function parseTableNote(note: string | null | undefined, layout: TableLayoutItem[]): Set<string> {
  if (!note || note === '-') return new Set();
  const parts = note.split(' + ');
  const ids = new Set<string>();
  for (const part of parts) {
    const label = part.replace(/^โต๊ะ\s*/u, '').trim();
    const found = layout.find(t => t.label === label);
    if (found) ids.add(found.id);
  }
  return ids;
}

function shortTableNote(note: string | null | undefined): string {
  if (!note || note === '-') return '';
  return note.replace(/โต๊ะ/g, '').replace(/ \+ /g, '+');
}

/* ─── Soup chip styles (row display) ────────────────────────────── */

const SOUP_SHORT_LABEL: Record<string, string> = {
  'น้ำดำ':  'ดำ',
  'น้ำใส':  'ใส',
  'หมาล่า': 'หมาล่า',
};

const SOUP_CHIP_STYLE: Record<string, string> = {
  'น้ำดำ':  'border-foreground/40 bg-foreground text-background',
  'น้ำใส':  'border-foreground/25 bg-background text-foreground',
  'หมาล่า': 'border-[var(--status-danger-border)] bg-[var(--status-danger-fg)] text-white',
};

/* ─── Soup selector styles (form buttons) ───────────────────────── */
/* Same color language as SOUP_CHIP_STYLE on the board — ดำ is filled dark,
   ใส is plain white, หมาล่า is filled red. Selection = primary ring + check. */

const SOUP_STYLE: Record<SoupOption, string> = {
  'น้ำดำ':  'border-foreground/40 bg-foreground text-background',
  'น้ำใส':  'border-foreground/25 bg-background text-foreground',
  'หมาล่า': 'border-[var(--status-danger-border)] bg-[var(--status-danger-fg)] text-white',
};

/* ─── Row status tones ───────────────────────────────────────────── */

type DisplayStatus =
  | 'waiting' | 'waiting_suitable_table' | 'called' | 'admitted' | 'billed'
  | 'skipped' | 'cancelled';

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
  billed: {
    label:       'ออกบิลแล้ว',
    badge:       'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
    accentColor: 'var(--status-neutral-fg)',
  },
  skipped: {
    label:       'ข้ามแล้ว',
    badge:       'border-[var(--status-orange-border)] bg-[var(--status-orange-bg)] text-[var(--status-orange-fg)]',
    accentColor: 'var(--status-orange-fg)',
  },
  cancelled: {
    label:       'ยกเลิกแล้ว',
    badge:       'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
    accentColor: 'var(--status-danger-fg)',
  },
};

/* ─── Helpers ────────────────────────────────────────────────────── */

function soupSummary(pots: Array<{ soups: string[] }> | null | undefined): string {
  if (!pots?.length) return '';
  return pots
    .map(p => (p.soups?.length ? p.soups.join(' + ') : ''))
    .filter(Boolean)
    .join(' · ');
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
  const chips: { label: string; style: string }[] = [];
  for (const p of pots) {
    if (!p.soups?.length) continue;
    // Duplicates render as two separate chips ("ใส ใส"), never "ใส ×2".
    for (const soup of p.soups) {
      chips.push({ label: SOUP_SHORT_LABEL[soup] ?? soup, style: SOUP_CHIP_STYLE[soup] ?? SOUP_CHIP_STYLE['น้ำดำ'] });
    }
  }
  if (!chips.length) return null;
  return (
    <>
      {chips.map((chip, i) => (
        <span
          key={i}
          className={cn('shrink-0 rounded border px-1.5 py-0.5 text-xs font-bold leading-none', chip.style)}
        >
          {chip.label}
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
  const [qrTarget, setQrTarget]         = useState<QueueEntry | null>(null);
  const [lastAdded, setLastAdded]       = useState<QueueQrData | null>(null);

  const queryClient = useQueryClient();
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Active queue list: waiting + waiting_suitable_table + called + admitted(not billed)
  const { data: entries = [] } = useQuery({
    queryKey: ['queue-list'],
    queryFn:  () => getQueueList().then(r => r.ok ? r.data : []),
    initialData: initialEntries,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  const { data: todayHistory = [] } = useQuery({
    queryKey: ['queue-history', todayStr],
    queryFn:  () => getQueueHistory(todayStr).then(r => r.ok ? r.data : []),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Skipped/cancelled queues stay on the board (muted, read-only) instead of
  // vanishing into history. The whole board renders as one sequence sorted by
  // queue number (Q001, Q002, …) regardless of status.
  const terminalToday = useMemo(
    () => todayHistory.filter(e => e.status === 'skipped' || e.status === 'cancelled'),
    [todayHistory],
  );
  const boardEntries = useMemo(
    () => [...entries, ...terminalToday].sort((a, b) =>
      a.queueNumber.localeCompare(b.queueNumber, undefined, { numeric: true })),
    [entries, terminalToday],
  );

  // Counter computations — entries now includes all admitted (billed and not-billed)
  const waitingCount   = entries.filter(e => e.status !== 'admitted').length;
  const admittedCount  = entries.filter(e => e.status === 'admitted' && !e.billIssued).length;
  const billedCount    = entries.filter(e => e.status === 'admitted' && !!e.billIssued).length;
  const skippedToday   = todayHistory.filter(e => e.status === 'skipped').length;
  const cancelledToday = todayHistory.filter(e => e.status === 'cancelled').length;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['queue-list'] });
    queryClient.invalidateQueries({ queryKey: ['queue-history', todayStr] });
  }, [queryClient, todayStr]);

  const { mutate: doToggleBill, isPending: billPending, variables: billVars } = useMutation({
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
      queueNumber: string; publicToken: string; partySize: number;
      adultCount: number; childCount: number; soupPots: Array<{ soups: SoupOption[] }>;
    } | null,
  ) {
    invalidate();
    if (data) {
      const createdAt = `${formatThaiDateTime(new Date())} น.`;
      const qrData = buildQrData(data, createdAt, appUrl);
      setLastAdded(qrData);
      void printQueueQr({ type: 'queue_qr', queueEntry: qrData });
    }
    setFormMode(null);
    setEditingEntry(null);
  }

  function getPrintHandler(entry: QueueEntry) {
    return () => {
      const createdAt = `${formatThaiDateTime(entry.createdAt)} น.`;
      void printQueueQr({ type: 'queue_qr', queueEntry: buildQrData(entry, createdAt, appUrl) });
    };
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--surface-0)]">

      {/* ── Header — single compact row on tablet+, counters wrap below on mobile ── */}
      <header className="shrink-0 border-b border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)]">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
          {/* Identity */}
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-primary-subtle)]">
              <ClipboardList className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight text-foreground sm:text-lg">จัดการคิว</h1>
              <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                วันนี้ {formatThaiDate(new Date())}
              </p>
            </div>
          </div>

          {/* Status counters — inline in the same row on tablet+, own row on mobile */}
          <div className="order-last flex w-full items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:w-auto sm:flex-1 sm:pb-0">
            <Counter label="รอ"       count={waitingCount}   cls="text-[var(--status-warning-fg)] bg-[var(--status-warning-bg)] border-[var(--status-warning-border)]" />
            <Counter label="รับเข้า"  count={admittedCount}  cls="text-[var(--status-success-fg)] bg-[var(--status-success-bg)] border-[var(--status-success-border)]" />
            <Counter label="ออกบิล"   count={billedCount}    cls="text-[var(--status-neutral-fg)] bg-[var(--status-neutral-bg)] border-[var(--status-neutral-border)]" />
            <Counter label="ข้าม"     count={skippedToday}   cls="text-muted-foreground bg-muted/30 border-border" />
            <Counter label="ยกเลิก"   count={cancelledToday} cls="text-muted-foreground bg-muted/30 border-border" />
          </div>

          {/* เพิ่มคิว — primary action, large touch target */}
          <button
            type="button"
            onClick={() => { setEditingEntry(null); setFormMode('add'); }}
            className="ml-auto flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 text-base font-bold text-primary-foreground shadow-[var(--shadow-raised)] transition-colors hover:bg-primary/90 active:scale-95 sm:ml-0 sm:px-6"
          >
            <Plus className="size-5" />
            เพิ่มคิว
          </button>
        </div>
      </header>

      {/* ── Last-added notice ──────────────────────────────────── */}
      {lastAdded && (
        <div className="mx-auto mt-2 w-full max-w-5xl px-3 sm:px-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2">
            <span className="min-w-0 truncate text-sm font-semibold text-[var(--status-success-fg)]">
              คิว {lastAdded.queueNumber} เพิ่มสำเร็จ
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void printQueueQr({ type: 'queue_qr', queueEntry: lastAdded })}
                className="flex min-h-9 items-center gap-1 rounded-lg border border-[var(--status-success-border)] px-2.5 text-xs font-semibold text-[var(--status-success-fg)] hover:bg-[var(--surface-1)]"
              >
                <Printer className="size-3" />
                พิมพ์ซ้ำ
              </button>
              <button type="button" aria-label="ปิด" onClick={() => setLastAdded(null)}
                className="flex size-9 items-center justify-center rounded-lg text-[var(--status-success-fg)] hover:bg-[var(--surface-1)]">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Single-sequence board ──────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {boardEntries.length === 0 ? (
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
          <div className="mx-auto w-full max-w-5xl space-y-2 px-3 pb-8 pt-2.5 sm:px-4">
            {boardEntries.map(entry => (
              <ActiveQueueRow
                key={entry.id}
                entry={entry}
                onEdit={() => { setEditingEntry(entry); setFormMode('edit'); }}
                onPickTable={() => setTableTarget(entry)}
                onAdmit={() => setAdmitTarget(entry)}
                onSkip={() => setSkipTarget(entry)}
                billPending={billPending && billVars?.id === entry.id}
                onBillIssued={() => { if (!billPending) doToggleBill({ id: entry.id, issued: true }); }}
                onCancel={() => setCancelTarget(entry)}
                onPrint={getPrintHandler(entry)}
                onShowQr={() => setQrTarget(entry)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Overlays ───────────────────────────────────────────── */}
      {tableTarget && (
        <TableMapPickerModal
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
      {qrTarget && (
        <QrPreviewModal
          entry={qrTarget}
          url={`${appUrl}/q/${qrTarget.publicToken}`}
          onClose={() => setQrTarget(null)}
        />
      )}
    </div>
  );
}

/* ─── Counter chip ───────────────────────────────────────────────── */

function Counter({ label, count, cls }: { label: string; count: number; cls: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium leading-none',
        cls,
        count === 0 && 'opacity-55',
      )}
    >
      {label}
      <span className="text-sm font-bold tabular-nums leading-none">{count}</span>
    </span>
  );
}

/* ─── ActiveQueueRow — unified row for all active statuses ──────── */

interface ActiveQueueRowProps {
  entry: QueueEntry;
  onEdit: () => void;
  onPickTable: () => void;
  onAdmit: () => void;
  onSkip: () => void;
  billPending: boolean;
  onBillIssued: () => void;
  onCancel: () => void;
  onPrint: () => void;
  onShowQr: () => void;
}

/* Overflow menu (แสดง QR / พิมพ์ซ้ำ / ยกเลิก) — its own component so the
   card can render one instance for the desktop action column and one for
   the mobile action bar. Portal keeps it clear of overflow-hidden/scroll. */
function RowOverflowMenu({
  onShowQr, onPrint, onCancel, className,
}: {
  onShowQr: () => void; onPrint: () => void; onCancel: () => void; className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuFixed, setMenuFixed] = useState<{ top: number; right: number } | null>(null);

  function openMenu() {
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const approxMenuH = 134; // 3 items × ~40px + 2 dividers + border
    const top = rect.bottom + approxMenuH > window.innerHeight
      ? rect.top - approxMenuH - 4
      : rect.bottom + 4;
    setMenuFixed({ top, right: window.innerWidth - rect.right });
    setMenuOpen(true);
  }

  return (
    <>
      <button
        ref={menuBtnRef}
        type="button"
        aria-label="เมนูเพิ่มเติม"
        onClick={openMenu}
        className={cn(
          'flex items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted',
          className,
        )}
      >
        <MoreVertical className="size-4" />
      </button>
      {menuOpen && menuFixed && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setMenuOpen(false)} />
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-xl border border-border bg-[var(--surface-raised)] shadow-[var(--shadow-raised)]"
            style={{ top: menuFixed.top, right: menuFixed.right }}
          >
            <button type="button" onClick={() => { setMenuOpen(false); onShowQr(); }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted">
              <QrCode className="size-3.5 text-muted-foreground" />แสดง QR
            </button>
            <div className="border-t border-border" />
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
        </>,
        document.body,
      )}
    </>
  );
}

function ActiveQueueRow({
  entry, onEdit, onPickTable, onAdmit, onSkip, billPending, onBillIssued, onCancel, onPrint, onShowQr,
}: ActiveQueueRowProps) {
  const isBilled   = entry.status === 'admitted' && !!entry.billIssued;
  const isAdmitted = entry.status === 'admitted';
  // Skipped/cancelled entries stay on the board as muted, read-only cards.
  const isTerminal = entry.status === 'skipped' || entry.status === 'cancelled';
  const displayStatus: DisplayStatus = isTerminal
    ? (entry.status as DisplayStatus)
    : isBilled ? 'billed' : (entry.status as DisplayStatus);
  const tone       = ROW_TONE[displayStatus] ?? ROW_TONE.waiting;
  const seating    = seatingDisplayLabel(entry.seatingFit);
  const isNonNormal = entry.customerType && entry.customerType !== 'normal';
  const tableNote  = (entry.plannedTableNote && entry.plannedTableNote !== '-')
    ? entry.plannedTableNote : null;
  const timeRef    = (isAdmitted && entry.admittedAt) ? entry.admittedAt : entry.createdAt;

  // Card surface changes subtly per status
  const cardCls = isBilled || isTerminal
    ? 'border-border/40 bg-[var(--surface-2)]/60 opacity-75'
    : isAdmitted
      ? 'border-[var(--status-success-border)]/50 bg-[var(--status-success-bg)]/15'
      : 'border-border/60 bg-[var(--surface-1)]';

  // Table chip color: success for admitted, info for waiting
  const tableChipCls = tableNote
    ? (isAdmitted
      ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
      : 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]')
    : 'border-border bg-[var(--surface-2)] text-muted-foreground hover:border-primary/40 hover:text-foreground';

  /* Action buttons — rendered twice: side column (sm+) and bottom bar (mobile).
     `mobile` only changes sizing/stretch classes, never behavior. */
  function renderActions(mobile: boolean) {
    const base   = mobile ? 'min-h-11 flex-1 justify-center' : 'min-h-10';
    const square = mobile ? 'size-11' : 'size-10';
    return (
      <>
        {/* เลือกโต๊ะ — always shown */}
        <button
          type="button"
          onClick={onPickTable}
          aria-label="เลือกโต๊ะ"
          className={cn(
            'flex items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors active:scale-95',
            base,
            tableChipCls,
          )}
        >
          <MapPin className="size-3.5 shrink-0" />
          {tableNote ? shortTableNote(tableNote) : 'โต๊ะ'}
        </button>

        {/* Status-conditional primary action — hidden when billed */}
        {!isBilled && (
          isAdmitted ? (
            <button
              type="button"
              disabled={billPending}
              onClick={onBillIssued}
              className={cn(
                'flex items-center gap-1 rounded-lg border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-60',
                base,
              )}
            >
              {billPending
                ? <Loader2 className="size-3.5 shrink-0 animate-spin" />
                : <Check className="size-3.5 shrink-0" />}
              ออกบิล
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onAdmit}
                className={cn(
                  'flex items-center gap-1 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 text-xs font-semibold text-[var(--status-success-fg)] transition-colors hover:border-[var(--status-success-fg)] active:scale-95',
                  base,
                )}
              >
                <UserCheck className="size-3.5 shrink-0" />
                รับเข้า
              </button>

              {/* ข้าม — icon only */}
              <button
                type="button"
                onClick={onSkip}
                aria-label="ข้ามคิว"
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-lg border border-[var(--status-warning-border)] text-[var(--status-warning-fg)] transition-colors hover:bg-[var(--status-warning-bg)] active:scale-95',
                  square,
                )}
              >
                <SkipForward className="size-4" />
              </button>
            </>
          )
        )}

        <RowOverflowMenu
          onShowQr={onShowQr}
          onPrint={onPrint}
          onCancel={onCancel}
          className={cn('shrink-0', square)}
        />
      </>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl border shadow-[var(--shadow-card)] transition-colors', cardCls)}>
      <div className="flex items-stretch">
        {/* Accent bar */}
        <div className="w-1 shrink-0" style={{ backgroundColor: tone.accentColor }} aria-hidden="true" />

        {/* Tappable info area → opens edit (read-only for terminal entries) */}
        <button
          type="button"
          disabled={isTerminal}
          onClick={isTerminal ? undefined : onEdit}
          className={cn(
            'flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3 py-3 text-left transition-colors sm:py-3.5',
            !isTerminal && 'hover:bg-foreground/[0.02]',
          )}
        >
          {/* Line 1: number · status badge · time */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-2xl font-black tabular-nums leading-none text-foreground sm:min-w-[4.5rem] sm:text-[1.75rem]">
              {entry.queueNumber}
            </span>
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold leading-none', tone.badge)}>
              {tone.label}
            </span>
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground" suppressHydrationWarning>
              <Clock className="size-3 shrink-0" />
              {formatDistanceToNowStrict(new Date(timeRef as string | Date), { locale: th, addSuffix: true })}
            </span>
          </div>

          {/* Line 2: count · soup chips · seating · table chip · type chip */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <span className="shrink-0 font-semibold text-foreground">
              ผู้ใหญ่ {entry.adultCount ?? 0} · เด็ก {entry.childCount ?? 0}
            </span>
            <SoupChips pots={entry.soupPots as Array<{ soups: string[] }> | null} />
            {seating && <span className="shrink-0 text-muted-foreground">{seating}</span>}
            {tableNote && (
              <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded border px-1.5 py-0.5 font-semibold', tableChipCls)}>
                <MapPin className="size-2.5" />
                {tableNote}
              </span>
            )}
            {isNonNormal && (
              <span className="shrink-0 rounded border border-border bg-[var(--surface-2)] px-1.5 py-0.5 font-medium text-muted-foreground">
                {CUSTOMER_TYPE_SHORT[entry.customerType as CustomerType]}
              </span>
            )}
            {isTerminal && entry.skipReason && (
              <span className="shrink-0 text-muted-foreground">เหตุผล: {entry.skipReason}</span>
            )}
          </div>
        </button>

        {/* Actions — tablet/desktop side column (terminal cards are read-only) */}
        {!isTerminal && (
          <div className="hidden shrink-0 items-center gap-1.5 pr-3 sm:flex" onClick={e => e.stopPropagation()}>
            {renderActions(false)}
          </div>
        )}
      </div>

      {/* Actions — mobile bottom bar (full-width touch targets) */}
      {!isTerminal && (
        <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2 sm:hidden" onClick={e => e.stopPropagation()}>
          {renderActions(true)}
        </div>
      )}
    </div>
  );
}

/* ─── TableMapPickerModal — real restaurant floor plan picker ────── */

function TableMapPickerModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: QueueEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const containerRef                       = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW]       = useState(0);
  const [containerH, setContainerH]       = useState(0);
  // Tracks explicit user toggle overrides (id → true=on / false=off)
  const [manualToggles, setManualToggles] = useState<Map<string, boolean>>(new Map());
  const [submitting, setSubmitting]       = useState(false);

  const { data: layout = [], isLoading } = useQuery({
    queryKey: ['tables-layout'],
    queryFn:  () => getTablesLayout().then(r => r.ok ? r.data : []),
    staleTime: 60_000,
  });

  // Base selection derived from note string + real layout (no setState-in-effect needed)
  const parsedBase = useMemo(
    () => parseTableNote(entry.plannedTableNote, layout),
    [entry.plannedTableNote, layout],
  );

  // Effective selection = parsed base merged with manual overrides
  const selected = useMemo(() => {
    const result = new Set(parsedBase);
    for (const [id, on] of manualToggles) {
      if (on) result.add(id); else result.delete(id);
    }
    return result;
  }, [parsedBase, manualToggles]);

  // Tight bounding box of actual table shapes — removes unused empty canvas margins
  const bounds = useMemo(() => {
    if (!layout.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    return {
      minX: Math.min(...layout.map(t => t.positionX)),
      minY: Math.min(...layout.map(t => t.positionY)),
      maxX: Math.max(...layout.map(t => t.positionX + t.width)),
      maxY: Math.max(...layout.map(t => t.positionY + t.height)),
    };
  }, [layout]);

  const PAD      = 32; // visual padding around the cropped table area
  const croppedW = bounds.maxX - bounds.minX + PAD * 2;
  const croppedH = bounds.maxY - bounds.minY + PAD * 2;
  // Shift all table positions so that bounds.minX/Y maps to PAD
  const offsetX  = PAD - bounds.minX;
  const offsetY  = PAD - bounds.minY;

  // Measure container for fit-all scale; needs BOTH dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setContainerW(el.clientWidth);
      setContainerH(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scale to fit BOTH width and height — all tables visible on tablet, no scroll needed.
  // Using cropped bounds (not raw canvas origin) keeps scale high enough to stay tappable.
  const scale = (containerW > 0 && containerH > 0)
    ? Math.min(containerW / croppedW, containerH / croppedH, 1)
    : 1;

  function toggle(id: string) {
    const willBeOn = !selected.has(id);
    setManualToggles(prev => {
      const next = new Map(prev);
      next.set(id, willBeOn);
      return next;
    });
  }

  // Mobile list is sorted numerically ("2" before "10"); the DB orders by
  // label as a string, which is fine for map positions but wrong for a list.
  const sortedTables = useMemo(
    () => [...layout].sort((a, b) => a.label.localeCompare(b.label, 'th', { numeric: true })),
    [layout],
  );

  const notePreview = formatTableNote(selected, layout);
  const hasExisting = entry.plannedTableNote && entry.plannedTableNote !== '-';

  async function handleConfirm() {
    const note = notePreview || '-';
    setSubmitting(true);
    const result = await updatePlannedTable({ id: entry.id, plannedTableNote: note });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(notePreview ? `บันทึก ${notePreview}` : 'ล้างการเลือกโต๊ะ');
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

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/30 backdrop-blur-[2px] md:items-center"
      onClick={onClose}
    >
      {/*
        Mobile  : full-width bottom sheet, up to 94dvh tall
        Tablet+ : 96vw × 92dvh — large enough for the full floor plan
        flex-col: header (fixed) → map (flex-1, fit-all) → footer (fixed)
      */}
      <div
        className="flex w-full max-h-[94dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-dialog)] md:h-[92dvh] md:w-[96vw] md:max-h-none md:max-w-[1200px] md:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar — mobile only */}
        <div className="flex shrink-0 justify-center pt-2.5 md:hidden">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>

        {/* Header — compact single row */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="shrink-0 text-base font-bold text-foreground">
              เลือกโต๊ะ — คิว {entry.queueNumber}
            </h2>
            <span className="truncate text-xs text-muted-foreground">
              ผ{entry.adultCount}/ด{entry.childCount} · เลือกได้มากกว่า 1 · วางแผนเท่านั้น
            </span>
          </div>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="ml-3 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Map area — flex-1; fit-all scale on tablet means no vertical scroll needed */}
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center bg-[var(--surface-2)]">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : layout.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[var(--surface-2)] text-sm text-muted-foreground">
            <MapPin className="size-6 opacity-40" />
            ยังไม่มีโต๊ะในระบบ
          </div>
        ) : (
          <>
          {/* Mobile (<md): tappable table list — the floor plan is too small to
              hit reliably on a phone; same toggle/selection state as the map */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-2)] p-3 md:hidden">
            <div className="grid grid-cols-4 gap-2">
              {sortedTables.map(t => {
                const isSelected = selected.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    className={cn(
                      'flex min-h-12 flex-col items-center justify-center rounded-xl border-2 font-bold transition-all active:scale-95 select-none',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground shadow-md'
                        : 'border-border/60 bg-[var(--surface-1)] text-foreground',
                    )}
                  >
                    <span className="flex items-center gap-1 text-base leading-tight tabular-nums">
                      {isSelected && <Check className="size-3.5 opacity-80" />}
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tablet+ (md+): floor-plan map — fit-all scale, no scroll needed.
              ref measures BOTH dimensions; overflow-hidden because fit-all avoids overflow */}
          <div
            ref={containerRef}
            className="hidden flex-1 items-center justify-center overflow-hidden bg-[var(--surface-2)] md:flex"
          >
            {/* Wrapper sized to the exact rendered cropped-canvas dimensions */}
            <div
              className="relative shrink-0"
              style={{ width: croppedW * scale, height: croppedH * scale }}
            >
              {/* Dot-grid background */}
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <defs>
                  <pattern id="dots-q" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1" fill="currentColor" className="text-muted-foreground/15" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#dots-q)" />
              </svg>

              {/* Scaled canvas — buttons at cropped+offset DB positions */}
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{ width: croppedW, height: croppedH, transform: `scale(${scale})` }}
              >
                {layout.map(t => {
                  const isSelected = selected.has(t.id);
                  const shape      = t.shape === 'rectangle' ? 'rounded-md' : 'rounded-xl';
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggle(t.id)}
                      style={{
                        position: 'absolute',
                        left:   t.positionX + offsetX,
                        top:    t.positionY + offsetY,
                        width:  t.width,
                        height: t.height,
                      }}
                      className={cn(
                        'flex flex-col items-center justify-center border-2 font-semibold transition-all active:scale-95 select-none',
                        shape,
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground shadow-md ring-[3px] ring-primary/60 ring-offset-2'
                          : 'border-border/60 bg-[var(--surface-1)] text-foreground hover:border-primary/50 hover:bg-[var(--surface-primary-subtle)]',
                      )}
                    >
                      <span className="text-base font-bold leading-tight tabular-nums">{t.label}</span>
                      {isSelected && <Check className="mt-0.5 size-3.5 opacity-80" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          </>
        )}

        {/* Footer — always visible; never overlays map because it's below flex-1.
            Stacks summary above buttons on mobile so nothing overlaps. */}
        <div className="shrink-0 border-t border-border bg-[var(--surface-1)] px-4 py-3">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
            {/* Selection summary */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {selected.size > 0 ? (
                <>
                  <MapPin className="size-3.5 shrink-0 text-[var(--status-info-fg)]" />
                  <span className="shrink-0 text-sm text-muted-foreground">เลือกแล้ว:</span>
                  <span className="truncate text-sm font-semibold text-[var(--status-info-fg)]">
                    {notePreview}
                  </span>
                  <span className="shrink-0 rounded-full border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--status-info-fg)]">
                    {selected.size} โต๊ะ
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">แตะโต๊ะเพื่อเลือก (เลือกได้มากกว่า 1)</span>
              )}
            </div>

            {/* Action buttons — full-width row on mobile */}
            <div className="flex shrink-0 items-center gap-2">
              {hasExisting && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={submitting}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] px-4 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60"
                >
                  ล้าง
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-[var(--surface-2)] px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60 sm:flex-none"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting || selected.size === 0}
                className="flex min-h-11 min-w-[5.5rem] flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:opacity-60 sm:flex-none"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                ยืนยัน
              </button>
            </div>
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
          className="flex size-12 items-center justify-center rounded-xl border border-border bg-[var(--surface-1)] text-foreground shadow-[var(--shadow-card)] transition-colors active:scale-95 disabled:opacity-40 disabled:shadow-none">
          <Minus className="size-5" />
        </button>
        <span className="w-10 text-center text-3xl font-bold tabular-nums text-foreground">{value}</span>
        <button type="button" aria-label={`เพิ่ม ${label}`}
          onClick={() => onChange(Math.min(99, value + 1))}
          disabled={value >= 99}
          className="flex size-12 items-center justify-center rounded-xl border border-border bg-[var(--surface-1)] text-foreground shadow-[var(--shadow-card)] transition-colors active:scale-95 disabled:opacity-40 disabled:shadow-none">
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  );
}

/* ─── SoupPotSelector ────────────────────────────────────────────── */

type PotUI = { s1: SoupOption | null; s2: SoupOption | null };

function SoupPotSelector({
  pots, onChange,
}: {
  pots: PotUI[];
  onChange: (v: PotUI[]) => void;
}) {
  function selectSlot(potIdx: number, slot: 's1' | 's2', soup: SoupOption) {
    onChange(pots.map((p, i) => {
      if (i !== potIdx) return p;
      return { ...p, [slot]: p[slot] === soup ? null : soup };
    }));
  }

  return (
    <div className="space-y-3">
      {pots.map((pot, potIdx) => (
        <div key={potIdx} className="space-y-2.5 rounded-xl border border-border bg-[var(--surface-2)] p-3">
          {/* Pot header — only shown when there are multiple pots */}
          {pots.length > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">หม้อ {potIdx + 1}</span>
              <button
                type="button"
                aria-label={`ลบหม้อ ${potIdx + 1}`}
                onClick={() => onChange(pots.filter((_, i) => i !== potIdx))}
                className="flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
              >
                <X className="size-3" />ลบหม้อ
              </button>
            </div>
          )}

          {/* Slot 1 */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">ซุป 1</p>
            <div className="flex gap-2">
              {SOUP_OPTIONS.map(soup => (
                <button
                  key={soup}
                  type="button"
                  onClick={() => selectSlot(potIdx, 's1', soup)}
                  className={cn(
                    'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-all active:scale-95',
                    SOUP_STYLE[soup],
                    pot.s1 === soup && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface-2)]',
                  )}
                >
                  {pot.s1 === soup && <Check className="size-3.5 shrink-0" />}
                  {soup}
                </button>
              ))}
            </div>
          </div>

          {/* Slot 2 — optional, always visible */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              ซุป 2 <span className="opacity-50">(ไม่บังคับ)</span>
            </p>
            <div className="flex gap-2">
              {SOUP_OPTIONS.map(soup => (
                <button
                  key={soup}
                  type="button"
                  onClick={() => selectSlot(potIdx, 's2', soup)}
                  className={cn(
                    'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-all active:scale-95',
                    SOUP_STYLE[soup],
                    pot.s2 === soup && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface-2)]',
                  )}
                >
                  {pot.s2 === soup && <Check className="size-3.5 shrink-0" />}
                  {soup}
                </button>
              ))}
            </div>
          </div>

        </div>
      ))}

      {pots.length < 4 && (
        <button
          type="button"
          onClick={() => onChange([...pots, { s1: null, s2: null }])}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/50 bg-[var(--surface-primary-subtle)] text-sm font-medium text-primary transition-colors hover:bg-[var(--surface-primary-muted)] active:scale-[0.99]"
        >
          <Plus className="size-4" />เพิ่มหม้อ
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
  const [adultCount, setAdultCount]     = useState(entry?.adultCount ?? 1);
  const [childCount, setChildCount]     = useState(entry?.childCount ?? 0);
  const [customerType, setCustomerType] = useState<CustomerType>(
    (entry?.customerType as CustomerType) ?? 'normal',
  );
  const [soupPots, setSoupPots] = useState<PotUI[]>(() => {
    const entryPots = entry?.soupPots as Array<{ soups: SoupOption[] }> | null;
    if (entryPots?.length) {
      return entryPots.map(p => ({
        s1: (p.soups[0] as SoupOption | undefined) ?? null,
        s2: (p.soups[1] as SoupOption | undefined) ?? null,
      }));
    }
    return [{ s1: null, s2: null }];
  });
  const [error, setError]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const total = adultCount + childCount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const serverPots = soupPots.map(p => ({
      soups: [p.s1, p.s2].filter((s): s is SoupOption => s !== null),
    }));
    if (total === 0)                                 { setError('กรุณากรอกจำนวนคน'); return; }
    if (serverPots.some(p => p.soups.length === 0))  { setError('กรุณาเลือกน้ำซุปอย่างน้อย 1 อย่างต่อหม้อ'); return; }
    const payload: AddQueueInput = { adultCount, childCount, customerType, soupPots: serverPots };
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
      {/* flex-col shell: header (fixed) → fields (scroll) → CTA footer (always visible) */}
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-dialog)] sm:rounded-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-lg font-bold text-foreground">{mode === 'add' ? 'เพิ่มคิวใหม่' : 'แก้ไขคิว'}</h2>
          <button type="button" aria-label="ปิด" onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">จำนวนคน</p>
                <span className="rounded-full bg-[var(--surface-primary-subtle)] px-2.5 py-1 text-xs font-bold tabular-nums text-primary">
                  รวม {total} คน
                </span>
              </div>
              <div className="flex gap-4 rounded-xl border border-border bg-[var(--surface-2)] px-4 py-3.5">
                <Stepper label="ผู้ใหญ่" value={adultCount} onChange={setAdultCount} />
                <div className="w-px bg-border" />
                <Stepper label="เด็ก"    value={childCount}  onChange={setChildCount} />
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">ประเภทลูกค้า</p>
              <div className="flex gap-2">
                {(['normal', 'foreigner', 'staff'] as CustomerType[]).map(type => (
                  <button key={type} type="button" onClick={() => setCustomerType(type)}
                    className={cn(
                      'flex min-h-11 flex-1 items-center justify-center rounded-xl border text-sm font-semibold transition-colors active:scale-95',
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
              <p className="mb-2 text-sm font-semibold text-foreground">น้ำซุป</p>
              <SoupPotSelector pots={soupPots} onChange={setSoupPots} />
            </div>
            {error && (
              <p className="rounded-lg bg-[var(--status-danger-bg)] px-3 py-2.5 text-sm font-medium text-[var(--status-danger-fg)]">
                {error}
              </p>
            )}
          </div>
          {/* CTA footer — stays visible while fields scroll */}
          <div className="shrink-0 border-t border-border bg-[var(--surface-1)] px-5 py-3">
            <button type="submit" disabled={submitting}
              className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:opacity-60">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? 'กำลังบันทึก…' : mode === 'add' ? `เพิ่มคิว${total > 0 ? ` · ${total} คน` : ''}` : 'บันทึกการแก้ไข'}
            </button>
          </div>
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
  const tableNote = (entry.plannedTableNote && entry.plannedTableNote !== '-')
    ? entry.plannedTableNote : null;

  async function handleAdmit() {
    setSubmitting(true);
    const result = await admitQueue({ id: entry.id, billIssued: false });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(`รับคิว ${entry.queueNumber} เข้าแล้ว`);
    onSuccess();
  }

  return (
    <ModalShell title={`รับเข้า — คิว ${entry.queueNumber}`} onClose={onClose}>
      <div className="mb-4 rounded-xl border border-border bg-[var(--surface-2)] px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">{total} คน (ผ{entry.adultCount}/ด{entry.childCount})</p>
        {soup && <p className="mt-0.5 text-muted-foreground">{soup}</p>}
        {tableNote && (
          <p className="mt-1 flex items-center gap-1 font-semibold text-[var(--status-info-fg)]">
            <MapPin className="size-3" />{tableNote}
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

/* ─── QrPreviewModal ─────────────────────────────────────────────── */

function QrPreviewModal({
  entry, url, onClose,
}: {
  entry: QueueEntry;
  url: string;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied]       = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: QRCode } = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(url, {
        width: 280, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
      if (!cancelled) setQrDataUrl(dataUrl);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [url]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied('idle'), 2500);
  }

  const soup = soupSummary(entry.soupPots as Array<{ soups: string[] }> | null);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-[var(--surface-1)] shadow-[var(--shadow-dialog)]"
        style={{ maxHeight: '92dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-[var(--surface-1)] px-5 py-3.5">
          <h2 className="text-base font-bold text-foreground">QR คิว {entry.queueNumber}</h2>
          <button type="button" aria-label="ปิด" onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col items-center gap-5 px-6 pb-6 pt-5">
          {/* QR code */}
          <div className="rounded-2xl border border-border bg-white p-4 shadow-[var(--shadow-card)]">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt={`QR คิว ${entry.queueNumber}`} width={280} height={280} />
            ) : (
              <div className="flex size-[280px] items-center justify-center">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Queue info */}
          <div className="text-center">
            <p className="text-3xl font-black tabular-nums text-foreground">{entry.queueNumber}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              ผู้ใหญ่ {entry.adultCount ?? 0} · เด็ก {entry.childCount ?? 0}
              {soup ? ` · ${soup}` : ''}
            </p>
          </div>

          {/* Staff instruction */}
          <p className="text-center text-xs text-muted-foreground">
            ให้ลูกค้าสแกนเพื่อเช็คสถานะคิว หรือยกเลิกคิว
          </p>

          {/* Action buttons */}
          <div className="flex w-full gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-[var(--surface-2)] text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <ExternalLink className="size-4" />เปิดลิงก์
            </a>
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors',
                copied === 'ok'
                  ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                  : copied === 'fail'
                    ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
                    : 'border-border bg-[var(--surface-2)] text-foreground hover:bg-muted',
              )}
            >
              {copied === 'ok' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === 'ok' ? 'คัดลอกแล้ว' : copied === 'fail' ? 'คัดลอกไม่สำเร็จ' : 'คัดลอกลิงก์'}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-10 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
          >
            ปิด
          </button>
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
