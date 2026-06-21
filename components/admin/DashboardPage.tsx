'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import {
  ChartContainer,
  ChartTooltip,
  ChartXAxis,
  ChartYAxis,
  CartesianGrid,
  BarChart, Bar,
  PieChart, Pie, Cell, Legend,
} from '@/components/ui/chart';
import { getDashboardData, getDashboardKpisForPeriod } from '@/lib/actions/dashboard';
import type { DashboardData } from '@/lib/actions/dashboard';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { StatusBadge } from '@/components/ui/status-badge';
import type { BadgeVariant } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { AppShell } from '@/components/ui/app-shell';
import { Banknote, Table2, Users, TrendingUp, Percent, Clock, BarChart2, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHART_COLORS } from '@/lib/tokens';

type Period = 'today' | 'week' | 'month';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'วันนี้',
  week: 'สัปดาห์นี้',
  month: 'เดือนนี้',
};

const PERIOD_VS: Record<Period, string> = {
  today: 'vs เมื่อวาน',
  week: 'vs สัปดาห์ก่อน',
  month: 'vs เดือนก่อน',
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  qr_promptpay: 'QR PromptPay',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต',
};

type TableStatus = 'available' | 'occupied' | 'cleaning' | 'reserved';

const STATUS_CONFIG: Record<TableStatus, { label: string; variant: BadgeVariant }> = {
  available: { label: 'ว่าง',           variant: 'success' },
  occupied:  { label: 'มีลูกค้า',       variant: 'danger' },
  cleaning:  { label: 'ทำความสะอาด',   variant: 'warning' },
  reserved:  { label: 'จอง',            variant: 'info' },
};

/* Always show all 4 status tiles even when count is 0 */
const TABLE_STATUS_ORDER: TableStatus[] = ['available', 'occupied', 'cleaning', 'reserved'];

const PIE_COLORS: readonly string[] = CHART_COLORS;

interface DashboardPageProps {
  initialData: DashboardData;
}

