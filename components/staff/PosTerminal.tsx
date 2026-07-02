'use client';

import { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInSeconds } from 'date-fns';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import {
  getPosSessionsForPos,
  getPosSessionDetail,
  getActiveTilesForPos,
  processPayment,
  markBillPrinted,
  getActivePaymentOptionsForPos,
} from '@/lib/actions/pos';
import { getPaymentReceiptData } from '@/lib/actions/history';
import { updateSessionGuests, closeSession } from '@/lib/actions/sessions';
import { getStoreSettings } from '@/lib/actions/store';
import type { StoreSettingsData } from '@/lib/actions/store';
import { resolveBillConfig } from '@/lib/utils/billConfig';
import type { BillTypeKey } from '@/lib/utils/billConfig';
import { incrementReceiptCounter } from '@/lib/actions/store';
import type { PosSession, PosSessionDetail } from '@/lib/actions/pos';
import { Printer, CheckCircle2, Tag, Package, X, Loader2, Receipt, Save, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PricingTile as PricingTileCard } from '@/components/staff/PricingTile';
import { ShiftWidget } from '@/components/staff/ShiftWidget';
import { print as printReceipt } from '@/lib/printer/service';
import type { ReceiptData } from '@/lib/printer/types';
import type { PricingTile } from '@/lib/db/schema';
import { getAccountGroup } from '@/lib/payments/account-group';

type PosPaymentOption = NonNullable<
  Extract<Awaited<ReturnType<typeof getActivePaymentOptionsForPos>>, { ok: true }>['data']
>[number];

const METHOD_LABEL: Record<string, string> = {
  cash:         'เงินสด',
  cash_qr:      'QR + เงินสด',
  qr_promptpay: 'QR PromptPay',
  transfer:     'โอนเงิน',
  card:         'บัตรเครดิต',
};

function formatElapsed(startedAt: Date | string): string {
  const secs = Math.max(0, differenceInSeconds(new Date(), new Date(startedAt)));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fallbackReceiptNo() {
  return Date.now().toString().slice(-8);
}

/* ─── Numpad ────────────────────────────────────────────────────────── */

function Numpad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  function press(key: string) {
    if (key === '⌫') {
      onChange(value.length > 1 ? value.slice(0, -1) : '0');
    } else if (key === 'C') {
      onChange('0');
    } else {
      const next = value === '0' ? key : value + key;
      if (next.length <= 7) onChange(next);
    }
  }
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {(['7','8','9','4','5','6','1','2','3','C','0','⌫'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className={`rounded-xl py-3.5 text-base font-semibold transition-all duration-100 active:scale-[0.94] ${
            k === 'C'  ? 'bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[var(--status-danger-fg)] hover:opacity-80' :
            k === '⌫' ? 'bg-[var(--surface-2)] border border-border text-foreground hover:bg-muted/70' :
                         'bg-[var(--surface-1)] border border-border text-foreground hover:bg-[var(--surface-2)]'
          }`}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

interface PosTerminalProps {
  initialSessions: PosSession[];
  cashierName: string;
  initialSelectedId?: string | null;

}

export function PosTerminal({
  initialSessions,
  cashierName,
  initialSelectedId = null,
}: PosTerminalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [groupPickerId, setGroupPickerId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: sessions = [] } = useQuery({
    queryKey: ['pos-sessions'],
    queryFn: () => getPosSessionsForPos().then((r) => (r.ok ? r.data : [])),
    initialData: initialSessions,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  useEffect(() => {
    // Keep selectedId even if the sessions list briefly does not include it yet.
    // DetailPanel loads by session id and will show a safe error if the bill is truly gone.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (groupPickerId && !sessions.find((s) => s.id === groupPickerId)) setGroupPickerId(null);
  }, [sessions, groupPickerId]);


  const closing = useMemo(() => sessions.filter((s) => s.status === 'closing'), [sessions]);
  const active = useMemo(() => sessions.filter((s) => s.status === 'active'), [sessions]);

  const handlePaid = useCallback(() => {
    setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: ['pos-sessions'] });
  }, [queryClient]);

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    const order = (s: string) => s === 'closing' ? 0 : s === 'active' ? 1 : 2;
    if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  }), [sessions]);

  const linkedMap = useMemo(() => {
    const map: Record<string, PosSession[]> = {};
    for (const s of sortedSessions) {
      if (s.parentSessionId) {
        if (!map[s.parentSessionId]) map[s.parentSessionId] = [];
        map[s.parentSessionId].push(s);
      }
    }
    return map;
  }, [sortedSessions]);

  const primarySessions = useMemo(
    () => sortedSessions.filter((s) => !s.parentSessionId),
    [sortedSessions],
  );

  const handleSelectSession = useCallback((id: string) => {
    const linked = linkedMap[id] ?? [];
    if (linked.length > 0) {
      setGroupPickerId(id);
    } else {
      setSelectedId(id);
    }
  }, [linkedMap]);

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-[var(--surface-0)] p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4 rounded-2xl border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-soft)]">
        <h1 className="text-xl font-semibold text-foreground">POS / แคชเชียร์</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {closing.length > 0 && (
            <span className="text-[var(--status-danger-fg)] font-medium">{closing.length} รอเรียกเก็บเงิน · </span>
          )}
          {active.length} โต๊ะที่ใช้งาน
        </p>
      </div>

      {/* Cashier shift banner */}
      <div className="mb-4">
        <ShiftWidget />
      </div>


      {/* Session grid */}
      {primarySessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-[var(--surface-1)] px-6 py-20 text-center shadow-[var(--shadow-soft)]">
          <p className="text-sm font-medium text-muted-foreground">ไม่มีโต๊ะที่ใช้งาน</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {primarySessions.map((s) => {
            const linked = linkedMap[s.id] ?? [];
            const isGroupSelected = selectedId === s.id || linked.some((l) => l.id === selectedId);
            if (linked.length === 0) {
              return (
                <SessionCard key={s.id} session={s} selected={selectedId === s.id} onSelect={handleSelectSession} linkedCount={0} hasPrinted={!!s.billPrintedAt} />
              );
            }
            // If primary is paid but a child is pending (closing/active), show child as front card
            const urgentChild = s.status === 'paid'
              ? (linked.find((l) => l.status === 'closing') ?? linked.find((l) => l.status === 'active'))
              : undefined;
            const frontSession = urgentChild ?? s;
            return (
              <div key={s.id} className="relative">
                {linked.length >= 2 && (
                  <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl border-2 border-border bg-[var(--surface-2)] z-0" />
                )}
                <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-xl border-2 border-border bg-[var(--surface-1)] z-[1]" />
                <div className="relative z-[2]">
                  <SessionCard
                    session={frontSession}
                    selected={isGroupSelected}
                    onSelect={urgentChild ? () => handleSelectSession(s.id) : handleSelectSession}
                    linkedCount={linked.length}
                    hasPrinted={!!frontSession.billPrintedAt}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Group picker popup */}
      {groupPickerId && (() => {
        const primary = sessions.find((s) => s.id === groupPickerId);
        const linked = linkedMap[groupPickerId] ?? [];
        if (!primary) return null;
        const allInGroup = [primary, ...linked];
        // Split payment = all sessions share the same table (vs linked-table group = different tables)
        const isSplit = allInGroup.every((g) => g.tableId === allInGroup[0].tableId);
        // Sort: closing/active before paid so pending items appear first
        const sortedGroup = [...allInGroup].sort((a, b) => {
          const u = (st: string) => st === 'closing' ? 0 : st === 'active' ? 1 : 2;
          return u(a.status) - u(b.status);
        });
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setGroupPickerId(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-[var(--surface-1)] border border-border p-6 shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-base font-semibold text-foreground">เลือกบิลที่ต้องการเปิด</p>
              <div className="space-y-2">
                {sortedGroup.map((s) => {
                  const total = s.guests.reduce((sum, g) => sum + Number(g.pricingTile.price) * g.quantity, 0);
                  const guestCount = s.guests.reduce((sum, g) => sum + g.quantity, 0);
                  const isClosing = s.status === 'closing';
                  const isPaid    = s.status === 'paid';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setSelectedId(s.id); setGroupPickerId(null); }}
                      className={`w-full flex items-center justify-between rounded-xl border px-4 py-4 text-left transition-colors ${
                        isPaid
                          ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] hover:opacity-90'
                          : isClosing
                            ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] hover:opacity-90'
                            : 'border-border bg-[var(--surface-1)] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">โต๊ะ {s.table.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {isSplit
                              ? (isPaid ? 'ชำระแล้ว' : 'ยังค้างชำระ')
                              : (s.parentSessionId ? 'บัญชีรอง' : 'บัญชีหลัก')}
                          </span>
                          {isClosing && (
                            <span className="rounded-full bg-[var(--status-danger-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-danger-fg)]">
                              รอชำระ
                            </span>
                          )}
                          {isPaid && (
                            <span className="rounded-full bg-[var(--status-success-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-success-fg)]">
                              จ่ายแล้ว
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{guestCount} คน</p>
                      </div>
                      <p className={`text-sm font-bold tabular-nums ${isPaid ? 'text-[var(--status-success-fg)]' : 'text-foreground'}`}>
                        ฿{total.toLocaleString('th-TH')}
                      </p>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setGroupPickerId(null)}
                className="w-full rounded-xl border border-border bg-[var(--surface-1)] py-3.5 text-sm font-medium text-muted-foreground hover:bg-[var(--surface-2)] transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        );
      })()}

      {/* Modal */}
      {selectedId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="relative h-[calc(100dvh-2rem)] max-h-[820px] w-full max-w-[1180px] overflow-hidden rounded-2xl bg-[var(--surface-1)] border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="ปิด"
              onClick={() => setSelectedId(null)}
              className="absolute right-4 top-4 z-10 flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="size-5" />
            </button>
            <DetailPanel sessionId={selectedId} cashierName={cashierName} onPaid={handlePaid} />
          </div>
        </div>
      )}
    </div>
  );
}

function baseTotal(session: PosSession): number {
  // chargeLineTotal = sum of all non-voided charge lines (guests + addons + penalties).
  // Falls back to live guest pricing for sessions where charge lines are unexpectedly absent.
  if (session.chargeLineTotal > 0) return session.chargeLineTotal;
  return session.guests.reduce((sum, g) => sum + Number(g.pricingTile.price) * g.quantity, 0);
}

const SessionCard = memo(function SessionCard({ session, selected, onSelect, linkedCount = 0, hasPrinted = false }: { session: PosSession; selected: boolean; onSelect: (id: string) => void; linkedCount?: number; hasPrinted?: boolean }) {
  const handleClick = useCallback(() => onSelect(session.id), [onSelect, session.id]);
  const total = baseTotal(session);
  const isClosing = session.status === 'closing';
  const isPaid = session.status === 'paid';
  const totalGuests = session.guests.reduce((s, g) => s + g.quantity, 0);

  const isContinuation = !!session.parentSessionId;
  const cardClass = cn(
    'min-h-32 rounded-xl border-2 p-3 text-left transition-all duration-150 w-full shadow-[var(--shadow-soft)]',
    selected
      ? 'border-primary bg-primary text-primary-foreground shadow-md'
      : isClosing
        ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] hover:opacity-90'
        : isPaid
          ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] hover:opacity-90'
          : 'border-border bg-[var(--surface-1)] hover:bg-[var(--surface-2)]',
  );

  return (
    <button type="button" onClick={handleClick} className={cardClass}>
      <div className="flex items-start justify-between gap-1">
        <span className={`text-base font-bold tabular-nums leading-tight ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>
          โต๊ะ {session.table.label}
        </span>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {hasPrinted && (
            <Receipt
              aria-label="พิมพ์บิลแล้ว"
              className={`size-3.5 ${selected ? 'text-sky-200' : 'text-sky-500'}`}
            />
          )}
          {isContinuation && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-amber-400/80 text-white' : 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'}`}>
              ชำระบางส่วน
            </span>
          )}
          {isClosing && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-red-400/80 text-white' : 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'}`}>
              รอบิล
            </span>
          )}
          {isPaid && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-emerald-400/80 text-white' : 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'}`}>
              จ่ายแล้ว
            </span>
          )}
        </div>
      </div>
      <p className={`mt-0.5 text-xs ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{totalGuests} คน</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${selected ? 'text-primary-foreground' : isPaid ? 'text-[var(--status-success-fg)]' : 'text-foreground'}`}>
        ฿{total.toLocaleString('th-TH')}
      </p>
      {linkedCount > 0 && (
        <p className={`mt-0.5 text-[10px] font-medium ${selected ? 'text-violet-200' : 'text-violet-500'}`}>
          เชื่อม {linkedCount + 1} โต๊ะ
        </p>
      )}
      <p suppressHydrationWarning className={`mt-0.5 text-[11px] tabular-nums ${selected ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
        {formatElapsed(session.startedAt)}
      </p>
    </button>
  );
});

function DetailPanel({ sessionId, cashierName, onPaid }: { sessionId: string; cashierName: string; onPaid: () => void }) {
  const [lastGoodData, setLastGoodData] = useState<PosSessionDetail | null>(null);
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['pos-detail', sessionId],
    queryFn: async () => {
      const result = await getPosSessionDetail(sessionId);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    enabled: !!sessionId,
    refetchInterval: sessionId ? 10_000 : false,
    staleTime: 5_000,
    placeholderData: (previousData) => previousData,
    retry: (failureCount) => failureCount < 6,
    retryDelay: 500,
  });

  useEffect(() => {
    if (!data) return;
    const timer = window.setTimeout(() => setLastGoodData(data), 0);
    return () => window.clearTimeout(timer);
  }, [data]);

  const visibleData = data ?? lastGoodData;
  const detailError = error instanceof Error ? error.message : 'โหลดข้อมูลบิลไม่สำเร็จ';

  const { data: tileData } = useQuery({
    queryKey: ['pos-tiles'],
    queryFn: () => getActiveTilesForPos().then((r) => (r.ok ? r.data : { guests: [], addons: [], discounts: [] })),
    staleTime: 60_000,
  });

  const { data: storeData } = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => getStoreSettings().then((r) => (r.ok ? r.data : null)),
    staleTime: 0, // always refetch on mount so settings changes are reflected immediately
  });

  const { data: paymentOptions = [] } = useQuery({
    queryKey: ['pos-payment-options'],
    queryFn: () => getActivePaymentOptionsForPos().then((r) => (r.ok ? r.data : [])),
    staleTime: 30_000,
  });

  if ((isLoading || isFetching) && !visibleData) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground shadow-sm">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลดบิล...
        </div>
      </div>
    );
  }

  if (!visibleData) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow-sm">
          <p className="text-sm font-semibold text-foreground">โหลดข้อมูลบิลไม่สำเร็จ</p>
          <p className="mt-2 text-sm text-muted-foreground">{detailError}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            โหลดอีกครั้ง
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      {(isFetching || isError) && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
          {isError ? detailError : 'กำลังอัปเดตข้อมูลบิล...'}
        </div>
      )}
      <PaymentPanel
        detail={visibleData}
        guestTiles={tileData?.guests ?? []}
        addonTiles={tileData?.addons ?? []}
        discountTiles={tileData?.discounts ?? []}
        cashierName={cashierName}
        storeSettings={storeData ?? null}
        isGroupBill={visibleData.isGroupBill}
        linkedTableLabels={visibleData.linkedTableLabels}
        paymentOptions={paymentOptions}
        onPaid={onPaid}
      />
    </div>
  );
}
/* ─── Tile counter tile (compact, for POS) ─────────────────────────── */

