'use client';

import Link from 'next/link';
import { useState, useEffect, type ReactNode } from 'react';
import { format, subDays, startOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ChevronLeft,
  Clock,
  Download,
  ListOrdered,
  Loader2,
  ReceiptText,
  SkipForward,
  Timer,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { getQueueReport } from '@/lib/actions/reports/queue-report';
import type { QueueReportData } from '@/lib/actions/reports/queue-report';
import { QUEUE_STATUS_LABELS } from '@/lib/reports/report-labels';
import { CUSTOMER_TYPE_SHORT } from '@/lib/validations/queue';
import type { CustomerType } from '@/lib/validations/queue';
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayBKK() {
  return format(toZonedTime(new Date(), TZ), 'yyyy-MM-dd');
}

function fmtBKK(iso: string, fmt = 'dd/MM HH:mm') {
  return format(toZonedTime(new Date(iso), TZ), fmt);
}

function fmtWait(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} นาที`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}ชม. ${m}น.` : `${h} ชม.`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const STATUS_BAR_COLORS: Record<string, string> = {
  waiting:                'bg-[var(--status-info-fg)]',
  waiting_suitable_table: 'bg-[var(--status-warning-fg)]',
  called:                 'bg-primary',
  admitted:               'bg-[var(--status-success-fg)]',
  skipped:                'bg-[var(--status-orange-fg)]',
  cancelled:              'bg-muted-foreground',
  seated:                 'bg-[var(--status-success-fg)]',
  left:                   'bg-muted-foreground',
};

const STATUS_CHIP_CLASSES: Record<string, string> = {
  waiting:                'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
  waiting_suitable_table: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border-[var(--status-warning-border)]',
  called:                 'bg-[var(--surface-primary-subtle)] text-primary border-primary/20',
  admitted:               'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
  skipped:                'bg-[var(--status-orange-bg)] text-[var(--status-orange-fg)] border-[var(--status-orange-border)]',
  cancelled:              'bg-[var(--surface-2)] text-muted-foreground border-border',
  seated:                 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
  left:                   'bg-[var(--surface-2)] text-muted-foreground border-border',
};

const CUSTOMER_CHIP_CLASSES: Record<string, string> = {
  normal:    'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
  foreigner: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
  staff:     'bg-[var(--status-purple-bg)] text-[var(--status-purple-fg)] border-[var(--status-purple-border)]',
};

const SOUP_BAR_COLORS: Record<string, string> = {
  'น้ำดำ': 'bg-foreground',
  'น้ำใส': 'bg-[var(--status-info-fg)]',
  'หมาล่า': 'bg-[var(--status-danger-fg)]',
};

const CUSTOMER_TYPE_BAR_COLORS: Record<string, string> = {
  normal:    'bg-[var(--status-success-fg)]',
  foreigner: 'bg-[var(--status-info-fg)]',
  staff:     'bg-[var(--status-purple-fg)]',
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

type KpiTone = 'primary' | 'info' | 'success' | 'neutral';

const KPI_CLASSES: Record<KpiTone, {
  card: string; icon: string; label: string; value: string; detail: string;
}> = {
  primary: {
    card:   'border-primary/20 bg-primary shadow-[var(--shadow-card)]',
    icon:   'border-white/20 bg-white/10 text-white',
    label:  'text-white/65',
    value:  'text-white',
    detail: 'text-white/60',
  },
  info: {
    card:   'border-[var(--status-info-border)] bg-[var(--status-info-bg)] shadow-[var(--shadow-card)]',
    icon:   'border-[var(--status-info-border)] bg-[var(--surface-1)] text-[var(--status-info-fg)]',
    label:  'text-[var(--status-info-fg)]/70',
    value:  'text-[var(--status-info-fg)]',
    detail: 'text-[var(--status-info-fg)]/60',
  },
  success: {
    card:   'border-[var(--status-success-border)] bg-[var(--status-success-bg)] shadow-[var(--shadow-card)]',
    icon:   'border-[var(--status-success-border)] bg-[var(--surface-1)] text-[var(--status-success-fg)]',
    label:  'text-[var(--status-success-fg)]/70',
    value:  'text-[var(--status-success-fg)]',
    detail: 'text-[var(--status-success-fg)]/60',
  },
  neutral: {
    card:   'border-border bg-[var(--surface-1)] shadow-[var(--shadow-card)]',
    icon:   'border-border bg-[var(--surface-2)] text-muted-foreground',
    label:  'text-muted-foreground',
    value:  'text-foreground',
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
            <Skeleton className="h-7 w-24 opacity-40" />
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
  label, sub, right, rightSub, pct, color,
}: {
  label: string; sub?: string;
  right: string; rightSub?: string;
  pct: number; color: string;
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

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const label = QUEUE_STATUS_LABELS[status] ?? status;
  const cls = STATUS_CHIP_CLASSES[status] ?? 'bg-[var(--surface-2)] text-muted-foreground border-border';
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
      cls,
    )}>
      {label}
    </span>
  );
}

