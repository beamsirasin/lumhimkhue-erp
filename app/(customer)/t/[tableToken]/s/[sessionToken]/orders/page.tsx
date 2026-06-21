import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getSessionData, getSessionOrders } from '@/lib/actions/orders';
import { OrderList } from '@/components/customer/OrderList';

interface Props {
  params: Promise<{ tableToken: string; sessionToken: string }>;
}

export default async function MyOrdersPage({ params }: Props) {
  const { tableToken, sessionToken } = await params;

  const [sessionResult, ordersResult] = await Promise.all([
    getSessionData(tableToken, sessionToken),
    getSessionOrders(sessionToken),
  ]);

  if (!sessionResult.ok) notFound();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 shadow-[var(--shadow-subtle)] backdrop-blur">
        <div className="mx-auto flex max-w-sm items-center gap-3">
          <Link
            href={`/t/${tableToken}/s/${sessionToken}`}
            className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
            aria-label="กลับไปสั่งอาหาร"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Lum Him Khue</p>
            <h1 className="text-base font-semibold text-foreground">รายการที่สั่ง</h1>
          </div>
        </div>
      </header>

      <OrderList
        sessionToken={sessionToken}
        initialOrders={ordersResult.ok ? ordersResult.data : []}
      />
    </div>
  );
}
