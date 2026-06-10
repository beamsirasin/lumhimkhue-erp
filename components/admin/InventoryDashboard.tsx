'use client';

import { useState, useTransition } from 'react';
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
  RefreshCw,
  BarChart2,
  FlaskConical,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { getInventoryDashboard, type InventoryDashboardData } from '@/lib/actions/inventory';
import { getDailyVariance, type VarianceRow } from '@/lib/actions/inventory-variance';
import { checkReorderNeeded, createDraftPOFromReorder, type ReorderItem } from '@/lib/actions/reorder';

interface Props {
  initialData: InventoryDashboardData;
  initialDataUpdatedAt: number;
}

type DashTab = 'overview' | 'variance' | 'reorder';

const STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง',
  pending_approval: 'รออนุมัติ',
  ordered: 'ยืนยันแล้ว',
  received: 'รับของแล้ว',
  cancelled: 'ยกเลิก',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_approval: 'bg-amber-100 text-amber-700',
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

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: InventoryDashboardData }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Package className="size-5 text-slate-600" />} label="วัตถุดิบทั้งหมด" value={String(data.totalIngredients)} unit="รายการ" bg="bg-slate-50" />
        <StatCard icon={<AlertTriangle className="size-5 text-red-500" />} label="ต่ำกว่าจุดสั่งซื้อ" value={String(data.lowStockCount)} unit="รายการ" bg={data.lowStockCount > 0 ? 'bg-red-50' : 'bg-slate-50'} valueColor={data.lowStockCount > 0 ? 'text-red-600' : 'text-slate-900'} />
        <StatCard icon={<ShoppingBag className="size-5 text-blue-500" />} label="PO รอรับของ" value={String(data.pendingOrders)} unit="รายการ" bg={data.pendingOrders > 0 ? 'bg-blue-50' : 'bg-slate-50'} valueColor={data.pendingOrders > 0 ? 'text-blue-600' : 'text-slate-900'} />
        <StatCard icon={<TrendingUp className="size-5 text-green-500" />} label="ยอดสั่งซื้อเดือนนี้" value={`฿${Number(data.monthlySpend).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} bg="bg-green-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low stock */}
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" />
              <h2 className="text-sm font-semibold text-slate-900">ต้องสั่งซื้อ</h2>
              {data.lowStockItems.length > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">{data.lowStockItems.length}</span>
              )}
            </div>
            <Link href="/inventory/count" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">นับสต็อก →</Link>
          </div>
          {data.lowStockItems.length === 0 ? (
            <div className="py-10 text-center"><Package className="mx-auto size-7 text-slate-300 mb-1" /><p className="text-sm text-slate-400">สต็อกปกติ ไม่มีรายการวิกฤต</p></div>
          ) : (
            <div className="divide-y divide-slate-50">
              {data.lowStockItems.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <AlertTriangle className="size-3.5 text-red-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.ingredient.name}</p>
                    <p className="text-xs text-slate-500">มี {Number(item.quantityOnHand).toLocaleString('th-TH')} {item.unit} / ต้องมี {Number(item.ingredient.minStock).toLocaleString('th-TH')} {item.unit}</p>
                  </div>
                  {item.ingredient.defaultSupplier && (
                    <span className="text-xs text-slate-400 shrink-0 max-w-[100px] truncate">{item.ingredient.defaultSupplier.name}</span>
                  )}
                </div>
              ))}
              {data.lowStockItems.length > 8 && <div className="px-4 py-2 text-xs text-slate-400">…อีก {data.lowStockItems.length - 8} รายการ</div>}
            </div>
          )}
          {data.lowStockItems.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-3">
              <Link href="/inventory/orders" className="text-sm font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1">สร้างใบสั่งซื้อ <ChevronRight className="size-4" /></Link>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2"><ClipboardList className="size-4 text-slate-500" /><h2 className="text-sm font-semibold text-slate-900">ประวัตินับสต็อก 7 วัน</h2></div>
              <Link href="/inventory/count" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">นับวันนี้ →</Link>
            </div>
            {data.countHistory.length === 0 ? (
              <div className="py-8 text-center"><p className="text-sm text-slate-400">ยังไม่มีการนับสต็อก</p></div>
            ) : (
              <div className="divide-y divide-slate-50">
                {data.countHistory.map((count) => (
                  <div key={count.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800">{fmtDate(count.countDate)}</p>
                      <p className="text-xs text-slate-500">{count.countedByUser.name} • {count.items.length} รายการ</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${count.status === 'submitted' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {count.status === 'submitted' ? 'ส่งแล้ว' : 'ร่าง'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2"><ShoppingBag className="size-4 text-slate-500" /><h2 className="text-sm font-semibold text-slate-900">ใบสั่งซื้อล่าสุด</h2></div>
              <Link href="/inventory/orders" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">ดูทั้งหมด →</Link>
            </div>
            {data.recentOrders.length === 0 ? (
              <div className="py-8 text-center"><p className="text-sm text-slate-400">ยังไม่มีใบสั่งซื้อ</p></div>
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
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[po.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABEL[po.status] ?? po.status}
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

// ── Variance Tab ──────────────────────────────────────────────────────────────

function VarianceTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<VarianceRow[] | null>(null);

  async function handleQuery() {
    setLoading(true);
    const r = await getDailyVariance(date);
    setLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setRows(r.data);
  }

  const flaggedCount = rows?.filter((r) => r.investigationNeeded).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">วันที่</label>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <button type="button" onClick={handleQuery} disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loading ? 'กำลังคำนวณ…' : 'คำนวณ Variance'}
        </button>
      </div>

      {rows !== null && (
        <>
          {flaggedCount > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <AlertTriangle className="size-4 text-amber-600 shrink-0" />
              <p className="text-sm font-medium text-amber-800">พบ {flaggedCount} รายการที่ variance เกิน 10% — ควรตรวจสอบ</p>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/5">
              <FlaskConical className="mx-auto size-8 text-slate-300 mb-2" />
              <p className="text-sm text-slate-500">ไม่พบข้อมูลการนับสต็อกที่ส่งแล้วในวันนี้ หรือยังไม่มีสูตรอาหารที่กำหนดไว้</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <p className="text-sm font-semibold text-slate-700">Variance รายวัน — {date}</p>
                <p className="text-xs text-slate-400 mt-0.5">Variance = จริง − ทฤษฎี · บวก = ใช้เกิน · ลบ = ใช้น้อยกว่าคาด</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">วัตถุดิบ</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">ทฤษฎี</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">จริง</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Variance</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">%</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">มูลค่า</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr key={row.ingredientId} className={`hover:bg-slate-50 ${row.investigationNeeded ? 'bg-amber-50/50' : ''}`}>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{row.ingredientName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{row.theoreticalUsage} {row.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{row.actualUsage} {row.unit}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${row.variance > 0 ? 'text-red-600' : row.variance < 0 ? 'text-green-600' : 'text-slate-500'}`}>
                          {row.variance > 0 ? '+' : ''}{row.variance} {row.unit}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${Math.abs(row.variancePct) > 10 ? 'text-amber-700' : 'text-slate-600'}`}>
                          {row.variancePct > 0 ? '+' : ''}{row.variancePct}%
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">฿{fmt(row.varianceCost)}</td>
                        <td className="px-4 py-2.5 text-center">
                          {row.investigationNeeded ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">ตรวจสอบ</span>
                          ) : (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">ปกติ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Reorder Tab ───────────────────────────────────────────────────────────────

function ReorderTab() {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ReorderItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function handleCheck() {
    setLoading(true);
    const r = await checkReorderNeeded();
    setLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setItems(r.data);
    setSelected(new Set(r.data.map((i) => i.ingredientId)));
  }

  function toggleAll() {
    if (!items) return;
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.ingredientId)));
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleCreatePO() {
    if (!selected.size) { toast.error('กรุณาเลือกรายการ'); return; }
    startTransition(async () => {
      const r = await createDraftPOFromReorder([...selected]);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`สร้าง ${r.data.count} ใบสั่งซื้อแล้ว`);
      setItems(null);
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <button type="button" onClick={handleCheck} disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'กำลังตรวจสอบ…' : 'ตรวจสอบรายการ Auto-Reorder'}
        </button>
        <p className="text-xs text-slate-500">แสดงรายการที่สต็อกต่ำกว่า Par Level</p>
      </div>

      {items !== null && (
        <>
          {items.length === 0 ? (
            <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/5">
              <Package className="mx-auto size-8 text-green-400 mb-2" />
              <p className="text-sm text-slate-500">สต็อกทุกรายการยังสูงกว่า Par Level</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selected.size === items.length} onChange={toggleAll} className="rounded" id="select-all" aria-label="เลือกทั้งหมด" />
                  <span className="text-sm font-semibold text-slate-800">สินค้าต่ำกว่า Par Level ({items.length} รายการ)</span>
                </div>
                <button type="button" onClick={handleCreatePO} disabled={isPending || !selected.size}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  <ShoppingBag className="size-3.5" />
                  สร้าง PO อัตโนมัติ ({selected.size})
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <th className="w-10 px-4 py-2.5" />
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">วัตถุดิบ</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">สต็อกปัจจุบัน</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Par Level</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">ต้องสั่ง</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">ราคาต่อหน่วย</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Supplier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.ingredientId} className={`hover:bg-slate-50 ${selected.has(item.ingredientId) ? '' : 'opacity-50'}`}>
                        <td className="px-4 py-2.5">
                          <input type="checkbox" checked={selected.has(item.ingredientId)} onChange={() => toggleItem(item.ingredientId)} className="rounded" aria-label={item.ingredientName} />
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{item.ingredientName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-red-600 font-medium">{item.currentStock.toFixed(2)} {item.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{item.parLevel.toFixed(2)} {item.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{item.reorderQty.toFixed(2)} {item.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">฿{fmt(item.lastCost)}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[120px] truncate">
                          {item.supplierName ?? <span className="text-amber-600">ไม่มี Supplier</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-400">
                  * รายการที่ไม่มี Supplier กำหนดไว้จะไม่ถูกรวมในการสร้าง PO · PO จะถูกจัดกลุ่มตาม Supplier
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function InventoryDashboard({ initialData, initialDataUpdatedAt }: Props) {
  const [tab, setTab] = useState<DashTab>('overview');

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

  const TABS: { key: DashTab; label: string; Icon: typeof Package }[] = [
    { key: 'overview', label: 'ภาพรวม',     Icon: Package },
    { key: 'variance', label: 'Variance',    Icon: FlaskConical },
    { key: 'reorder',  label: 'Auto-Reorder', Icon: RefreshCw },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">ภาพรวมสต็อก</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map(({ key, label }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'variance' && <VarianceTab />}
      {tab === 'reorder'  && <ReorderTab />}
    </div>
  );
}

function StatCard({
  icon, label, value, unit, bg = 'bg-slate-50', valueColor = 'text-slate-900',
}: {
  icon: React.ReactNode; label: string; value: string; unit?: string; bg?: string; valueColor?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 ${bg} p-4`}>
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>
        {value}{unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
      </p>
    </div>
  );
}
