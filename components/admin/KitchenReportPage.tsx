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
  BarChart3,
  CheckCircle2,
  ChefHat,
  ChevronLeft,
  Clock,
  Download,
  LayoutGrid,
  Loader2,
  ReceiptText,
  Timer,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { getKitchenReport } from '@/lib/actions/reports/kitchen-report';
import type { KitchenReportData } from '@/lib/actions/reports/kitchen-report';
import { ITEM_STATUS_LABELS, STATION_LABELS } from '@/lib/reports/report-labels';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatThaiDate, formatThaiDateTime, formatThaiMonthDay, formatThaiTime } from '@/lib/date-time';

const TZ = 'Asia/Bangkok';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayBKK() {
  return format(toZonedTime(new Date(), TZ), 'yyyy-MM-dd');
}

function fmtBKK(iso: string, fmt = 'dd/MM HH:mm') {
  if (fmt === 'HH:mm') return formatThaiTime(iso);
  if (fmt === 'dd/MM/yyyy') return formatThaiDate(iso);
  return formatThaiDateTime(iso);
}

function fmtDuration(minutes: number | null): string {
  if (minutes === null) return 'ยังไม่มีข้อมูลพอ';
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

const STATUS_CHIP_CLASSES: Record<string, string> = {
  pending:   'bg-[var(--status-warning-bg)]  text-[var(--status-warning-fg)]  border-[var(--status-warning-border)]',
  preparing: 'bg-[var(--status-info-bg)]     text-[var(--status-info-fg)]     border-[var(--status-info-border)]',
  ready:     'bg-[var(--status-success-bg)]  text-[var(--status-success-fg)]  border-[var(--status-success-border)]',
  served:    'bg-[var(--status-purple-bg)]   text-[var(--status-purple-fg)]   border-[var(--status-purple-border)]',
  cancelled: 'bg-[var(--status-danger-bg)]   text-[var(--status-danger-fg)]   border-[var(--status-danger-border)]',
};

const STATUS_BAR_COLORS: Record<string, string> = {
  pending:   'bg-[var(--status-warning-fg)]',
  preparing: 'bg-[var(--status-info-fg)]',
  ready:     'bg-[var(--status-success-fg)]',
  served:    'bg-[var(--status-purple-fg)]',
  cancelled: 'bg-[var(--status-danger-fg)]',
};

const STATION_CHIP_CLASSES: Record<string, string> = {
  meat:      'bg-[var(--status-danger-bg)]   text-[var(--status-danger-fg)]',
  seafood:   'bg-[var(--status-info-bg)]     text-[var(--status-info-fg)]',
  vegetable: 'bg-[var(--status-success-bg)]  text-[var(--status-success-fg)]',
  noodle:    'bg-[var(--status-warning-bg)]  text-[var(--status-warning-fg)]',
  dessert:   'bg-[var(--status-purple-bg)]   text-[var(--status-purple-fg)]',
  drink:     'bg-[var(--status-cyan-bg)]     text-[var(--status-cyan-fg)]',
  sauce:     'bg-[var(--status-orange-bg)]   text-[var(--status-orange-fg)]',
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
  const label = ITEM_STATUS_LABELS[status] ?? status;
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

// ─── Station chip ─────────────────────────────────────────────────────────────

function StationChip({ station }: { station: string }) {
  const label = STATION_LABELS[station] ?? station;
  const cls   = STATION_CHIP_CLASSES[station] ?? 'bg-[var(--surface-2)] text-muted-foreground';
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
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

// ─── Main component ───────────────────────────────────────────────────────────

export function KitchenReportPage() {
  const todayStr = todayBKK();

  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate,   setToDate]   = useState(todayStr);
  const [loading,  setLoading]  = useState(true);
  const [data,     setData]     = useState<KitchenReportData | null>(null);

  useEffect(() => {
    if (fromDate > toDate) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    getKitchenReport(fromDate, toDate).then((result) => {
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
    const headers = ['วันที่สั่ง', 'เวลา', 'โต๊ะ', 'โซน', 'รายการ', 'สถานี', 'จำนวน', 'สถานะ', 'เสิร์ฟเมื่อ', 'เวลาตั้งแต่สั่ง (นาที)'];
    const dataRows = data.rows.map((r) => [
      fmtBKK(r.orderedAt, 'dd/MM/yyyy'),
      fmtBKK(r.orderedAt, 'HH:mm'),
      r.tableLabel,
      r.tableZone,
      r.itemName,
      STATION_LABELS[r.station] ?? r.station,
      r.quantity,
      ITEM_STATUS_LABELS[r.itemStatus] ?? r.itemStatus,
      r.servedAt ? fmtBKK(r.servedAt) : '',
      r.prepMinutes ?? '',
    ]);
    downloadCsv(
      `kitchen-report-${fromDate}-${toDate}.csv`,
      [headers, ...dataRows].map((row) => row.join(',')).join('\n'),
    );
  }

  const dateLabel = fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;

  return (
    <AppShell>
      <PageHeader
        title="รายงานครัว"
        subtitle="วิเคราะห์ปริมาณออเดอร์ สถานะรายการครัว และเมนูที่ถูกสั่งบ่อย"
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
                <ThaiDateInput
                  value={fromDate}
                  max={todayStr}
                  onValueChange={setFromDate}
                  className="h-10 w-40"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">วันสิ้นสุด</Label>
                <ThaiDateInput
                  value={toDate}
                  max={todayStr}
                  onValueChange={setToDate}
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

        {/* ── 6 KPI cards (2×3) ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <KpiCard
            label="ออเดอร์ทั้งหมด"
            value={data?.totalOrders ?? '—'}
            detail={loading ? undefined : dateLabel}
            icon={<ReceiptText className="size-5" />}
            tone="primary"
            loading={loading}
          />
          <KpiCard
            label="รายการอาหาร"
            value={data?.totalItemQty ?? '—'}
            detail={loading || !data ? undefined
              : `เฉลี่ย ${data.avgItemsPerOrder ?? '—'} รายการ/ออเดอร์`}
            icon={<ChefHat className="size-5" />}
            tone="info"
            loading={loading}
          />
          <KpiCard
            label="เสร็จแล้ว"
            value={loading ? '—' : data ? data.servedQty : '—'}
            detail={loading || !data ? undefined
              : data.totalItemQty > 0
              ? `${Math.round((data.servedQty / data.totalItemQty) * 100)}% ของรายการทั้งหมด`
              : undefined}
            icon={<CheckCircle2 className="size-5" />}
            tone="success"
            loading={loading}
          />
          <KpiCard
            label="กำลังรอ"
            value={loading ? '—' : data ? data.pendingQty : '—'}
            detail="รอทำ + กำลังทำ + พร้อมเสิร์ฟ"
            icon={<Clock className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="ยกเลิก"
            value={loading ? '—' : data ? data.cancelledQty : '—'}
            detail={loading || !data ? undefined
              : data.totalItemQty > 0
              ? `${Math.round((data.cancelledQty / data.totalItemQty) * 100)}% ของรายการ`
              : undefined}
            icon={<XCircle className="size-5" />}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            label="เวลาเฉลี่ย"
            value={loading ? '—'
              : data?.avgPrepMinutes !== null && data?.avgPrepMinutes !== undefined
              ? fmtDuration(data.avgPrepMinutes)
              : 'ยังไม่มีข้อมูลพอ'}
            detail={loading ? undefined
              : data?.avgPrepMinutes !== null && data?.avgPrepMinutes !== undefined
              ? 'ตั้งแต่สั่งจนถึงเสิร์ฟ'
              : 'ต้องมีข้อมูล servedAt ≥ 5 รายการ'}
            icon={<Timer className="size-5" />}
            tone="neutral"
            loading={loading}
          />
        </div>

        {/* ── Daily chart + Status breakdown ──────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

          <DataCard
            title="ปริมาณรายการครัวรายวัน"
            subtitle={`ช่วงวันที่ ${dateLabel}`}
            className="lg:col-span-2"
          >
            {loading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : !data || data.dailyRows.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="size-5" />}
                title="ไม่พบข้อมูลครัวในช่วงวันที่เลือก"
                size="sm"
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.dailyRows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => formatThaiMonthDay(v)}
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
                    formatter={(v, name) => [
                      Number(v),
                      name === 'itemQty' ? 'รายการ' : 'ออเดอร์',
                    ]}
                    labelFormatter={(l) => typeof l === 'string' ? fmtBKK(l + 'T00:00:00', 'dd/MM/yyyy') : String(l)}
                    contentStyle={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="itemQty" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={48} name="itemQty" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DataCard>

          <DataCard title="สถานะรายการ" subtitle="แยกตามสถานะ KDS">
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
              <EmptyState icon={<ChefHat className="size-5" />} title="ไม่มีข้อมูล" size="sm" />
            ) : (
              <div className="space-y-4">
                {data.statusSummary.map((s) => (
                  <PctBar
                    key={s.status}
                    label={s.label}
                    right={`${s.qty} ชิ้น`}
                    rightSub={`${s.pct}%`}
                    pct={s.pct}
                    color={STATUS_BAR_COLORS[s.status] ?? 'bg-muted-foreground'}
                  />
                ))}
              </div>
            )}
          </DataCard>
        </div>

        {/* ── Popular items + Station breakdown ───────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">

          {/* Popular items */}
          <DataCard
            title="เมนูยอดนิยม"
            subtitle="เรียงตามจำนวนรายการที่สั่ง (top 10)"
            className="lg:col-span-3"
            noPadding
          >
            {loading ? (
              <div className="divide-y divide-border">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex gap-4 px-4 py-3.5">
                    <Skeleton className="h-4 w-6" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </div>
            ) : !data || data.popularItems.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<TrendingUp className="size-5" />}
                  title="ไม่พบข้อมูลเมนูในช่วงวันที่เลือก"
                  size="sm"
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[440px] w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-[var(--surface-2)]">
                      <Th align="center">#</Th>
                      <Th>เมนู</Th>
                      <Th>สถานี</Th>
                      <Th align="right">จำนวน</Th>
                      <Th align="right">ออเดอร์</Th>
                      <Th align="right">สัดส่วน</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.popularItems.map((item, i) => (
                      <tr key={i} className="hover:bg-[var(--surface-2)] transition-colors">
                        <Td align="center" className="text-xs text-muted-foreground font-bold">
                          {i + 1}
                        </Td>
                        <Td className="font-medium">{item.itemName}</Td>
                        <Td><StationChip station={item.station} /></Td>
                        <Td align="right" className="font-semibold">{item.totalQty}</Td>
                        <Td align="right" className="text-xs text-muted-foreground">{item.orderCount}</Td>
                        <Td align="right" className="text-xs text-muted-foreground">{item.pct}%</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DataCard>

          {/* Station breakdown */}
          <DataCard
            title="แต่ละสถานีครัว"
            subtitle="ปริมาณรายการแยกตามสถานี"
            className="lg:col-span-2"
          >
            {loading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                ))}
              </div>
            ) : !data || data.stationBreakdown.length === 0 ? (
              <EmptyState icon={<LayoutGrid className="size-5" />} title="ไม่มีข้อมูล" size="sm" />
            ) : (
              <div className="space-y-4">
                {data.stationBreakdown.map((s) => (
                  <PctBar
                    key={s.station}
                    label={s.label}
                    sub={`เสิร์ฟ ${s.servedQty} · รอ ${s.pendingQty} · ยกเลิก ${s.cancelledQty}`}
                    right={`${s.totalQty}`}
                    rightSub={`${s.pct}%`}
                    pct={s.pct}
                    color="bg-primary"
                  />
                ))}
              </div>
            )}
          </DataCard>
        </div>

        {/* ── Table workload ───────────────────────────────────────────────── */}
        {(!loading && data && data.tableWorkload.length > 0) && (
          <DataCard
            title="โต๊ะที่มีงานครัวมากที่สุด"
            subtitle="เรียงตามจำนวนรายการ (top 10)"
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="min-w-[520px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-[var(--surface-2)]">
                    <Th>โต๊ะ</Th>
                    <Th>โซน</Th>
                    <Th align="center">ออเดอร์</Th>
                    <Th align="center">รายการทั้งหมด</Th>
                    <Th align="center">ยังรอ</Th>
                    <Th>ล่าสุดเมื่อ</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.tableWorkload.map((t) => (
                    <tr key={t.tableId} className="hover:bg-[var(--surface-2)] transition-colors">
                      <Td className="font-semibold">{t.tableLabel}</Td>
                      <Td className="text-xs text-muted-foreground">{t.tableZone}</Td>
                      <Td align="center">{t.orderCount}</Td>
                      <Td align="center" className="font-medium">{t.totalQty}</Td>
                      <Td align="center">
                        {t.pendingQty > 0 ? (
                          <span className="text-[var(--status-warning-fg)] font-medium">
                            {t.pendingQty}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtBKK(t.lastOrderAt)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCard>
        )}

        {/* ── Detail table ─────────────────────────────────────────────────── */}
        <DataCard
          title="รายละเอียดทุกรายการ"
          subtitle={`${data?.rows.length ?? 0} รายการ · เรียงจากล่าสุด`}
          noPadding
        >
          {loading ? (
            <div className="divide-y divide-border">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex gap-4 px-4 py-3.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<ChefHat className="size-5" />}
                title="ไม่พบข้อมูลครัวในช่วงวันที่เลือก"
                description="ลองเปลี่ยนช่วงวันที่หรือตรวจสอบว่ามีออเดอร์เข้าครัวในช่วงนี้"
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[780px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-[var(--surface-2)]">
                    <Th>วันที่/เวลา</Th>
                    <Th>โต๊ะ</Th>
                    <Th>รายการ</Th>
                    <Th>สถานี</Th>
                    <Th align="center">จำนวน</Th>
                    <Th>สถานะ</Th>
                    <Th>เสิร์ฟเมื่อ</Th>
                    <Th align="right">เวลา (นาที)</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((row) => (
                    <tr key={row.itemId} className="hover:bg-[var(--surface-2)] transition-colors">
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtBKK(row.orderedAt)}
                      </Td>
                      <Td className="font-semibold whitespace-nowrap">{row.tableLabel}</Td>
                      <Td className="font-medium">{row.itemName}</Td>
                      <Td><StationChip station={row.station} /></Td>
                      <Td align="center">{row.quantity}</Td>
                      <Td><StatusChip status={row.itemStatus} /></Td>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {row.servedAt ? fmtBKK(row.servedAt) : '—'}
                      </Td>
                      <Td align="right" className="text-xs text-muted-foreground">
                        {row.prepMinutes !== null ? row.prepMinutes : '—'}
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
