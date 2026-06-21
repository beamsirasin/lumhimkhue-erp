'use client';

import Link from 'next/link';
import { useState, useEffect, type ReactNode } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import {
  ArrowRight,
  BadgePercent,
  Banknote,
  BarChart3,
  ClipboardCheck,
  Download,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { getReportSummary } from '@/lib/actions/dashboard';
import { getFoodCostReport } from '@/lib/actions/recipes';
import { getPaymentCollectionReport } from '@/lib/actions/reports/collection';
import type { ReportSummary } from '@/lib/actions/dashboard';
import type { FoodCostRow } from '@/lib/actions/recipes';
import type { PaymentCollectionReport } from '@/lib/actions/reports/collection';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type Tab = 'revenue' | 'foodcost' | 'collection';
type SessionType = 'all' | 'primary' | 'secondary';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'เงินสด',
  cash_qr: 'QR + เงินสด',
  qr_promptpay: 'QR พร้อมเพย์',
  transfer: 'โอนเงิน',
  card: 'บัตรเครดิต/เดบิต',
};

const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  all: 'รวมทั้งหมด',
  primary: 'บัญชีหลัก',
  secondary: 'บัญชีรอง',
};

const METHOD_TYPE_LABELS: Record<string, string> = {
  cash: 'เงินสด',
  promptpay: 'QR PromptPay',
  welfare: 'สวัสดิการรัฐ',
  mixed_legacy: 'ประวัติ QR+เงินสด',
  other: 'อื่น ๆ',
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank_cash_group: 'บัญชีธนาคาร/เงินสด',
  welfare: 'บัญชีสวัสดิการรัฐ',
  cash_drawer: 'ลิ้นชักเงินสด',
  other: 'อื่น ๆ',
};

const REPORT_TONE_CLASSES = {
  info: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
  success: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
  warning: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  danger: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
};

const REPORT_HUB_CARDS = [
  {
    kind: 'tab',
    tab: 'revenue' as Tab,
    title: 'รายได้และลูกค้า',
    description: 'ดูรายได้รายวัน จำนวนโต๊ะ ลูกค้า เฉลี่ยต่อโต๊ะ และแยกตามช่องทางชำระเงิน',
    badge: 'รายงานหลัก',
    icon: BarChart3,
    tone: 'info' as const,
  },
  {
    kind: 'tab',
    tab: 'foodcost' as Tab,
    title: 'ต้นทุนอาหาร',
    description: 'ติดตามต้นทุนทฤษฎี เทียบยอดขาย และเปอร์เซ็นต์ต้นทุนอาหารรายวัน',
    badge: 'ควบคุมต้นทุน',
    icon: BadgePercent,
    tone: 'warning' as const,
  },
  {
    kind: 'tab',
    tab: 'collection' as Tab,
    title: 'ยอดรับจริง',
    description: 'ตรวจยอดรับตามวิธีชำระเงิน บัญชีรับเงิน และตาราง matrix สำหรับปิดยอด',
    badge: 'ปิดยอดเงิน',
    icon: WalletCards,
    tone: 'success' as const,
  },
  {
    kind: 'link',
    href: '/reports/audit',
    title: 'รายงานตรวจสอบ',
    description: 'เปิดหน้าตรวจสอบประวัติการแก้ไข ลบ และกิจกรรมสำคัญของระบบ',
    badge: 'Audit trail',
    icon: ShieldCheck,
    tone: 'danger' as const,
  },
] as const;

const REPORT_COMMAND_POINTS = [
  {
    label: 'Data source',
    value: 'ใช้ action เดิม',
    detail: 'ทุกแท็บยังโหลดข้อมูลจาก server action ชุดเดิม',
    icon: ClipboardCheck,
  },
  {
    label: 'Export',
    value: 'CSV รายได้',
    detail: 'ปุ่ม export ยังอิงตารางรายวันเดิมเท่านั้น',
    icon: Download,
  },
  {
    label: 'Routes',
    value: '/reports/audit',
    detail: 'ลิงก์เสริมชี้ไปยัง route รายงานที่มีอยู่แล้ว',
    icon: ReceiptText,
  },
];