function PosTile({
  tile,
  qty,
  onInc,
  onDec,
}: {
  tile: PricingTile;
  qty: number;
  onInc: () => void;
  onDec: () => void;
}) {
  const bg = tile.color ?? (tile.category === 'addon' ? '#f0fdf4' : '#fff7ed');
  const priceLabel =
    tile.category === 'discount'
      ? tile.discountType === 'percentage'
        ? `-${tile.discountValue}%`
        : `-฿${Number(tile.discountValue).toLocaleString('th-TH')}`
      : `+฿${Number(tile.price).toLocaleString('th-TH')}`;

  return (
    <div
      className={`relative flex flex-col items-center rounded-xl border-2 transition-all p-2 ${
        qty > 0 ? 'border-primary' : 'border-transparent'
      }`}
      style={{ width: 100, minHeight: 90, backgroundColor: bg }}
    >
      {qty > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {qty}
        </span>
      )}
      {tile.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.imageUrl} alt={tile.name} className="h-8 w-8 object-contain rounded" />
      ) : (
        tile.category === 'addon'
          ? <Package className="size-7 text-green-500 opacity-70" />
          : <Tag className="size-7 text-red-400 opacity-70" />
      )}
      <p className="mt-0.5 text-center text-[11px] font-semibold text-foreground line-clamp-1 w-full">{tile.name}</p>
      <p className={`text-[11px] font-bold ${tile.category === 'discount' ? 'text-red-600 dark:text-red-400' : 'text-[var(--status-success-fg)]'}`}>{priceLabel}</p>
      <div className="flex items-center gap-1 mt-1">
        <button type="button" aria-label="ลด" onClick={onDec} disabled={qty === 0}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-card/70 text-xs font-bold text-foreground hover:bg-card disabled:opacity-30 shadow-sm transition-colors">−</button>
        <span className="w-4 text-center tabular-nums text-xs font-bold text-foreground">{qty}</span>
        <button type="button" aria-label="เพิ่ม" onClick={onInc}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-sm transition-colors">+</button>
      </div>
    </div>
  );
}

/* ─── Payment Panel ────────────────────────────────────────────────── */

type PaymentRowDraft = {
  id: string;
  paymentMethodId: string;
  paymentMethodName: string;
  paymentMethodType: string;
  receivingAccountId: string;
  receivingAccountCode: string;
  receivingAccountName: string;
  amount: number;
  amountTendered: number | null;
  changeAmount: number | null;
  payerLabel: string;
};

type PaymentHistoryEntry = {
  id: string;
  amount: number;
  methodLabel: string;
  accountLabel?: string;
  paidAtLabel: string;
  settlementType: SettlementMode | string;
  receipt?: ReceiptData;
  allocations?: Array<{ label: string; quantity: number; amount: number }>;
};
type SettlementMode = 'final' | 'partial';
type CheckoutMode = 'close_all' | 'head' | 'manual';
type PaymentMode = 'full' | 'items';

