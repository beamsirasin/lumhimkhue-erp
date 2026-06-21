'use client';

import Link from 'next/link';
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
import {
  Activity,
  ArrowRight,
  Banknote,
  BarChart2,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  FileText,
  Package,
  Percent,
  Settings,
  Table2,
  TrendingUp,
  TriangleAlert,
  UserRoundCog,
  Users,
  Utensils,
  WalletCards,
} from 'lucide-react';
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
  available: { label: 'ว่าง', variant: 'success' },
  occupied: { label: 'มีลูกค้า', variant: 'danger' },
  cleaning: { label: 'ทำความสะอาด', variant: 'warning' },
  reserved: { label: 'จอง', variant: 'info' },
};

const TABLE_STATUS_ORDER: TableStatus[] = ['available', 'occupied', 'cleaning', 'reserved'];
const PIE_COLORS: readonly string[] = CHART_COLORS;
const CHART_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };
const CHART_GRID = 'var(--border)';

const QUICK_ACTIONS = [
  { href: '/pos', title: 'POS', subtitle: 'เปิดหน้าขาย', icon: Utensils },
  { href: '/tables', title: 'โต๊ะ', subtitle: 'ดูผังโต๊ะสด', icon: Table2 },
  { href: '/reports', title: 'รายงาน', subtitle: 'สรุปยอดและภาษี', icon: FileText },
  { href: '/inventory', title: 'สต็อก', subtitle: 'วัตถุดิบและสั่งซื้อ', icon: Package },
  { href: '/hr', title: 'HR', subtitle: 'พนักงานและเงินเดือน', icon: UserRoundCog },
  { href: '/payment-settings', title: 'ชำระเงิน', subtitle: 'ตั้งค่าการรับเงิน', icon: Settings },
] as const;

interface DashboardPageProps {
  initialData: DashboardData;
}

