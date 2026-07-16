'use client';

import { useQuery } from '@tanstack/react-query';
import { formatThaiTime } from '@/lib/date-time';
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
  pending:   'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border-[var(--status-warning-border)]',
  preparing: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
  ready:     'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
  served:    'bg-muted/50 text-muted-foreground border-border',
  cancelled: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] border-[var(--status-danger-border)]',
};

const ITEM_STATUS_DOT: Record<string, string> = {
  pending:   'bg-[var(--status-warning-fg)]',
  preparing: 'bg-[var(--status-info-fg)]',
  ready:     'bg-[var(--status-success-fg)]',
  served:    'bg-muted-foreground/50',
  cancelled: 'bg-[var(--status-danger-fg)]',
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
    <div className="space-y-4 p-4">
      {data.map((order) => (
        <div
          key={order.id}
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">สั่งเมื่อ</p>
              <p className="text-sm font-semibold text-foreground">
                {formatThaiTime(order.createdAt)}
              </p>
            </div>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
              {order.items.length} รายการ
            </span>
          </div>

          <ul className="px-4 py-2">
            {order.items.map((item, index) => (
              <li key={item.id} className="relative flex gap-3 py-3">
                <div className="relative flex w-5 shrink-0 justify-center">
                  {index < order.items.length - 1 && (
                    <span className="absolute bottom-0 top-7 w-px bg-border" aria-hidden="true" />
                  )}
                  <span
                    className={`mt-1 size-3 rounded-full ring-4 ring-card ${ITEM_STATUS_DOT[item.status] ?? 'bg-muted-foreground/50'}`}
                    aria-hidden="true"
                  />
                </div>

                <div className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-tight text-foreground">
                        {item.menuItem?.name ?? item.itemName ?? '-'}
                      </p>
                      {item.notes && (
                        <p className="mt-1 text-xs leading-snug text-muted-foreground">{item.notes}</p>
                      )}
                    </div>

                    <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                      ×{item.quantity}
                    </span>
                  </div>

                  <div className="mt-2 flex justify-end">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${ITEM_STATUS_COLOR[item.status] ?? 'bg-muted/50 text-muted-foreground border-border'}`}
                    >
                      {ITEM_STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