function PaymentPanel({
  detail,
  guestTiles,
  addonTiles,
  discountTiles,
  cashierName,
  storeSettings,
  isGroupBill,
  linkedTableLabels,
  paymentOptions = [],
  onPaid,
}: {
  detail: PosSessionDetail;
  guestTiles: PricingTile[];
  addonTiles: PricingTile[];
  discountTiles: PricingTile[];
  cashierName: string;
  storeSettings: StoreSettingsData | null;
  isGroupBill?: boolean;
  linkedTableLabels?: string[];
  /** Loaded in 2B-1; used starting in 2B-2. */
  paymentOptions?: PosPaymentOption[];
  onPaid: () => void;
}) {
  const { session, orders, totals } = detail;

  const [view, setView] = useState<'bill' | 'payment' | 'split'>('bill');
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);
  // keyed by pricingTile.id — initialized from existing session guests
  const [guestQty, setGuestQty] = useState<Record<string, number>>(
    Object.fromEntries(session.guests.map((g) => [g.pricingTile.id, g.quantity])),
  );
  const addonQtyInitialized = useRef(false);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [discountQty, setDiscountQty] = useState<Record<string, number>>({});

  // Restore addon quantities from saved charge lines once addon tiles are available.
  // Uses a ref so periodic detail refetches don't overwrite unsaved user edits.
  useEffect(() => {
    if (addonQtyInitialized.current || addonTiles.length === 0) return;
    const addonTileIds = new Set(addonTiles.map((t) => t.id));
    const initial: Record<string, number> = {};
    for (const line of detail.chargeLines ?? []) {
      if (!line.voidedAt && line.pricingTileId && addonTileIds.has(line.pricingTileId)) {
        initial[line.pricingTileId] = line.quantity;
      }
    }
    setAddonQty(initial);
    addonQtyInitialized.current = true;
  }, [addonTiles, detail.chargeLines]);
  const [saving, setSaving] = useState(false);

  const queryClient = useQueryClient();

  // Payment-view state
  const [method, setMethod] = useState<'cash' | 'cash_qr' | 'qr_promptpay' | 'transfer' | 'card'>('qr_promptpay');
  const [bankAccount, setBankAccount] = useState<'main' | 'secondary'>('main');
  const [numpadInput, setNumpadInput] = useState(() => {
    const initGuests = Object.fromEntries(session.guests.map((g) => [g.pricingTile.id, g.quantity]));
    return String(guestTiles.reduce((sum, t) => sum + Number(t.price) * (initGuests[t.id] ?? 0), 0));
  });
  const [manualDiscount, setManualDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [cashQrField, setCashQrField] = useState<'qr' | 'cash'>('qr');
  const [cashQrCashInput, setCashQrCashInput] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  // ─── Phase 16B: double-submit protection ─────────────────────────────────
  // submitLockRef closes the same-frame double-tap gap (React state updates are
  // async, so `submitting` alone can't stop two taps landing before a re-render).
  // idempotencyKeyRef identifies one checkout attempt to the server: it is kept
  // across failures (a retry is the same attempt) and rotated only after the
  // server confirms the attempt is recorded (success or already-processed).
  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef<string>(nanoid(24));
  const [paid, setPaid] = useState(false);
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('final');
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('head');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full');
  const [selectedHeadQty, setSelectedHeadQty] = useState<Record<string, number>>({});
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);
  const [paymentHistoryDialogOpen, setPaymentHistoryDialogOpen] = useState(false);
  const [localPaymentHistory, setLocalPaymentHistory] = useState<PaymentHistoryEntry[]>([]);

  // Split payment state — sequential rounds
  type CompletedRound = { items: { pricingTileId: string; name: string; qty: number; price: number }[]; subtotal: number; method: 'cash' | 'qr_promptpay' | 'cash_qr'; cashPortion?: number };
  const [roundRemaining,  setRoundRemaining]  = useState<Record<string, number>>({});
  const [roundSelection,  setRoundSelection]  = useState<Record<string, number>>({});
  const [completedRounds, setCompletedRounds] = useState<CompletedRound[]>([]);
  const [roundMethod,     setRoundMethod]     = useState<'cash' | 'qr_promptpay' | 'cash_qr'>('qr_promptpay');
  const [roundNumpad,     setRoundNumpad]     = useState('0');
  const [roundCashQrField, setRoundCashQrField] = useState<'qr' | 'cash'>('qr');
  const [roundCashQrCashInput, setRoundCashQrCashInput] = useState('0');

  // Draft payment row builder state (Phase 2B-2 — local only, not yet submitted)
  const [paymentRowsDraft, setPaymentRowsDraft] = useState<PaymentRowDraft[]>([]);
  const [draftMethodId, setDraftMethodId] = useState('');
  const [draftAccountId, setDraftAccountId] = useState('');
  const [draftAmountInput, setDraftAmountInput] = useState('');
  const [draftTenderedInput, setDraftTenderedInput] = useState('');
  const [draftAmountAutoPrefilled, setDraftAmountAutoPrefilled] = useState(false);
  const [draftTenderedAutoPrefilled, setDraftTenderedAutoPrefilled] = useState(false);
  const [cashEditTarget, setCashEditTarget] = useState<'amount' | 'tendered'>('tendered');
  const [draftPayerLabel, setDraftPayerLabel] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [amountPopupOpen, setAmountPopupOpen] = useState(false);

  // Derived: account group locked by the first draft row ('a' | 'b' | null)
  const lockedAccountGroup = useMemo(
    () => paymentRowsDraft.length > 0
      ? getAccountGroup(paymentRowsDraft[0].receivingAccountCode)
      : null,
    [paymentRowsDraft],
  );

  // Keep numpad in sync with round subtotal when QR is selected
  useEffect(() => {
    if (roundMethod === 'qr_promptpay') {
      const sub = [...guestTiles, ...addonTiles].reduce(
        (s, t) => s + (roundSelection[t.id] ?? 0) * Number(t.price), 0,
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoundNumpad(String(sub));
    }
  }, [roundSelection, roundMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  function initRoundSplit() {
    const rem: Record<string, number> = {};
    for (const t of guestTiles)  { const q = guestQty[t.id]  ?? 0; if (q > 0) rem[t.id] = q; }
    for (const t of addonTiles)  { const q = addonQty[t.id]  ?? 0; if (q > 0) rem[t.id] = q; }
    setRoundRemaining(rem);
    setRoundSelection({});
    setCompletedRounds([]);
    setRoundMethod('qr_promptpay');
    setRoundNumpad('0');
    setRoundCashQrField('qr');
    setRoundCashQrCashInput('0');
  }

  function getRoundSubtotal(): number {
    return [...guestTiles, ...addonTiles].reduce(
      (s, t) => s + (roundSelection[t.id] ?? 0) * Number(t.price), 0,
    );
  }

  function adjustRoundItem(tileId: string, delta: number) {
    const remaining = roundRemaining[tileId] ?? 0;
    setRoundSelection((prev) => {
      const cur = prev[tileId] ?? 0;
      const next = cur + delta;
      if (next < 0 || next > remaining) return prev;
      return { ...prev, [tileId]: next };
    });
  }

  function confirmRound() {
    const sub = getRoundSubtotal();
    if (sub === 0) return;
    const items = [...guestTiles, ...addonTiles]
      .filter((t) => (roundSelection[t.id] ?? 0) > 0)
      .map((t) => ({ pricingTileId: t.id, name: t.name, qty: roundSelection[t.id]!, price: Number(t.price) }));
    // roundNumpad = QR amount for cash_qr (mirrors main view); cashPortion is auto-calculated
    const roundNumpadNum = Number(roundNumpad) || 0;
    const cashPortion = roundMethod === 'cash_qr'
      ? sub - Math.min(roundNumpadNum, sub)
      : undefined;
    setCompletedRounds((prev) => [...prev, { items, subtotal: sub, method: roundMethod, cashPortion }]);
    setRoundRemaining((prev) => {
      const next = { ...prev };
      for (const [id, qty] of Object.entries(roundSelection)) {
        next[id] = (next[id] ?? 0) - qty;
        if (next[id] <= 0) delete next[id];
      }
      return next;
    });
    setRoundSelection({});
    setRoundNumpad('0');
    setRoundCashQrField('qr');
    setRoundCashQrCashInput('0');
  }

  // Tax invoice state
  const [taxInvoiceOpen, setTaxInvoiceOpen] = useState(false);
  const [taxInvoice, setTaxInvoice] = useState<{
    companyName: string; phone: string; taxId: string; address: string;
  } | null>(null);
  const [taxForm, setTaxForm] = useState({ companyName: '', phone: '', taxId: '', address: '' });
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [lastPaymentId, setLastPaymentId] = useState<string | null>(null);

  const baseTotal = guestTiles.reduce(
    (sum, t) => sum + Number(t.price) * (guestQty[t.id] ?? 0),
    0,
  );
  const addonTotal = addonTiles.reduce((sum, t) => sum + Number(t.price) * (addonQty[t.id] ?? 0), 0);
  const subtotalBeforeDiscount = baseTotal + addonTotal;
  const manualDiscountNum = Math.max(0, Number(manualDiscount) || 0);
  const discountTileTotal = discountTiles.reduce((sum, t) => {
    const qty = discountQty[t.id] ?? 0;
    if (qty === 0) return sum;
    if (t.discountType === 'percentage') return sum + subtotalBeforeDiscount * Number(t.discountValue) / 100;
    return sum + Number(t.discountValue) * qty;
  }, 0);
  const total = Math.max(0, subtotalBeforeDiscount - manualDiscountNum - discountTileTotal);
  const numpadNum   = Number(numpadInput) || 0;
  const qrPortion     = method === 'cash_qr' ? Math.min(numpadNum, total) : 0;
  const cashPortion   = method === 'cash_qr' ? total - qrPortion : numpadNum;
  const cashQrCashNum = Number(cashQrCashInput) || 0;
  const cashQrChange  = method === 'cash_qr' ? cashQrCashNum - cashPortion : 0;
  const change        = method === 'cash' ? numpadNum - total : 0;
  const paidBeforeSettlement = detail.paymentSummary?.paidTotal ?? 0;
  const billTotalForSettlement = paidBeforeSettlement > 0
    ? (detail.paymentSummary?.billTotal ?? total)
    : total;
  const remainingBeforePayment = paidBeforeSettlement > 0
    ? Math.max(0, detail.paymentSummary?.remaining ?? billTotalForSettlement - paidBeforeSettlement)
    : total;
  const draftRowsTotal = paymentRowsDraft.reduce((s, r) => s + r.amount, 0);
  const activeChargeLines = (detail.chargeLines ?? []).filter((line) => !line.voidedAt && line.remainingQuantity > 0);
  const allChargeLines = detail.chargeLines ?? [];
  const billHasGuestLines = session.guests.some((guest) => guest.quantity > 0);
  const waitingForChargeLines = billHasGuestLines && allChargeLines.length === 0 && remainingBeforePayment > 0;
  const remainingHeadTotal = activeChargeLines.reduce((sum, line) => sum + line.remainingQuantity, 0);
  const selectedHeadTotal = activeChargeLines.reduce(
    (sum, line) => sum + Math.min(line.remainingQuantity, Math.max(0, selectedHeadQty[line.id] ?? 0)),
    0,
  );
  const selectedHeadAmount = activeChargeLines.reduce((sum, line) => {
    const qty = Math.min(line.remainingQuantity, Math.max(0, selectedHeadQty[line.id] ?? 0));
    return sum + qty * line.unitPrice;
  }, 0);
  const selectedAllocations = activeChargeLines
    .map((line) => {
      const quantity = Math.min(line.remainingQuantity, Math.max(0, selectedHeadQty[line.id] ?? 0));
      return {
        chargeLineId: line.id,
        quantity,
        amount: quantity * line.unitPrice,
      };
    })
    .filter((allocation) => allocation.quantity > 0);
  const closeAllAllocations = activeChargeLines.map((line) => ({
    chargeLineId: line.id,
    quantity: line.remainingQuantity,
    amount: line.remainingQuantity * line.unitPrice,
  }));
  const closeAllAllocationAmount = closeAllAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const remainingBeforeCents = Math.round(remainingBeforePayment * 100);
  const closeAllAllocationCents = Math.round(closeAllAllocationAmount * 100);
  const selectedHeadAmountCents = Math.round(selectedHeadAmount * 100);
  const chargeSelectionKey = activeChargeLines
    .map((line) => `${line.id}:${line.remainingQuantity}`)
    .join('|');
  const allRemainingHeadsSelected =
    activeChargeLines.length > 0 &&
    activeChargeLines.every((line) => (selectedHeadQty[line.id] ?? 0) === line.remainingQuantity);
  const canFinalHeadSettlement = allRemainingHeadsSelected && selectedHeadAmountCents === remainingBeforeCents;
  const effectiveSettlementMode: SettlementMode =
    checkoutMode === 'manual'
      ? settlementMode
      : canFinalHeadSettlement ? 'final' : 'partial';
  const paymentTargetAmount = checkoutMode === 'manual'
    ? remainingBeforePayment
    : paymentMode === 'full'
      ? remainingBeforePayment
      : selectedHeadAmount;
  const paymentTargetCents = Math.round(paymentTargetAmount * 100);
  const remainingForDraft = Math.max(0, paymentTargetAmount - draftRowsTotal);
  const remainingAfterSelection = Math.max(0, remainingBeforePayment - paymentTargetAmount);
  const draftMethodForSync = paymentOptions.find((methodOption) => methodOption.id === draftMethodId) ?? null;
  const draftSyncMethodId = draftMethodForSync?.id;
  const draftSyncMethodType = draftMethodForSync?.type;
  const draftRemainingInputValue = remainingForDraft > 0 ? String(remainingForDraft) : '';
  const canAutoAllocateCloseAll =
    checkoutMode === 'close_all' &&
    activeChargeLines.length > 0 &&
    closeAllAllocationCents === remainingBeforeCents;
  const serverPaymentHistory: PaymentHistoryEntry[] = (detail.paymentHistory ?? []).map((entry) => {
    const methodLabel = [...new Set(entry.rows.map((row) => row.methodName).filter(Boolean))].join(' / ');
    const accountLabel = [...new Set(entry.rows.map((row) => row.receivingAccountName).filter(Boolean))].join(' / ');
    const paidAtDate = new Date(entry.paidAt);
    return {
      id: entry.id,
      amount: entry.amount,
      methodLabel: methodLabel || 'รับชำระ',
      accountLabel: accountLabel || undefined,
      paidAtLabel: Number.isNaN(paidAtDate.getTime())
        ? ''
        : paidAtDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }),
      settlementType: entry.settlementType ?? 'final',
    };
  });
  const serverPaymentHistoryIds = new Set(serverPaymentHistory.map((entry) => entry.id));
  const paymentHistoryEntries = [
    ...serverPaymentHistory,
    ...localPaymentHistory.filter((entry) => !serverPaymentHistoryIds.has(entry.id)),
  ];
  const paymentHistoryTotal = paymentHistoryEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const priorPaidHistoryAmount = Math.max(0, paidBeforeSettlement - paymentHistoryTotal);
  const hasPaymentHistorySummary = priorPaidHistoryAmount > 0 || paymentHistoryEntries.length > 0;

  useEffect(() => {
    if (view !== 'payment' || checkoutMode === 'manual' || waitingForChargeLines) return;
    if (activeChargeLines.length === 0 && allChargeLines.length === 0 && remainingBeforePayment > 0) return;
    const nextSelection = paymentMode === 'full'
      ? Object.fromEntries(activeChargeLines.map((line) => [line.id, line.remainingQuantity]))
      : {};
    const timer = window.setTimeout(() => setSelectedHeadQty(nextSelection), 0);
    return () => window.clearTimeout(timer);
  }, [view, checkoutMode, paymentMode, chargeSelectionKey, waitingForChargeLines]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view !== 'payment' || !draftSyncMethodId) return;
    const timer = window.setTimeout(() => {
      setDraftAmountInput(draftRemainingInputValue);
      setDraftTenderedInput(draftSyncMethodType === 'cash' ? draftRemainingInputValue : '');
      setDraftAmountAutoPrefilled(draftRemainingInputValue !== '');
      setDraftTenderedAutoPrefilled(draftSyncMethodType === 'cash' && draftRemainingInputValue !== '');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [view, draftSyncMethodId, draftSyncMethodType, draftRemainingInputValue]);
  function resetDraftPaymentRows() {
    setPaymentRowsDraft([]);
    setDraftMethodId('');
    setDraftAccountId('');
    setDraftAmountInput('');
    setDraftTenderedInput('');
    setDraftAmountAutoPrefilled(false);
    setDraftTenderedAutoPrefilled(false);
    setDraftPayerLabel('');
  }

  function selectPaymentMode(nextMode: PaymentMode) {
    setPaymentMode(nextMode);
    setCheckoutMode('head');
    setSettlementMode('final');
    resetDraftPaymentRows();
    setSelectedHeadQty(
      nextMode === 'full'
        ? Object.fromEntries(activeChargeLines.map((line) => [line.id, line.remainingQuantity]))
        : {},
    );
  }

  function openPaymentScreen() {
    selectPaymentMode('full');
    setView('payment');
  }

  function setHeadQuantity(lineId: string, quantity: number) {
    const line = activeChargeLines.find((item) => item.id === lineId);
    if (!line) return;
    const nextQty = Math.min(line.remainingQuantity, Math.max(0, Math.trunc(quantity)));
    setSelectedHeadQty((prev) => ({ ...prev, [lineId]: nextQty }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateSessionGuests({
        sessionId: session.id,
        guests: guestTiles.map((t) => ({
          pricingTileId: t.id,
          quantity: guestQty[t.id] ?? 0,
        })),
        addonItems: addonTiles.map((t) => ({
          pricingTileId: t.id,
          quantity: addonQty[t.id] ?? 0,
        })),
      });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success('บันทึกแล้ว');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['pos-sessions'] }),
          queryClient.invalidateQueries({ queryKey: ['pos-detail', session.id] }),
        ]);
      }
    } finally {
      setSaving(false);
    }
  }

  const now = () => new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
  const paymentHistoryTime = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

  function buildShopInfo(billType: BillTypeKey, s?: StoreSettingsData | null) {
    const src = s ?? storeSettings;
    if (!src) return { shopNameTh: 'ร้านชาบู' };
    const cfg = resolveBillConfig(src, billType);
    return {
      cfg,
      logoUrl:       cfg.logoUrl,
      logoHeight:    cfg.logoHeight,
      paperWidth:    (src.billPaperWidth as 58 | 80) ?? 80,
      shopNameTh:    cfg.shopNameTh ?? '',
      shopNameEn:    cfg.shopNameEn,
      companyName:   cfg.companyName,
      shopAddress:   cfg.address,
      phone:         cfg.phone,
      taxId:         cfg.taxId,
      branch:        cfg.branch,
      registerNo:    cfg.registerNo,
      footerNote:    cfg.footerNote,
      vatPercent:    cfg.vatPercent ?? 7,
      billTypeLabel: cfg.billTypeLabel,
    };
  }

  async function handlePrint() {
    const freshRes = await getStoreSettings();
    const fresh = freshRes.ok ? freshRes.data : storeSettings;
    const { cfg, ...shopInfo } = buildShopInfo('preview', fresh);
    const hidden = new Set(cfg?.hiddenFields ?? []);

    const receiptItems: ReceiptData['items'] = [];
    for (const t of guestTiles) {
      const qty = guestQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    await Promise.all([
      printReceipt({
        type: 'receipt',
        payment: {
          receiptType: 'bill',
          ...shopInfo,
          tableNumber:  hidden.has('tableNo')   ? '' : session.table.label,
          cashierName:  hidden.has('cashier')   ? '' : cashierName,
          paidAt:       hidden.has('date')      ? '' : now(),
          items: receiptItems, subtotal: subtotalBeforeDiscount, discount: 0, serviceCharge: 0,
          total: subtotalBeforeDiscount, receivedAmount: 0, changeAmount: 0,
          paymentMethod: '', sessionId: session.id,
        },
      }),
      markBillPrinted(session.id),
    ]);
    queryClient.invalidateQueries({ queryKey: ['pos-sessions'] });
  }

  function buildLineItems() {
    const items: Array<{ pricingTileId: string; quantity: number; amount: number }> = [];
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) items.push({ pricingTileId: t.id, quantity: qty, amount: Number(t.price) * qty });
    }
    for (const t of discountTiles) {
      const qty = discountQty[t.id] ?? 0;
      if (qty > 0) {
        const amount = t.discountType === 'percentage'
          ? -(subtotalBeforeDiscount * Number(t.discountValue) / 100)
          : -(Number(t.discountValue) * qty);
        items.push({ pricingTileId: t.id, quantity: qty, amount });
      }
    }
    return items;
  }

  function buildSettlementReceiptFields(data: {
    settlementType?: 'partial' | 'final';
    billTotal?: number;
    paidBefore?: number;
    paidThisTime?: number;
    paidTotal?: number;
    remainingAfter?: number;
    total: number;
  }): Pick<ReceiptData, 'settlementType' | 'billTotal' | 'paidBefore' | 'paidThisTime' | 'paidTotal' | 'remainingAfter'> {
    const paidThisTime = data.paidThisTime ?? data.total;
    const paidBefore = data.paidBefore ?? 0;
    return {
      settlementType: data.settlementType ?? 'final',
      billTotal: data.billTotal ?? data.total,
      paidBefore,
      paidThisTime,
      paidTotal: data.paidTotal ?? paidBefore + paidThisTime,
      remainingAfter: data.remainingAfter ?? 0,
    };
  }

  async function printPaymentEventReceipt(paymentId: string, fallbackReceipt: ReceiptData) {
    const receiptResult = await getPaymentReceiptData(paymentId);
    if (receiptResult.ok) {
      await printReceipt({ type: 'receipt', payment: receiptResult.data });
      return;
    }
    await printReceipt({ type: 'receipt', payment: fallbackReceipt });
  }

  // Phase 16B: synchronous re-entry lock around the real submit. Two taps in
  // the same frame both reach onClick before React re-renders with a disabled
  // button — the ref check is synchronous, so the second tap is a no-op.
  async function handleSubmit() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      await submitPaymentAttempt();
    } finally {
      submitLockRef.current = false;
    }
  }

  async function submitPaymentAttempt() {
    // ── Draft payment rows path ──────────────────────────────────────────
    if (paymentRowsDraft.length > 0) {
      const draftRowsTotalCents = Math.round(draftRowsTotal * 100);
      if (checkoutMode === 'head') {
        if (selectedAllocations.length === 0 || selectedHeadAmountCents <= 0) {
          toast.error('กรุณาเลือกรายการที่ต้องการรับชำระ');
          return;
        }
        if (activeChargeLines.some((line) => (selectedHeadQty[line.id] ?? 0) > line.remainingQuantity)) {
          toast.error('จำนวนหัวที่เลือกเกินจำนวนคงเหลือ');
          return;
        }
        if (draftRowsTotalCents !== selectedHeadAmountCents) {
          toast.error('ยอดรับชำระไม่ตรงกับรายการที่เลือก');
          return;
        }
        if (selectedHeadAmountCents > remainingBeforeCents) {
          toast.error('ยอดรายการที่เลือกมากกว่ายอดคงเหลือ');
          return;
        }
      } else if (checkoutMode === 'close_all') {
        if (draftRowsTotalCents !== remainingBeforeCents) {
          toast.error('ยอดชำระยังไม่ครบยอดคงเหลือ กรุณาเพิ่มยอดให้ครบก่อนปิดบิล');
          return;
        }
      } else {
        if (settlementMode === 'final' && draftRowsTotalCents !== remainingBeforeCents) {
          toast.error('ยอดชำระยังไม่ครบยอดคงเหลือ กรุณาเพิ่มยอดให้ครบก่อนปิดบิล');
          return;
        }
        if (settlementMode === 'partial' && draftRowsTotalCents >= remainingBeforeCents) {
          toast.error('ถ้าต้องการชำระครบยอด กรุณาใช้โหมดปิดบิลทั้งหมด');
          return;
        }
        if (settlementMode === 'partial' && draftRowsTotalCents <= 0) {
          toast.error('กรุณาระบุยอดรับชำระบางส่วน');
          return;
        }
      }
      setSubmitting(true);

      const draftNotes = [
        notes || '',
        taxInvoice ? `[ใบกำกับภาษี: ${taxInvoice.companyName} ${taxInvoice.taxId}]` : '',
      ].filter(Boolean).join(' ') || undefined;

      const counterResult = await incrementReceiptCounter();
      const receiptNo = counterResult.ok ? counterResult.receiptNo : fallbackReceiptNo();

      // Compute safe legacy placeholder values — backend derives the real values from paymentRows
      const rowTypes = new Set(paymentRowsDraft.map((r) => r.paymentMethodType));
      const legacyMethod: 'cash' | 'cash_qr' | 'qr_promptpay' | 'transfer' | 'card' =
        rowTypes.size === 1 && rowTypes.has('cash')      ? 'cash'
        : rowTypes.size === 1 && rowTypes.has('promptpay') ? 'qr_promptpay'
        : rowTypes.has('cash') || rowTypes.has('promptpay') ? 'cash_qr'
        : 'transfer';
      const draftCashTendered = paymentRowsDraft
        .filter((r) => r.paymentMethodType === 'cash')
        .reduce((s, r) => s + (r.amountTendered ?? r.amount), 0);

      const result = await processPayment({
        sessionId: session.id,
        settlementMode: effectiveSettlementMode,
        paymentMethod: legacyMethod,
        receivedAmount: draftCashTendered > 0 ? draftCashTendered : draftRowsTotal,
        discount: manualDiscountNum,
        notes: draftNotes,
        receiptNo,
        lineItems: buildLineItems(),
        paymentMode,
        idempotencyKey: idempotencyKeyRef.current,
        paymentRows: paymentRowsDraft.map((row) => ({
          paymentMethodId:    row.paymentMethodId,
          receivingAccountId: row.receivingAccountId,
          amount:             row.amount,
          amountTendered:     row.amountTendered,
          changeAmount:       row.changeAmount,
          referenceNo:        null,
          payerLabel:         row.payerLabel || null,
          note:               null,
        })),
        ...(checkoutMode === 'head'
          ? { allocations: selectedAllocations }
          : canAutoAllocateCloseAll
            ? { allocations: closeAllAllocations }
            : {}),
      });
      setSubmitting(false);
      if (!result.ok) { toast.error(result.error); return; }
      // Attempt is recorded server-side — rotate the key so the next payment
      // attempt on this session is a distinct attempt.
      const alreadyProcessed = result.data.alreadyProcessed === true;
      idempotencyKeyRef.current = nanoid(24);
      if (alreadyProcessed) toast.info('รายการชำระนี้ถูกบันทึกแล้ว');
      if (result.data.shiftWarning) {
        toast.warning('ไม่มีรอบแคชเชียร์เปิดอยู่ รายการนี้จะไม่ถูกรวมในการตรวจรอบ');
      }

      const receiptItems: ReceiptData['items'] = [];
      for (const t of guestTiles) {
        const qty = guestQty[t.id] ?? 0;
        if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
      }
      for (const t of addonTiles) {
        const qty = addonQty[t.id] ?? 0;
        if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
      }
      const primaryAccountCode = paymentRowsDraft[0]?.receivingAccountCode;
      const billType: BillTypeKey = taxInvoice
        ? 'taxInvoice'
        : primaryAccountCode
          ? (`account:${primaryAccountCode}` as BillTypeKey)
          : 'main';
      const freshRes = await getStoreSettings();
      const fresh = freshRes.ok ? freshRes.data : storeSettings;
      const { cfg, ...shopInfo } = buildShopInfo(billType, fresh);
      const hidden = new Set(cfg?.hiddenFields ?? []);
      const finalReceiptNo = result.data.receiptNo ?? receiptNo;
      const draftMethodLabel = [...new Set(paymentRowsDraft.map((r) => r.paymentMethodName))].join(' / ');
      const draftAccountLabel = [...new Set(paymentRowsDraft.map((r) => r.receivingAccountName).filter(Boolean))].join(' / ');
      const receipt: ReceiptData = {
        receiptType: 'receipt',
        ...shopInfo,
        receiptNo:    hidden.has('receiptNo') ? undefined : finalReceiptNo,
        tableNumber:  hidden.has('tableNo')   ? '' : session.table.label,
        cashierName:  hidden.has('cashier')   ? '' : cashierName,
        paidAt:       hidden.has('date')      ? '' : now(),
        items: receiptItems, subtotal: subtotalBeforeDiscount,
        discount: manualDiscountNum + discountTileTotal, serviceCharge: 0,
        total: result.data.total,
        receivedAmount: draftCashTendered > 0 ? draftCashTendered : result.data.total,
        changeAmount: result.data.changeAmount, paymentMethod: draftMethodLabel, sessionId: session.id,
        ...buildSettlementReceiptFields(result.data),
        paymentRows: paymentRowsDraft.map((row) => ({
          label:         row.paymentMethodName,
          accountName:   row.receivingAccountName,
          amount:        row.amount,
          amountTendered: row.amountTendered ?? null,
          changeAmount:  row.changeAmount ?? null,
          payerLabel:    row.payerLabel || null,
        })),
        buyerInfo: taxInvoice ? {
          companyName: taxInvoice.companyName,
          address:     taxInvoice.address,
          taxId:       taxInvoice.taxId,
        } : undefined,
      };
      setLastReceipt(receipt);
      setPaymentRowsDraft([]);
      setDraftMethodId('');
      setDraftAccountId('');
      setDraftAmountInput('');
      setDraftTenderedInput('');
      setDraftAmountAutoPrefilled(false);
      setDraftTenderedAutoPrefilled(false);
      setCashEditTarget('tendered');
      setDraftPayerLabel('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-detail', session.id] }),
      ]);
      setLastPaymentId(result.data.paymentId);
      setLocalPaymentHistory((prev) => [
        // Guard against a duplicate local entry when the server reports an
        // already-processed attempt whose success response reached us earlier
        ...prev.filter((p) => p.id !== result.data.paymentId),
        {
          id: result.data.paymentId,
          amount: result.data.total,
          methodLabel: draftMethodLabel || 'รับชำระ',
          accountLabel: draftAccountLabel || undefined,
          paidAtLabel: paymentHistoryTime(),
          settlementType: result.data.settlementType,
          receipt,
          allocations: 'allocations' in result.data
            ? result.data.allocations?.map((allocation: { label: string; quantity: number; amount: number }) => ({
              label: allocation.label,
              quantity: allocation.quantity,
              amount: allocation.amount,
            }))
            : undefined,
        },
      ]);
      // Auto-print receipt — non-blocking; payment success never depends on print
      // outcome. Skipped for already-processed duplicates so a re-submitted
      // attempt never prints the same receipt twice (manual reprint stays available).
      if (!alreadyProcessed) {
        void printPaymentEventReceipt(result.data.paymentId, receipt).catch(() => {
          toast.warning('รับชำระสำเร็จ แต่พิมพ์ใบเสร็จไม่สำเร็จ');
        });
      }
      if (effectiveSettlementMode === 'partial') {
        toast.success(
          checkoutMode === 'head'
            ? `รับชำระตามรายการสำเร็จ เหลือ ฿${result.data.remainingAfter.toLocaleString('th-TH')}`
            : `รับชำระบางส่วนแล้ว เหลือ ฿${result.data.remainingAfter.toLocaleString('th-TH')}`,
        );
        setSettlementMode('final');
        setCheckoutMode('head');
        setPaymentMode('full');
        setSelectedHeadQty({});
        return;
      }
      setPaid(true);
      return;
    }

    // ── Legacy path (unchanged) ──────────────────────────────────────────
    if (method === 'cash' && numpadNum < total) { toast.error('จำนวนเงินที่รับไม่เพียงพอ'); return; }
    if (method === 'cash_qr' && cashPortion > 0 && cashQrChange < 0) { toast.error('จำนวนเงินสดไม่เพียงพอ'); return; }
    setSubmitting(true);
    const accountLabel = bankAccount === 'main' ? 'บัญชี A' : 'บัญชี B';
    const splitNote = method === 'cash_qr'
      ? `[QR ฿${qrPortion.toLocaleString('th-TH')} + เงินสด ฿${cashPortion.toLocaleString('th-TH')}]`
      : '';
    const fullNotes = [
      `[${accountLabel}]`,
      splitNote,
      notes || '',
      taxInvoice ? `[ใบกำกับภาษี: ${taxInvoice.companyName} ${taxInvoice.taxId}]` : '',
    ].filter(Boolean).join(' ');

    const counterResult = await incrementReceiptCounter();
    const receiptNo = counterResult.ok ? counterResult.receiptNo : fallbackReceiptNo();

    const result = await processPayment({
      sessionId: session.id,
      settlementMode: 'final',
      paymentMethod: method,
      receivedAmount: method === 'cash' ? numpadNum : method === 'cash_qr' ? cashPortion : total,
      discount: manualDiscountNum,
      notes: fullNotes || undefined,
      receiptNo,
      lineItems: buildLineItems(),
      idempotencyKey: idempotencyKeyRef.current,
    });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error); return; }
    const alreadyProcessed = result.data.alreadyProcessed === true;
    idempotencyKeyRef.current = nanoid(24);
    if (alreadyProcessed) toast.info('รายการชำระนี้ถูกบันทึกแล้ว');
    if (result.data.shiftWarning) {
      toast.warning('ไม่มีรอบแคชเชียร์เปิดอยู่ รายการนี้จะไม่ถูกรวมในการตรวจรอบ');
    }

    const receiptItems: ReceiptData['items'] = [];
    for (const t of guestTiles) {
      const qty = guestQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    for (const t of addonTiles) {
      const qty = addonQty[t.id] ?? 0;
      if (qty > 0) receiptItems.push({ name: t.name, quantity: qty, total: Number(t.price) * qty });
    }
    const billType: BillTypeKey = taxInvoice
      ? 'taxInvoice'
      : (bankAccount === 'main' ? 'account:bank_cash_a' : 'account:bank_cash_b');
    const freshRes = await getStoreSettings();
    const fresh = freshRes.ok ? freshRes.data : storeSettings;
    const { cfg, ...shopInfo } = buildShopInfo(billType, fresh);
    const hidden = new Set(cfg?.hiddenFields ?? []);
    const finalReceiptNo = result.data.receiptNo ?? receiptNo;
    const receipt: ReceiptData = {
      receiptType: 'receipt',
      ...shopInfo,
      receiptNo:    hidden.has('receiptNo') ? undefined : finalReceiptNo,
      tableNumber:  hidden.has('tableNo')   ? '' : session.table.label,
      cashierName:  hidden.has('cashier')   ? '' : cashierName,
      paidAt:       hidden.has('date')      ? '' : now(),
      items: receiptItems, subtotal: subtotalBeforeDiscount,
      discount: manualDiscountNum + discountTileTotal, serviceCharge: 0,
      total: result.data.total,
      receivedAmount: method === 'cash' ? numpadNum : method === 'cash_qr' ? cashPortion : result.data.total,
      changeAmount: result.data.changeAmount, paymentMethod: METHOD_LABEL[method], sessionId: session.id,
      ...buildSettlementReceiptFields(result.data),
      buyerInfo: taxInvoice ? {
        companyName: taxInvoice.companyName,
        address:     taxInvoice.address,
        taxId:       taxInvoice.taxId,
      } : undefined,
    };
    setLastReceipt(receipt);
    setPaid(true);
    setLastPaymentId(result.data.paymentId);
    setLocalPaymentHistory((prev) => [
      ...prev.filter((p) => p.id !== result.data.paymentId),
      {
        id: result.data.paymentId,
        amount: result.data.total,
        methodLabel: METHOD_LABEL[method],
        paidAtLabel: paymentHistoryTime(),
        settlementType: result.data.settlementType,
        receipt,
      },
    ]);
    // Auto-print receipt — non-blocking; skipped for already-processed duplicates
    if (!alreadyProcessed) {
      void printPaymentEventReceipt(result.data.paymentId, receipt).catch(() => {
        toast.warning('รับชำระสำเร็จ แต่พิมพ์ใบเสร็จไม่สำเร็จ');
      });
    }
  }

  /* ── Success ── */
  if (paid && lastReceipt) {
    async function handleForceClose() {
      setSubmitting(true);
      const res = await closeSession({ sessionId: session.id });
      setSubmitting(false);
      if (!res.ok) { toast.error(res.error); return; }
      onPaid();
    }

    return (
      <div className="p-6 space-y-6">
        <div className="rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto size-12 text-[var(--status-success-fg)]" />
          <h2 className="text-xl font-bold text-[var(--status-success-fg)]">ชำระเงินสำเร็จ</h2>
          <p className="text-3xl font-bold tabular-nums text-foreground">฿{lastReceipt.total.toLocaleString('th-TH')}</p>
          {lastReceipt.changeAmount > 0 && <p className="text-base text-muted-foreground">เงินทอน ฿{lastReceipt.changeAmount.toLocaleString('th-TH')}</p>}
          <p className="text-sm text-muted-foreground">โต๊ะ {lastReceipt.tableNumber} · ชำระด้วย {lastReceipt.paymentMethod}</p>
          <p className="text-xs text-muted-foreground">โต๊ะยังแสดงสถานะ &quot;จ่ายแล้ว&quot; — ปิดโต๊ะได้ที่ จัดการโต๊ะ</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => void (lastPaymentId ? printPaymentEventReceipt(lastPaymentId, lastReceipt) : printReceipt({ type: 'receipt', payment: lastReceipt }))}
            className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
            <Printer className="size-4" />พิมพ์ซ้ำ
          </button>
          <button type="button" onClick={handleForceClose} disabled={submitting}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] py-3 text-sm font-medium text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] disabled:opacity-50 transition-colors">
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {submitting ? 'กำลังปิด…' : 'บังคับปิดโต๊ะ'}
          </button>
          <button type="button" onClick={onPaid} className="flex-1 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">เสร็จสิ้น</button>
        </div>
      </div>
    );
  }

  /* ── Tax invoice popup ── */
  const TaxInvoicePopup = taxInvoiceOpen ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">ข้อมูลใบกำกับภาษี</h3>
          <button type="button" aria-label="ปิด" onClick={() => setTaxInvoiceOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><X className="size-5" /></button>
        </div>
        {(['companyName', 'phone', 'taxId', 'address'] as const).map((field) => {
          const labels = { companyName: 'ชื่อบริษัท / นิติบุคคล', phone: 'เบอร์โทรศัพท์', taxId: 'เลขประจำตัวผู้เสียภาษี', address: 'ที่อยู่' };
          return (
            <div key={field}>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">{labels[field]}</label>
              {field === 'address' ? (
                <textarea rows={2} value={taxForm[field]} onChange={(e) => setTaxForm((p) => ({ ...p, [field]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-3 text-base text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 resize-none transition-colors" />
              ) : (
                <input type="text" value={taxForm[field]} onChange={(e) => setTaxForm((p) => ({ ...p, [field]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-3 text-base text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
              )}
            </div>
          );
        })}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={() => { setTaxInvoice(null); setTaxInvoiceOpen(false); }}
            className="flex-1 rounded-xl border border-border py-3.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">ไม่ออกใบกำกับ</button>
          <button type="button"
            onClick={() => {
              if (taxForm.companyName && taxForm.taxId) { setTaxInvoice({ ...taxForm }); }
              setTaxInvoiceOpen(false);
            }}
            className="flex-1 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">บันทึก</button>
        </div>
      </div>
    </div>
  ) : null;

  /* ── Payment form view ── */
  if (view === 'payment') {
    const draftMethod = paymentOptions.find((m) => m.id === draftMethodId) ?? null;
    const draftAccount = draftMethod?.accounts.find((a) => a.id === draftAccountId) ?? null;
    const isCashMethod = draftMethod?.type === 'cash';
    const draftAmountNum = Math.max(0, Number(draftAmountInput) || 0);
    const draftTenderedNum = Math.max(0, Number(draftTenderedInput) || 0);
    const draftChange = isCashMethod ? draftTenderedNum - draftAmountNum : 0;
    const canAddRow =
      draftMethodId !== '' &&
      draftAccountId !== '' &&
      draftAmountNum > 0 &&
      draftAmountNum <= remainingForDraft + 0.001 &&
      (!isCashMethod || draftTenderedNum >= draftAmountNum);
    const draftRowsTotalCents = Math.round(draftRowsTotal * 100);
    const isDraftComplete =
      paymentRowsDraft.length > 0 &&
      paymentTargetCents > 0 &&
      draftRowsTotalCents === paymentTargetCents;
    const isPartialDraftValid =
      paymentRowsDraft.length > 0 &&
      draftRowsTotalCents > 0 &&
      draftRowsTotalCents < remainingBeforeCents;
    const canConfirmSettlement =
      checkoutMode === 'head'
        ? selectedAllocations.length > 0 && selectedHeadAmountCents <= remainingBeforeCents && isDraftComplete
        : checkoutMode === 'close_all'
          ? isDraftComplete
          : settlementMode === 'final'
            ? isDraftComplete
            : isPartialDraftValid;
    const confirmLabel =
      checkoutMode === 'head'
        ? paymentMode === 'full'
          ? `รับชำระและปิดบิล ฿${paymentTargetAmount.toLocaleString('th-TH')}`
          : effectiveSettlementMode === 'final'
            ? `รับชำระตามรายการและปิดบิล ฿${paymentTargetAmount.toLocaleString('th-TH')}`
            : `รับชำระตามรายการ ฿${paymentTargetAmount.toLocaleString('th-TH')}`
        : checkoutMode === 'close_all'
          ? `ปิดบิลและชำระคงเหลือ ฿${remainingBeforePayment.toLocaleString('th-TH')}`
          : settlementMode === 'final'
            ? `ปิดบิลและชำระคงเหลือ ฿${remainingBeforePayment.toLocaleString('th-TH')}`
            : `รับชำระบางส่วน ฿${draftRowsTotal.toLocaleString('th-TH')}`;
    const isEditingCashTendered = isCashMethod && cashEditTarget === 'tendered';
    const numpadSetter = isEditingCashTendered ? setDraftTenderedInput : setDraftAmountInput;
    const numpadValue = isEditingCashTendered ? draftTenderedInput : draftAmountInput;
    const numpadAutoPrefilled = isEditingCashTendered ? draftTenderedAutoPrefilled : draftAmountAutoPrefilled;
    const setNumpadAutoPrefilled = isEditingCashTendered ? setDraftTenderedAutoPrefilled : setDraftAmountAutoPrefilled;
    const handleNumpadPress = (key: string) => {
      if (key === '⌫') {
        numpadSetter((value) => value.length > 1 ? value.slice(0, -1) : '0');
        setNumpadAutoPrefilled(false);
        return;
      }
      if (key === 'C') {
        numpadSetter('0');
        setNumpadAutoPrefilled(false);
        return;
      }
      if (numpadAutoPrefilled) {
        numpadSetter(key);
        setNumpadAutoPrefilled(false);
        return;
      }
      numpadSetter((value) => {
        const next = value === '0' ? key : value + key;
        return next.length <= 7 ? next : value;
      });
    };
    const predictAmounts = (t: number): number[] => {
      const seen = new Set<number>();
      const out: number[] = [];
      const push = (n: number) => { if (n >= t && !seen.has(n)) { seen.add(n); out.push(n); } };
      const r = (n: number, d: number) => Math.ceil(n / d) * d;
      push(t); push(r(t, 10)); push(r(t, 100)); push(r(t, 500)); push(r(t, 1000));
      return out;
    };
    const cashQuickAmounts = isCashMethod && draftAmountNum > 0
      ? cashEditTarget === 'amount'
        ? [remainingForDraft, ...[100, 200, 500].filter((q) => q < remainingForDraft)].slice(0, 4)
        : predictAmounts(draftAmountNum).slice(0, 4)
      : [];
    const qrQuickAmounts = !isCashMethod && remainingForDraft > 0
      ? [remainingForDraft, ...[100, 200, 500].filter((q) => q < remainingForDraft)].slice(0, 4)
      : [];
    const activeQuickAmounts = isCashMethod ? cashQuickAmounts : qrQuickAmounts;
    const selectDraftMethod = (methodId: string) => {
      const found = paymentOptions.find((opt) => opt.id === methodId) ?? null;
      const nextAmount = remainingForDraft > 0 ? String(remainingForDraft) : '';
      setDraftMethodId(methodId);
      // If a prior row has locked the account group, prefer an account from
      // that group; fall back to the method default if the method has no match.
      const defaultAcc = lockedAccountGroup !== null
        ? (found?.accounts.find((a) => getAccountGroup(a.code) === lockedAccountGroup) ??
           found?.accounts.find((a) => a.id === found.defaultAccountId) ??
           found?.accounts[0] ??
           null)
        : (found?.accounts.find((a) => a.id === found.defaultAccountId) ??
           found?.accounts[0] ??
           null);
      setDraftAccountId(defaultAcc?.id ?? '');
      setDraftAmountInput(nextAmount);
      setDraftTenderedInput(found?.type === 'cash' ? nextAmount : '');
      setDraftAmountAutoPrefilled(nextAmount !== '');
      setDraftTenderedAutoPrefilled(found?.type === 'cash' && nextAmount !== '');
      setCashEditTarget('tendered');
    };
    const addDraftRow = () => {
      if (!canAddRow || !draftMethod || !draftAccount) return;
      const row: PaymentRowDraft = {
        id: crypto.randomUUID(),
        paymentMethodId: draftMethod.id,
        paymentMethodName: draftMethod.name,
        paymentMethodType: draftMethod.type,
        receivingAccountId: draftAccount.id,
        receivingAccountCode: draftAccount.code,
        receivingAccountName: draftAccount.name,
        amount: draftAmountNum,
        amountTendered: isCashMethod ? draftTenderedNum : null,
        changeAmount: isCashMethod ? Math.max(0, draftChange) : null,
        payerLabel: draftPayerLabel.trim(),
      };
      const roundMoney = (value: number) => Math.round(value * 100) / 100;
      const mergeTarget = paymentRowsDraft.find((existing) =>
        existing.paymentMethodId === row.paymentMethodId &&
        existing.receivingAccountId === row.receivingAccountId &&
        existing.paymentMethodType === row.paymentMethodType,
      );

      if (mergeTarget) {
        setPaymentRowsDraft((prev) => prev.map((existing) => {
          if (existing.id !== mergeTarget.id) return existing;
          const mergedAmount = roundMoney(existing.amount + row.amount);
          if (existing.paymentMethodType === 'cash') {
            const mergedTendered = roundMoney((existing.amountTendered ?? existing.amount) + (row.amountTendered ?? row.amount));
            return {
              ...existing,
              amount: mergedAmount,
              amountTendered: mergedTendered,
              changeAmount: Math.max(0, roundMoney(mergedTendered - mergedAmount)),
              payerLabel: existing.payerLabel || row.payerLabel,
            };
          }
          return {
            ...existing,
            amount: mergedAmount,
            payerLabel: existing.payerLabel || row.payerLabel,
          };
        }));
        toast.success('รวมรายการชำระช่องทางเดิมแล้ว');
      } else {
        setPaymentRowsDraft((prev) => [...prev, row]);
      }
      setDraftMethodId('');
      setDraftAccountId('');
      setDraftAmountInput('');
      setDraftTenderedInput('');
      setDraftAmountAutoPrefilled(false);
      setDraftTenderedAutoPrefilled(false);
      setCashEditTarget('tendered');
      setDraftPayerLabel('');
    };
    const confirmDisabled =
      submitting ||
      paymentOptions.length === 0 ||
      paymentRowsDraft.length === 0 ||
      !canConfirmSettlement;

    return (
      <div className="flex h-full min-h-0">
        {TaxInvoicePopup}
        {paymentHistoryDialogOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={() => setPaymentHistoryDialogOpen(false)}>
            <div
              className="flex max-h-[82dvh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-base font-semibold text-foreground">ประวัติชำระบิลนี้</p>
                  <p className="text-xs text-muted-foreground">โต๊ะ {session.table.label} · ชำระแล้ว ฿{paidBeforeSettlement.toLocaleString('th-TH')}</p>
                </div>
                <button
                  type="button"
                  aria-label="ปิดประวัติชำระ"
                  onClick={() => setPaymentHistoryDialogOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-3">
                {priorPaidHistoryAmount > 0 && (
                  <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">ชำระก่อนหน้า</p>
                        <p className="mt-1 text-xs text-muted-foreground">รายละเอียดรอบก่อนหน้ามาจากยอดรวมที่โหลดมากับบิลนี้</p>
                      </div>
                      <p className="text-xl font-bold tabular-nums text-foreground">฿{priorPaidHistoryAmount.toLocaleString('th-TH')}</p>
                    </div>
                  </div>
                )}
                {paymentHistoryEntries.map((entry, index) => (
                  <div key={entry.id} className="rounded-xl border border-border bg-background px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">ชำระครั้งที่ {index + 1}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.methodLabel}{entry.accountLabel ? ` · ${entry.accountLabel}` : ''} · {entry.settlementType === 'partial' ? 'บางส่วน' : 'ปิดบิล'} · {entry.paidAtLabel}
                        </p>
                      </div>
                      <p className="shrink-0 text-xl font-bold tabular-nums text-foreground">฿{entry.amount.toLocaleString('th-TH')}</p>
                    </div>
                    {entry.allocations && entry.allocations.length > 0 && (
                      <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2">
                        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">รายการที่ผูกชำระ</p>
                        <div className="space-y-1">
                          {entry.allocations.map((allocation, allocationIndex) => (
                            <div key={`${entry.id}-${allocationIndex}`} className="flex justify-between gap-3 text-xs">
                              <span className="min-w-0 truncate text-muted-foreground">{allocation.label} ×{allocation.quantity}</span>
                              <span className="shrink-0 tabular-nums font-semibold text-foreground">฿{allocation.amount.toLocaleString('th-TH')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {entry.receipt && (
                        <button
                          type="button"
                          onClick={() => void printPaymentEventReceipt(entry.id, entry.receipt!)}
                          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/50"
                        >
                          พิมพ์ใบนี้
                        </button>
                      )}
                      {lastReceipt && (
                        <button
                          type="button"
                          onClick={() => void (lastPaymentId ? printPaymentEventReceipt(lastPaymentId, lastReceipt) : printReceipt({ type: 'receipt', payment: lastReceipt }))}
                          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/50"
                        >
                          พิมพ์ใบล่าสุด
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!hasPaymentHistorySummary && (
                  <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">ยังไม่มีประวัติชำระสำหรับบิลนี้</p>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Amount entry popup */}
        {amountPopupOpen && !isDraftComplete && (
          <div
            className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-4 sm:items-center"
            onClick={() => setAmountPopupOpen(false)}
          >
            <div
              className="w-full max-w-sm sm:max-w-[640px] rounded-2xl bg-[var(--surface-raised)] border border-border shadow-[var(--shadow-dialog)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <p className="text-lg font-semibold text-foreground">รับชำระ</p>
                  {draftMethod && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {draftMethod.name}{draftAccount ? ` · ${draftAccount.name}` : ''}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="ปิด"
                  onClick={() => setAmountPopupOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Two-column body: left = summary + numpad | right = shortcuts + CTA */}
              <div className="flex flex-col sm:flex-row">

                {/* Left column — amount summary + numpad */}
                <div className="flex flex-col gap-4 flex-1 px-5 pt-4 pb-5 min-w-0">

                  {/* Amount summary */}
                  {isCashMethod ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCashEditTarget('amount')}
                        className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                          cashEditTarget === 'amount'
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-[var(--surface-2)] hover:bg-muted/50'
                        }`}
                      >
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ยอดที่ต้องรับ</span>
                        <span className={`mt-1 block text-xl font-bold tabular-nums leading-none ${cashEditTarget === 'amount' ? 'text-primary' : 'text-foreground'}`}>
                          ฿{draftAmountNum.toLocaleString('th-TH')}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCashEditTarget('tendered')}
                        className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                          cashEditTarget === 'tendered'
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-[var(--surface-2)] hover:bg-muted/50'
                        }`}
                      >
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">รับเงินสด</span>
                        <span className={`mt-1 block text-xl font-bold tabular-nums leading-none ${cashEditTarget === 'tendered' ? 'text-primary' : 'text-foreground'}`}>
                          ฿{draftTenderedNum.toLocaleString('th-TH')}
                        </span>
                      </button>
                      <div className={`col-span-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${
                        draftAmountNum === 0
                          ? 'bg-[var(--surface-2)] text-muted-foreground'
                          : draftChange < 0
                            ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
                            : draftChange === 0
                              ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                              : 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]'
                      }`}>
                        <span>
                          {draftAmountNum === 0 ? 'ใส่ยอดชำระ' : draftChange < 0 ? 'ขาดเงินสด' : draftChange === 0 ? 'พอดี' : 'เงินทอน'}
                        </span>
                        <span className="tabular-nums">
                          {draftAmountNum > 0 && draftChange !== 0 ? `฿${Math.abs(draftChange).toLocaleString('th-TH')}` : ''}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className={`rounded-xl border px-4 py-4 transition-colors ${
                        draftAmountNum > 0 && draftAmountNum === remainingForDraft
                          ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]'
                          : draftAmountNum > remainingForDraft
                            ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]'
                            : 'border-primary bg-primary/5'
                      }`}>
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ยอดที่ต้องรับ</span>
                        <span className={`mt-1 block text-3xl font-bold tabular-nums leading-none ${
                          draftAmountNum > 0 && draftAmountNum === remainingForDraft
                            ? 'text-[var(--status-success-fg)]'
                            : draftAmountNum > remainingForDraft
                              ? 'text-[var(--status-danger-fg)]'
                              : 'text-primary'
                        }`}>
                          ฿{draftAmountNum.toLocaleString('th-TH')}
                        </span>
                      </div>
                      <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${
                        draftAmountNum === 0
                          ? 'bg-[var(--surface-2)] text-muted-foreground'
                          : draftAmountNum === remainingForDraft
                            ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                            : draftAmountNum > remainingForDraft
                              ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
                              : 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                      }`}>
                        <span>
                          {draftAmountNum === 0
                            ? 'ใส่ยอดชำระ'
                            : draftAmountNum === remainingForDraft
                              ? 'พอดี'
                              : draftAmountNum > remainingForDraft
                                ? 'เกินยอด'
                                : 'คงเหลือ'}
                        </span>
                        <span className="tabular-nums">
                          {draftAmountNum > 0 && draftAmountNum !== remainingForDraft
                            ? `฿${Math.abs(remainingForDraft - draftAmountNum).toLocaleString('th-TH')}`
                            : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Numpad */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {(['7','8','9','4','5','6','1','2','3','C','0','⌫'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => handleNumpadPress(k)}
                        className={`rounded-xl text-2xl font-bold transition-all active:scale-[0.92] select-none h-[68px] shadow-sm ${
                          k === 'C'
                            ? 'bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[var(--status-danger-fg)] hover:opacity-80'
                            : k === '⌫'
                              ? 'bg-[var(--surface-2)] border border-border text-foreground hover:bg-muted/70'
                              : 'bg-[var(--surface-1)] border border-border text-foreground hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right column — quick shortcuts + CTA */}
                <div className="flex flex-col gap-3 border-t border-border sm:border-t-0 sm:border-l sm:border-border px-5 pt-4 pb-5 sm:w-[200px]">
                  {activeQuickAmounts.length > 0 && (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ทางลัด</p>
                      <div className="flex flex-col gap-2">
                        {activeQuickAmounts.map((amt) => {
                          const qLabel = isCashMethod && cashEditTarget === 'tendered' && amt === draftAmountNum
                            ? 'พอดี'
                            : amt === remainingForDraft
                              ? 'คงเหลือ'
                              : `฿${amt.toLocaleString('th-TH')}`;
                          return (
                            <button
                              key={amt}
                              type="button"
                              onClick={() => { numpadSetter(String(amt)); setNumpadAutoPrefilled(false); }}
                              className={`w-full rounded-xl border py-3 text-sm font-semibold tabular-nums min-h-[48px] transition-all active:scale-[0.96] ${
                                numpadValue === String(amt)
                                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                  : 'border-border bg-[var(--surface-1)] text-foreground hover:bg-[var(--surface-2)] shadow-sm'
                              }`}
                            >
                              {qLabel}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    disabled={!canAddRow}
                    onClick={() => { addDraftRow(); setAmountPopupOpen(false); }}
                    className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98] min-h-[56px] shadow-[var(--shadow-raised)]"
                  >
                    + เพิ่มรายการชำระ
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Left panel: head selection / secondary details ── */}
        <div className="flex min-h-0 flex-col overflow-hidden p-4 gap-2.5 min-w-0 basis-[46%] shrink-0">

          {/* Header */}
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setView('bill')}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
              ← กลับ
            </button>
            <h2 className="text-sm font-semibold text-foreground">ชำระเงิน — โต๊ะ {session.table.label}</h2>
            {isGroupBill && linkedTableLabels && (
              <span className="rounded-full bg-[var(--status-purple-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--status-purple-fg)]">
                กลุ่ม {[session.table.label, ...linkedTableLabels].join(', ')}
              </span>
            )}
          </div>

          <div className="shrink-0 rounded-xl border border-border bg-muted/30 p-1">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => selectPaymentMode('full')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  paymentMode === 'full'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background hover:text-foreground'
                }`}
              >
                รับชำระเต็ม
              </button>
              <button
                type="button"
                onClick={() => selectPaymentMode('items')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  paymentMode === 'items'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background hover:text-foreground'
                }`}
              >
                รับชำระตามรายการ
              </button>
            </div>
          </div>

          {lastReceipt && (
            <div className="shrink-0 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--status-success-fg)]">ชำระเงินสำเร็จ</p>
                  <p className="text-sm font-bold tabular-nums text-foreground">฿{lastReceipt.total.toLocaleString('th-TH')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void (lastPaymentId ? printPaymentEventReceipt(lastPaymentId, lastReceipt) : printReceipt({ type: 'receipt', payment: lastReceipt }))}
                  className="shrink-0 rounded-lg border border-[var(--status-success-border)] bg-background px-3 py-2 text-xs font-semibold text-[var(--status-success-fg)] hover:bg-[var(--status-success-bg)]"
                >
                  พิมพ์ใบล่าสุด
                </button>
              </div>
            </div>
          )}

          <div className="shrink-0 rounded-xl border border-border bg-card p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {paymentMode === 'full' ? 'รับชำระเต็ม' : 'รับชำระตามรายการ'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {paymentMode === 'full'
                    ? 'รับยอดคงเหลือทั้งหมดและปิดบิล'
                    : 'เลือกรายการคงเหลือที่ต้องการรับชำระในรอบนี้'}
                </p>
              </div>
              <p className="shrink-0 text-right text-lg font-bold tabular-nums text-primary">
                ฿{paymentTargetAmount.toLocaleString('th-TH')}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-muted/50 px-2 py-2">
                <p className="text-[11px] text-muted-foreground">ยอดบิลทั้งหมด</p>
                <p className="text-base font-bold tabular-nums text-foreground">฿{billTotalForSettlement.toLocaleString('th-TH')}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-2 py-2">
                <p className="text-[11px] text-muted-foreground">ชำระแล้ว</p>
                <p className="text-base font-bold tabular-nums text-[var(--status-success-fg)]">฿{paidBeforeSettlement.toLocaleString('th-TH')}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-2 py-2">
                <p className="text-[11px] text-muted-foreground">คงเหลือ</p>
                <p className="text-base font-bold tabular-nums text-[var(--status-danger-fg)]">฿{remainingBeforePayment.toLocaleString('th-TH')}</p>
              </div>
            </div>

            {paymentMode === 'full' ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">เลือกรายการคงเหลือทั้งหมด</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">รวม {remainingHeadTotal} หัว จาก {activeChargeLines.length} รายการ</p>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-primary">฿{remainingBeforePayment.toLocaleString('th-TH')}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="min-h-0 max-h-[230px] overflow-y-auto pr-1 space-y-2">
                  {allChargeLines.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                      {waitingForChargeLines ? 'กำลังโหลดรายการบิล กรุณารอสักครู่' : 'ไม่พบรายการสำหรับบิลนี้'}
                    </p>
                  ) : (
                    allChargeLines.map((line) => {
                      const selectable = !line.voidedAt && line.remainingQuantity > 0;
                      const selectedQty = Math.min(line.remainingQuantity, Math.max(0, selectedHeadQty[line.id] ?? 0));
                      const selectedAmount = selectedQty * line.unitPrice;
                      return (
                        <div
                          key={line.id}
                          className={`rounded-lg border px-3 py-3 ${
                            selectable ? 'border-border bg-background' : 'border-border/60 bg-muted/30 opacity-70'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">{line.label}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                ฿{line.unitPrice.toLocaleString('th-TH')} / หัว · ทั้งหมด {line.quantity} · จ่ายแล้ว {line.allocatedQuantity} · คงเหลือ {line.remainingQuantity}
                                {line.voidedAt ? ' · ยกเลิกแล้ว' : ''}
                              </p>
                              {selectedQty > 0 && (
                                <p className="mt-1 text-xs font-semibold tabular-nums text-primary">
                                  รอบนี้ {selectedQty} หัว = ฿{selectedAmount.toLocaleString('th-TH')}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  aria-label={`ลด ${line.label}`}
                                  disabled={!selectable || selectedQty === 0}
                                  onClick={() => setHeadQuantity(line.id, selectedQty - 1)}
                                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-lg font-bold text-foreground hover:bg-muted/50 disabled:opacity-30"
                                >
                                  −
                                </button>
                                <span className="flex h-10 w-11 items-center justify-center rounded-lg bg-muted text-base font-bold tabular-nums text-foreground">
                                  {selectedQty}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`เพิ่ม ${line.label}`}
                                  disabled={!selectable || selectedQty >= line.remainingQuantity}
                                  onClick={() => setHeadQuantity(line.id, selectedQty + 1)}
                                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                                >
                                  +
                                </button>
                              </div>
                              <div className="mt-1 flex gap-1">
                                <button
                                  type="button"
                                  disabled={!selectable}
                                  onClick={() => setHeadQuantity(line.id, line.remainingQuantity)}
                                  className="min-h-8 flex-1 rounded-lg border border-border px-2 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-30"
                                >
                                  ทั้งหมด
                                </button>
                                <button
                                  type="button"
                                  disabled={!selectable || selectedQty === 0}
                                  onClick={() => setHeadQuantity(line.id, 0)}
                                  className="min-h-8 flex-1 rounded-lg border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-30"
                                >
                                  ล้าง
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {selectedHeadTotal === 0 ? (
                  <p className="text-center text-xs text-[var(--status-warning-fg)]">กรุณาเลือกรายการที่ต้องการรับชำระ</p>
                ) : canFinalHeadSettlement ? (
                  <p className="text-center text-xs font-semibold text-[var(--status-success-fg)]">
                    เลือกรายการคงเหลือครบแล้ว สามารถปิดบิลได้
                  </p>
                ) : allRemainingHeadsSelected ? (
                  <p className="text-center text-xs text-[var(--status-warning-fg)]">
                    เลือกรายการครบแล้ว แต่ยอดยังไม่ตรงกับยอดคงเหลือ ระบบจะรับเป็นบางส่วน
                  </p>
                ) : (
                  <p className="text-center text-xs text-muted-foreground">
                    ยังเลือกรายการไม่ครบทั้งหมด ระบบจะรับชำระบางส่วน
                  </p>
                )}
              </>
            )}
          </div>          {hasPaymentHistorySummary && (
            <div className="shrink-0 rounded-xl border border-border bg-card px-3 py-2.5">
              <button
                type="button"
                onClick={() => setPaymentHistoryDialogOpen(true)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-xs font-semibold text-foreground">ประวัติชำระบิลนี้</span>
                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                  รวม ฿{paidBeforeSettlement.toLocaleString('th-TH')} · ดูรายละเอียด
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentHistoryDialogOpen(true)}
                className="mt-2 block max-h-24 w-full space-y-1.5 overflow-y-auto rounded-lg text-left"
              >
                {priorPaidHistoryAmount > 0 && (
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">ชำระก่อนหน้า</span>
                      <span className="text-sm font-bold tabular-nums text-foreground">฿{priorPaidHistoryAmount.toLocaleString('th-TH')}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">จากข้อมูลบิลนี้</p>
                  </div>
                )}
                {paymentHistoryEntries.slice(-2).map((entry, index) => (
                  <div key={entry.id} className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">ชำระครั้งที่ {paymentHistoryEntries.length - paymentHistoryEntries.slice(-2).length + index + 1}</span>
                      <span className="text-sm font-bold tabular-nums text-foreground">฿{entry.amount.toLocaleString('th-TH')}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {entry.methodLabel}{entry.accountLabel ? ` · ${entry.accountLabel}` : ''} · {entry.settlementType === 'partial' ? 'บางส่วน' : 'ปิดบิล'} · {entry.paidAtLabel}
                    </p>
                  </div>
                ))}
              </button>
            </div>
          )}
          <div className="shrink-0 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2">
            <button
              type="button"
              onClick={() => setPaymentDetailsOpen((value) => !value)}
              className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>รายละเอียดเพิ่มเติม</span>
              <span className="text-[11px]">{paymentDetailsOpen ? 'ซ่อน' : 'เปิด'}</span>
            </button>
            {paymentDetailsOpen && (
              <div className="mt-2 space-y-2">          {/* Discount tiles */}
          {discountTiles.length > 0 && (
            <div className="shrink-0">
              <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-foreground">
                <Tag className="size-3 text-red-400" />ส่วนลด
              </p>
              <div className="flex flex-wrap gap-1.5">
                {discountTiles.map((t) => (
                  <PosTile key={t.id} tile={t} qty={discountQty[t.id] ?? 0}
                    onInc={() => setDiscountQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
                    onDec={() => setDiscountQty((p) => ({ ...p, [t.id]: Math.max(0, (p[t.id] ?? 0) - 1) }))} />
                ))}
              </div>
            </div>
          )}

          {/* Manual discount */}
          <div className="shrink-0">
            <label className="block text-xs font-medium text-muted-foreground mb-1">ส่วนลดเพิ่มเติม (฿)</label>
            <input type="number" min={0} value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground tabular-nums outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
          </div>

          {/* Totals with item breakdown */}
          <div className="hidden">
            <p className="text-xs font-semibold text-muted-foreground mb-2">รายการ</p>
            {/* Guest lines */}
            {guestTiles.filter((t) => (guestQty[t.id] ?? 0) > 0).map((t) => {
              const qty = guestQty[t.id] ?? 0;
              return (
                <div key={t.id} className="flex justify-between text-xs text-muted-foreground pl-2">
                  <span>{t.name} ×{qty}</span>
                  <span className="tabular-nums">฿{(Number(t.price) * qty).toLocaleString('th-TH')}</span>
                </div>
              );
            })}
            {/* Addon lines */}
            {addonTiles.filter((t) => (addonQty[t.id] ?? 0) > 0).map((t) => {
              const qty = addonQty[t.id] ?? 0;
              return (
                <div key={t.id} className="flex justify-between text-xs text-muted-foreground pl-2">
                  <span>{t.name} ×{qty}</span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+฿{(Number(t.price) * qty).toLocaleString('th-TH')}</span>
                </div>
              );
            })}
            {discountTileTotal > 0 && (
              <div className="flex justify-between text-xs text-red-500 dark:text-red-400 pl-2">
                <span>ส่วนลด</span>
                <span className="tabular-nums">−฿{discountTileTotal.toLocaleString('th-TH')}</span>
              </div>
            )}
            {manualDiscountNum > 0 && (
              <div className="flex justify-between text-xs text-red-500 dark:text-red-400 pl-2">
                <span>ส่วนลดเพิ่มเติม</span>
                <span className="tabular-nums">−฿{manualDiscountNum.toLocaleString('th-TH')}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 mt-1 font-bold text-foreground">
              <span className="text-sm font-semibold">ยอดชำระ</span>
              <span className="tabular-nums text-xl">฿{total.toLocaleString('th-TH')}</span>
            </div>
          </div>

          {/* Notes — collapsible */}
          <div className="shrink-0">
            {notesOpen ? (
              <>
                <label className="block text-xs font-medium text-muted-foreground mb-1">หมายเหตุ (ไม่บังคับ)</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="พิมพ์หมายเหตุ..." autoFocus
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
              </>
            ) : (
              <button type="button" onClick={() => setNotesOpen(true)}
                className="w-full text-left rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
                {notes ? `หมายเหตุ: ${notes}` : '+ เพิ่มหมายเหตุ'}
              </button>
            )}
          </div>

          {/* Tax invoice */}
          <button type="button"
            onClick={() => { setTaxForm(taxInvoice ?? { companyName: '', phone: '', taxId: '', address: '' }); setTaxInvoiceOpen(true); }}
            className={`shrink-0 w-full rounded-xl border py-2.5 text-xs font-medium transition-colors ${
              taxInvoice ? 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]' : 'border-border text-foreground hover:bg-muted/50'
            }`}>
            {taxInvoice ? `📄 ${taxInvoice.companyName}` : '+ ออกใบกำกับภาษี'}
          </button>

              </div>
            )}
          </div>
          {/* Helper text */}
          {paymentOptions.length === 0 ? (
            <p className="shrink-0 text-center text-xs text-[var(--status-warning-fg)]">
              ไม่สามารถโหลดช่องทางชำระได้ — กรุณาลองรีเฟรชหน้า
            </p>
          ) : checkoutMode === 'head' && paymentMode === 'items' && selectedHeadTotal === 0 ? (
            <p className="shrink-0 text-center text-xs text-[var(--status-warning-fg)]">
              กรุณาเลือกรายการที่ต้องการรับชำระ
            </p>
          ) : paymentRowsDraft.length === 0 ? (
            <p className="shrink-0 text-center text-xs text-muted-foreground">
              เลือกช่องทางและเพิ่มรายการชำระก่อนยืนยัน
            </p>
          ) : checkoutMode === 'head' && selectedHeadAmountCents > remainingBeforeCents ? (
            <p className="shrink-0 text-center text-xs text-[var(--status-warning-fg)]">
              ยอดรายการที่เลือกมากกว่ายอดคงเหลือ
            </p>
          ) : checkoutMode === 'head' && !isDraftComplete ? (
            <p className="shrink-0 text-center text-xs text-[var(--status-warning-fg)]">
              ยอดรับชำระไม่ตรงกับรายการที่เลือก
            </p>
          ) : checkoutMode === 'manual' && settlementMode === 'partial' && isDraftComplete ? (
            <p className="shrink-0 text-center text-xs text-[var(--status-warning-fg)]">
              ยอดนี้ครบคงเหลือแล้ว กรุณาใช้โหมดปิดบิลทั้งหมด
            </p>
          ) : null}


        </div>

        {/* ── Right panel: payment rows + static numpad ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden border-l border-border bg-[var(--surface-0)] p-4 min-w-0">

          {paymentOptions.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="size-8 text-amber-400" />
              <p className="text-sm font-semibold text-foreground">ไม่สามารถโหลดช่องทางชำระได้</p>
              <p className="text-xs text-muted-foreground">ตรวจสอบการตั้งค่าช่องทางชำระ แล้วลองรีเฟรชหน้า</p>
            </div>
          ) : (
            <>
              {/* Balance summary — simplified to primary operator focus */}
              <div className="shrink-0 rounded-xl bg-[var(--surface-1)] border border-border px-4 py-4 shadow-[var(--shadow-card)]">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">ต้องรับรอบนี้</p>
                <p className={`tabular-nums text-4xl font-bold leading-none ${remainingForDraft > 0 ? 'text-primary' : 'text-[var(--status-success-fg)]'}`}>
                  ฿{remainingForDraft.toLocaleString('th-TH')}
                </p>
                {paymentRowsDraft.length > 0 && draftRowsTotalCents !== paymentTargetCents && (
                  <p className="mt-3 text-center text-xs font-medium text-[var(--status-warning-fg)]">
                    ยอดรับเงินต้องเท่ากับ ฿{paymentTargetAmount.toLocaleString('th-TH')}
                  </p>
                )}
                {isCashMethod && draftChange > 0 && (
                  <div className="mt-3 flex justify-between text-sm font-semibold text-[var(--status-success-fg)]">
                    <span>เงินทอน</span>
                    <span className="tabular-nums">฿{draftChange.toLocaleString('th-TH')}</span>
                  </div>
                )}
              </div>              {isDraftComplete && (
                <div className="shrink-0 rounded-xl bg-[var(--status-success-bg)] border border-[var(--status-success-border)] px-3 py-2 text-center">
                  <p className="text-sm font-semibold text-[var(--status-success-fg)]">ครบยอดแล้ว — กดยืนยันชำระได้เลย</p>
                </div>
              )}

              {/* Method buttons — hidden when complete */}
              {!isDraftComplete && (
                <div className="shrink-0">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2 text-center uppercase tracking-wide">ช่องทางชำระ</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {paymentOptions.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => selectDraftMethod(m.id)}
                        className={`rounded-xl border px-5 py-3 text-sm font-semibold min-h-[52px] min-w-[80px] transition-all active:scale-[0.96] ${
                          draftMethodId === m.id
                            ? 'border-primary bg-primary text-primary-foreground shadow-md'
                            : 'border-border bg-[var(--surface-1)] text-foreground hover:bg-[var(--surface-2)] shadow-sm'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Account buttons — only when method has multiple accounts */}
              {!isDraftComplete && draftMethod && draftMethod.accounts.length > 1 && (
                <div className="shrink-0">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2 text-center uppercase tracking-wide">บัญชีรับเงิน</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {draftMethod.accounts.map((acc) => {
                      const isGroupLocked = lockedAccountGroup !== null && getAccountGroup(acc.code) !== lockedAccountGroup;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          disabled={isGroupLocked}
                          onClick={() => setDraftAccountId(acc.id)}
                          title={isGroupLocked ? 'รอบชำระนี้ล็อกบัญชีกลุ่มเดิมแล้ว' : undefined}
                          className={`rounded-xl border px-5 py-3 text-sm font-semibold min-h-[52px] min-w-[80px] transition-all active:scale-[0.96] ${
                            isGroupLocked
                              ? 'border-border bg-[var(--surface-1)] text-muted-foreground opacity-40 cursor-not-allowed'
                              : draftAccountId === acc.id
                                ? 'border-primary bg-primary text-primary-foreground shadow-md'
                                : 'border-border bg-[var(--surface-1)] text-foreground hover:bg-[var(--surface-2)] shadow-sm'
                          }`}
                        >
                          {acc.name}{acc.accountLast4 ? ` ···${acc.accountLast4}` : ''}
                        </button>
                      );
                    })}
                  </div>
                  {lockedAccountGroup && (
                    <p className="text-[11px] text-amber-600 mt-1.5 text-center">
                      รอบนี้ล็อกบัญชี {lockedAccountGroup.toUpperCase()} — ทุกช่องทางต้องใช้บัญชีเดียวกัน
                    </p>
                  )}
                </div>
              )}

              {/* Enter amount — opens popup */}
              {!isDraftComplete && (
                draftMethodId !== '' ? (
                  <button
                    type="button"
                    onClick={() => setAmountPopupOpen(true)}
                    className="shrink-0 w-full rounded-xl border-2 border-primary bg-primary/5 py-3.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-all active:scale-[0.98] min-h-[52px]"
                  >
                    ใส่ยอดชำระ
                  </button>
                ) : (
                  <p className="shrink-0 text-center text-sm text-muted-foreground py-2">
                    เลือกช่องทางและบัญชีเพื่อใส่ยอดชำระ
                  </p>
                )
              )}

              {/* Draft rows list */}
              {paymentRowsDraft.length > 0 && (
                <div className="min-h-0 max-h-28 overflow-y-auto space-y-1 pr-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">รายการที่เพิ่มแล้ว</p>
                  {paymentRowsDraft.map((row, idx) => (
                    <div key={row.id} className="rounded-lg border border-border bg-card px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                          {idx + 1}. {row.paymentMethodName} · {row.receivingAccountName}
                        </p>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">฿{row.amount.toLocaleString('th-TH')}</span>
                        <button
                          type="button"
                          aria-label={`ลบรายการ ${idx + 1}`}
                          onClick={() => setPaymentRowsDraft((prev) => prev.filter((r) => r.id !== row.id))}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      {row.amountTendered != null && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          รับ ฿{row.amountTendered.toLocaleString('th-TH')} · ทอน ฿{(row.changeAmount ?? 0).toLocaleString('th-TH')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={confirmDisabled}
                className="mt-auto flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40 shadow-[var(--shadow-raised)] min-h-[60px]"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {submitting ? 'กำลังดำเนินการ…' : confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── Split payment view (round-by-round sequential) ── */
  if (view === 'split') {
    const hasRemaining = Object.values(roundRemaining).some((v) => v > 0);
    const roundSubtotal = getRoundSubtotal();
    const roundNumpadNum = Number(roundNumpad) || 0;
    const roundChange = roundMethod === 'cash' ? roundNumpadNum - roundSubtotal : 0;
    // cash_qr computed values (mirrors main payment view)
    const roundCashQrCashNum = Number(roundCashQrCashInput) || 0;
    const roundCashQrQrPortion = roundMethod === 'cash_qr' ? Math.min(roundNumpadNum, roundSubtotal) : 0;
    const roundCashQrCashPortion = roundMethod === 'cash_qr' ? roundSubtotal - roundCashQrQrPortion : 0;
    const roundCashQrChange = roundCashQrCashPortion > 0 ? roundCashQrCashNum - roundCashQrCashPortion : 0;
    const canConfirmRound =
      roundSubtotal > 0 &&
      (roundMethod === 'qr_promptpay' ||
       (roundMethod === 'cash' && roundNumpadNum >= roundSubtotal) ||
       (roundMethod === 'cash_qr' && roundNumpadNum > 0 && (roundCashQrCashPortion === 0 || roundCashQrChange >= 0)));
    const completedTotal = completedRounds.reduce((s, r) => s + r.subtotal, 0);
    const allDone = !hasRemaining;

    const predictRoundAmounts = (t: number): number[] => {
      const seen = new Set<number>();
      const out: number[] = [];
      const push = (n: number) => { if (n >= t && !seen.has(n)) { seen.add(n); out.push(n); } };
      const rd = (n: number, d: number) => Math.ceil(n / d) * d;
      push(t); push(rd(t, 10)); push(rd(t, 100)); push(rd(t, 500)); push(rd(t, 1000));
      return out;
    };
    const roundQuickAmounts = roundSubtotal > 0
      ? (roundMethod === 'cash'
          ? predictRoundAmounts(roundSubtotal)
          : (roundMethod === 'cash_qr' && roundCashQrField === 'cash' && roundCashQrCashPortion > 0)
            ? predictRoundAmounts(roundCashQrCashPortion)
            : [])
      : [];

    function handleConfirmRound() {
      if (!canConfirmRound) return;
      confirmRound();
    }

    // Phase 16B: same synchronous re-entry lock as handleSubmit
    async function handleRoundSubmit() {
      if (completedRounds.length === 0) return;
      if (!allDone) {
        toast.error('กรุณาใช้โหมดรับชำระบางส่วนในหน้าชำระเงินหลัก');
        return;
      }
      if (submitLockRef.current) return;
      submitLockRef.current = true;
      try {
        await submitRoundsAttempt();
      } finally {
        submitLockRef.current = false;
      }
    }

    async function submitRoundsAttempt() {
      setSubmitting(true);

      // Aggregate per-tile quantities from completed rounds
      const partialGuestQty: Record<string, number> = {};
      const partialAddonQty: Record<string, number> = {};
      const guestTileIds = new Set(guestTiles.map((t) => t.id));
      for (const round of completedRounds) {
        for (const item of round.items) {
          if (guestTileIds.has(item.pricingTileId)) {
            partialGuestQty[item.pricingTileId] = (partialGuestQty[item.pricingTileId] ?? 0) + item.qty;
          } else {
            partialAddonQty[item.pricingTileId] = (partialAddonQty[item.pricingTileId] ?? 0) + item.qty;
          }
        }
      }

      const hasCash = completedRounds.some((r) => r.method === 'cash' || r.method === 'cash_qr');
      const hasQr   = completedRounds.some((r) => r.method === 'qr_promptpay' || r.method === 'cash_qr');
      const dbMethod: 'cash' | 'cash_qr' | 'qr_promptpay' =
        hasCash && hasQr ? 'cash_qr' : hasCash ? 'cash' : 'qr_promptpay';
      const cashTotal = completedRounds.reduce(
        (s, r) => s + (r.method === 'cash' ? r.subtotal : r.method === 'cash_qr' ? (r.cashPortion ?? 0) : 0), 0,
      );
      const roundNote = completedRounds
        .map((r, i) => {
          const mLabel = r.method === 'cash' ? 'สด' : r.method === 'cash_qr' ? 'สด+QR' : 'QR';
          return `[รอบ ${i + 1}: ฿${r.subtotal.toLocaleString('th-TH')} ${mLabel}]`;
        })
        .join(' ');
      const accountLabel = bankAccount === 'main' ? 'บัญชี A' : 'บัญชี B';
      const partialNote = !allDone ? `[ชำระบางส่วน]` : '';
      const fullNotes = [
        `[${accountLabel}]`,
        partialNote,
        `[แยกชำระ ${completedRounds.length} รอบ]`,
        roundNote,
      ].filter(Boolean).join(' ');

      // For partial payment, use addon line items from completed rounds only
      const lineItemsToUse = allDone
        ? buildLineItems()
        : addonTiles
            .filter((t) => (partialAddonQty[t.id] ?? 0) > 0)
            .map((t) => ({
              pricingTileId: t.id,
              quantity: partialAddonQty[t.id],
              amount: Number(t.price) * partialAddonQty[t.id],
            }));

      const splitCounter = await incrementReceiptCounter();
      // eslint-disable-next-line react-hooks/purity
      const splitReceiptNo = splitCounter.ok ? splitCounter.receiptNo : Date.now().toString().slice(-8);

      const result = await processPayment({
        sessionId: session.id,
        settlementMode: 'final',
        paymentMethod: dbMethod,
        receivedAmount: cashTotal > 0 ? cashTotal : completedTotal,
        discount: allDone ? manualDiscountNum : 0,
        notes: fullNotes || undefined,
        receiptNo: splitReceiptNo,
        lineItems: lineItemsToUse,
        idempotencyKey: idempotencyKeyRef.current,
      });
      setSubmitting(false);
      if (!result.ok) { toast.error(result.error); return; }
      if (result.data.alreadyProcessed === true) toast.info('รายการชำระนี้ถูกบันทึกแล้ว');
      idempotencyKeyRef.current = nanoid(24);

      const receiptItems: ReceiptData['items'] = completedRounds.flatMap((r) =>
        r.items.map((x) => ({ name: x.name, quantity: x.qty, total: x.price * x.qty })),
      );
      const splitBillType: BillTypeKey = taxInvoice
        ? 'taxInvoice'
        : (bankAccount === 'main' ? 'account:bank_cash_a' : 'account:bank_cash_b');
      const splitFreshRes = await getStoreSettings();
      const splitFresh = splitFreshRes.ok ? splitFreshRes.data : storeSettings;
      const { cfg: splitCfg, ...splitShopInfo } = buildShopInfo(splitBillType, splitFresh);
      const splitHidden = new Set(splitCfg?.hiddenFields ?? []);
      const finalSplitReceiptNo = result.data.receiptNo ?? splitReceiptNo;
      const receipt: ReceiptData = {
        receiptType: 'receipt',
        ...splitShopInfo,
        receiptNo:   splitHidden.has('receiptNo') ? undefined : finalSplitReceiptNo,
        tableNumber: splitHidden.has('tableNo')   ? '' : session.table.label,
        cashierName: splitHidden.has('cashier')   ? '' : cashierName,
        paidAt:      splitHidden.has('date')      ? '' : now(),
        items: receiptItems, subtotal: completedTotal,
        discount: allDone ? manualDiscountNum + discountTileTotal : 0, serviceCharge: 0,
        total: result.data.total,
        receivedAmount: cashTotal > 0 ? cashTotal : completedTotal,
        changeAmount: result.data.changeAmount,
        paymentMethod: METHOD_LABEL[dbMethod],
        sessionId: session.id,
        ...buildSettlementReceiptFields(result.data),
      };
      setLastReceipt(receipt);

      setPaid(true);
      setLastPaymentId(result.data.paymentId);
      setLocalPaymentHistory((prev) => [
        ...prev.filter((p) => p.id !== result.data.paymentId),
        {
          id: result.data.paymentId,
          amount: result.data.total,
          methodLabel: METHOD_LABEL[dbMethod],
          paidAtLabel: paymentHistoryTime(),
          settlementType: result.data.settlementType,
          receipt,
        },
      ]);
    }

    const activeTiles = [...guestTiles, ...addonTiles].filter((t) => (roundRemaining[t.id] ?? 0) > 0);

    return (
      <div className="flex h-full min-h-[480px]">
        {/* ── Left panel ── */}
        <div className="flex-1 flex flex-col overflow-y-auto p-5 gap-3 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setView('payment')}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
              ← กลับ
            </button>
            <h2 className="text-sm font-semibold text-foreground">แยกชำระ — โต๊ะ {session.table.label}</h2>
            {!allDone && (
              <span className="ml-auto text-xs font-medium text-muted-foreground">รอบที่ {completedRounds.length + 1}</span>
            )}
          </div>

          {/* Tile pickers for current round */}
          {!allDone && activeTiles.length > 0 && (
            <div className="shrink-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">เลือกรายการรอบนี้</p>
              <div className="flex flex-wrap gap-1.5">
                {activeTiles.map((t) => {
                  const remaining = roundRemaining[t.id] ?? 0;
                  const selected  = roundSelection[t.id] ?? 0;
                  return (
                    <div
                      key={t.id}
                      className={`relative flex flex-col items-center rounded-xl border-2 p-2 transition-all ${
                        selected > 0 ? 'border-primary bg-primary/5' : 'border-border bg-card'
                      }`}
                      style={{ width: 100, minHeight: 80 }}
                    >
                      {selected > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                          {selected}
                        </span>
                      )}
                      <p className="mt-0.5 text-center text-[11px] font-semibold text-foreground line-clamp-2 w-full leading-tight">{t.name}</p>
                      <p className="text-[11px] font-bold text-muted-foreground">฿{Number(t.price).toLocaleString('th-TH')}</p>
                      <p className="text-[10px] text-muted-foreground">เหลือ {remaining}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <button type="button" aria-label="ลด"
                          onClick={() => adjustRoundItem(t.id, -1)}
                          disabled={selected === 0}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground hover:bg-muted/70 disabled:opacity-30 transition-colors">−</button>
                        <span className="w-5 text-center tabular-nums text-xs font-bold text-foreground">{selected}</span>
                        <button type="button" aria-label="เพิ่ม"
                          onClick={() => adjustRoundItem(t.id, 1)}
                          disabled={selected >= remaining}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed rounds history */}
          {completedRounds.length > 0 && (
            <div className="shrink-0 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">รอบที่ชำระแล้ว</p>
              {completedRounds.map((r, i) => (
                <div key={i}
                  className="flex items-center justify-between rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-foreground">รอบ {i + 1}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {r.items.map((x) => `${x.name} ×${x.qty}`).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold tabular-nums text-[var(--status-success-fg)]">฿{r.subtotal.toLocaleString('th-TH')}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.method === 'cash' ? 'เงินสด' : r.method === 'cash_qr' ? 'เงินสด+QR' : 'QR'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paid / remaining summary when partial */}
          {completedRounds.length > 0 && !allDone && (
            <div className="shrink-0 rounded-xl border border-border bg-card p-3 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">สรุปการชำระ</p>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[var(--status-success-fg)] shrink-0" />
                <span className="text-xs text-foreground flex-1">
                  ชำระแล้ว {completedRounds.reduce((s, r) => s + r.items.reduce((a, x) => a + x.qty, 0), 0)} คน
                </span>
                <span className="text-xs font-semibold tabular-nums text-[var(--status-success-fg)]">฿{completedTotal.toLocaleString('th-TH')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[var(--status-warning-fg)] shrink-0" />
                <span className="text-xs text-foreground flex-1">
                  ยังเหลือ {Object.values(roundRemaining).reduce((a, b) => a + b, 0)} คน
                </span>
                <span className="text-xs font-semibold tabular-nums text-[var(--status-warning-fg)]">
                  ฿{[...guestTiles, ...addonTiles]
                      .reduce((s, t) => s + (roundRemaining[t.id] ?? 0) * Number(t.price), 0)
                      .toLocaleString('th-TH')}
                </span>
              </div>
            </div>
          )}

          {/* Bank account + submit — shown whenever at least one round is done */}
          {completedRounds.length > 0 && (
            <>
              {allDone ? (
                <div className="shrink-0 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3">
                  <p className="text-xs font-medium text-[var(--status-success-fg)]">เก็บครบแล้ว {completedRounds.length} รอบ</p>
                  <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">฿{completedTotal.toLocaleString('th-TH')}</p>
                </div>
              ) : (
                <div className="shrink-0 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3">
                  <p className="text-xs font-medium text-[var(--status-warning-fg)]">
                    เก็บแล้ว {completedRounds.length} รอบ · ยังเหลือ {Object.values(roundRemaining).reduce((a, b) => a + b, 0)} คน
                  </p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">฿{completedTotal.toLocaleString('th-TH')}</p>
                  <p className="text-[10px] text-[var(--status-warning-fg)] mt-0.5">ยืนยันจะชำระเฉพาะรอบที่เก็บแล้ว ส่วนที่เหลือจะถูกยกเลิก</p>
                </div>
              )}
              <div className="shrink-0">
                <p className="mb-1 text-xs font-medium text-muted-foreground">เข้าบัญชี</p>
                <div className="flex gap-1.5">
                  {(['main', 'secondary'] as const).map((acc) => (
                    <button key={acc} type="button" onClick={() => setBankAccount(acc)}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                        bankAccount === acc ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted/50'
                      }`}>
                      {acc === 'main' ? 'บัญชี A' : 'บัญชี B'}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={handleRoundSubmit} disabled={submitting}
                className="shrink-0 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {submitting ? 'กำลังดำเนินการ…' : `ยืนยันชำระ ฿${completedTotal.toLocaleString('th-TH')}`}
              </button>
            </>
          )}
        </div>

        {/* ── Right panel: method + numpad (only when not all done) ── */}
        {!allDone && (
          <div className="flex-1 border-l border-border p-5 flex flex-col gap-3 bg-muted/20">
            {/* Method */}
            <div className="shrink-0">
              <p className="mb-1 text-xs font-medium text-muted-foreground">ช่องทางชำระรอบนี้</p>
              <div className="flex gap-1.5">
                {(['qr_promptpay', 'cash', 'cash_qr'] as const).map((m) => (
                  <button key={m} type="button"
                    onClick={() => {
                      setRoundMethod(m);
                      if (m !== 'qr_promptpay') setRoundNumpad('0');
                      setRoundCashQrField('qr');
                      setRoundCashQrCashInput('0');
                    }}
                    className={`flex-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                      roundMethod === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted/50'
                    }`}>
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            {/* Display — two fields for cash_qr, single for others */}
            {roundMethod === 'cash_qr' ? (
              <div className="shrink-0 space-y-2">
                <button type="button" onClick={() => setRoundCashQrField('qr')}
                  className={`w-full rounded-2xl border px-5 py-3 text-right transition-colors ${
                    roundCashQrField === 'qr' ? 'border-primary ring-2 ring-primary/20 bg-card' : 'border-border bg-card hover:border-primary/40'
                  }`}>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">QR PromptPay</p>
                  <p className="text-3xl font-bold tabular-nums text-foreground leading-none">
                    ฿{roundCashQrQrPortion.toLocaleString('th-TH')}
                  </p>
                </button>
                <button type="button" onClick={() => setRoundCashQrField('cash')}
                  className={`w-full rounded-2xl border px-5 py-3 text-right transition-colors ${
                    roundCashQrField === 'cash' ? 'border-primary ring-2 ring-primary/20 bg-card' : 'border-border bg-card hover:border-primary/40'
                  }`}>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">
                    เงินสด{roundCashQrCashPortion > 0 ? ` — ส่วนลูกค้า ฿${roundCashQrCashPortion.toLocaleString('th-TH')}` : ''}
                  </p>
                  <p className="text-3xl font-bold tabular-nums text-foreground leading-none">
                    ฿{roundCashQrCashNum.toLocaleString('th-TH')}
                  </p>
                  {roundCashQrCashNum > 0 && roundCashQrCashPortion > 0 && (
                    <p className={`text-sm mt-1 tabular-nums font-semibold ${roundCashQrChange >= 0 ? 'text-[var(--status-success-fg)]' : 'text-[var(--status-danger-fg)]'}`}>
                      {roundCashQrChange >= 0 ? `เงินทอน ฿${roundCashQrChange.toLocaleString('th-TH')}` : 'ไม่เพียงพอ'}
                    </p>
                  )}
                </button>
              </div>
            ) : (
              <div className="shrink-0 rounded-xl border border-border bg-card px-3 py-2 text-right">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {roundMethod === 'qr_promptpay' ? 'ยอดชำระ QR' : 'รับเงิน'}
                </p>
                <p className="text-4xl font-bold tabular-nums text-foreground leading-none">
                  ฿{Number(roundNumpad).toLocaleString('th-TH')}
                </p>
                {roundMethod === 'cash' && roundNumpadNum > 0 && (
                  <p className={`text-sm mt-2 tabular-nums font-semibold ${roundChange >= 0 ? 'text-[var(--status-success-fg)]' : 'text-[var(--status-danger-fg)]'}`}>
                    {roundChange >= 0 ? `เงินทอน ฿${roundChange.toLocaleString('th-TH')}` : 'ไม่เพียงพอ'}
                  </p>
                )}
              </div>
            )}

            {/* Numpad — QR disabled (auto-filled); cash_qr switches target by active field */}
            {(() => {
              const roundSetter = roundMethod === 'cash_qr' && roundCashQrField === 'cash'
                ? setRoundCashQrCashInput
                : setRoundNumpad;
              return (
                <div className="flex-1 grid grid-cols-3 gap-1.5 content-start">
                  {(['7','8','9','4','5','6','1','2','3','C','0','⌫'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={roundMethod === 'qr_promptpay'}
                      onClick={() => {
                        if (k === '⌫') roundSetter((v) => v.length > 1 ? v.slice(0, -1) : '0');
                        else if (k === 'C') roundSetter('0');
                        else roundSetter((v) => {
                          const next = v === '0' ? k : v + k;
                          return next.length <= 7 ? next : v;
                        });
                      }}
                      className={`rounded-lg text-base font-bold transition-colors active:scale-95 select-none h-10 ${
                        roundMethod === 'qr_promptpay'
                          ? 'bg-muted/30 border border-border text-muted-foreground/30 cursor-not-allowed'
                          : k === 'C'  ? 'bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[var(--status-danger-fg)] hover:opacity-80' :
                            k === '⌫' ? 'bg-muted border border-border text-foreground hover:bg-muted/70' :
                                         'bg-card border border-border text-foreground hover:bg-muted/50 shadow-sm'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Quick amounts (cash and cash_qr cash field) */}
            {roundQuickAmounts.length > 0 && (roundMethod === 'cash' || (roundMethod === 'cash_qr' && roundCashQrField === 'cash')) && (
              <div className="shrink-0 flex gap-1.5">
                {roundQuickAmounts.map((amt) => {
                  const activeVal = roundMethod === 'cash_qr' ? roundCashQrCashInput : roundNumpad;
                  const activeSetter = roundMethod === 'cash_qr' ? setRoundCashQrCashInput : setRoundNumpad;
                  return (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => activeSetter(String(amt))}
                      className={`flex-1 rounded-xl border py-2.5 text-xs font-semibold tabular-nums transition-colors ${
                        activeVal === String(amt)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:bg-muted/50'
                      }`}
                    >
                      ฿{amt.toLocaleString('th-TH')}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Round total */}
            <div className="shrink-0 rounded-xl bg-muted/50 border border-border px-4 py-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">รอบนี้</span>
                <span className="font-bold tabular-nums text-foreground">฿{roundSubtotal.toLocaleString('th-TH')}</span>
              </div>
            </div>

            {/* Confirm this round */}
            <button type="button" onClick={handleConfirmRound} disabled={!canConfirmRound}
              className="shrink-0 flex w-full items-center justify-center rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {roundSubtotal > 0 ? `เก็บรอบนี้ ฿${roundSubtotal.toLocaleString('th-TH')}` : 'เลือกรายการก่อน'}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── Bill view (default) — mirrors เปิดโต๊ะ pattern ── */
  const selectedGuests = guestTiles.filter((t) => (guestQty[t.id] ?? 0) > 0);
  const selectedAddons = addonTiles.filter((t) => (addonQty[t.id] ?? 0) > 0);
  const totalGuests = guestTiles.reduce((s, t) => s + (guestQty[t.id] ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <p className="text-base font-semibold text-foreground">โต๊ะ {session.table.label}</p>
          {isGroupBill && linkedTableLabels && (
            <p className="text-xs font-medium text-[var(--status-purple-fg)] mt-0.5">
              บิลกลุ่ม · รวมโต๊ะ {[session.table.label, ...linkedTableLabels].join(', ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saving && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />กำลังบันทึก…
            </span>
          )}
          {session.status === 'closing' && (
            <span className="rounded-full bg-[var(--status-danger-bg)] px-3 py-1 text-xs font-semibold text-[var(--status-danger-fg)]">
              รอเรียกเก็บเงิน
            </span>
          )}
        </div>
      </div>

      {/* Content: left tile area + right sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Left: tile pickers */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-5">
          {/* Guest tiles */}
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}>
            {guestTiles.map((t) => (
              <PricingTileCard
                key={t.id}
                tile={t}
                mode="tap"
                size="lg"
                quantity={guestQty[t.id] ?? 0}
                onIncrement={() => setGuestQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
              />
            ))}
          </div>

          {/* Addon tiles */}
          {addonTiles.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">รายการเพิ่มเติม</p>
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}>
                {addonTiles.map((t) => (
                  <PricingTileCard
                    key={t.id}
                    tile={t}
                    mode="tap"
                    size="lg"
                    quantity={addonQty[t.id] ?? 0}
                    onIncrement={() => setAddonQty((p) => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: summary sidebar */}
        <div className="w-80 shrink-0 border-l border-border flex flex-col">
          {/* Summary — scrollable items area */}
          {(() => {
            const editingPosTile = editingSummaryId
              ? (guestTiles.find((t) => t.id === editingSummaryId) ?? addonTiles.find((t) => t.id === editingSummaryId) ?? null)
              : null;
            const editingPosIsAddon = editingSummaryId ? !!addonTiles.find((t) => t.id === editingSummaryId) : false;
            const editingPosQty = editingSummaryId
              ? (editingPosIsAddon ? (addonQty[editingSummaryId] ?? 0) : (guestQty[editingSummaryId] ?? 0))
              : 0;
            const handlePosQtyChange = (newQty: number) => {
              if (!editingSummaryId) return;
              if (editingPosIsAddon) setAddonQty((p) => ({ ...p, [editingSummaryId]: newQty }));
              else setGuestQty((p) => ({ ...p, [editingSummaryId]: newQty }));
              if (newQty === 0) setEditingSummaryId(null);
            };
            return (
              <>
                <div className="flex-1 overflow-y-auto p-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">รายการที่เลือก</p>
                  {selectedGuests.length === 0 && selectedAddons.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center text-center gap-2">
                      <Tag className="size-7 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">แตะ tile เพื่อเพิ่มรายการ</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedGuests.map((t) => {
                        const qty = guestQty[t.id] ?? 0;
                        return (
                          <button key={t.id} type="button" onClick={() => setEditingSummaryId(t.id)}
                            className="w-full rounded-xl bg-card border border-border px-3.5 py-3 text-left hover:bg-muted/50 active:bg-muted transition-colors">
                            <div className="flex items-center justify-between">
                              <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{t.name}</span>
                              <span className="shrink-0 ml-2 text-sm font-bold text-foreground tabular-nums">×{qty}</span>
                            </div>
                            <div className="flex justify-between mt-1">
                              <span className="text-xs text-muted-foreground">฿{Number(t.price).toLocaleString('th-TH')} / คน</span>
                              <span className="text-xs font-semibold text-foreground">฿{(Number(t.price) * qty).toLocaleString('th-TH')}</span>
                            </div>
                          </button>
                        );
                      })}
                      {selectedAddons.map((t) => {
                        const qty = addonQty[t.id] ?? 0;
                        return (
                          <button key={t.id} type="button" onClick={() => setEditingSummaryId(t.id)}
                            className="w-full rounded-xl bg-card border border-border px-3.5 py-3 text-left hover:bg-muted/50 active:bg-muted transition-colors">
                            <div className="flex items-center justify-between">
                              <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{t.name}</span>
                              <span className="shrink-0 ml-2 text-sm font-bold text-foreground tabular-nums">×{qty}</span>
                            </div>
                            <div className="flex justify-between mt-1">
                              <span className="text-xs text-muted-foreground">+฿{Number(t.price).toLocaleString('th-TH')}</span>
                              <span className="text-xs font-semibold text-[var(--status-success-fg)]">฿{(Number(t.price) * qty).toLocaleString('th-TH')}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Quantity edit popup */}
                {editingPosTile && (
                  <>
                    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm" onClick={() => setEditingSummaryId(null)} />
                    <div className="fixed left-1/2 top-1/2 z-[101] w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border p-6 shadow-2xl">
                      <p className="text-center text-base font-semibold text-foreground">{editingPosTile.name}</p>
                      <p className="mt-0.5 text-center text-sm text-muted-foreground">
                        {editingPosIsAddon ? `+฿${Number(editingPosTile.price).toLocaleString('th-TH')}` : `฿${Number(editingPosTile.price).toLocaleString('th-TH')} / คน`}
                      </p>
                      <div className="mt-5 flex items-center justify-center gap-6">
                        <button type="button" aria-label="ลด"
                          onClick={() => handlePosQtyChange(Math.max(0, editingPosQty - 1))}
                          className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl font-bold text-foreground hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)] active:scale-95 transition-all"
                        >−</button>
                        <span className="w-12 text-center text-3xl font-bold tabular-nums text-foreground">{editingPosQty}</span>
                        <button type="button" aria-label="เพิ่ม"
                          onClick={() => handlePosQtyChange(editingPosQty + 1)}
                          className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all"
                        >+</button>
                      </div>
                      <p className="mt-3 text-center text-sm font-semibold text-foreground">
                        รวม ฿{(Number(editingPosTile.price) * editingPosQty).toLocaleString('th-TH')}
                      </p>
                      <button type="button" onClick={() => setEditingSummaryId(null)}
                        className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                      >ปิด</button>
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {/* Sidebar footer: totals + action buttons */}
          <div className="shrink-0 border-t border-border p-4 space-y-3">
            {(totalGuests > 0 || addonTotal > 0) && (
              <div className="space-y-1.5">
                {totalGuests > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">รวมทั้งหมด</span>
                    <span className="font-semibold text-foreground">{totalGuests} คน</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">ยอดรวม</span>
                  <span className="text-xl font-bold tabular-nums text-foreground">฿{subtotalBeforeDiscount.toLocaleString('th-TH')}</span>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={handleSave} disabled={saving}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors">
                <Save className="size-4" />บันทึก
              </button>
              <button type="button" onClick={handlePrint}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
                <Printer className="size-4" />ปริ้นบิล
              </button>
            </div>
            <button type="button" onClick={openPaymentScreen}
              className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
              ชำระเงิน →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