// ─── Customer type chip ───────────────────────────────────────────────────────

function CustomerChip({ type }: { type: string }) {
  const label = CUSTOMER_TYPE_SHORT[type as CustomerType] ?? type;
  const cls = CUSTOMER_CHIP_CLASSES[type] ?? 'bg-[var(--surface-2)] text-muted-foreground border-border';
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
      cls,
    )}>
      {label}
    </span>
  );
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function Th({ children, align }: { children: ReactNode; align?: 'right' | 'center' }) {
  return (
    <th className={cn(
      'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap',
      align === 'right'  && 'text-right',
      align === 'center' && 'text-center',
    )}>
      {children}
    </th>
  );
}

function Td({ children, align, className }: {
  children: ReactNode; align?: 'right' | 'center'; className?: string;
}) {
  return (
    <td className={cn(
      'px-4 py-3 text-sm text-foreground',
      align === 'right'  && 'text-right tabular-nums',
      align === 'center' && 'text-center',
      className,
    )}>
      {children}
    </td>
  );
}

// ─── Soup display ─────────────────────────────────────────────────────────────

function soupLabel(pots: Array<{ soups: string[] }> | null): string {
  if (!pots || pots.length === 0) return '—';
  const all = pots.flatMap((p) => p.soups);
  return all.length > 0 ? all.join(', ') : '—';
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function QueueReportPage() {
  const todayStr = todayBKK();

  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate,   setToDate]   = useState(todayStr);
  const [loading,  setLoading]  = useState(true);
  const [data,     setData]     = useState<QueueReportData | null>(null);

  useEffect(() => {
    if (fromDate > toDate) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    getQueueReport(fromDate, toDate).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setData(result.data);
      else toast.error(result.error);
    });

    return () => { cancelled = true; };
  }, [fromDate, toDate]);

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
    if (!data) return;
    const headers = ['คิว', 'วันที่/เวลา', 'สถานะ', 'ผู้ใหญ่', 'เด็ก', 'ประเภทลูกค้า', 'น้ำซุป', 'โต๊ะที่วางแผน', 'เวลารอ (นาที)', 'เหตุผลข้าม'];
    const dataRows = data.rows.map((r) => [
      r.queueNumber,
      fmtBKK(r.createdAt),
      QUEUE_STATUS_LABELS[r.status] ?? r.status,
      r.adultCount,
      r.childCount,
      CUSTOMER_TYPE_SHORT[r.customerType as CustomerType] ?? r.customerType,
      soupLabel(r.soupPots).replace(/,/g, ' /'),
      r.plannedTableNote ?? '',
      r.waitMinutes ?? '',
      r.skipReason ?? '',
    ]);
    downloadCsv(
      `queue-report-${fromDate}-${toDate}.csv`,
      [headers, ...dataRows].map((r) => r.join(',')).join('\n'),
    );
  }

  const dateLabel = fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;

  return (
    <AppShell>
      <PageHeader
        title="รายงานคิว"
        subtitle="วิเคราะห์จำนวนคิว การรับเข้า การข้ามคิว การยกเลิก และเวลารอ"
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
            disabled={!data || loading}
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

            {loading && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {fromDate > toDate && (
            <p className="mt-3 text-xs text-destructive">วันเริ่มต้นต้องไม่เกินวันสิ้นสุด</p>
          )}
        </DataCard>

        {/* ── KPI grid (8 cards, 2×4) ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard
            label="คิวทั้งหมด"
            value={data?.totalQueues ?? '—'}
            detail={loading ? undefined : dateLabel}
            icon={<ListOrdered className="size-5" />}
            tone="primary"
            loading={loading}
          />
          <KpiCard
            label="รับเข้า"
            value={data?.admitted ?? '—'}
            detail={loading || !data ? undefined : `${data.totalQueues > 0 ? Math.round((data.admitted / data.totalQueues) * 100) : 0}% ของคิวทั้งหมด`}
            icon={<UserCheck className="size-5" />}
            tone="success"
            loading={loading}
          />
          <KpiCard
            label="ออกบิลแล้ว"
            value={data?.billed ?? '—'}
            detail={loading || !data ? undefined : `จาก ${data.admitted} รายที่รับเข้า`}
            icon={<ReceiptText className="size-5" />}
            tone="success"
            loading={loading}
          />
          <KpiCard
            label="เวลารอเฉลี่ย"
            value={loading ? '—' : data?.avgWaitMinutes !== null && data?.avgWaitMinutes !== undefined ? fmtWait(data.avgWaitMinutes) : '—'}
            detail={loading ? undefined : data?.avgWaitMinutes === null ? 'ยังไม่มีข้อมูลพอ' : 'ตั้งแต่รับคิวถึงรับเข้า'}
            icon={<Timer className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="รอ / ยังไม่จบ"
            value={data?.activeQueues ?? '—'}
            detail="waiting · called · รอโต๊ะ"
            icon={<Clock className="size-5" />}
            tone="info"
            loading={loading}
          />
          <KpiCard
            label="ข้าม"
            value={data?.skipped ?? '—'}
            detail={loading || !data ? undefined : `${data.totalQueues > 0 ? Math.round((data.skipped / data.totalQueues) * 100) : 0}% ของคิวทั้งหมด`}
            icon={<SkipForward className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="ยกเลิก"
            value={data?.cancelled ?? '—'}
            detail={loading || !data ? undefined : `${data.totalQueues > 0 ? Math.round((data.cancelled / data.totalQueues) * 100) : 0}% ของคิวทั้งหมด`}
            icon={<XCircle className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="ลูกค้ารวม"
            value={data?.totalPersons ?? '—'}
            detail={loading || !data ? undefined : `${data.totalAdults} ผู้ใหญ่ · ${data.totalChildren} เด็ก`}
            icon={<Users className="size-5" />}
            tone="neutral"
            loading={loading}
          />
        </div>

        {/* ── Chart + Status breakdown ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

          {/* Daily queue count chart */}
          <DataCard
            title="จำนวนคิวรายวัน"
            subtitle={`ช่วงวันที่ ${dateLabel}`}
            className="lg:col-span-2"
          >
            {loading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : !data || data.dailyRows.length === 0 ? (
              <EmptyState
                icon={<ListOrdered className="size-5" />}
                title="ไม่พบข้อมูลคิวในช่วงวันที่เลือก"
                size="sm"
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.dailyRows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => format(new Date(v + 'T00:00:00'), 'dd/MM')}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [Number(v), 'คิว']}
                    labelFormatter={(l) => typeof l === 'string' ? fmtBKK(l + 'T00:00:00', 'dd/MM/yyyy') : String(l)}
                    contentStyle={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DataCard>

          {/* Status breakdown */}
          <DataCard title="สถานะคิว" subtitle="สัดส่วนแต่ละสถานะ">
            {loading ? (
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                ))}
              </div>
            ) : !data || data.statusSummary.length === 0 ? (
              <EmptyState
                icon={<ListOrdered className="size-5" />}
                title="ไม่มีข้อมูล"
                size="sm"
              />
            ) : (
              <div className="space-y-4">
                {data.statusSummary.map((s) => (
                  <PctBar
                    key={s.status}
                    label={s.label}
                    right={`${s.count} คิว`}
                    rightSub={`${s.pct}%`}
                    pct={s.pct}
                    color={STATUS_BAR_COLORS[s.status] ?? 'bg-muted-foreground'}
                  />
                ))}
              </div>
            )}
          </DataCard>
        </div>

        {/* ── Customer type + Adults/Children + Soup ───────────────────────── */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">

          {/* Customer type */}
          <DataCard title="ประเภทลูกค้า" subtitle="สัดส่วนตามประเภท">
            {loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : !data || data.customerTypeSummary.length === 0 ? (
              <EmptyState icon={<Users className="size-5" />} title="ไม่มีข้อมูล" size="sm" />
            ) : (
              <div className="space-y-4">
                {data.customerTypeSummary.map((ct) => (
                  <PctBar
                    key={ct.type}
                    label={ct.label}
                    sub={`${ct.personCount} คน`}
                    right={`${ct.queueCount} คิว`}
                    rightSub={`${ct.pct}%`}
                    pct={ct.pct}
                    color={CUSTOMER_TYPE_BAR_COLORS[ct.type] ?? 'bg-muted-foreground'}
                  />
                ))}
              </div>
            )}
          </DataCard>

          {/* Adults / Children */}
          <DataCard title="ผู้ใหญ่ / เด็ก" subtitle="จำนวนลูกค้าแยกตามประเภท">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : !data ? (
              <EmptyState icon={<Users className="size-5" />} title="ไม่มีข้อมูล" size="sm" />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-4 py-3">
                  <p className="text-sm font-medium text-muted-foreground">ผู้ใหญ่</p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">{data.totalAdults}</p>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-4 py-3">
                  <p className="text-sm font-medium text-muted-foreground">เด็ก</p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">{data.totalChildren}</p>
                </div>
                {data.totalQueues > 0 && (
                  <p className="text-center text-xs text-muted-foreground">
                    เฉลี่ย {(data.totalPersons / data.totalQueues).toFixed(1)} คน/คิว
                  </p>
                )}
              </div>
            )}
          </DataCard>

          {/* Soup */}
          <DataCard title="น้ำซุปที่เลือก" subtitle="นับทุก slot รวมซ้ำ">
            {loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : !data || data.soupSummary.length === 0 ? (
              <EmptyState
                icon={<ListOrdered className="size-5" />}
                title="ไม่มีข้อมูลน้ำซุป"
                size="sm"
              />
            ) : (
              <div className="space-y-4">
                {data.soupSummary.map((s) => (
                  <PctBar
                    key={s.soup}
                    label={s.soup}
                    right={`${s.count} slot`}
                    rightSub={`${s.pct}%`}
                    pct={s.pct}
                    color={SOUP_BAR_COLORS[s.soup] ?? 'bg-muted-foreground'}
                  />
                ))}
              </div>
            )}
          </DataCard>
        </div>

        {/* ── Skip reasons ─────────────────────────────────────────────────── */}
        {(!loading && data && data.skipped > 0) && (
          <DataCard
            title="เหตุผลข้ามคิว"
            subtitle={`${data.skipped} คิวที่ถูกข้าม`}
          >
            {data.skipReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">ไม่มีเหตุผลที่บันทึกไว้</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.skipReasons.map(({ reason, count }) => (
                  <div
                    key={reason}
                    className="flex items-center gap-2 rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2"
                  >
                    <span className="text-sm font-medium text-foreground">{reason}</span>
                    <span className="flex size-5 items-center justify-center rounded-full bg-[var(--status-orange-bg)] text-[10px] font-bold text-[var(--status-orange-fg)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </DataCard>
        )}

        {/* ── Detail table ─────────────────────────────────────────────────── */}
        <DataCard title="รายละเอียดคิว" subtitle={`${data?.rows.length ?? 0} รายการ`} noPadding>
          {loading ? (
            <div className="space-y-0 divide-y divide-border">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex gap-4 px-4 py-3.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<ListOrdered className="size-5" />}
                title="ไม่พบข้อมูลคิวในช่วงวันที่เลือก"
                description="ลองเปลี่ยนช่วงวันที่หรือตรวจสอบว่ามีการบันทึกคิวในช่วงนี้"
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[780px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-[var(--surface-2)]">
                    <Th>คิว</Th>
                    <Th>วันที่/เวลา</Th>
                    <Th>สถานะ</Th>
                    <Th align="center">ผู้ใหญ่</Th>
                    <Th align="center">เด็ก</Th>
                    <Th>ประเภท</Th>
                    <Th>น้ำซุป</Th>
                    <Th>โต๊ะที่วางแผน</Th>
                    <Th align="right">เวลารอ</Th>
                    <Th>เหตุผลข้าม</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-[var(--surface-2)] transition-colors">
                      <Td className="font-mono font-semibold">{row.queueNumber}</Td>
                      <Td className="whitespace-nowrap text-muted-foreground text-xs">
                        {fmtBKK(row.createdAt)}
                      </Td>
                      <Td><StatusChip status={row.status} /></Td>
                      <Td align="center">{row.adultCount}</Td>
                      <Td align="center">{row.childCount}</Td>
                      <Td><CustomerChip type={row.customerType} /></Td>
                      <Td className="max-w-[140px] truncate text-xs text-muted-foreground">
                        {soupLabel(row.soupPots)}
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        {row.plannedTableNote ?? '—'}
                      </Td>
                      <Td align="right" className="text-xs text-muted-foreground">
                        {fmtWait(row.waitMinutes)}
                      </Td>
                      <Td className="max-w-[160px] truncate text-xs text-muted-foreground">
                        {row.skipReason ?? '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

      </div>
    </AppShell>
  );
}
