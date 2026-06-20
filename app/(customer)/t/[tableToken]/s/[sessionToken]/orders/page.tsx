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
      <header className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <Link
          href={`/t/${tableToken}/s/${sessionToken}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="กลับไปสั่งอาหาร"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="text-base font-medium text-foreground">รายการที่สั่ง</h1>
      </header>

      <OrderList
        sessionToken={sessionToken}
        initialOrders={ordersResult.ok ? ordersResult.data : []}
      />
    </div>
  );
}
