import { notFound } from 'next/navigation';
import Link from 'next/link';
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
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <Link
          href={`/t/${tableToken}/s/${sessionToken}`}
          className="text-slate-500 hover:text-slate-700 text-sm"
          aria-label="กลับไปสั่งอาหาร"
        >
          ←
        </Link>
        <h1 className="text-base font-medium text-slate-900">รายการที่สั่ง</h1>
      </header>

      <OrderList
        sessionToken={sessionToken}
        initialOrders={ordersResult.ok ? ordersResult.data : []}
      />
    </div>
  );
}
