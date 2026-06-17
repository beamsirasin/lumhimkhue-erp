'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import { getReportSummary } from '@/lib/actions/dashboard';
import { getFoodCostReport } from '@/lib/actions/recipes';
import { getPaymentCollectionReport } from '@/lib/actions/reports/collection';
import type { ReportSummary } from '@/lib/actions/dashboard';
import type { FoodCostRow } from '@/lib/actions/recipes';
import type { PaymentCollectionReport } from '@/lib/actions/reports/collection';

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

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Date pickers */}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">วันเริ่มต้น</label>
            <input type="date" value={fromDate} max={today}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">วันสิ้นสุด</label>
            <input type="date" value={toDate} max={today}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
          </div>
          {loading && <span className="pb-2 text-xs text-muted-foreground">กำลังโหลด…</span>}
          {!loading && report && (
            <button type="button" onClick={handleExport}
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors">
              Export CSV
            </button>
          )}
        </div>
        {/* Session type toggle */}
        <div className="flex gap-0.5 rounded-xl bg-muted p-1">
          {(['all', 'primary', 'secondary'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setSessionType(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                sessionType === t
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}>
              {SESSION_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-primary px-5 py-4 text-primary-foreground">
          <p className="text-[11px] text-primary-foreground/60 font-semibold uppercase tracking-wider">รายได้รวม</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums">
            ฿{(totals?.revenue ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
          </p>
          <p className="mt-0.5 text-xs text-primary-foreground/60">
            {fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`}
          </p>
        </div>
        <div className="rounded-xl bg-card border border-border px-5 py-4">
          <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">จำนวนโต๊ะ</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
            {(totals?.sessions ?? 0).toLocaleString('th-TH')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">โต๊ะ</p>
        </div>
        <div className="rounded-xl bg-card border border-border px-5 py-4">
          <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">เฉลี่ยต่อโต๊ะ</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
            ฿{Math.round(avgPerSession).toLocaleString('th-TH')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {totalGuests > 0 ? `฿${Math.round((totals?.revenue ?? 0) / totalGuests).toLocaleString('th-TH')} / คน` : '—'}
          </p>
        </div>
      </div>

      {/* ── Chart + Breakdowns ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Chart — takes 2/3 */}
        <div className="lg:col-span-2 rounded-xl bg-card border border-border p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-foreground">รายได้รายวัน</p>
            {report && report.rows.length > 0 && (
              <span className="text-xs text-muted-foreground">{report.rows.length} วัน</span>
            )}
          </div>
          {loading ? (
            <div className="flex flex-1 min-h-[180px] items-center justify-center">
              <span className="text-sm text-muted-foreground">กำลังโหลด…</span>
            </div>
          ) : !report || report.rows.length === 0 ? (
            <div className="flex flex-1 min-h-[180px] items-center justify-center">
              <span className="text-sm text-muted-foreground">ไม่มีข้อมูลในช่วงนี้</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={report.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.006 248)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'oklch(0.52 0.01 248)' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'oklch(0.52 0.01 248)' }}
                  tickFormatter={(v: number) => v >= 1000 ? `฿${(v / 1000).toFixed(0)}K` : `฿${v}`}
                  axisLine={false} tickLine={false} width={50}
                />
                <Tooltip
                  cursor={{ fill: 'oklch(0.94 0.005 248 / 50%)' }}
                  contentStyle={{ borderRadius: 8, border: '1px solid oklch(0.90 0.006 248)', fontSize: 12 }}
                  formatter={(v) => [`฿${Number(v).toLocaleString('th-TH')}`, 'รายได้']}
                  labelFormatter={(l) => `วันที่ ${l}`}
                />
                <Bar dataKey="revenue" fill="oklch(0.30 0.11 248)" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Breakdowns — takes 1/3 */}
        <div className="flex flex-col gap-4">

          {/* Guest type breakdown */}
          <div className="rounded-xl bg-card border border-border p-5 flex-1">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">ประเภทลูกค้า</p>
              {totalGuests > 0 && (
                <span className="text-xs text-muted-foreground">{totalGuests} คน</span>
              )}
            </div>
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
                          className="h-1.5 rounded-full bg-primary/70 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payment method breakdown */}
          <div className="rounded-xl bg-card border border-border p-5 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">ช่องทางชำระเงิน</p>
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
                          className="h-1.5 rounded-full bg-primary/50 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Daily Table ───────────────────────────────────────────────────── */}
      {report && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30">
            <p className="text-xs font-semibold text-foreground">รายละเอียดรายวัน</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
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
                <tr key={r.date} className="hover:bg-muted/30 transition-colors">
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
                <tr className="border-t-2 border-border bg-muted/50 font-semibold">
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
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">วันเริ่มต้น</label>
          <input type="date" value={fromDate} max={today} onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">วันสิ้นสุด</label>
          <input type="date" value={toDate} max={today} onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
        </div>
        {loading && <span className="pb-2 text-xs text-muted-foreground">กำลังโหลด…</span>}
      </div>

      {/* KPI cards */}
      {rows !== null && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={`rounded-xl px-5 py-4 border ${
            avgFoodCostPct !== null && avgFoodCostPct > 35 ? 'bg-red-50 border-red-200' : 'bg-card border-border'
          }`}>
            <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">% ต้นทุนเฉลี่ยต่อวัน</p>
            <p className={`mt-1.5 text-2xl font-bold tabular-nums ${
              avgFoodCostPct !== null ? (avgFoodCostPct > 35 ? 'text-red-600' : 'text-emerald-600') : 'text-foreground'
            }`}>
              {avgFoodCostPct !== null ? `${avgFoodCostPct.toFixed(1)}%` : '—'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">เป้าหมาย ≤ 35%</p>
          </div>
          <div className={`rounded-xl px-5 py-4 border ${
            overallPct !== null && overallPct > 35 ? 'bg-red-50 border-red-200' : 'bg-card border-border'
          }`}>
            <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">% ต้นทุนรวม</p>
            <p className={`mt-1.5 text-2xl font-bold tabular-nums ${
              overallPct !== null ? (overallPct > 35 ? 'text-red-600' : 'text-emerald-600') : 'text-foreground'
            }`}>
              {overallPct !== null ? `${overallPct.toFixed(1)}%` : '—'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">ภาพรวม</p>
          </div>
          <div className="rounded-xl bg-card border border-border px-5 py-4">
            <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">รายได้รวม</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
              ฿{totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">ช่วงที่เลือก</p>
          </div>
          <div className="rounded-xl bg-card border border-border px-5 py-4">
            <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">ต้นทุนรวม (ทฤษฎี)</p>
            <p className={`mt-1.5 text-2xl font-bold tabular-nums ${overallPct !== null && overallPct > 35 ? 'text-red-600' : 'text-foreground'}`}>
              ฿{totalCost.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">ช่วงที่เลือก</p>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-xl bg-card border border-border p-5">
        <p className="text-sm font-semibold text-foreground mb-4">% ต้นทุนอาหารรายวัน</p>
        {loading ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <span className="text-sm text-muted-foreground">กำลังโหลด…</span>
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <span className="text-sm text-muted-foreground">ไม่มีข้อมูลในช่วงนี้</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.90 0.006 248)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'oklch(0.52 0.01 248)' }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'oklch(0.52 0.01 248)' }} unit="%" domain={[0, 'auto']} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'oklch(0.94 0.005 248 / 50%)' }}
                contentStyle={{ borderRadius: 8, border: '1px solid oklch(0.90 0.006 248)', fontSize: 12 }}
                formatter={(v) => [`${Number(v ?? 0).toFixed(1)}%`, '% ต้นทุนอาหาร']}
                labelFormatter={(l) => `วันที่ ${l}`}
              />
              <ReferenceLine y={35} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '35%', fill: '#ef4444', fontSize: 11 }} />
              <Bar dataKey="foodCostPct" radius={[4, 4, 0, 0]} maxBarSize={60}>
                {rows.map((row) => <Cell key={row.date} fill={row.foodCostPct > 35 ? '#ef4444' : '#22c55e'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      {rows !== null && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30">
            <p className="text-xs font-semibold text-foreground">รายละเอียดรายวัน</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>วันที่</Th><Th align="right">รายได้</Th><Th align="right">ต้นทุนทฤษฎี</Th>
                <Th align="right">% ต้นทุน</Th><Th align="right">เป้าหมาย</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-muted-foreground text-xs">ไม่มีข้อมูล</td></tr>}
              {rows.map((r) => (
                <tr key={r.date} className="hover:bg-muted/30 transition-colors">
                  <Td>{r.date}</Td>
                  <Td align="right">฿{r.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">฿{r.theoreticalCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">
                    <span className={`font-medium ${r.foodCostPct > 35 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {r.revenue > 0 ? `${r.foodCostPct.toFixed(1)}%` : '—'}
                    </span>
                  </Td>
                  <Td align="right">
                    {r.revenue > 0
                      ? <span className={r.targetMet ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>{r.targetMet ? 'ผ่าน ✓' : 'เกินเป้า'}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">วันเริ่มต้น</label>
          <input type="date" value={fromDate} max={today}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">วันสิ้นสุด</label>
          <input type="date" value={toDate} max={today}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors" />
        </div>
        {loading && <span className="pb-2 text-xs text-muted-foreground">กำลังโหลด…</span>}
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      {report && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="col-span-2 sm:col-span-1 rounded-xl bg-primary px-5 py-4 text-primary-foreground">
              <p className="text-[11px] text-primary-foreground/60 font-semibold uppercase tracking-wider">ยอดรับจริงรวม</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">
                ฿{report.totalCollected.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </p>
              <p className="mt-0.5 text-xs text-primary-foreground/60">
                {fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`}
              </p>
            </div>
            {([
              { label: 'เงินสด',          value: report.cashTotal       },
              { label: 'QR PromptPay',     value: report.promptpayTotal  },
              { label: 'สวัสดิการรัฐ',     value: report.welfareTotal    },
              { label: 'ประวัติ QR+เงินสด', value: report.legacyTotal    },
            ] as const).map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-card border border-border px-5 py-4">
                <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</p>
                <p className="mt-1.5 text-xl font-bold tabular-nums text-foreground">
                  ฿{value.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </p>
                {report.totalCollected > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {((value / report.totalCollected) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            อ้างอิงจาก payment_rows ตามบัญชีรับเงินจริง — ไม่ใช่ยอดขาย VAT
          </p>
        </>
      )}

      {/* ── Method + Account summaries ────────────────────────────────────── */}
      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Method summary */}
          <div className="rounded-xl bg-card border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <p className="text-xs font-semibold text-foreground">สรุปตามช่องทางชำระ</p>
            </div>
            {report.methodSummary.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">ไม่มีรายการรับเงินในช่วงนี้</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <Th>ช่องทาง</Th>
                    <Th>ประเภท</Th>
                    <Th align="right">รายการ</Th>
                    <Th align="right">ยอดรับ</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.methodSummary.map((m) => (
                    <tr key={m.methodId} className="hover:bg-muted/30 transition-colors">
                      <Td>{m.methodName}</Td>
                      <Td><span className="text-xs text-muted-foreground">{METHOD_TYPE_LABELS[m.methodType] ?? m.methodType}</span></Td>
                      <Td align="right">{m.rowCount}</Td>
                      <Td align="right" className="font-semibold">
                        ฿{m.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                    <Td>รวม</Td><Td>{''}</Td>
                    <Td align="right">{report.methodSummary.reduce((s, m) => s + m.rowCount, 0)}</Td>
                    <Td align="right">
                      ฿{report.methodSummary.reduce((s, m) => s + m.amount, 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </Td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Account summary */}
          <div className="rounded-xl bg-card border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <p className="text-xs font-semibold text-foreground">สรุปตามบัญชีรับเงิน</p>
            </div>
            {report.accountSummary.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">ไม่มีรายการรับเงินในช่วงนี้</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <Th>บัญชีรับเงิน</Th>
                    <Th>ประเภทบัญชี</Th>
                    <Th align="right">รายการ</Th>
                    <Th align="right">ยอดรับ</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.accountSummary.map((a) => (
                    <tr key={a.accountId} className="hover:bg-muted/30 transition-colors">
                      <Td>{a.accountName}</Td>
                      <Td><span className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType}</span></Td>
                      <Td align="right">{a.rowCount}</Td>
                      <Td align="right" className="font-semibold">
                        ฿{a.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                    <Td>รวม</Td><Td>{''}</Td>
                    <Td align="right">{report.accountSummary.reduce((s, a) => s + a.rowCount, 0)}</Td>
                    <Td align="right">
                      ฿{report.accountSummary.reduce((s, a) => s + a.amount, 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </Td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Account × Method matrix ───────────────────────────────────────── */}
      {report && report.matrix.length > 0 && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30">
            <p className="text-xs font-semibold text-foreground">รายละเอียด: บัญชีรับเงิน × ช่องทางชำระ</p>
          </div>
          <div className="divide-y divide-border">
            {report.matrix.map((matRow) => (
              <div key={matRow.accountId} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-semibold text-foreground">{matRow.accountName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {ACCOUNT_TYPE_LABELS[matRow.accountType] ?? matRow.accountType}
                    </span>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    ฿{matRow.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="space-y-1 pl-3 border-l-2 border-border">
                  {matRow.methods.map((m) => (
                    <div key={m.methodId} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{m.methodName}</span>
                      <span className="tabular-nums font-medium text-foreground">
                        ฿{m.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && report && report.methodSummary.length === 0 && (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          ยังไม่มีรายการรับเงินในช่วงวันที่นี้
        </div>
      )}
    </div>
  );
}

// ─── Page shell ────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');

  const TABS: { key: Tab; label: string }[] = [
    { key: 'revenue',    label: 'รายได้' },
    { key: 'foodcost',   label: 'ต้นทุนอาหาร' },
    { key: 'collection', label: 'ยอดรับจริง' },
  ];

  return (
    <div className="page-shell">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">รายงาน</h1>
        <div className="flex gap-px rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
                tab === t.key
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'revenue'    && <RevenueReport />}
      {tab === 'foodcost'   && <FoodCostReport />}
      {tab === 'collection' && <CollectionReport />}
    </div>
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
    <th className={`px-4 py-3 text-xs font-semibold text-muted-foreground ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({ children, align, className }: { children: React.ReactNode; align?: 'right'; className?: string }) {
  return (
    <td className={`px-4 py-3 text-foreground text-sm ${align === 'right' ? 'text-right tabular-nums' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}
