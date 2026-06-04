'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import {
  Package,
  AlertTriangle,
  ShoppingBag,
  TrendingUp,
  ClipboardList,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { getInventoryDashboard, type InventoryDashboardData } from '@/lib/actions/inventory';

interface Props {
  initialData: InventoryDashboardData;
  initialDataUpdatedAt: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง',
  ordered: 'ยืนยันแล้ว',
  received: 'รับของแล้ว',
  cancelled: 'ยกเลิก',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  ordered: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

function fmt(n: string | number) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'd MMM yyyy', { locale: th }); }
  catch { return d; }
}

export function InventoryDashboard({ initialData, initialDataUpdatedAt }: Props) {
  const { data = initialData } = useQuery({
    queryKey: ['inventory-dashboard'],
    queryFn: async () => {
      const r = await getInventoryDashboard();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData,
    initialDataUpdatedAt,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">ภาพรวมสต็อก</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Package className="size-5 text-slate-600" />}
          label="วัตถุดิบทั้งหมด"
          value={String(data.totalIngredients)}
          unit="รายการ"
          bg="bg-slate-50"
        />
        <StatCard
          icon={<AlertTriangle className="size-5 text-red-500" />}
          label="ต่ำกว่าจุดสั่งซื้อ"
          value={String(data.lowStockCount)}
          unit="รายการ"
          bg={data.lowStockCount > 0 ? 'bg-red-50' : 'bg-slate-50'}
          valueColor={data.lowStockCount > 0 ? 'text-red-600' : 'text-slate-900'}
        />
        <StatCard
          icon={<ShoppingBag className="size-5 text-blue-500" />}
          label="PO รอรับของ"
          value={String(data.pendingOrders)}
          unit="รายการ"
          bg={data.pendingOrders > 0 ? 'bg-blue-50' : 'bg-slate-50'}
          valueColor={data.pendingOrders > 0 ? 'text-blue-600' : 'text-slate-900'}
        />
        <StatCard
          icon={<TrendingUp className="size-5 text-green-500" />}
          label="ยอดสั่งซื้อเดือนนี้"
          value={`฿${Number(data.monthlySpend).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          bg="bg-green-50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low stock items */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" />
              <h2 className="text-sm font-semibold text-slate-900">ต้องสั่งซื้อ</h2>
              {data.lowStockItems.length > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                  {data.lowStockItems.length}
                </span>
              )}
            </div>
            <Link
              href="/inventory/count"
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              นับสต็อก →
            </Link>
          </div>

          {data.lowStockItems.length === 0 ? (
            <div className="py-10 text-center">
              <Package className="mx-auto size-7 text-slate-300 mb-1" />
              <p className="text-sm text-slate-400">สต็อกปกติ ไม่มีรายการวิกฤต</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {data.lowStockItems.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <AlertTriangle className="size-3.5 text-red-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.ingredient.name}</p>
                    <p className="text-xs text-slate-500">
                      มี {Number(item.quantityOnHand).toLocaleString('th-TH')} {item.unit}
                      {' '}/ ต้องมี {Number(item.ingredient.minStock).toLocaleString('th-TH')} {item.unit}
                    </p>
                  </div>
                  {item.ingredient.defaultSupplier && (
                    <span className="text-xs text-slate-400 shrink-0 max-w-[100px] truncate">
                      {item.ingredient.defaultSupplier.name}
                    </span>
                  )}
                </div>
              ))}
              {data.lowStockItems.length > 8 && (
                <div className="px-4 py-2 text-xs text-slate-400">…อีก {data.lowStockItems.length - 8} รายการ</div>
              )}
            </div>
          )}

          {data.lowStockItems.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-3">
              <Link
                href="/inventory/orders/new"
                className="text-sm font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1"
              >
                สร้างใบสั่งซื้อจากรายการนี้
                <ChevronRight className="size-4" />
              </Link>
            </div>
          )}
        </div>

        {/* Right column: stock history + recent PO */}
        <div className="space-y-6">
          {/* Stock count history */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <ClipboardList className="size-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-900">ประวัตินับสต็อก 7 วัน</h2>
              </div>
              <Link
                href="/inventory/count"
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                นับวันนี้ →
              </Link>
            </div>

            {data.countHistory.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">ยังไม่มีการนับสต็อก</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {data.countHistory.map((count) => (
                  <div key={count.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        {fmtDate(count.countDate)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {count.countedByUser.name} • {count.items.length} รายการ
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      count.status === 'submitted' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {count.status === 'submitted' ? 'ส่งแล้ว' : 'ร่าง'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent POs */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <ShoppingBag className="size-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-900">ใบสั่งซื้อล่าสุด</h2>
              </div>
              <Link
                href="/inventory/orders"
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                ดูทั้งหมด →
              </Link>
            </div>

            {data.recentOrders.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">ยังไม่มีใบสั่งซื้อ</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {data.recentOrders.map((po) => (
                  <div key={po.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-medium text-slate-800">{po.poNumber}</p>
                      <p className="text-xs text-slate-500 truncate">{po.supplier.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium tabular-nums">฿{fmt(po.total)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[po.status]}`}>
                        {STATUS_LABEL[po.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
  bg = 'bg-slate-50',
  valueColor = 'text-slate-900',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  bg?: string;
  valueColor?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 ${bg} p-4`}>
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>
        {value}
        {unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
      </p>
    </div>
  );
}
