'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { getKdsItems, serveGroup } from '@/lib/actions/kds';
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
    refetchInterval: 3_000,
    staleTime: 1_000,
  });

  const { mutate: serve, isPending } = useMutation({
    mutationFn: (itemIds: string[]) => serveGroup({ itemIds }),
    onSuccess: (result) => {
      if (!result.ok) { toast.error(result.error); return; }
      queryClient.invalidateQueries({ queryKey: ['kds-items'] });
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const groups = groupItems(items);
  const visibleGroups =
    activeStation === 'all'
      ? groups
      : groups.filter((g) => g.station === activeStation);

  // count groups per station (not items)
  const stationGroupCount = groups.reduce<Record<string, number>>((acc, g) => {
    acc[g.station] = (acc[g.station] ?? 0) + 1;
    return acc;
  }, {});
  const stationsWithGroups = (Object.keys(STATION_LABEL) as Station[]).filter(
    (s) => (stationGroupCount[s] ?? 0) > 0,
  );

  return (
    <div className="flex h-screen flex-col bg-slate-900">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Kitchen Display</h1>
          <p className="text-xs text-slate-400">{groups.length} ออเดอร์ที่รอเสิร์ฟ</p>
        </div>
        {/* Station tabs */}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setActiveStation('all')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeStation === 'all'
                ? 'bg-white text-slate-900'
                : 'text-slate-400 hover:text-white'
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
                  ? 'bg-white text-slate-900'
                  : 'text-slate-400 hover:text-white'
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
            <p className="text-slate-500">ไม่มีรายการที่รอเสิร์ฟ</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleGroups.map((group) => (
              <div
                key={group.groupKey}
                className="flex flex-col overflow-hidden rounded-xl border-2 border-amber-300 bg-amber-50"
              >
                {/* Card header */}
                <div className="flex items-center justify-between px-4 py-3 bg-amber-100 border-b border-amber-200">
                  <div>
                    <p className="text-base font-bold text-slate-900">
                      โต๊ะ {group.tableNumber}
                    </p>
                    <p className="text-xs font-medium text-amber-700">
                      {STATION_LABEL[group.station]}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 text-right">
                    {formatDistanceToNowStrict(group.orderedAt, {
                      locale: th,
                      addSuffix: true,
                    })}
                  </p>
                </div>

                {/* Item list */}
                <ul className="flex-1 divide-y divide-amber-100 px-3 py-2">
                  {group.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2.5 py-2">
                      {/* Thumbnail */}
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt={item.menuItemName}
                          className="h-10 w-10 rounded-md object-cover shrink-0 border border-amber-200"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-amber-200 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight text-slate-900 truncate">
                          {item.menuItemName}
                        </p>
                        {item.notes && (
                          <p className="mt-0.5 text-xs text-slate-500 truncate">{item.notes}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-lg font-bold tabular-nums text-slate-800">
                        ×{item.quantity}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Serve button */}
                <div className="px-3 pb-3">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => serve(group.items.map((i) => i.id))}
                    className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 transition-colors"
                  >
                    เสิร์ฟ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