export function DashboardPage({ initialData }: DashboardPageProps) {
  const [period, setPeriod] = useState<Period>('today');

  const { data: chartsData } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => getDashboardData().then((r) => (r.ok ? r.data : null)),
    initialData,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis', period],
    queryFn: async () => {
      const r = await getDashboardKpisForPeriod(period);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (!chartsData) return null;

  const { revenueByDay, topMenuItems, paymentMethods, tableSummary } = chartsData;
  const vsLabel = PERIOD_VS[period];

  return (
    <AppShell>
      {/* Header + period selector */}
      <PageHeader
        title="แดชบอร์ด"
        subtitle={format(new Date(), 'EEEE d MMMM yyyy', { locale: th })}
        actions={
          <div className="flex gap-px rounded-lg bg-muted p-1">
            {(['today', 'week', 'month'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  'rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-150',
                  period === p
                    ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        }
      />

      <ErrorBoundary>
        {/* Primary KPIs */}
        <StatCardGrid cols={4}>
          <StatCard
            loading={kpisLoading}
            label="รายได้"
            value={kpis ? `฿${kpis.revenue.value.toLocaleString('th-TH', { minimumFractionDigits: 0 })}` : '—'}
            trend={kpis?.revenue ? {
              pct: kpis.revenue.changePct ?? 0,
              dir: kpis.revenue.changeDir ?? 'flat',
              label: vsLabel,
            } : undefined}
            icon={<Banknote className="size-4" />}
            accent="info"
          />
          <StatCard
            loading={kpisLoading}
            label="โต๊ะที่ปิดบิล"
            value={kpis ? kpis.sessions.value.toString() : '—'}
            unit="โต๊ะ"
            trend={kpis?.sessions ? {
              pct: kpis.sessions.changePct ?? 0,
              dir: kpis.sessions.changeDir ?? 'flat',
              label: vsLabel,
            } : undefined}
            icon={<Table2 className="size-4" />}
            accent="default"
          />
          <StatCard
            loading={kpisLoading}
            label="จำนวนลูกค้า"
            value={kpis ? kpis.guests.value.toString() : '—'}
            unit="คน"
            trend={kpis?.guests ? {
              pct: kpis.guests.changePct ?? 0,
              dir: kpis.guests.changeDir ?? 'flat',
              label: vsLabel,
            } : undefined}
            icon={<Users className="size-4" />}
            accent="success"
          />
          <StatCard
            loading={kpisLoading}
            label="เฉลี่ยต่อโต๊ะ"
            value={kpis ? `฿${kpis.avgPerSession.value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
            trend={kpis?.avgPerSession ? {
              pct: kpis.avgPerSession.changePct ?? 0,
              dir: kpis.avgPerSession.changeDir ?? 'flat',
              label: vsLabel,
            } : undefined}
            icon={<TrendingUp className="size-4" />}
            accent="warning"
          />
        </StatCardGrid>

        {/* Revenue chart + live floor status */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <DataCard
            title="รายได้ 7 วันที่ผ่านมา"
            subtitle="ยอดรายได้รวมต่อวัน"
            className="lg:col-span-2"
          >
            <ChartContainer height={216}>
              <BarChart data={revenueByDay} barSize={28}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <ChartXAxis
                  dataKey="date"
                  tickFormatter={(v) => format(new Date(v + 'T00:00:00'), 'd/M', { locale: th })}
                />
                <ChartYAxis tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`} width={48} />
                <ChartTooltip
                  formatter={(v) => [`฿${Number(v).toLocaleString('th-TH')}`, 'รายได้']}
                  labelFormatter={(v) => format(new Date(v + 'T00:00:00'), 'd MMMM', { locale: th })}
                />
                <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </DataCard>

          <DataCard title="สถานะโต๊ะ ณ ขณะนี้" subtitle="จำนวนโต๊ะแยกตามสถานะ">
            <div className="grid grid-cols-2 gap-3">
              {TABLE_STATUS_ORDER.map((status) => {
                const cfg = STATUS_CONFIG[status];
                const count = tableSummary.find((t) => t.status === status)?.count ?? 0;
                return (
                  <div
                    key={status}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-[var(--surface-2)] p-4"
                  >
                    <StatusBadge label={cfg.label} variant={cfg.variant} dot size="sm" />
                    <p className="text-[28px] font-bold tabular-nums text-foreground leading-none">{count}</p>
                  </div>
                );
              })}
            </div>
          </DataCard>
        </div>

        {/* Sales detail row */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <DataCard title="เมนูยอดนิยมวันนี้" subtitle="Top 10 รายการที่สั่งมากที่สุด">
            {topMenuItems.length === 0 ? (
              <EmptyState
                title="ยังไม่มีออเดอร์"
                description="ยังไม่มีรายการสั่งอาหารในวันนี้"
                size="sm"
              />
            ) : (
              <ol className="space-y-3">
                {topMenuItems.map((item, i) => {
                  const max = topMenuItems[0].quantity;
                  return (
                    <li key={item.name} className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums font-semibold text-muted-foreground/40">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                          <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">{item.quantity} จาน</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60 transition-all"
                            style={{ width: `${(item.quantity / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </DataCard>

          <DataCard title="วิธีชำระเงินวันนี้" subtitle="สัดส่วนยอดชำระแยกตามวิธี">
            {paymentMethods.length === 0 ? (
              <EmptyState
                icon={<CreditCard className="size-5" />}
                title="ยังไม่มีข้อมูล"
                description="ยังไม่มีการชำระเงินในวันนี้"
                size="sm"
              />
            ) : (
              <ChartContainer height={200}>
                <PieChart>
                  <Pie
                    data={paymentMethods}
                    dataKey="total"
                    nameKey="method"
                    cx="50%" cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={2}
                  >
                    {paymentMethods.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    formatter={(v, name) => [`฿${Number(v).toLocaleString('th-TH')}`, METHOD_LABEL[String(name)] ?? name]}
                  />
                  <Legend
                    formatter={(v) => METHOD_LABEL[v] ?? v}
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ChartContainer>
            )}
          </DataCard>
        </div>

        {/* Efficiency KPIs — secondary row */}
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            ตัวชี้วัดประสิทธิภาพ
          </p>
          <StatCardGrid cols={4}>
            <StatCard
              loading={kpisLoading}
              label="Food Cost %"
              value={kpis?.foodCostPct.available ? `${kpis.foodCostPct.value.toFixed(1)}%` : 'N/A'}
              subLabel={
                !kpis?.foodCostPct.available
                  ? 'ยังไม่มีสูตรอาหาร'
                  : kpis.foodCostPct.value > 35
                    ? 'เกินเป้า (≤35%)'
                    : 'อยู่ในเป้า'
              }
              valueClassName={
                kpis?.foodCostPct.available
                  ? kpis.foodCostPct.value > 35
                    ? 'text-[var(--status-danger-fg)]'
                    : 'text-[var(--status-success-fg)]'
                  : undefined
              }
              icon={<Percent className="size-4" />}
              accent={
                kpis?.foodCostPct.available
                  ? kpis.foodCostPct.value > 35 ? 'danger' : 'success'
                  : 'default'
              }
            />
            <StatCard
              loading={kpisLoading}
              label="Labor Cost %"
              value={kpis?.laborCostPct.available ? `${kpis.laborCostPct.value.toFixed(1)}%` : 'N/A'}
              subLabel={kpis?.laborCostPct.available ? undefined : 'ยังไม่มีข้อมูลเงินเดือน'}
              icon={<Users className="size-4" />}
              accent="default"
            />
            <StatCard
              loading={kpisLoading}
              label="เฉลี่ยรอบโต๊ะ/วัน"
              value={kpis ? kpis.avgTableTurns.value.toFixed(1) : '—'}
              unit="รอบ"
              trend={kpis?.avgTableTurns ? {
                pct: kpis.avgTableTurns.changePct ?? 0,
                dir: kpis.avgTableTurns.changeDir ?? 'flat',
                label: vsLabel,
              } : undefined}
              icon={<Clock className="size-4" />}
              accent="info"
            />
            <StatCard
              loading={kpisLoading}
              label="รายได้/ที่นั่ง/วัน"
              value={kpis ? `฿${kpis.revpash.value.toFixed(0)}` : '—'}
              trend={kpis?.revpash ? {
                pct: kpis.revpash.changePct ?? 0,
                dir: kpis.revpash.changeDir ?? 'flat',
                label: vsLabel,
              } : undefined}
              icon={<BarChart2 className="size-4" />}
              accent="default"
            />
          </StatCardGrid>
        </div>
      </ErrorBoundary>
    </AppShell>
  );
}
