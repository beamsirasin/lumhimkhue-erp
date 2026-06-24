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
  Banknote,
  CheckCircle2,
  ChevronLeft,
  Download,
  LayoutGrid,
  Loader2,
  Timer,
  Users,
  UsersRound,
} from 'lucide-react';
import { getTableReport } from '@/lib/actions/reports/table-report';
import type { TableReportData } from '@/lib/actions/reports/table-report';
import { SESSION_STATUS_LABELS } from '@/lib/reports/report-labels';
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

function fmtDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} นาที`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}ชม. ${m}น.` : `${h} ชม.`;
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

// ─── Style maps ───────────────────────────────────────────────────────────────

const STATUS_BAR_COLORS: Record<string, string> = {
  active:  'bg-[var(--status-success-fg)]',
  closing: 'bg-[var(--status-warning-fg)]',
  closed:  'bg-[var(--status-info-fg)]',
  paid:    'bg-primary',
};

const STATUS_CHIP_CLASSES: Record<string, string> = {
  active:  'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
  closing: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border-[var(--status-warning-border)]',
  closed:  'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
  paid:    'bg-[var(--status-purple-bg)] text-[var(--status-purple-fg)] border-[var(--status-purple-border)]',
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
  label: string; value: ReactNode; detail?: ReactNode;
  icon: ReactNode; tone?: KpiTone; loading?: boolean;
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
  label: string; sub?: string; right: string; rightSub?: string; pct: number; color: string;
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
  const label = SESSION_STATUS_LABELS[status] ?? status;
  const cls   = STATUS_CHIP_CLASSES[status] ?? 'bg-[var(--surface-2)] text-muted-foreground border-border';
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
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

// ─── Main page ────────────────────────────────────────────────────────────────

export function TableReportPage() {
  const todayStr = todayBKK();

  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate,   setToDate]   = useState(todayStr);
  const [loading,  setLoading]  = useState(true);
  const [data,     setData]     = useState<TableReportData | null>(null);

  useEffect(() => {
    if (fromDate > toDate) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    getTableReport(fromDate, toDate).then((result) => {
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
    const headers = ['วันที่เปิด', 'เวลาเปิด', 'โต๊ะ', 'โซน', 'สถานะ', 'ลูกค้า', 'เวลาใช้งาน (นาที)', 'ยอดบิล (฿)', 'เวลาปิด'];
    const dataRows = data.rows.map((r) => [
      fmtBKK(r.startedAt, 'dd/MM/yyyy'),
      fmtBKK(r.startedAt, 'HH:mm'),
      r.tableLabel,
      r.tableZone,
      SESSION_STATUS_LABELS[r.status] ?? r.status,
      r.guestCount ?? '',
      r.durationMinutes ?? '',
      r.revenue !== null ? r.revenue.toFixed(2) : '',
      r.closedAt ? fmtBKK(r.closedAt) : '',
    ]);
    downloadCsv(
      `table-report-${fromDate}-${toDate}.csv`,
      [headers, ...dataRows].map((row) => row.join(',')).join('\n'),
    );
  }

  const dateLabel = fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;

  return (
    <AppShell>
      <PageHeader
        title="รายงานโต๊ะ"
        subtitle="วิเคราะห์การเปิดโต๊ะ จำนวนลูกค้า รอบโต๊ะ และระยะเวลาการนั่ง"
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

        {/* ── KPI grid (6 cards, 2×3) ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <KpiCard
            label="เปิดโต๊ะทั้งหมด"
            value={data?.totalSessions ?? '—'}
            detail={loading ? undefined : dateLabel}
            icon={<LayoutGrid className="size-5" />}
            tone="primary"
            loading={loading}
          />
          <KpiCard
            label="ปิดแล้ว"
            value={data?.closedSessions ?? '—'}
            detail={loading || !data ? undefined
              : `ยังเปิดอยู่ ${data.openSessions} โต๊ะ`}
            icon={<CheckCircle2 className="size-5" />}
            tone="success"
            loading={loading}
          />
          <KpiCard
            label="ลูกค้ารวม"
            value={data?.totalGuests ?? '—'}
            detail="จากโต๊ะหลัก (primary sessions)"
            icon={<Users className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="เวลาเฉลี่ย"
            value={loading ? '—'
              : data?.avgDurationMinutes !== null && data?.avgDurationMinutes !== undefined
              ? fmtDuration(data.avgDurationMinutes)
              : '—'}
            detail={loading ? undefined
              : data?.avgDurationMinutes === null
              ? 'ยังไม่มีข้อมูลพอ'
              : 'เฉพาะโต๊ะที่ปิดแล้ว'}
            icon={<Timer className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="เฉลี่ยคน/โต๊ะ"
            value={loading ? '—'
              : data?.avgGuestsPerSession !== null && data?.avgGuestsPerSession !== undefined
              ? data.avgGuestsPerSession.toFixed(1)
              : '—'}
            detail="เฉพาะโต๊ะที่มีข้อมูลผู้ใช้บริการ"
            icon={<UsersRound className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="รายได้รวม"
            value={loading ? '—' : data ? thb(data.totalRevenue) : '—'}
            detail={loading || !data ? undefined
              : data.avgRevenuePerSession !== null
              ? `เฉลี่ย ${thb(data.avgRevenuePerSession)}/โต๊ะ`
              : 'ยังไม่มีการชำระเงิน'}
            icon={<Banknote className="size-5" />}
            tone="info"
            loading={loading}
          />
        </div>

        {/* ── Chart + Status breakdown ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

          {/* Daily sessions chart */}
          <DataCard
            title="จำนวนโต๊ะที่เปิดรายวัน"
            subtitle={`ช่วงวันที่ ${dateLabel}`}
            className="lg:col-span-2"
          >
            {loading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : !data || data.dailyRows.length === 0 ? (
              <EmptyState
                icon={<LayoutGrid className="size-5" />}
                title="ไม่พบข้อมูลโต๊ะในช่วงวันที่เลือก"
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
                    formatter={(v) => [Number(v), 'โต๊ะ']}
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

          {/* Session status breakdown */}
          <DataCard title="สถานะโต๊ะ" subtitle="สัดส่วนแต่ละสถานะ">
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
              <EmptyState icon={<LayoutGrid className="size-5" />} title="ไม่มีข้อมูล" size="sm" />
            ) : (
              <div className="space-y-4">
                {data.statusSummary.map((s) => (
                  <PctBar
                    key={s.status}
                    label={s.label}
                    right={`${s.count} โต๊ะ`}
                    rightSub={`${s.pct}%`}
                    pct={s.pct}
                    color={STATUS_BAR_COLORS[s.status] ?? 'bg-muted-foreground'}
                  />
                ))}
              </div>
            )}
          </DataCard>
        </div>

        {/* ── Table usage breakdown ────────────────────────────────────────── */}
        <DataCard
          title="การใช้งานแต่ละโต๊ะ"
          subtitle={`${data?.tableBreakdown.length ?? 0} โต๊ะ`}
          noPadding
        >
          {loading ? (
            <div className="space-y-0 divide-y divide-border">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex gap-4 px-4 py-3.5">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : !data || data.tableBreakdown.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<LayoutGrid className="size-5" />}
                title="ไม่พบข้อมูลโต๊ะในช่วงวันที่เลือก"
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[580px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-[var(--surface-2)]">
                    <Th>โต๊ะ</Th>
                    <Th>โซน</Th>
                    <Th align="center">รอบ</Th>
                    <Th align="center">ลูกค้า</Th>
                    <Th align="right">เวลาเฉลี่ย</Th>
                    <Th align="right">รายได้</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.tableBreakdown.map((t) => (
                    <tr key={t.tableId} className="hover:bg-[var(--surface-2)] transition-colors">
                      <Td className="font-semibold">{t.tableLabel}</Td>
                      <Td className="text-xs text-muted-foreground">{t.tableZone}</Td>
                      <Td align="center">{t.sessionCount}</Td>
                      <Td align="center">{t.guestCount > 0 ? t.guestCount : '—'}</Td>
                      <Td align="right" className="text-xs text-muted-foreground">
                        {fmtDuration(t.avgDurationMinutes)}
                      </Td>
                      <Td align="right" className="text-xs text-muted-foreground">
                        {t.revenue > 0 ? thb(t.revenue) : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        {/* ── Longest sessions ─────────────────────────────────────────────── */}
        {(!loading && data && data.longestSessions.length > 0) && (
          <DataCard
            title="โต๊ะที่นั่งนานที่สุด"
            subtitle="เฉพาะโต๊ะที่ปิดแล้ว (top 10)"
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="min-w-[560px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-[var(--surface-2)]">
                    <Th>โต๊ะ</Th>
                    <Th>เปิดเมื่อ</Th>
                    <Th>ปิดเมื่อ</Th>
                    <Th align="right">ระยะเวลา</Th>
                    <Th align="center">ลูกค้า</Th>
                    <Th>สถานะ</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.longestSessions.map((r) => (
                    <tr key={r.sessionId} className="hover:bg-[var(--surface-2)] transition-colors">
                      <Td className="font-semibold">{r.tableLabel}</Td>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtBKK(r.startedAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.closedAt ? fmtBKK(r.closedAt) : '—'}
                      </Td>
                      <Td align="right" className="font-medium">
                        {fmtDuration(r.durationMinutes)}
                      </Td>
                      <Td align="center">
                        {r.guestCount !== null ? r.guestCount : '—'}
                      </Td>
                      <Td><StatusChip status={r.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCard>
        )}

        {/* ── Detail table ─────────────────────────────────────────────────── */}
        <DataCard
          title="รายละเอียดโต๊ะทั้งหมด"
          subtitle={`${data?.rows.length ?? 0} รายการ`}
          noPadding
        >
          {loading ? (
            <div className="space-y-0 divide-y divide-border">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex gap-4 px-4 py-3.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<LayoutGrid className="size-5" />}
                title="ไม่พบข้อมูลโต๊ะในช่วงวันที่เลือก"
                description="ลองเปลี่ยนช่วงวันที่หรือตรวจสอบว่ามีการเปิดโต๊ะในช่วงนี้"
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-[var(--surface-2)]">
                    <Th>เปิดเมื่อ</Th>
                    <Th>โต๊ะ</Th>
                    <Th>โซน</Th>
                    <Th>สถานะ</Th>
                    <Th align="center">ลูกค้า</Th>
                    <Th align="right">เวลาใช้งาน</Th>
                    <Th align="right">ยอดบิล</Th>
                    <Th>ปิดเมื่อ</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((row) => (
                    <tr
                      key={row.sessionId}
                      className={cn(
                        'hover:bg-[var(--surface-2)] transition-colors',
                        row.parentSessionId !== null && 'opacity-70',
                      )}
                    >
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtBKK(row.startedAt)}
                      </Td>
                      <Td>
                        <span className="font-semibold">{row.tableLabel}</span>
                        {row.parentSessionId !== null && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">(เชื่อม)</span>
                        )}
                      </Td>
                      <Td className="text-xs text-muted-foreground">{row.tableZone}</Td>
                      <Td><StatusChip status={row.status} /></Td>
                      <Td align="center">
                        {row.guestCount !== null ? row.guestCount : '—'}
                      </Td>
                      <Td align="right" className="text-xs text-muted-foreground">
                        {fmtDuration(row.durationMinutes)}
                      </Td>
                      <Td align="right" className="text-xs text-muted-foreground">
                        {row.revenue !== null ? thb(row.revenue) : '—'}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {row.closedAt ? fmtBKK(row.closedAt) : '—'}
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