type ReportStatTone = 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const REPORT_STAT_TONE_CLASSES: Record<ReportStatTone, { card: string; icon: string; label: string; value: string }> = {
  primary: {
    card: 'border-primary/30 bg-primary text-primary-foreground shadow-[var(--shadow-card)]',
    icon: 'border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground',
    label: 'text-primary-foreground/70',
    value: 'text-primary-foreground',
  },
  info: {
    card: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)]',
    icon: 'border-[var(--status-info-border)] bg-[var(--surface-1)] text-[var(--status-info-fg)]',
    label: 'text-[var(--status-info-fg)]/80',
    value: 'text-[var(--status-info-fg)]',
  },
  success: {
    card: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]',
    icon: 'border-[var(--status-success-border)] bg-[var(--surface-1)] text-[var(--status-success-fg)]',
    label: 'text-[var(--status-success-fg)]/80',
    value: 'text-[var(--status-success-fg)]',
  },
  warning: {
    card: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    icon: 'border-[var(--status-warning-border)] bg-[var(--surface-1)] text-[var(--status-warning-fg)]',
    label: 'text-[var(--status-warning-fg)]/80',
    value: 'text-[var(--status-warning-fg)]',
  },
  danger: {
    card: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]',
    icon: 'border-[var(--status-danger-border)] bg-[var(--surface-1)] text-[var(--status-danger-fg)]',
    label: 'text-[var(--status-danger-fg)]/80',
    value: 'text-[var(--status-danger-fg)]',
  },
  neutral: {
    card: 'border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)]',
    icon: 'border-border bg-[var(--surface-2)] text-muted-foreground',
    label: 'text-muted-foreground',
    value: 'text-foreground',
  },
};

