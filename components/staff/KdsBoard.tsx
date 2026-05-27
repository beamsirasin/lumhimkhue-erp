'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { getKdsItems, updateItemStatus } from '@/lib/actions/kds';
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

const STATUS_CONFIG = {
  pending: {
    card: 'border-amber-300 bg-amber-50',
    badge: 'bg-amber-100 text-amber-800',
    label: 'รอทำ',
    nextStatus: 'preparing' as const,
    actionLabel: 'เริ่มทำ',
    actionClass: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
  preparing: {
    card: 'border-blue-300 bg-blue-50',
    badge: 'bg-blue-100 text-blue-800',
    label: 'กำลังทำ',
    nextStatus: 'ready' as const,
    actionLabel: 'พร้อมเสิร์ฟ',
    actionClass: 'bg-green-600 hover:bg-green-700 text-white',
  },
  ready: {
    card: 'border-green-300 bg-green-50',
    badge: 'bg-green-100 text-green-800',
    label: 'พร้อมแล้ว',
    nextStatus: 'served' as const,
    actionLabel: 'เสิร์ฟแล้ว',
    actionClass: 'bg-slate-600 hover:bg-slate-700 text-white',
  },
} as const;

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

  const { mutate: advance, isPending } = useMutation({
    mutationFn: (vars: { itemId: string; status: 'preparing' | 'ready' | 'served' }) =>
      updateItemStatus(vars),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['kds-items'] });
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const visibleItems =
    activeStation === 'all' ? items : items.filter((i) => i.station === activeStation);

  const stationCounts = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.station] = (acc[i.station] ?? 0) + 1;
    return acc;
  }, {});

  const stationsWithItems = (Object.keys(STATION_LABEL) as Station[]).filter(
    (s) => (stationCounts[s] ?? 0) > 0,
  );

  return (
    <div className="flex h-screen flex-col bg-slate-900">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Kitchen Display</h1>
          <p className="text-xs text-slate-400">{items.length} รายการที่รอดำเนินการ</p>
        </div>
        {/* Station tabs */}
        <div className="flex items-center gap-1.5">
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
            {items.length > 0 && (
              <span className="ml-1.5 tabular-nums">({items.length})</span>
            )}
          </button>
          {stationsWithItems.map((s) => (
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
              <span className="ml-1.5 tabular-nums">({stationCounts[s]})</span>
            </button>
          ))}
        </div>
      </header>

      {/* Cards */}
      <main className="flex-1 overflow-y-auto p-4">
        {visibleItems.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-slate-500">ไม่มีรายการที่รอดำเนินการ</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleItems.map((item) => {
              const cfg = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG];
              if (!cfg) return null;
              return (
                <div
                  key={item.id}
                  className={`flex flex-col rounded-lg border-2 p-3 ${cfg.card}`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-base font-bold tabular-nums text-slate-900">
                      โต๊ะ {item.tableNumber}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                  </div>

                  {/* Station */}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {STATION_LABEL[item.station]}
                  </p>

                  {/* Item name + qty */}
                  <p className="mt-2 flex-1 text-sm font-semibold leading-snug text-slate-900">
                    {item.menuItemName}
                  </p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
                    ×{item.quantity}
                  </p>

                  {/* Notes */}
                  {item.notes && (
                    <p className="mt-1 rounded bg-white/60 px-2 py-1 text-xs text-slate-600">
                      {item.notes}
                    </p>
                  )}

                  {/* Elapsed time */}
                  <p className="mt-2 text-xs text-slate-500">
                    {formatDistanceToNowStrict(new Date(item.orderedAt), {
                      locale: th,
                      addSuffix: true,
                    })}
                  </p>

                  {/* Action button */}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      advance({ itemId: item.id, status: cfg.nextStatus })
                    }
                    className={`mt-3 w-full rounded-md py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${cfg.actionClass}`}
                  >
                    {cfg.actionLabel}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
