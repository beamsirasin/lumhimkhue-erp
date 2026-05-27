'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { getSessionOrders } from '@/lib/actions/orders';
import type { SessionOrdersData } from '@/lib/actions/orders';

const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: 'รอครัว',
  preparing: 'กำลังทำ',
  ready: 'พร้อมเสิร์ฟ',
  served: 'เสิร์ฟแล้ว',
  cancelled: 'ยกเลิก',
};

const ITEM_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  preparing: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  served: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-red-100 text-red-500',
};

interface OrderListProps {
  sessionToken: string;
  initialOrders: SessionOrdersData;
}

export function OrderList({ sessionToken, initialOrders }: OrderListProps) {
  const { data } = useQuery({
    queryKey: ['session-orders', sessionToken],
    queryFn: () => getSessionOrders(sessionToken).then((r) => (r.ok ? r.data : [])),
    initialData: initialOrders,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <p className="text-sm">ยังไม่มีรายการสั่ง</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {data.map((order) => (
        <div key={order.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <span className="text-xs text-slate-500">
              {format(new Date(order.createdAt), 'HH:mm', { locale: th })}
            </span>
            <span className="text-xs text-slate-500">{order.items.length} รายการ</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {order.items.map((item) => (
              <li key={item.id} className="px-4 py-3 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {item.menuItem.name}
                  </p>
                  {item.notes && (
                    <p className="text-xs text-slate-400 truncate">{item.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm tabular-nums text-slate-600">×{item.quantity}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${ITEM_STATUS_COLOR[item.status] ?? 'bg-slate-100 text-slate-500'}`}
                  >
                    {ITEM_STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