function ReportStatCard({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon: ReactNode;
  tone?: ReportStatTone;
  valueClassName?: string;
}) {
  const style = REPORT_STAT_TONE_CLASSES[tone];
  return (
    <div className={cn('rounded-lg border p-4', style.card)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('text-[11px] font-semibold uppercase tracking-wider', style.label)}>{label}</p>
          <p className={cn('mt-2 text-2xl font-bold tabular-nums leading-none', style.value, valueClassName)}>{value}</p>
        </div>
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border', style.icon)}>
          {icon}
        </span>
      </div>
      {detail && <p className={cn('mt-3 text-xs leading-5', tone === 'primary' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{detail}</p>}
    </div>
  );
}

// ─── Revenue Report ────────────────────────────────────────────────────────────

function RevenueReport() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [sessionType, setSessionType] = useState<SessionType>('all');
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportSummary | null>(null);

  useEffect(() => {
    if (fromDate > toDate) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getReportSummary(fromDate, toDate, sessionType).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) { toast.error(r.error); return; }
      setReport(r.data);
    });
    return () => { cancelled = true; };
  }, [fromDate, toDate, sessionType]);

  function handleExport() {
    if (!report) return;
    const headers = ['วันที่', 'จำนวนโต๊ะ', 'จำนวนลูกค้า', 'รายได้รวม (฿)', 'เฉลี่ยต่อโต๊ะ (฿)'];
    const rows = report.rows.map((r) => [r.date, r.sessions, r.guests, r.revenue.toFixed(2), r.avgPerSession.toFixed(2)]);
    const totalRow = [
      'รวม', report.totals.sessions, report.totals.guests, report.totals.revenue.toFixed(2),
      report.totals.sessions > 0 ? (report.totals.revenue / report.totals.sessions).toFixed(2) : '0.00',
    ];
    downloadCsv(`report-${fromDate}-${toDate}.csv`, [headers, ...rows, totalRow].map((r) => r.join(',')).join('\n'));
  }

  const totals = report?.totals;
  const avgPerSession = totals && totals.sessions > 0 ? totals.revenue / totals.sessions : 0;
  const totalGuests = report?.guestBreakdown.reduce((s, g) => s + g.total, 0) ?? 0;
  const sortedGuests = report
    ? [...report.guestBreakdown].sort((a, b) => b.total - a.total)
    : [];
  const totalPaymentRevenue = report?.paymentBreakdown.reduce((s, p) => s + p.revenue, 0) ?? 0;

  return (
    <div className="space-y-5">

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <DataCard
        title="ตัวกรองรายงานรายได้"
        subtitle="เลือกช่วงวันที่และบัญชีรับเงิน โดยคงเงื่อนไขรายงานเดิม"
        actions={(!loading && report) ? (
          <Button type="button" variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="size-4" />
            Export CSV
          </Button>
        ) : undefined}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">วันเริ่มต้น</Label>
              <Input type="date" value={fromDate} max={today}
                onChange={(e) => setFromDate(e.target.value)} className="h-10 w-40" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">วันสิ้นสุด</Label>
              <Input type="date" value={toDate} max={today}
                onChange={(e) => setToDate(e.target.value)} className="h-10 w-40" />
            </div>
            {loading && <span className="pb-2 text-xs text-muted-foreground">กำลังโหลด…</span>}
          </div>
          {/* Session type toggle */}
          <div className="flex gap-0.5 rounded-lg border border-border bg-muted p-1">
            {(['all', 'primary', 'secondary'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setSessionType(t)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  sessionType === t
                    ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}>
                {SESSION_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </DataCard>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ReportStatCard
          label="รายได้รวม"
          value={`฿${(totals?.revenue ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
          detail={fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`}
          icon={<Banknote className="size-5" />}
          tone="primary"
        />
        <ReportStatCard
          label="จำนวนโต๊ะ"
          value={(totals?.sessions ?? 0).toLocaleString('th-TH')}
          detail="โต๊ะ"
          icon={<ReceiptText className="size-5" />}
          tone="neutral"
        />
        <ReportStatCard
          label="เฉลี่ยต่อโต๊ะ"
          value={`฿${Math.round(avgPerSession).toLocaleString('th-TH')}`}
          detail={totalGuests > 0 ? `฿${Math.round((totals?.revenue ?? 0) / totalGuests).toLocaleString('th-TH')} / คน` : '—'}
          icon={<BarChart3 className="size-5" />}
          tone="info"
        />
      </div>

      {/* ── Chart + Breakdowns ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Chart — takes 2/3 */}
        <DataCard
          title="รายได้รายวัน"
          subtitle={report && report.rows.length > 0 ? `${report.rows.length} วัน · ใช้ข้อมูลรายวันเดิม` : undefined}
          className="lg:col-span-2"
        >
          {loading ? (
            <div className="flex min-h-[180px] items-center justify-center">
              <span className="text-sm text-muted-foreground">กำลังโหลด…</span>
            </div>
          ) : !report || report.rows.length === 0 ? (
            <div className="flex min-h-[180px] items-center justify-center">
              <EmptyState icon={<BarChart3 className="size-5" />} title="ยังไม่มีรายได้ในช่วงนี้" description="กราฟจะปรากฏเมื่อมีข้อมูลการชำระเงินสำเร็จในช่วงวันที่เลือก" size="sm" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={report.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(v: number) => v >= 1000 ? `฿${(v / 1000).toFixed(0)}K` : `฿${v}`}
                  axisLine={false} tickLine={false} width={50}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)' }}
                  contentStyle={{ backgroundColor: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: 12, boxShadow: 'var(--shadow-card)' }}
                  formatter={(v) => [`฿${Number(v).toLocaleString('th-TH')}`, 'รายได้']}
                  labelFormatter={(l) => `วันที่ ${l}`}
                />
                <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </DataCard>

        {/* Breakdowns — takes 1/3 */}
        <div className="flex flex-col gap-4">

          {/* Guest type breakdown */}
          <DataCard
            title="ประเภทลูกค้า"
            subtitle={totalGuests > 0 ? `${totalGuests} คน` : undefined}
            className="flex-1"
          >
            {sortedGuests.length === 0 ? (
              <p className="text-sm text-muted-foreground">ไม่มีข้อมูล</p>
            ) : (
              <div className="space-y-3">
                {sortedGuests.map((g) => {
                  const pct = totalGuests > 0 ? (g.total / totalGuests) * 100 : 0;
                  return (
                    <div key={g.name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-foreground">{g.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{pct.toFixed(0)}%</span>
                          <span className="text-xs font-bold text-foreground tabular-nums w-10 text-right">{g.total} คน</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-[var(--chart-2)] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DataCard>

          {/* Payment method breakdown */}
          <DataCard title="ช่องทางชำระเงิน" className="flex-1">
            {!report || report.paymentBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">ไม่มีข้อมูล</p>
            ) : (
              <div className="space-y-3">
                {report.paymentBreakdown.map((p) => {
                  const pct = totalPaymentRevenue > 0 ? (p.revenue / totalPaymentRevenue) * 100 : 0;
                  return (
                    <div key={p.method}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-foreground">{PAYMENT_LABELS[p.method] ?? p.method}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{p.count} ครั้ง</span>
                          <span className="text-xs font-bold text-foreground tabular-nums">
                            ฿{p.revenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-[var(--chart-3)] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DataCard>
        </div>
      </div>

      {/* ── Daily Table ───────────────────────────────────────────────────── */}
      {report && (
        <DataCard noPadding title="รายละเอียดรายวัน" subtitle="แถวและค่าที่ใช้ export ยังคงอิง report.rows เดิม">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[var(--surface-2)]">
                  <Th>วันที่</Th>
                  <Th align="right">จำนวนโต๊ะ</Th>
                  <Th align="right">จำนวนลูกค้า</Th>
                  <Th align="right">รายได้รวม</Th>
                  <Th align="right">เฉลี่ยต่อโต๊ะ</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground text-xs">ไม่มีข้อมูลในช่วงเวลานี้</td></tr>
                )}
                {report.rows.map((r) => (
                  <tr key={r.date} className="transition-colors hover:bg-[var(--surface-2)]/70">
                    <Td>{r.date}</Td>
                    <Td align="right">{r.sessions}</Td>
                    <Td align="right">{r.guests}</Td>
                    <Td align="right">฿{r.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                    <Td align="right">฿{Math.round(r.avgPerSession).toLocaleString('th-TH')}</Td>
                  </tr>
                ))}
              </tbody>
              {report.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-[var(--surface-2)] font-semibold">
                    <Td>รวม</Td>
                    <Td align="right">{report.totals.sessions}</Td>
                    <Td align="right">{report.totals.guests}</Td>
                    <Td align="right">฿{report.totals.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                    <Td align="right">
                      ฿{Math.round(report.totals.sessions > 0 ? report.totals.revenue / report.totals.sessions : 0).toLocaleString('th-TH')}
                    </Td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </DataCard>
      )}
    </div>
  );
}

// ─── Food Cost Report ──────────────────────────────────────────────────────────

function FoodCostReport() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FoodCostRow[] | null>(null);

  useEffect(() => {
    if (fromDate > toDate) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getFoodCostReport(fromDate, toDate).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) { toast.error(r.error); return; }
      setRows(r.data);
    });
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  const withRevenue = rows?.filter((r) => r.revenue > 0) ?? [];
  const avgFoodCostPct = withRevenue.length > 0
    ? withRevenue.reduce((s, r) => s + r.foodCostPct, 0) / withRevenue.length
    : null;
  const totalRevenue = rows?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const totalCost = rows?.reduce((s, r) => s + r.theoreticalCost, 0) ?? 0;
  const overallPct = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : null;

  return (
    <div className="space-y-5">

      {/* Controls */}
      <DataCard
        title="ตัวกรองรายงานต้นทุนอาหาร"
        subtitle="ช่วงวันที่ยังใช้เงื่อนไขเดิมของรายงานต้นทุน"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">วันเริ่มต้น</Label>
            <Input type="date" value={fromDate} max={today} onChange={(e) => setFromDate(e.target.value)} className="h-10 w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">วันสิ้นสุด</Label>
            <Input type="date" value={toDate} max={today} onChange={(e) => setToDate(e.target.value)} className="h-10 w-40" />
          </div>
          {loading && <span className="pb-2 text-xs text-muted-foreground">กำลังโหลด…</span>}
        </div>
      </DataCard>

      {/* KPI cards */}
      {rows !== null && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ReportStatCard
            label="% ต้นทุนเฉลี่ยต่อวัน"
            value={avgFoodCostPct !== null ? `${avgFoodCostPct.toFixed(1)}%` : '—'}
            detail="เป้าหมาย ≤ 35%"
            icon={<BadgePercent className="size-5" />}
            tone={avgFoodCostPct !== null && avgFoodCostPct > 35 ? 'danger' : avgFoodCostPct !== null ? 'success' : 'neutral'}
          />
          <ReportStatCard
            label="% ต้นทุนรวม"
            value={overallPct !== null ? `${overallPct.toFixed(1)}%` : '—'}
            detail="ภาพรวม"
            icon={<BarChart3 className="size-5" />}
            tone={overallPct !== null && overallPct > 35 ? 'danger' : overallPct !== null ? 'success' : 'neutral'}
          />
          <ReportStatCard
            label="รายได้รวม"
            value={`฿${totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
            detail="ช่วงที่เลือก"
            icon={<Banknote className="size-5" />}
            tone="neutral"
          />
          <ReportStatCard
            label="ต้นทุนรวม (ทฤษฎี)"
            value={`฿${totalCost.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
            detail="ช่วงที่เลือก"
            icon={<ReceiptText className="size-5" />}
            tone={overallPct !== null && overallPct > 35 ? 'danger' : 'neutral'}
          />
        </div>
      )}

      {/* Chart */}
      <DataCard title="% ต้นทุนอาหารรายวัน" subtitle="เส้นอ้างอิง 35% และสีแท่งยังอิงค่า foodCostPct เดิม">
        {loading ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <span className="text-sm text-muted-foreground">กำลังโหลด…</span>
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <EmptyState icon={<BadgePercent className="size-5" />} title="ยังไม่มีข้อมูลต้นทุนอาหาร" description="กราฟจะปรากฏเมื่อมีรายงานต้นทุนในช่วงวันที่เลือก" size="sm" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} unit="%" domain={[0, 'auto']} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                contentStyle={{ backgroundColor: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--foreground)', fontSize: 12, boxShadow: 'var(--shadow-card)' }}
                formatter={(v) => [`${Number(v ?? 0).toFixed(1)}%`, '% ต้นทุนอาหาร']}
                labelFormatter={(l) => `วันที่ ${l}`}
              />
              <ReferenceLine y={35} stroke="var(--status-danger-fg)" strokeDasharray="4 4" label={{ value: '35%', fill: 'var(--status-danger-fg)', fontSize: 11 }} />
              <Bar dataKey="foodCostPct" radius={[4, 4, 0, 0]} maxBarSize={60}>
                {rows.map((row) => <Cell key={row.date} fill={row.foodCostPct > 35 ? 'var(--status-danger-fg)' : 'var(--status-success-fg)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </DataCard>

      {/* Table */}
      {rows !== null && (
        <DataCard noPadding title="รายละเอียดรายวัน" subtitle="ค่ารายได้ ต้นทุน และสถานะเป้าหมายมาจาก rows เดิม">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[var(--surface-2)]">
                  <Th>วันที่</Th><Th align="right">รายได้</Th><Th align="right">ต้นทุนทฤษฎี</Th>
                  <Th align="right">% ต้นทุน</Th><Th align="right">เป้าหมาย</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-muted-foreground text-xs">ไม่มีข้อมูล</td></tr>}
                {rows.map((r) => (
                  <tr key={r.date} className="transition-colors hover:bg-[var(--surface-2)]/70">
                    <Td>{r.date}</Td>
                    <Td align="right">฿{r.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                    <Td align="right">฿{r.theoreticalCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                    <Td align="right">
                      <span className={cn('font-medium', r.foodCostPct > 35 ? 'text-[var(--status-danger-fg)]' : 'text-[var(--status-success-fg)]')}>
                        {r.revenue > 0 ? `${r.foodCostPct.toFixed(1)}%` : '—'}
                      </span>
                    </Td>
                    <Td align="right">
                      {r.revenue > 0
                        ? <span className={cn('font-medium', r.targetMet ? 'text-[var(--status-success-fg)]' : 'text-[var(--status-danger-fg)]')}>{r.targetMet ? 'ผ่าน ✓' : 'เกินเป้า'}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataCard>
      )}
    </div>
  );
}

// ─── Collection Report ─────────────────────────────────────────────────────────

function CollectionReport() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<PaymentCollectionReport | null>(null);

  useEffect(() => {
    if (fromDate > toDate) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getPaymentCollectionReport(fromDate, toDate).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) { toast.error(r.error); return; }
      setReport(r.data);
    });
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  return (
    <div className="space-y-5">
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <DataCard
        title="ตัวกรองรายงานยอดรับจริง"
        subtitle="ช่วงวันที่ยังใช้เงื่อนไขเดิมของรายงาน payment_rows"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">วันเริ่มต้น</Label>
            <Input type="date" value={fromDate} max={today}
              onChange={(e) => setFromDate(e.target.value)} className="h-10 w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">วันสิ้นสุด</Label>
            <Input type="date" value={toDate} max={today}
              onChange={(e) => setToDate(e.target.value)} className="h-10 w-40" />
          </div>
          {loading && <span className="pb-2 text-xs text-muted-foreground">กำลังโหลด…</span>}
        </div>
      </DataCard>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      {report && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <ReportStatCard
              label="ยอดรับจริงรวม"
              value={`฿${report.totalCollected.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`}
              detail={fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`}
              icon={<WalletCards className="size-5" />}
              tone="primary"
            />
            <ReportStatCard
              label="ช่องทางชำระ"
              value={report.methodSummary.length.toLocaleString('th-TH')}
              detail="วิธีที่มีรายการ"
              icon={<Banknote className="size-5" />}
              tone="info"
            />
            <ReportStatCard
              label="บัญชีรับเงิน"
              value={report.accountSummary.length.toLocaleString('th-TH')}
              detail="บัญชีที่มีรายการ"
              icon={<ReceiptText className="size-5" />}
              tone="success"
            />
            {([
              { label: 'เงินสด', value: report.cashTotal, tone: 'neutral' as const, icon: Banknote },
              { label: 'QR PromptPay', value: report.promptpayTotal, tone: 'info' as const, icon: WalletCards },
              { label: 'สวัสดิการรัฐ', value: report.welfareTotal, tone: 'success' as const, icon: ShieldCheck },
            ] as const).map(({ label, value, tone, icon: Icon }) => (
              <ReportStatCard
                key={label}
                label={label}
                value={`฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`}
                detail={report.totalCollected > 0 ? `${((value / report.totalCollected) * 100).toFixed(1)}%` : undefined}
                icon={<Icon className="size-5" />}
                tone={tone}
              />
            ))}
          </div>
          <DataCard className="bg-[var(--surface-1)]" title="หมายเหตุยอดรับจริง" subtitle="อ้างอิงจาก payment_rows ตามบัญชีรับเงินจริง — ไม่ใช่ยอดขาย VAT">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-[var(--surface-2)] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Legacy mixed</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  ฿{report.legacyTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-[var(--surface-2)] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Method rows</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {report.methodSummary.reduce((s, m) => s + m.rowCount, 0).toLocaleString('th-TH')} รายการ
                </p>
              </div>
              <div className="rounded-lg border border-border bg-[var(--surface-2)] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Account rows</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {report.accountSummary.reduce((s, a) => s + a.rowCount, 0).toLocaleString('th-TH')} รายการ
                </p>
              </div>
            </div>
          </DataCard>
        </>
      )}

      {/* ── Method + Account summaries ───────────────────────────────────── */}
      {report && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Method summary */}
          <DataCard noPadding title="สรุปตามช่องทางชำระ" subtitle="ชื่อช่องทาง ประเภท จำนวนรายการ และยอดรับจาก methodSummary เดิม">
            {report.methodSummary.length === 0 ? (
              <EmptyState
                icon={<Banknote className="size-5" />}
                title="ไม่มีรายการรับเงิน"
                description="ไม่มีรายการรับเงินในช่วงนี้"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-[var(--surface-2)]">
                      <Th>ช่องทาง</Th>
                      <Th>ประเภท</Th>
                      <Th align="right">รายการ</Th>
                      <Th align="right">ยอดรับ</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.methodSummary.map((m) => (
                      <tr key={m.methodId} className="transition-colors hover:bg-[var(--surface-2)]/70">
                        <Td>
                          <div className="flex flex-col gap-0.5">
                            <span>{m.methodName}</span>
                            <span className="text-[11px] text-muted-foreground">{m.methodCode}</span>
                          </div>
                        </Td>
                        <Td><span className="rounded-full border border-border bg-[var(--surface-2)] px-2 py-0.5 text-xs text-muted-foreground">{METHOD_TYPE_LABELS[m.methodType] ?? m.methodType}</span></Td>
                        <Td align="right">{m.rowCount}</Td>
                        <Td align="right" className="font-semibold">
                          ฿{m.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-[var(--surface-2)] font-semibold">
                      <Td>รวม</Td><Td>{''}</Td>
                      <Td align="right">{report.methodSummary.reduce((s, m) => s + m.rowCount, 0)}</Td>
                      <Td align="right">
                        ฿{report.methodSummary.reduce((s, m) => s + m.amount, 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </Td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </DataCard>

          {/* Account summary */}
          <DataCard noPadding title="สรุปตามบัญชีรับเงิน" subtitle="บัญชีรับเงิน ประเภทบัญชี จำนวนรายการ และยอดรับจาก accountSummary เดิม">
            {report.accountSummary.length === 0 ? (
              <EmptyState
                icon={<Banknote className="size-5" />}
                title="ไม่มีรายการรับเงิน"
                description="ไม่มีรายการรับเงินในช่วงนี้"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-[var(--surface-2)]">
                      <Th>บัญชีรับเงิน</Th>
                      <Th>ประเภทบัญชี</Th>
                      <Th align="right">รายการ</Th>
                      <Th align="right">ยอดรับ</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.accountSummary.map((a) => (
                      <tr key={a.accountId} className="transition-colors hover:bg-[var(--surface-2)]/70">
                        <Td>
                          <div className="flex flex-col gap-0.5">
                            <span>{a.accountName}</span>
                            <span className="text-[11px] text-muted-foreground">{a.accountCode}</span>
                          </div>
                        </Td>
                        <Td><span className="rounded-full border border-border bg-[var(--surface-2)] px-2 py-0.5 text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType}</span></Td>
                        <Td align="right">{a.rowCount}</Td>
                        <Td align="right" className="font-semibold">
                          ฿{a.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-[var(--surface-2)] font-semibold">
                      <Td>รวม</Td><Td>{''}</Td>
                      <Td align="right">{report.accountSummary.reduce((s, a) => s + a.rowCount, 0)}</Td>
                      <Td align="right">
                        ฿{report.accountSummary.reduce((s, a) => s + a.amount, 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </Td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </DataCard>
        </div>
      )}

      {/* ── Account × Method matrix ─────────────────────────────────────── */}
      {report && report.matrix.length > 0 && (
        <DataCard noPadding title="รายละเอียด: บัญชีรับเงิน × ช่องทางชำระ" subtitle="แสดง matrix ตามลำดับและค่าที่ server action ส่งกลับ">
          <div className="divide-y divide-border">
            {report.matrix.map((matRow) => (
              <div key={matRow.accountId} className="px-5 py-4 transition-colors hover:bg-[var(--surface-2)]/50">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{matRow.accountName}</span>
                      <span className="rounded-full border border-border bg-[var(--surface-2)] px-2 py-0.5 text-xs text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[matRow.accountType] ?? matRow.accountType}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{matRow.accountCode}</p>
                  </div>
                  <span className="rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2 text-sm font-bold tabular-nums text-foreground">
                    ฿{matRow.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {matRow.methods.map((m) => (
                    <div key={m.methodId} className="rounded-lg border border-border bg-[var(--surface-1)] px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate text-muted-foreground">{m.methodName}</span>
                        <span className="tabular-nums font-semibold text-foreground">
                          ฿{m.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">{METHOD_TYPE_LABELS[m.methodType] ?? m.methodType}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DataCard>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && report && report.methodSummary.length === 0 && (
        <EmptyState
          icon={<Banknote className="size-5" />}
          title="ยังไม่มีรายการรับเงิน"
          description="ยังไม่มีรายการรับเงินในช่วงวันที่นี้"
        />
      )}
    </div>
  );
}

// ─── Page shell ────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');

  const TABS: { key: Tab; label: string; description: string }[] = [
    { key: 'revenue', label: 'รายได้', description: 'ยอดขาย โต๊ะ ลูกค้า และช่องทางชำระเงิน' },
    { key: 'foodcost', label: 'ต้นทุนอาหาร', description: 'ต้นทุนทฤษฎีและเปอร์เซ็นต์ต้นทุน' },
    { key: 'collection', label: 'ยอดรับจริง', description: 'สรุปยอดรับตามวิธีและบัญชี' },
  ];

  return (
    <AppShell>
      <PageHeader
        title="รายงาน"
        subtitle="ศูนย์รายงานสำหรับติดตามรายได้ ต้นทุนอาหาร และยอดรับจริงของร้าน"
        className="rounded-lg border border-border bg-[var(--surface-1)] px-5 py-4 shadow-[var(--shadow-card)]"
        noBorder
        actions={(
          <Link
            href="/reports/audit"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-[var(--surface-1)] px-3 text-sm font-medium text-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ShieldCheck className="size-4" />
            ตรวจสอบ
          </Link>
        )}
      >
        <div className="flex flex-wrap gap-2 pt-1">
          <span className="rounded-full border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-1 text-xs font-medium text-[var(--status-info-fg)]">
            UI-only premium pass
          </span>
          <span className="rounded-full border border-border bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
            ไม่เปลี่ยนสูตรคำนวณ
          </span>
          <span className="rounded-full border border-border bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
            Dark-mode safe
          </span>
        </div>
      </PageHeader>

      <section className="mt-6 space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reports hub</p>
            <h2 className="text-lg font-semibold text-foreground">เลือกมุมมองรายงาน</h2>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            ทางลัดด้านล่างใช้ข้อมูลและ route เดิมทั้งหมด เพื่อให้เข้าถึงรายงานสำคัญเร็วขึ้นโดยไม่กระทบ logic รายงาน
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {REPORT_HUB_CARDS.map((card) => {
            const Icon = card.icon;
            const isActive = card.kind === 'tab' && tab === card.tab;
            const cardClassName = cn(
              'group flex min-h-44 flex-col justify-between rounded-lg border bg-[var(--surface-1)] p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border',
            );
            const content = (
              <>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border', REPORT_TONE_CLASSES[card.tone])}>
                      <Icon className="size-5" />
                    </span>
                    <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', REPORT_TONE_CLASSES[card.tone])}>
                      {card.badge}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{card.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{card.description}</p>
                  </div>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  {card.kind === 'link' ? 'เปิดหน้า' : 'ดูรายงาน'}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </>
            );

            if (card.kind === 'link') {
              return (
                <Link key={card.title} href={card.href} className={cardClassName}>
                  {content}
                </Link>
              );
            }

            return (
              <button key={card.tab} type="button" onClick={() => setTab(card.tab)} className={cardClassName}>
                {content}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-3">
        {REPORT_COMMAND_POINTS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-lg border border-border bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--surface-2)] text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="mt-6 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Report detail</p>
            <h2 className="text-lg font-semibold text-foreground">รายละเอียดรายงาน</h2>
          </div>
          <p className="text-sm text-muted-foreground">ตัวกรอง กราฟ ตาราง และ export ยังคงใช้ implementation เดิม</p>
        </div>

        <Tabs value={tab} onValueChange={(v) => { if (v) setTab(v as Tab); }} className="space-y-6">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-border bg-muted p-1">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="h-auto min-h-11 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left data-[state=active]:bg-[var(--surface-1)] data-[state=active]:shadow-sm sm:min-w-44"
              >
                <span className="text-sm font-semibold">{t.label}</span>
                <span className="hidden text-[11px] font-normal text-muted-foreground sm:block">{t.description}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="revenue" className="mt-0"><RevenueReport /></TabsContent>
          <TabsContent value="foodcost" className="mt-0"><FoodCostReport /></TabsContent>
          <TabsContent value="collection" className="mt-0"><CollectionReport /></TabsContent>
        </Tabs>
      </section>
    </AppShell>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={cn('px-4 py-3 text-xs font-semibold text-muted-foreground text-left', align === 'right' && 'text-right')}>
      {children}
    </th>
  );
}

function Td({ children, align, className }: { children: React.ReactNode; align?: 'right'; className?: string }) {
  return (
    <td className={cn('px-4 py-3 text-foreground text-sm', align === 'right' && 'text-right tabular-nums', className)}>
      {children}
    </td>
  );
}
