'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getKdsItems, serveGroup, cancelGroup } from '@/lib/actions/kds';
import type { KdsItem } from '@/lib/actions/kds';

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

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border-2 ${
      isLate ? 'border-red-400 bg-red-50' : 'border-amber-300 bg-amber-50'
    }`}>
      {/* Card header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${
        isLate ? 'bg-red-100 border-red-200' : 'bg-amber-100 border-amber-200'
      }`}>
        <div>
          <p className="text-sm font-bold text-foreground">โต๊ะ {group.tableNumber}</p>
          <p className={`text-[11px] font-medium ${isLate ? 'text-red-700' : 'text-amber-700'}`}>
            {STATION_LABEL[group.station]}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[10px] tabular-nums font-semibold ${isLate ? 'text-red-600' : 'text-amber-600'}`}>
            {seconds}s
          </p>
          {isLate && (
            <p className="text-[9px] font-bold text-red-500">เสิร์ฟช้า</p>
          )}
        </div>
      </div>

      {/* Item list */}
      <ul className={`flex-1 divide-y px-2 py-1 ${isLate ? 'divide-red-100' : 'divide-amber-100'}`}>
        {group.items.map((item) => (
          <li key={item.id} className="flex items-center gap-1.5 py-1.5">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.menuItemName}
                className={`h-7 w-7 rounded object-cover shrink-0 border ${
                  isLate ? 'border-red-200' : 'border-amber-200'
                }`}
              />
            ) : (
              <div className={`h-7 w-7 rounded shrink-0 ${isLate ? 'bg-red-200' : 'bg-amber-200'}`} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-tight text-foreground truncate">
                {item.menuItemName}
              </p>
              {item.notes && (
                <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{item.notes}</p>
              )}
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
              ×{item.quantity}
            </span>
          </li>
        ))}
      </ul>

      {/* Action buttons */}
      <div className="px-2 pb-2 flex gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={onServe}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors"
        >
          {isPending && <Loader2 className="size-3 animate-spin" />}
          เสิร์ฟ
        </button>
        {confirming ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => { setConfirming(false); onCancel(); }}
            className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            ยืนยัน?
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirming(true)}
            onBlur={() => setConfirming(false)}
            className="rounded-lg border border-border/60 px-2.5 py-2 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600 disabled:opacity-50 transition-colors"
          >
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
  const queryClient = useQueryClient();

  const { data: items = [] } = useQuery({
    queryKey: ['kds-items'],
    queryFn: () => getKdsItems().then((r) => (r.ok ? r.data : [])),
    initialData: initialItems,
    initialDataUpdatedAt: Date.now(),
    refetchInterval: 3_000,
    staleTime: 1_000,
  });

  const { mutate: serve, isPending: isServing } = useMutation({
    mutationFn: (itemIds: string[]) => serveGroup({ itemIds }),
    onSuccess: (result) => {
      if (!result.ok) { toast.error(result.error); return; }
      queryClient.invalidateQueries({ queryKey: ['kds-items'] });
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const { mutate: cancel, isPending: isCancelling } = useMutation({
    mutationFn: (itemIds: string[]) => cancelGroup({ itemIds }),
    onSuccess: (result) => {
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('ยกเลิกออเดอร์แล้ว');
      queryClient.invalidateQueries({ queryKey: ['kds-items'] });
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const isPending = isServing || isCancelling;

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
    <div className="flex h-screen flex-col" style={{ background: 'oklch(0.11 0.015 248)' }}>
      {/* Top bar */}
      <header className="flex items-center justify-between border-b px-6 py-3" style={{ borderColor: 'oklch(0.25 0.03 248)', background: 'oklch(0.15 0.02 248)' }}>
        <div>
          <h1 className="text-lg font-semibold text-white">Kitchen Display</h1>
          <p className="text-xs text-muted-foreground">{groups.length} ออเดอร์ที่รอเสิร์ฟ</p>
        </div>
        {/* Station tabs */}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setActiveStation('all')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeStation === 'all'
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:text-white/80'
            }`}
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
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeStation === s
                  ? 'bg-card text-foreground'
                  : 'text-muted-foreground hover:text-white/80'
              }`}
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
            <p className="text-muted-foreground">ไม่มีรายการที่รอเสิร์ฟ</p>
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-4">
            {visibleGroups.map((group) => (
              <KdsCard
                key={group.groupKey}
                group={group}
                isPending={isPending}
                onServe={() => serve(group.items.map((i) => i.id))}
                onCancel={() => cancel(group.items.map((i) => i.id))}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
