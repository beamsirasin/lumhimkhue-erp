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
  pending:   'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  preparing: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
  ready:     'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
  served:    'bg-muted/50 text-muted-foreground',
  cancelled: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
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
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">ยังไม่มีรายการสั่ง</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {data.map((order) => (
        <div key={order.id} className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted/30 border-b border-border flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {format(new Date(order.createdAt), 'HH:mm', { locale: th })}
            </span>
            <span className="text-xs text-muted-foreground">{order.items.length} รายการ</span>
          </div>
          <ul className="divide-y divide-border/30">
            {order.items.map((item) => (
              <li key={item.id} className="px-4 py-3 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.menuItem?.name ?? item.itemName ?? '-'}
                  </p>
                  {item.notes && (
                    <p className="text-xs text-muted-foreground truncate">{item.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm tabular-nums text-muted-foreground">×{item.quantity}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${ITEM_STATUS_COLOR[item.status] ?? 'bg-muted/50 text-muted-foreground'}`}
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
