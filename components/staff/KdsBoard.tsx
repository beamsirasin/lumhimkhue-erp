'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChefHat, Clock, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getKdsItems, serveGroup, cancelGroup } from '@/lib/actions/kds';
import type { KdsItem } from '@/lib/actions/kds';
import { cn } from '@/lib/utils';

type Station = KdsItem['station'];

const STATION_LABEL: Record<Station, string> = {
  meat: 'เนื้อสัตว์',
  seafood: 'อาหารทะเล',
  vegetable: 'ผัก',
  noodle: 'เส้น',
  dessert: 'ของหวาน',
  drink: 'เครื่องดื่ม',
  sauce: 'ซอส',
};

const STATION_ORDER: Record<Station, number> = {
  meat: 0,
  seafood: 1,
  vegetable: 2,
  noodle: 3,
  drink: 4,
  dessert: 5,
  sauce: 6,
};

interface KdsGroup {
  groupKey: string;
  orderId: string;
  tableNumber: string;
  station: Station;
  orderedAt: Date;
  items: KdsItem[];
}

function groupItems(items: KdsItem[]): KdsGroup[] {
  const map = new Map<string, KdsGroup>();
  for (const item of items) {
    const key = `${item.orderId}__${item.station}`;
    if (!map.has(key)) {
      map.set(key, {
        groupKey: key,
        orderId: item.orderId,
        tableNumber: item.tableNumber,
        station: item.station,
        orderedAt: new Date(item.orderedAt),
        items: [],
      });
    }
    map.get(key)!.items.push(item);
  }
  return [...map.values()].sort((a, b) => {
    const timeDiff = a.orderedAt.getTime() - b.orderedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    const tableCompare = a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true });
    if (tableCompare !== 0) return tableCompare;
    return STATION_ORDER[a.station] - STATION_ORDER[b.station];
  });
}

const LATE_SEC = 600;

function formatElapsedClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const CARD_TONE = {
  waiting: {
    card: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    header: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    accent: 'text-[var(--status-warning-fg)]',
    media: 'border-[var(--status-warning-border)] bg-card',
    divide: 'divide-[var(--status-warning-border)]/45',
  },
  late: {
    card: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]',
    header: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]',
    accent: 'text-[var(--status-danger-fg)]',
    media: 'border-[var(--status-danger-border)] bg-card',
    divide: 'divide-[var(--status-danger-border)]/45',
  },
} as const;

const KdsCard = memo(function KdsCard({
  group,
  isPending,
  onServe,
  onCancel,
}: {
  group: KdsGroup;
  isPending: boolean;
  onServe: () => void;
  onCancel: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const tick = () =>
      setSeconds(Math.floor((Date.now() - group.orderedAt.getTime()) / 1000));
    tick(); // sync immediately after hydration
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [group.orderedAt]);

  const isLate = seconds >= LATE_SEC;
  const tone = isLate ? CARD_TONE.late : CARD_TONE.waiting;

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl border-2 shadow-[var(--shadow-card)]', tone.card)}>
      {/* Card header */}
      <div className={cn('flex items-center justify-between border-b px-3 py-2.5', tone.header)}>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">โต๊ะ {group.tableNumber}</p>
          <p className={cn('mt-0.5 text-[11px] font-semibold', tone.accent)}>
            {STATION_LABEL[group.station]}
          </p>
        </div>
        <div className="ml-3 shrink-0 text-right">
          <p className={cn('inline-flex items-center gap-1 text-sm font-bold tabular-nums', tone.accent)}>
            <Clock className="size-3.5" />
            {formatElapsedClock(seconds)}
          </p>
          {isLate && (
            <p className="mt-0.5 text-[11px] font-bold text-[var(--status-danger-fg)]">เสิร์ฟช้า</p>
          )}
        </div>
      </div>

      {/* Item list */}
      <ul className={cn('flex-1 divide-y px-2 py-1', tone.divide)}>
        {group.items.map((item) => (
          <li key={item.id} className="flex items-center gap-1.5 py-1.5">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.menuItemName}
                className={cn('h-7 w-7 shrink-0 rounded border object-cover', tone.media)}
              />
            ) : (
              <div className={cn('h-7 w-7 shrink-0 rounded border', tone.media)} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-tight text-foreground">
                {item.menuItemName}
              </p>
              {item.notes && (
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.notes}</p>
              )}
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
              ×{item.quantity}
            </span>
          </li>
        ))}
      </ul>

      {/* Action buttons */}
      <div className="flex gap-1.5 px-2 pb-2">
        <button
          type="button"
          disabled={isPending}
          onClick={onServe}
          className="flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] py-2 text-xs font-bold text-[var(--status-success-fg)] transition-colors hover:border-[var(--status-success-fg)] disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          เสิร์ฟ
        </button>
        {confirming ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => { setConfirming(false); onCancel(); }}
            className="min-h-10 flex-1 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] py-2 text-xs font-bold text-[var(--status-danger-fg)] transition-colors hover:border-[var(--status-danger-fg)] disabled:opacity-50"
          >
            ยืนยัน?
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirming(true)}
            onBlur={() => setConfirming(false)}
            className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-border/70 px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[var(--status-danger-border)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)] disabled:opacity-50"
          >
            <XCircle className="size-3.5" />
            ยกเลิก
          </button>
        )}
      </div>
    </div>
  );
});

