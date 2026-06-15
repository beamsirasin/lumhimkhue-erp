'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartXAxis,
  ChartYAxis,
  BarChart, Bar,
  PieChart, Pie, Cell, Legend,
} from '@/components/ui/chart';
import { getDashboardData, getDashboardKpisForPeriod } from '@/lib/actions/dashboard';
import type { DashboardData, KpiMetric, PeriodKpis } from '@/lib/actions/dashboard';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

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

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: 'ว่าง', color: 'bg-emerald-400' },
  occupied: { label: 'มีลูกค้า', color: 'bg-rose-400' },
  cleaning: { label: 'ทำความสะอาด', color: 'bg-amber-400' },
  reserved: { label: 'จอง', color: 'bg-blue-400' },
};

const PIE_COLORS = ['#0f172a', '#3b82f6', '#10b981', '#f59e0b'];

interface DashboardPageProps {
  initialData: DashboardData;
}

export function DashboardPage({ initialData }: DashboardPageProps) {
  const [period, setPeriod] = useState<Period>('today');

  const { data: chartsData } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => getDashboardData().then((r) => (r.ok ? r.data : null)),
    initialData,
    initialDataUpdatedAt: Date.now(),
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
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">แดชบอร์ด</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {format(new Date(), 'EEEE d MMMM yyyy', { locale: th })}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                period === p
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <ErrorBoundary>
        {/* Row 1: core revenue KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            loading={kpisLoading}
            label="รายได้"
            value={kpis ? `฿${kpis.revenue.value.toLocaleString('th-TH', { minimumFractionDigits: 0 })}` : '—'}
            kpi={kpis?.revenue}
            vsLabel={vsLabel}
          />
          <KpiCard
            loading={kpisLoading}
            label="โต๊ะที่ปิดบิล"
            value={kpis ? kpis.sessions.value.toString() : '—'}
            unit="โต๊ะ"
            kpi={kpis?.sessions}
            vsLabel={vsLabel}
          />
          <KpiCard
            loading={kpisLoading}
            label="จำนวนลูกค้า"
            value={kpis ? kpis.guests.value.toString() : '—'}
            unit="คน"
            kpi={kpis?.guests}
            vsLabel={vsLabel}
          />
          <KpiCard
            loading={kpisLoading}
            label="เฉลี่ยต่อโต๊ะ"
            value={kpis ? `฿${kpis.avgPerSession.value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
            kpi={kpis?.avgPerSession}
            vsLabel={vsLabel}
          />
        </div>

        {/* Row 2: cost + efficiency KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            loading={kpisLoading}
            label="Food Cost %"
            value={kpis?.foodCostPct.available ? `${kpis.foodCostPct.value.toFixed(1)}%` : 'N/A'}
            subLabel={kpis?.foodCostPct.available ? (kpis.foodCostPct.value > 35 ? 'เกินเป้า (≤35%)' : 'อยู่ในเป้า') : 'ยังไม่มีสูตรอาหาร'}
            kpi={kpis?.foodCostPct.available ? kpis.foodCostPct : undefined}
            vsLabel={vsLabel}
            invertColor
            valueColor={kpis?.foodCostPct.available
              ? kpis.foodCostPct.value > 35 ? 'text-red-600' : 'text-green-600'
              : undefined}
          />
          <KpiCard
            loading={kpisLoading}
            label="Labor Cost %"
            value={kpis?.laborCostPct.available ? `${kpis.laborCostPct.value.toFixed(1)}%` : 'N/A'}
            subLabel={kpis?.laborCostPct.available ? undefined : 'ยังไม่มีข้อมูลเงินเดือน'}
            kpi={kpis?.laborCostPct.available ? kpis.laborCostPct : undefined}
            vsLabel={vsLabel}
            invertColor
          />
          <KpiCard
            loading={kpisLoading}
            label="เฉลี่ยรอบโต๊ะ/วัน"
            value={kpis ? kpis.avgTableTurns.value.toFixed(1) : '—'}
            unit="รอบ"
            kpi={kpis?.avgTableTurns}
            vsLabel={vsLabel}
          />
          <KpiCard
            loading={kpisLoading}
            label="รายได้/ที่นั่ง/วัน"
            value={kpis ? `฿${kpis.revpash.value.toFixed(0)}` : '—'}
            kpi={kpis?.revpash}
            vsLabel={vsLabel}
          />
        </div>
      </ErrorBoundary>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl bg-card border border-border p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">รายได้ 7 วันที่ผ่านมา</h2>
          <ChartContainer height={200}>
            <BarChart data={revenueByDay} barSize={28}>
              <ChartXAxis
                dataKey="date"
                tickFormatter={(v) => format(new Date(v + 'T00:00:00'), 'd/M', { locale: th })}
              />
              <ChartYAxis tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`} width={48} />
              <ChartTooltip
                formatter={(v) => [`฿${Number(v).toLocaleString('th-TH')}`, 'รายได้']}
                labelFormatter={(v) => format(new Date(v + 'T00:00:00'), 'd MMMM', { locale: th })}
              />
              <Bar dataKey="revenue" fill="oklch(0.30 0.11 248)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>

        <div className="rounded-xl bg-card border border-border p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">วิธีชำระเงินวันนี้</h2>
          {paymentMethods.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center">
              <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูล</p>
            </div>
          ) : (
            <ChartContainer height={200}>
              <PieChart>
                <Pie data={paymentMethods} dataKey="total" nameKey="method" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}>
                  {paymentMethods.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <ChartTooltip
                  formatter={(v, name) => [`฿${Number(v).toLocaleString('th-TH')}`, METHOD_LABEL[String(name)] ?? name]}
                />
                <Legend formatter={(v) => METHOD_LABEL[v] ?? v} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ChartContainer>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl bg-card border border-border p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">เมนูยอดนิยมวันนี้ (Top 10)</h2>
          {topMenuItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีออเดอร์วันนี้</p>
          ) : (
            <ol className="space-y-3">
              {topMenuItems.map((item, i) => {
                const max = topMenuItems[0].quantity;
                return (
                  <li key={item.name} className="flex items-center gap-3">
                    <span className="w-5 text-xs tabular-nums text-muted-foreground/50 font-semibold text-right shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                        <span className="ml-2 text-xs tabular-nums text-muted-foreground shrink-0">{item.quantity} จาน</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary/70 transition-all" style={{ width: `${(item.quantity / max) * 100}%` }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="rounded-xl bg-card border border-border p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">สถานะโต๊ะปัจจุบัน</h2>
          <div className="grid grid-cols-2 gap-3">
            {tableSummary.map((t) => {
              const cfg = STATUS_CONFIG[t.status] ?? { label: t.status, color: 'bg-muted' };
              return (
                <div key={t.status} className="flex items-center gap-3 rounded-xl bg-muted/50 border border-border p-4">
                  <span className={`h-3 w-3 rounded-full shrink-0 ${cfg.color}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">{cfg.label}</p>
                    <p className="text-2xl font-bold tabular-nums text-foreground leading-tight">{t.count}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  loading, label, value, unit, subLabel, kpi, vsLabel, invertColor, valueColor,
}: {
  loading: boolean;
  label: string;
  value: string;
  unit?: string;
  subLabel?: string;
  kpi?: KpiMetric;
  vsLabel: string;
  invertColor?: boolean;
  valueColor?: string;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-4 transition-shadow hover:shadow-sm">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
      {loading ? (
        <div className="mt-3 h-8 rounded-lg bg-muted animate-pulse w-28" />
      ) : (
        <p className={`mt-2.5 text-2xl font-bold tabular-nums leading-none ${valueColor ?? 'text-foreground'}`}>
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        </p>
      )}
      {kpi && !loading && kpi.changePct !== null ? (
        <ChangeChip changePct={kpi.changePct} changeDir={kpi.changeDir} vsLabel={vsLabel} invert={invertColor} />
      ) : subLabel && !loading ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{subLabel}</p>
      ) : null}
    </div>
  );
}

function ChangeChip({
  changePct, changeDir, vsLabel, invert,
}: {
  changePct: number;
  changeDir: 'up' | 'down' | 'flat';
  vsLabel: string;
  invert?: boolean;
}) {
  const isGood = invert ? changeDir === 'down' : changeDir === 'up';
  const isBad = invert ? changeDir === 'up' : changeDir === 'down';

  const colorClass = changeDir === 'flat'
    ? 'text-muted-foreground'
    : isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';

  const Icon = changeDir === 'up' ? TrendingUp : changeDir === 'down' ? TrendingDown : Minus;

  return (
    <div className={`mt-2 flex items-center gap-1 text-xs ${colorClass}`}>
      <Icon className="size-3 shrink-0" />
      <span className="font-semibold tabular-nums">
        {changePct > 0 ? '+' : ''}{changePct.toFixed(1)}%
      </span>
      <span className="text-muted-foreground">{vsLabel}</span>
    </div>
  );
}
