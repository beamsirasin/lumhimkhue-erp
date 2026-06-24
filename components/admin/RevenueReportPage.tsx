'use client';

import Link from 'next/link';
import { useState, useEffect, type ReactNode } from 'react';
import { format, subDays, startOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Banknote,
  BarChart3,
  ChevronLeft,
  Download,
  Loader2,
  ReceiptText,
  TrendingUp,
  Users,
  WalletCards,
} from 'lucide-react';
import { getReportSummary } from '@/lib/actions/dashboard';
import { getPaymentCollectionReport } from '@/lib/actions/reports/collection';
import type { ReportSummary } from '@/lib/actions/dashboard';
import type { PaymentCollectionReport } from '@/lib/actions/reports/collection';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const TZ = 'Asia/Bangkok';
type SessionType = 'all' | 'primary' | 'secondary';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayBKK() {
  return format(toZonedTime(new Date(), TZ), 'yyyy-MM-dd');
}

function thb(v: number, dp = 0) {
  return `฿${v.toLocaleString('th-TH', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Label maps ───────────────────────────────────────────────────────────────

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

// ─── KPI Card ─────────────────────────────────────────────────────────────────

type KpiTone = 'primary' | 'info' | 'success' | 'neutral';

const KPI_CLASSES: Record<KpiTone, {
  card: string; icon: string; label: string; value: string; detail: string;
}> = {
  primary: {
    card: 'border-primary/20 bg-primary shadow-[var(--shadow-card)]',
    icon: 'border-white/20 bg-white/10 text-white',
    label: 'text-white/65',
    value: 'text-white',
    detail: 'text-white/60',
  },
  info: {
    card: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] shadow-[var(--shadow-card)]',
    icon: 'border-[var(--status-info-border)] bg-[var(--surface-1)] text-[var(--status-info-fg)]',
    label: 'text-[var(--status-info-fg)]/70',
    value: 'text-[var(--status-info-fg)]',
    detail: 'text-[var(--status-info-fg)]/60',
  },
  success: {
    card: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] shadow-[var(--shadow-card)]',
    icon: 'border-[var(--status-success-border)] bg-[var(--surface-1)] text-[var(--status-success-fg)]',
    label: 'text-[var(--status-success-fg)]/70',
    value: 'text-[var(--status-success-fg)]',
    detail: 'text-[var(--status-success-fg)]/60',
  },
  neutral: {
    card: 'border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)]',
    icon: 'border-border bg-[var(--surface-2)] text-muted-foreground',
    label: 'text-muted-foreground',
    value: 'text-foreground',
    detail: 'text-muted-foreground',
  },
};

function KpiCard({
  label, value, detail, icon, tone = 'neutral', loading,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon: ReactNode;
  tone?: KpiTone;
  loading?: boolean;
}) {
  const cls = KPI_CLASSES[tone];
  if (loading) {
    return (
      <div className={cn('rounded-xl border p-5', cls.card)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-2.5 w-20 opacity-40" />
            <Skeleton className="h-7 w-28 opacity-40" />
          </div>
          <Skeleton className="size-10 shrink-0 rounded-lg opacity-40" />
        </div>
        <Skeleton className="mt-3.5 h-2.5 w-24 opacity-40" />
      </div>
    );
  }
  return (
    <div className={cn('rounded-xl border p-5', cls.card)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn('text-[11px] font-semibold uppercase tracking-widest', cls.label)}>
            {label}
          </p>
          <p className={cn('mt-2 text-[1.625rem] font-bold leading-none tabular-nums', cls.value)}>
            {value}
          </p>
        </div>
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border', cls.icon)}>
          {icon}
        </span>
      </div>
      {detail && (
        <p className={cn('mt-3 text-xs leading-5', cls.detail)}>{detail}</p>
      )}
    </div>
  );
}

// ─── Progress bar row ─────────────────────────────────────────────────────────

function PctBar({
  label,
  sub,
  right,
  rightSub,
  pct,
  color,
}: {
  label: string;
  sub?: string;
  right: string;
  rightSub?: string;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums text-foreground">{right}</p>
          {rightSub && <p className="mt-0.5 text-[11px] text-muted-foreground">{rightSub}</p>}
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className={cn('h-2 rounded-full transition-[width] duration-500', color)}
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function Th({ children, align }: { children: ReactNode; align?: 'right' }) {
  return (
    <th className={cn(
      'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap',
      align === 'right' && 'text-right',
    )}>
      {children}
    </th>
  );
}

function Td({ children, align, className }: { children: ReactNode; align?: 'right'; className?: string }) {
  return (
    <td className={cn(
      'px-4 py-3 text-sm text-foreground',
      align === 'right' && 'text-right tabular-nums',
      className,
    )}>
      {children}
    </td>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function RevenueReportPage() {
  const todayStr = todayBKK();

  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  const [sessionType, setSessionType] = useState<SessionType>('all');

  const [loading, setLoading] = useState(true);
  const [revData, setRevData] = useState<ReportSummary | null>(null);
  const [colData, setColData] = useState<PaymentCollectionReport | null>(null);

  // Fetch both reports in parallel whenever filters change
  useEffect(() => {
    if (fromDate > toDate) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    Promise.all([
      getReportSummary(fromDate, toDate, sessionType),
      getPaymentCollectionReport(fromDate, toDate),
    ]).then(([rev, col]) => {
      if (cancelled) return;
      setLoading(false);
      if (rev.ok) setRevData(rev.data);
      else toast.error(rev.error);
      if (col.ok) setColData(col.data);
      else toast.error(col.error);
    });

    return () => { cancelled = true; };
  }, [fromDate, toDate, sessionType]);

  function applyPreset(preset: 'today' | '7d' | 'month') {
    const now = toZonedTime(new Date(), TZ);
    const d = format(now, 'yyyy-MM-dd');
    if (preset === 'today') {
      setFromDate(d); setToDate(d);
    } else if (preset === '7d') {
      setFromDate(format(subDays(now, 6), 'yyyy-MM-dd'));
      setToDate(d);
    } else {
      setFromDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setToDate(d);
    }
  }

  function handleExport() {
    if (!revData) return;
    const { rows, totals } = revData;
    const headers = ['วันที่', 'จำนวนบิล', 'จำนวนลูกค้า', 'รายได้รวม (฿)', 'เฉลี่ยต่อโต๊ะ (฿)', 'เฉลี่ยต่อหัว (฿)'];
    const dataRows = rows.map((r) => [
      r.date,
      r.sessions,
      r.guests,
      r.revenue.toFixed(2),
      r.avgPerSession.toFixed(2),
      r.guests > 0 ? (r.revenue / r.guests).toFixed(2) : '0.00',
    ]);
    const totalRow = [
      'รวม',
      totals.sessions,
      totals.guests,
      totals.revenue.toFixed(2),
      totals.sessions > 0 ? (totals.revenue / totals.sessions).toFixed(2) : '0.00',
      totals.guests > 0 ? (totals.revenue / totals.guests).toFixed(2) : '0.00',
    ];
    downloadCsv(
      `revenue-report-${fromDate}-${toDate}.csv`,
      [headers, ...dataRows, totalRow].map((r) => r.join(',')).join('\n'),
    );
  }

  // Derived values — no calculations changed from server actions
  const totals = revData?.totals;
  const avgPerSession = totals && totals.sessions > 0 ? totals.revenue / totals.sessions : 0;
  const avgPerGuest = totals && totals.guests > 0 ? totals.revenue / totals.guests : 0;
  const totalGuests = totals?.guests ?? 0;
  const sortedGuests = revData ? [...revData.guestBreakdown].sort((a, b) => b.total - a.total) : [];
  const totalColAmount = colData?.totalCollected ?? 0;
  const dateLabel = fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;

  return (
    <AppShell>
      <PageHeader
        title="รายได้"
        subtitle="สรุปรายได้ ยอดรับจริง ช่องทางชำระ และบัญชีรับเงิน"
        breadcrumb={
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            รายงาน
          </Link>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!revData || loading}
            className="gap-2"
          >
            <Download className="size-4" />
            Export CSV
          </Button>
        }
      />

      <div className="mt-6 space-y-5">

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <DataCard>
          <div className="flex flex-wrap items-end gap-3">

            {/* Date range inputs */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">วันเริ่มต้น</Label>
                <Input
                  type="date"
                  value={fromDate}
                  max={todayStr}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-10 w-40"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">วันสิ้นสุด</Label>
                <Input
                  type="date"
                  value={toDate}
                  max={todayStr}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-10 w-40"
                />
              </div>
            </div>

            {/* Quick presets */}
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-1">
              {([
                { key: 'today', label: 'วันนี้' },
                { key: '7d',    label: '7 วัน' },
                { key: 'month', label: 'เดือนนี้' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Session type toggle */}
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-1">
              {(['all', 'primary', 'secondary'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSessionType(t)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    sessionType === t
                      ? 'bg-[var(--surface-1)] text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {SESSION_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {loading && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {fromDate > toDate && (
            <p className="mt-3 text-xs text-destructive">วันเริ่มต้นต้องไม่เกินวันสิ้นสุด</p>
          )}
        </DataCard>

        {/* ── KPI cards — 2 col mobile / 3 col tablet / 6 col desktop ─────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            label="รายได้รวม"
            value={thb(totals?.revenue ?? 0, 0)}
            detail={dateLabel}
            icon={<Banknote className="size-5" />}
            tone="primary"
            loading={loading}
          />
          <KpiCard
            label="ยอดรับจริง"
            value={thb(totalColAmount, 2)}
            detail="จาก payment_rows"
            icon={<WalletCards className="size-5" />}
            tone="info"
            loading={loading}
          />
          <KpiCard
            label="จำนวนบิล"
            value={(totals?.sessions ?? 0).toLocaleString('th-TH')}
            detail="โต๊ะ / รอบ"
            icon={<ReceiptText className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="จำนวนลูกค้า"
            value={totalGuests.toLocaleString('th-TH')}
            detail="คน"
            icon={<Users className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="เฉลี่ยต่อโต๊ะ"
            value={thb(avgPerSession, 0)}
            detail="บาท / รอบ"
            icon={<BarChart3 className="size-5" />}
            tone="success"
            loading={loading}
          />
          <KpiCard
            label="เฉลี่ยต่อหัว"
            value={totalGuests > 0 ? thb(avgPerGuest, 0) : '—'}
            detail={totalGuests > 0 ? 'บาท / คน' : 'ยังไม่มีข้อมูล'}
            icon={<TrendingUp className="size-5" />}
            tone="success"
            loading={loading}
          />
        </div>

        {/* ── Revenue chart + Guest breakdown ─────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

          {/* Chart — 2/3 */}
          <DataCard
            title="รายได้รายวัน"
            subtitle={revData && revData.rows.length > 0 ? `${revData.rows.length} วัน` : undefined}
            className="lg:col-span-2"
          >
            {loading ? (
              <Skeleton className="h-[240px] w-full rounded-lg" />
            ) : !revData || revData.rows.length === 0 ? (
              <div className="flex min-h-[240px] items-center justify-center">
                <EmptyState
                  icon={<BarChart3 className="size-5" />}
                  title="ยังไม่มีรายได้ในช่วงนี้"
                  description="กราฟจะปรากฏเมื่อมีการชำระเงินสำเร็จในช่วงวันที่เลือก"
                  size="sm"
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={revData.rows}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickFormatter={(v: string) => v.slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickFormatter={(v: number) => v >= 1000 ? `฿${(v / 1000).toFixed(0)}K` : `฿${v}`}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={{
                      backgroundColor: 'var(--surface-1)',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      color: 'var(--foreground)',
                      fontSize: 12,
                      boxShadow: 'var(--shadow-card)',
                    }}
                    formatter={(v) => [`฿${Number(v).toLocaleString('th-TH')}`, 'รายได้']}
                    labelFormatter={(l) => `วันที่ ${l}`}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="var(--chart-1)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={56}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DataCard>

          {/* Guest type breakdown — 1/3 */}
          <DataCard
            title="ประเภทลูกค้า"
            subtitle={totalGuests > 0 ? `${totalGuests} คน` : undefined}
          >
            {loading ? (
              <div className="space-y-5">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
              </div>
            ) : sortedGuests.length === 0 ? (
              <p className="text-sm text-muted-foreground">ไม่มีข้อมูล</p>
            ) : (
              <div className="space-y-5">
                {sortedGuests.map((g) => {
                  const pct = totalGuests > 0 ? (g.total / totalGuests) * 100 : 0;
                  return (
                    <PctBar
                      key={g.name}
                      label={g.name}
                      right={`${g.total} คน`}
                      rightSub={`${pct.toFixed(1)}%`}
                      pct={pct}
                      color="bg-[var(--chart-2)]"
                    />
                  );
                })}
              </div>
            )}
          </DataCard>
        </div>

        {/* ── Method + Account breakdown ───────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* Payment methods */}
          <DataCard
            title="ช่องทางชำระเงิน"
            subtitle={colData ? `ยอดรับจริงรวม ${thb(totalColAmount, 2)}` : undefined}
          >
            {loading ? (
              <div className="space-y-5">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : !colData || colData.methodSummary.length === 0 ? (
              <EmptyState
                icon={<Banknote className="size-5" />}
                title="ไม่มีรายการรับเงิน"
                description="ไม่มีรายการในช่วงนี้"
              />
            ) : (
              <div className="space-y-5">
                {colData.methodSummary.map((m) => {
                  const pct = totalColAmount > 0 ? (m.amount / totalColAmount) * 100 : 0;
                  return (
                    <PctBar
                      key={m.methodId}
                      label={m.methodName}
                      sub={METHOD_TYPE_LABELS[m.methodType] ?? m.methodType}
                      right={thb(m.amount, 2)}
                      rightSub={`${m.rowCount} รายการ · ${pct.toFixed(1)}%`}
                      pct={pct}
                      color="bg-[var(--chart-1)]"
                    />
                  );
                })}
              </div>
            )}
          </DataCard>

          {/* Receiving accounts */}
          <DataCard
            title="บัญชีรับเงิน"
            subtitle={colData && colData.accountSummary.length > 0
              ? `${colData.accountSummary.length} บัญชีที่มีรายการ`
              : undefined}
          >
            {loading ? (
              <div className="space-y-5">
                {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : !colData || colData.accountSummary.length === 0 ? (
              <EmptyState
                icon={<WalletCards className="size-5" />}
                title="ไม่มีรายการรับเงิน"
                description="ไม่มีรายการในช่วงนี้"
              />
            ) : (
              <div className="space-y-5">
                {colData.accountSummary.map((a) => {
                  const pct = totalColAmount > 0 ? (a.amount / totalColAmount) * 100 : 0;
                  return (
                    <PctBar
                      key={a.accountId}
                      label={a.accountName}
                      sub={ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType}
                      right={thb(a.amount, 2)}
                      rightSub={`${a.rowCount} รายการ · ${pct.toFixed(1)}%`}
                      pct={pct}
                      color="bg-[var(--chart-3)]"
                    />
                  );
                })}
              </div>
            )}
          </DataCard>
        </div>

        {/* ── Account × Method matrix ──────────────────────────────────────── */}
        {!loading && colData && colData.matrix.length > 0 && (
          <DataCard
            noPadding
            title="รายละเอียด: บัญชีรับเงิน × ช่องทางชำระ"
            subtitle="ยอดรับในแต่ละบัญชีแยกตามช่องทาง"
          >
            <div className="divide-y divide-border">
              {colData.matrix.map((matRow) => (
                <div
                  key={matRow.accountId}
                  className="px-5 py-4 transition-colors hover:bg-[var(--surface-2)]/40"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {matRow.accountName}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-border bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-muted-foreground">
                          {ACCOUNT_TYPE_LABELS[matRow.accountType] ?? matRow.accountType}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{matRow.accountCode}</p>
                    </div>
                    <span className="rounded-lg border border-border bg-[var(--surface-2)] px-3 py-1.5 text-sm font-bold tabular-nums text-foreground">
                      {thb(matRow.total, 2)}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {matRow.methods.map((m) => (
                      <div
                        key={m.methodId}
                        className="rounded-lg border border-border bg-[var(--surface-1)] px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-muted-foreground">{m.methodName}</span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {thb(m.amount, 2)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {METHOD_TYPE_LABELS[m.methodType] ?? m.methodType}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </DataCard>
        )}

        {/* ── Daily detail table ───────────────────────────────────────────── */}
        {!loading && revData ? (
          <DataCard noPadding title="รายละเอียดรายวัน" subtitle={dateLabel}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-[var(--surface-2)]">
                    <Th>วันที่</Th>
                    <Th align="right">จำนวนบิล</Th>
                    <Th align="right">จำนวนลูกค้า</Th>
                    <Th align="right">รายได้รวม</Th>
                    <Th align="right">เฉลี่ยต่อโต๊ะ</Th>
                    <Th align="right">เฉลี่ยต่อหัว</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {revData.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-10 text-center text-xs text-muted-foreground"
                      >
                        ไม่พบข้อมูลรายได้ในช่วงวันที่เลือก
                      </td>
                    </tr>
                  )}
                  {revData.rows.map((r) => (
                    <tr
                      key={r.date}
                      className="transition-colors hover:bg-[var(--surface-2)]/60"
                    >
                      <Td>{r.date}</Td>
                      <Td align="right">{r.sessions}</Td>
                      <Td align="right">{r.guests}</Td>
                      <Td align="right" className="font-medium">
                        {thb(r.revenue, 2)}
                      </Td>
                      <Td align="right">{thb(r.avgPerSession, 0)}</Td>
                      <Td align="right">
                        {r.guests > 0 ? thb(r.revenue / r.guests, 0) : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                {revData.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-[var(--surface-2)] font-semibold">
                      <Td>รวม</Td>
                      <Td align="right">{revData.totals.sessions}</Td>
                      <Td align="right">{revData.totals.guests}</Td>
                      <Td align="right">{thb(revData.totals.revenue, 2)}</Td>
                      <Td align="right">
                        {thb(
                          revData.totals.sessions > 0
                            ? revData.totals.revenue / revData.totals.sessions
                            : 0,
                          0,
                        )}
                      </Td>
                      <Td align="right">
                        {revData.totals.guests > 0
                          ? thb(revData.totals.revenue / revData.totals.guests, 0)
                          : '—'}
                      </Td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </DataCard>
        ) : loading ? (
          <DataCard noPadding title="รายละเอียดรายวัน">
            <div className="space-y-0 divide-y divide-border">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-4 py-3.5">
                  <Skeleton className="h-5 w-full" />
                </div>
              ))}
            </div>
          </DataCard>
        ) : null}

      </div>
    </AppShell>
  );
}