interface KdsBoardProps {
  initialItems: KdsItem[];
}

export function KdsBoard({ initialItems }: KdsBoardProps) {
  const [activeStation, setActiveStation] = useState<Station | 'all'>('all');
  // Only the card being acted on shows a pending state — other cards stay usable
  const [pendingGroupKey, setPendingGroupKey] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: items = [] } = useQuery({
    queryKey: ['kds-items'],
    queryFn: () => getKdsItems().then((r) => (r.ok ? r.data : [])),
    initialData: initialItems,
    refetchInterval: 3_000,
    staleTime: 1_000,
  });

  const { mutate: serve } = useMutation({
    mutationFn: ({ itemIds }: { groupKey: string; itemIds: string[] }) => serveGroup({ itemIds }),
    onSuccess: (result) => {
      if (!result.ok) { toast.error(result.error); return; }
      queryClient.invalidateQueries({ queryKey: ['kds-items'] });
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
    onSettled: () => setPendingGroupKey(null),
  });

  const { mutate: cancel } = useMutation({
    mutationFn: ({ itemIds }: { groupKey: string; itemIds: string[] }) => cancelGroup({ itemIds }),
    onSuccess: (result) => {
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('ยกเลิกออเดอร์แล้ว');
      queryClient.invalidateQueries({ queryKey: ['kds-items'] });
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
    onSettled: () => setPendingGroupKey(null),
  });

  const groups = useMemo(() => groupItems(items), [items]);
  const visibleGroups = useMemo(
    () => activeStation === 'all' ? groups : groups.filter((g) => g.station === activeStation),
    [groups, activeStation],
  );

  const stationGroupCount = useMemo(
    () => groups.reduce<Record<string, number>>((acc, g) => {
      acc[g.station] = (acc[g.station] ?? 0) + 1;
      return acc;
    }, {}),
    [groups],
  );
  const stationsWithGroups = useMemo(
    () => (Object.keys(STATION_LABEL) as Station[]).filter((s) => (stationGroupCount[s] ?? 0) > 0),
    [stationGroupCount],
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-3 shadow-[var(--shadow-subtle)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <ChefHat className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">Kitchen Display</h1>
            <p className="text-xs text-muted-foreground">{groups.length} ออเดอร์ที่รอเสิร์ฟ</p>
          </div>
        </div>
        {/* Station tabs */}
        <div className="flex items-center justify-end gap-1.5 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => setActiveStation('all')}
            className={cn(
              'min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              activeStation === 'all'
                ? 'border-primary/30 bg-primary text-primary-foreground shadow-[var(--shadow-subtle)]'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            ทั้งหมด
            {groups.length > 0 && (
              <span className="ml-1.5 tabular-nums">({groups.length})</span>
            )}
          </button>
          {stationsWithGroups.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActiveStation(s)}
              className={cn(
                'min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                activeStation === s
                  ? 'border-primary/30 bg-primary text-primary-foreground shadow-[var(--shadow-subtle)]'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {STATION_LABEL[s]}
              <span className="ml-1.5 tabular-nums">({stationGroupCount[s]})</span>
            </button>
          ))}
        </div>
      </header>

      {/* Cards */}
      <main className="flex-1 overflow-y-auto p-4">
        {visibleGroups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex min-h-40 min-w-72 flex-col items-center justify-center rounded-xl border border-border bg-card px-8 py-6 text-center shadow-[var(--shadow-card)]">
              <ChefHat className="size-9 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">ไม่มีรายการที่รอเสิร์ฟ</p>
              <p className="mt-1 text-xs text-muted-foreground">ครัวยังไม่มีออเดอร์ใหม่</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {visibleGroups.map((group) => (
              <KdsCard
                key={group.groupKey}
                group={group}
                isPending={pendingGroupKey === group.groupKey}
                onServe={() => {
                  if (pendingGroupKey) return;
                  setPendingGroupKey(group.groupKey);
                  serve({ groupKey: group.groupKey, itemIds: group.items.map((i) => i.id) });
                }}
                onCancel={() => {
                  if (pendingGroupKey) return;
                  setPendingGroupKey(group.groupKey);
                  cancel({ groupKey: group.groupKey, itemIds: group.items.map((i) => i.id) });
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