function formatBaht(value: number) {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getTableCount(tableSummary: DashboardData['tableSummary'], status: TableStatus) {
  return tableSummary.find((table) => table.status === status)?.count ?? 0;
}

export function DashboardPage({ initialData }: DashboardPageProps) {
  const [period, setPeriod] = useState<Period>('today');
  const currentDateLabel = format(new Date(), 'EEEE d MMMM yyyy, HH:mm', { locale: th });

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
  const totalTables = tableSummary.reduce((sum, table) => sum + table.count, 0);
  const occupiedTables = getTableCount(tableSummary, 'occupied');
  const availableTables = getTableCount(tableSummary, 'available');
  const cleaningTables = getTableCount(tableSummary, 'cleaning');
  const reservedTables = getTableCount(tableSummary, 'reserved');
  const hasRevenueData = revenueByDay.some((day) => day.revenue > 0);
  const hasPaymentData = paymentMethods.length > 0;
  const paymentTotal = paymentMethods.reduce((sum, method) => sum + method.total, 0);
  const leadingPaymentMethod = paymentMethods[0];
  const leadingMenuItem = topMenuItems[0];

  const operationItems = [
    {
      label: 'รายได้วันนี้',
      value: formatBaht(chartsData.kpis.revenueToday),
      detail: `${chartsData.kpis.sessionsToday.toLocaleString('th-TH')} บิลที่ปิดแล้ว`,
      icon: WalletCards,
      accent: 'info',
    },
    {
      label: 'โต๊ะกำลังใช้งาน',
      value: occupiedTables.toLocaleString('th-TH'),
      detail: totalTables > 0 ? `จาก ${totalTables.toLocaleString('th-TH')} โต๊ะทั้งหมด` : 'ยังไม่มีข้อมูลโต๊ะ',
      icon: Table2,
      accent: occupiedTables > 0 ? 'warning' : 'success',
    },
    {
      label: 'ลูกค้าวันนี้',
      value: chartsData.kpis.guestsToday.toLocaleString('th-TH'),
      detail: `${formatBaht(chartsData.kpis.avgPerSession)} เฉลี่ยต่อบิล`,
      icon: Users,
      accent: 'success',
    },
    {
      label: 'เมนูที่นำ',
      value: leadingMenuItem ? leadingMenuItem.quantity.toLocaleString('th-TH') : '0',
      detail: leadingMenuItem?.name ?? 'ยังไม่มีออเดอร์วันนี้',
      icon: ChefHat,
      accent: leadingMenuItem ? 'info' : 'default',
    },
  ];

  const watchItems = [
    {
      title: chartsData.kpis.revenueToday > 0 ? 'มียอดขายเข้าระบบแล้ว' : 'ยังไม่มียอดขายวันนี้',
      description: chartsData.kpis.revenueToday > 0
        ? `${formatBaht(chartsData.kpis.revenueToday)} จาก ${chartsData.kpis.sessionsToday.toLocaleString('th-TH')} บิล`
        : 'รอดูยอดขายหลังเริ่มปิดบิลแรก',
      icon: chartsData.kpis.revenueToday > 0 ? CheckCircle2 : TriangleAlert,
      variant: chartsData.kpis.revenueToday > 0 ? 'success' : 'warning',
    },
    {
      title: occupiedTables > 0 ? 'มีโต๊ะเปิดอยู่' : 'หน้าร้านยังโล่ง',
      description: occupiedTables > 0
        ? `${occupiedTables.toLocaleString('th-TH')} โต๊ะกำลังใช้งาน, ${availableTables.toLocaleString('th-TH')} โต๊ะว่าง`
        : `${availableTables.toLocaleString('th-TH')} โต๊ะพร้อมรับลูกค้า`,
      icon: occupiedTables > 0 ? Activity : CheckCircle2,
      variant: occupiedTables > 0 ? 'info' : 'success',
    },
    {
      title: cleaningTables + reservedTables > 0 ? 'มีโต๊ะต้องติดตาม' : 'ไม่มีโต๊ะค้างสถานะพิเศษ',
      description: `${cleaningTables.toLocaleString('th-TH')} ทำความสะอาด, ${reservedTables.toLocaleString('th-TH')} จอง`,
      icon: cleaningTables + reservedTables > 0 ? TriangleAlert : CheckCircle2,
      variant: cleaningTables + reservedTables > 0 ? 'warning' : 'success',
    },
  ] as const;

  return (
    <AppShell>
      <PageHeader
        title="แดชบอร์ด"
        subtitle="ศูนย์ควบคุมภาพรวมร้าน"
        className="rounded-lg border border-border bg-[var(--surface-1)] px-5 py-4 shadow-[var(--shadow-card)]"
        noBorder
        actions={
          <div className="flex gap-px rounded-lg border border-border bg-muted p-1">
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
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span suppressHydrationWarning className="text-xs text-muted-foreground">วันนี้ {currentDateLabel}</span>
          <StatusBadge label="รีเฟรชทุก 60 วิ" variant="info" dot size="sm" />
          <StatusBadge label={`ช่วงข้อมูล: ${PERIOD_LABELS[period]}`} variant="success" size="sm" />
        </div>
      </PageHeader>

      <ErrorBoundary>
        <StatCardGrid cols={4}>
          <StatCard
            loading={kpisLoading}
            label="รายได้"
            value={kpis ? formatBaht(kpis.revenue.value) : '—'}
            trend={kpis?.revenue ? { pct: kpis.revenue.changePct ?? 0, dir: kpis.revenue.changeDir ?? 'flat', label: vsLabel } : undefined}
            icon={<Banknote className="size-4" />}
            accent="info"
          />
          <StatCard
            loading={kpisLoading}
            label="โต๊ะที่ปิดบิล"
            value={kpis ? kpis.sessions.value.toString() : '—'}
            unit="โต๊ะ"
            trend={kpis?.sessions ? { pct: kpis.sessions.changePct ?? 0, dir: kpis.sessions.changeDir ?? 'flat', label: vsLabel } : undefined}
            icon={<Table2 className="size-4" />}
            accent="default"
          />
          <StatCard
            loading={kpisLoading}
            label="จำนวนลูกค้า"
            value={kpis ? kpis.guests.value.toString() : '—'}
            unit="คน"
            trend={kpis?.guests ? { pct: kpis.guests.changePct ?? 0, dir: kpis.guests.changeDir ?? 'flat', label: vsLabel } : undefined}
            icon={<Users className="size-4" />}
            accent="success"
          />
          <StatCard
            loading={kpisLoading}
            label="เฉลี่ยต่อโต๊ะ"
            value={kpis ? formatBaht(kpis.avgPerSession.value) : '—'}
            trend={kpis?.avgPerSession ? { pct: kpis.avgPerSession.changePct ?? 0, dir: kpis.avgPerSession.changeDir ?? 'flat', label: vsLabel } : undefined}
            icon={<TrendingUp className="size-4" />}
            accent="warning"
          />
        </StatCardGrid>

        <DataCard title="Operation Snapshot" subtitle="สถานะหน้าร้านจากข้อมูลแดชบอร์ดปัจจุบัน" actions={<StatusBadge label="Live" variant="info" dot size="sm" />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {operationItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-lg border border-border bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{item.label}</p>
                    <span className={cn(
                      'flex size-9 items-center justify-center rounded-lg',
                      item.accent === 'success' && 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
                      item.accent === 'warning' && 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
                      item.accent === 'info' && 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
                      item.accent === 'default' && 'bg-muted text-muted-foreground',
                    )}>
                      <Icon className="size-4" />
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-bold leading-none tabular-nums text-foreground">{item.value}</p>
                  <p className="mt-2 truncate text-xs text-muted-foreground">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </DataCard>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <DataCard title="รายได้ย้อนหลัง 7 วัน" subtitle="ยอดรวมรายวันจากข้อมูลเดิมของแดชบอร์ด" className="lg:col-span-2">
            {hasRevenueData ? (
              <ChartContainer height={244}>
                <BarChart data={revenueByDay} barSize={30}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={CHART_GRID} />
                  <ChartXAxis dataKey="date" tick={CHART_TICK} tickFormatter={(v) => format(new Date(v + 'T00:00:00'), 'd/M', { locale: th })} />
                  <ChartYAxis tick={CHART_TICK} tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`} width={48} />
                  <ChartTooltip formatter={(v) => [formatBaht(Number(v)), 'รายได้']} labelFormatter={(v) => format(new Date(v + 'T00:00:00'), 'd MMMM', { locale: th })} />
                  <Bar dataKey="revenue" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={<BarChart2 className="size-5" />} title="ยังไม่มีรายได้ในช่วง 7 วัน" description="กราฟจะปรากฏเมื่อมีการชำระเงินสำเร็จ" size="sm" />
            )}
          </DataCard>

          <DataCard title="สถานะโต๊ะตอนนี้" subtitle="จำนวนโต๊ะแยกตามสถานะสด">
            <div className="grid grid-cols-2 gap-3">
              {TABLE_STATUS_ORDER.map((status) => {
                const cfg = STATUS_CONFIG[status];
                const count = getTableCount(tableSummary, status);
                return (
                  <div key={status} className="flex min-h-28 flex-col justify-between rounded-lg border border-border bg-[var(--surface-2)] p-4">
                    <StatusBadge label={cfg.label} variant={cfg.variant} dot size="sm" />
                    <p className="text-[30px] font-bold tabular-nums leading-none text-foreground">{count}</p>
                  </div>
                );
              })}
            </div>
          </DataCard>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <DataCard title="เมนูยอดนิยมวันนี้" subtitle="Top 10 รายการที่สั่งมากที่สุด" className="xl:col-span-2">
            {topMenuItems.length === 0 ? (
              <EmptyState icon={<ChefHat className="size-5" />} title="ยังไม่มีออเดอร์" description="รายการยอดนิยมจะแสดงหลังมีออเดอร์วันนี้" size="sm" />
            ) : (
              <ol className="grid gap-3 md:grid-cols-2">
                {topMenuItems.map((item, i) => {
                  const max = topMenuItems[0].quantity;
                  return (
                    <li key={item.name} className="rounded-lg border border-border bg-[var(--surface-2)] p-3">
                      <div className="flex items-center gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.quantity} จาน</span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-[var(--chart-2)] transition-all" style={{ width: `${(item.quantity / max) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </DataCard>

          <DataCard
            title="วิธีชำระเงินวันนี้"
            subtitle={leadingPaymentMethod ? `${METHOD_LABEL[leadingPaymentMethod.method] ?? leadingPaymentMethod.method} นำอยู่` : 'สัดส่วนยอดชำระแยกตามวิธี'}
            footer={hasPaymentData ? (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">ยอดรับชำระรวม</span>
                <span className="font-semibold tabular-nums text-foreground">{formatBaht(paymentTotal)}</span>
              </div>
            ) : undefined}
          >
            {!hasPaymentData ? (
              <EmptyState icon={<CreditCard className="size-5" />} title="ยังไม่มีข้อมูล" description="ยังไม่มีการชำระเงินในวันนี้" size="sm" />
            ) : (
              <ChartContainer height={220}>
                <PieChart>
                  <Pie data={paymentMethods} dataKey="total" nameKey="method" cx="50%" cy="50%" innerRadius={54} outerRadius={82} paddingAngle={2}>
                    {paymentMethods.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <ChartTooltip formatter={(v, name) => [formatBaht(Number(v)), METHOD_LABEL[String(name)] ?? name]} />
                  <Legend formatter={(v) => METHOD_LABEL[v] ?? v} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }} />
                </PieChart>
              </ChartContainer>
            )}
          </DataCard>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <DataCard title="Quick Actions" subtitle="ทางลัดไปยังงานประจำของผู้จัดการ" className="xl:col-span-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link key={action.href} href={action.href} className="group rounded-lg border border-border bg-[var(--surface-2)] p-4 transition-colors hover:bg-muted/60">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-[var(--status-info-bg)] text-[var(--status-info-fg)]"><Icon className="size-4" /></span>
                      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                    <p className="mt-4 text-sm font-semibold text-foreground">{action.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{action.subtitle}</p>
                  </Link>
                );
              })}
            </div>
          </DataCard>

          <DataCard title="สิ่งที่ต้องดู" subtitle="สัญญาณจากค่าที่มีอยู่บนแดชบอร์ด">
            <div className="space-y-3">
              {watchItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex gap-3 rounded-lg border border-border bg-[var(--surface-2)] p-3">
                    <span className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      item.variant === 'success' && 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
                      item.variant === 'warning' && 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
                      item.variant === 'info' && 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
                    )}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </DataCard>
        </div>

        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">ตัวชี้วัดประสิทธิภาพ</p>
          <StatCardGrid cols={4}>
            <StatCard
              loading={kpisLoading}
              label="Food Cost %"
              value={kpis?.foodCostPct.available ? `${kpis.foodCostPct.value.toFixed(1)}%` : 'N/A'}
              subLabel={!kpis?.foodCostPct.available ? 'ยังไม่มีสูตรอาหาร' : kpis.foodCostPct.value > 35 ? 'เกินเป้า (≤35%)' : 'อยู่ในเป้า'}
              valueClassName={kpis?.foodCostPct.available ? kpis.foodCostPct.value > 35 ? 'text-[var(--status-danger-fg)]' : 'text-[var(--status-success-fg)]' : undefined}
              icon={<Percent className="size-4" />}
              accent={kpis?.foodCostPct.available ? kpis.foodCostPct.value > 35 ? 'danger' : 'success' : 'default'}
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
              trend={kpis?.avgTableTurns ? { pct: kpis.avgTableTurns.changePct ?? 0, dir: kpis.avgTableTurns.changeDir ?? 'flat', label: vsLabel } : undefined}
              icon={<Clock className="size-4" />}
              accent="info"
            />
            <StatCard
              loading={kpisLoading}
              label="รายได้/ที่นั่ง/วัน"
              value={kpis ? formatBaht(kpis.revpash.value) : '—'}
              trend={kpis?.revpash ? { pct: kpis.revpash.changePct ?? 0, dir: kpis.revpash.changeDir ?? 'flat', label: vsLabel } : undefined}
              icon={<BarChart2 className="size-4" />}
              accent="default"
            />
          </StatCardGrid>
        </div>
      </ErrorBoundary>
    </AppShell>
  );
}
