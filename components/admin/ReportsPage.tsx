'use client';

import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import { getReportSummary } from '@/lib/actions/dashboard';
import { getPayrollCycles, getPayrollSsfReport } from '@/lib/actions/hr';
import { getFoodCostReport } from '@/lib/actions/recipes';
import type { ReportSummary } from '@/lib/actions/dashboard';
import type { SsfReportRow } from '@/lib/actions/hr';
import type { FoodCostRow } from '@/lib/actions/recipes';

type Tab = 'revenue' | 'ssf' | 'foodcost';

// ─── Revenue Report ────────────────────────────────────────────────────────────

function RevenueReport() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportSummary | null>(null);

  async function handleQuery() {
    if (fromDate > toDate) { toast.error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด'); return; }
    setLoading(true);
    const result = await getReportSummary(fromDate, toDate);
    setLoading(false);
    if (!result.ok) { toast.error(result.error); return; }
    setReport(result.data);
  }

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">วันเริ่มต้น</label>
          <input type="date" value={fromDate} max={today} onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">วันสิ้นสุด</label>
          <input type="date" value={toDate} max={today} onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <button type="button" onClick={handleQuery} disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loading ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
        {report && (
          <button type="button" onClick={handleExport}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Export CSV
          </button>
        )}
      </div>

      {report && (
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <Th>วันที่</Th>
                <Th align="right">จำนวนโต๊ะ</Th>
                <Th align="right">จำนวนลูกค้า</Th>
                <Th align="right">รายได้รวม</Th>
                <Th align="right">เฉลี่ยต่อโต๊ะ</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.rows.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400 text-xs">ไม่มีข้อมูลในช่วงเวลานี้</td></tr>
              )}
              {report.rows.map((r) => (
                <tr key={r.date} className="hover:bg-slate-50">
                  <Td>{r.date}</Td>
                  <Td align="right">{r.sessions}</Td>
                  <Td align="right">{r.guests}</Td>
                  <Td align="right">฿{r.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">฿{r.avgPerSession.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Td>
                </tr>
              ))}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <Td>รวม</Td>
                  <Td align="right">{report.totals.sessions}</Td>
                  <Td align="right">{report.totals.guests}</Td>
                  <Td align="right">฿{report.totals.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">฿{(report.totals.sessions > 0 ? report.totals.revenue / report.totals.sessions : 0)
                    .toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

// ─── SSF Report ────────────────────────────────────────────────────────────────

type CycleOption = { id: string; name: string; workStartDate: string; workEndDate: string };

function SsfReport() {
  const [cycles, setCycles] = useState<CycleOption[] | null>(null);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [loadingReport, setLoadingReport] = useState(false);
  const [rows, setRows] = useState<SsfReportRow[] | null>(null);
  const [totals, setTotals] = useState<{
    gross: number; ssfEmployee: number; ssfEmployer: number; withholdingTax: number; netPayAfterTax: number;
  } | null>(null);
  const [cycleName, setCycleName] = useState('');

  async function loadCycles() {
    if (cycles !== null) return;
    setLoadingCycles(true);
    try {
      const data = await getPayrollCycles();
      setCycles(data.map((c) => ({ id: c.id, name: c.name, workStartDate: c.workStartDate, workEndDate: c.workEndDate })));
    } catch { toast.error('โหลดรอบเงินเดือนไม่ได้'); }
    finally { setLoadingCycles(false); }
  }

  async function handleQuery() {
    if (!selectedCycleId) { toast.error('กรุณาเลือกรอบเงินเดือน'); return; }
    setLoadingReport(true);
    const result = await getPayrollSsfReport(selectedCycleId);
    setLoadingReport(false);
    if (!result.ok) { toast.error(result.error); return; }
    setRows(result.data.rows);
    setTotals(result.data.totals);
    setCycleName(result.data.cycle.name);
  }

  function handleExport() {
    if (!rows || !totals) return;
    const headers = ['รายชื่อพนักงาน', 'เงินเดือนรวม (฿)', 'SSF ลูกจ้าง (฿)', 'SSF นายจ้าง (฿)', 'ภาษีหัก ณ ที่จ่าย (฿)', 'รับสุทธิ (฿)'];
    const dataRows = rows.map((r) => [
      `${r.employee?.firstName ?? ''} ${r.employee?.lastName ?? ''}`.trim(),
      r.gross.toFixed(2), r.ssfEmployee.toFixed(2), r.ssfEmployer.toFixed(2),
      r.withholdingTax.toFixed(2), r.netPayAfterTax.toFixed(2),
    ]);
    const totalRow = ['รวม', totals.gross.toFixed(2), totals.ssfEmployee.toFixed(2), totals.ssfEmployer.toFixed(2), totals.withholdingTax.toFixed(2), totals.netPayAfterTax.toFixed(2)];
    downloadCsv(`ssf-report-${cycleName}.csv`, [headers, ...dataRows, totalRow].map((r) => r.join(',')).join('\n'));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">รอบเงินเดือน</label>
          <select value={selectedCycleId} onFocus={loadCycles} onChange={(e) => setSelectedCycleId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 min-w-[220px]">
            <option value="">{loadingCycles ? 'กำลังโหลด…' : 'เลือกรอบเงินเดือน'}</option>
            {(cycles ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.workStartDate} – {c.workEndDate})</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={handleQuery} disabled={loadingReport || !selectedCycleId}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loadingReport ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
        {rows && rows.length > 0 && (
          <button type="button" onClick={handleExport}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Export CSV
          </button>
        )}
      </div>

      {rows && (
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-sm font-semibold text-slate-700">เงินสมทบประกันสังคมและภาษีหัก ณ ที่จ่าย — {cycleName}</p>
            <p className="text-xs text-slate-400 mt-0.5">SSF 5% สูงสุด ฿750 · ภาษีแบบขั้นบันได (ประมาณการรายปี)</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <Th>รายชื่อพนักงาน</Th>
                <Th align="right">เงินเดือนรวม</Th>
                <Th align="right">SSF ลูกจ้าง</Th>
                <Th align="right">SSF นายจ้าง</Th>
                <Th align="right">ภาษีหัก ณ ที่จ่าย</Th>
                <Th align="right">รับสุทธิ</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-xs">ไม่มีข้อมูลในรอบนี้</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td>{r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : <span className="text-slate-400">—</span>}</Td>
                  <Td align="right">฿{r.gross.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">{r.ssfEmployee > 0 ? <span className="text-amber-700">฿{r.ssfEmployee.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span> : <span className="text-slate-400">—</span>}</Td>
                  <Td align="right">{r.ssfEmployer > 0 ? <span className="text-amber-700">฿{r.ssfEmployer.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span> : <span className="text-slate-400">—</span>}</Td>
                  <Td align="right">{r.withholdingTax > 0 ? <span className="text-red-600">฿{r.withholdingTax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span> : <span className="text-slate-400">—</span>}</Td>
                  <Td align="right">฿{r.netPayAfterTax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && totals && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <Td>รวม ({rows.length} คน)</Td>
                  <Td align="right">฿{totals.gross.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right" className="text-amber-700">฿{totals.ssfEmployee.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right" className="text-amber-700">฿{totals.ssfEmployer.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right" className="text-red-600">฿{totals.withholdingTax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">฿{totals.netPayAfterTax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
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
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<FoodCostRow[] | null>(null);

  async function handleQuery() {
    if (fromDate > toDate) { toast.error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด'); return; }
    setLoading(true);
    const result = await getFoodCostReport(fromDate, toDate);
    setLoading(false);
    if (!result.ok) { toast.error(result.error); return; }
    setRows(result.data);
  }

  function handleExport() {
    if (!rows) return;
    const headers = ['วันที่', 'รายได้ (฿)', 'ต้นทุนทฤษฎี (฿)', '% ต้นทุนอาหาร', 'เป้าหมาย ≤35%'];
    const dataRows = rows.map((r) => [r.date, r.revenue.toFixed(2), r.theoreticalCost.toFixed(2), r.foodCostPct.toFixed(1), r.targetMet ? 'ผ่าน' : 'เกินเป้า']);
    downloadCsv(`food-cost-${fromDate}-${toDate}.csv`, [headers, ...dataRows].map((r) => r.join(',')).join('\n'));
  }

  const avgFoodCostPct = rows && rows.length > 0
    ? rows.filter((r) => r.revenue > 0).reduce((s, r) => s + r.foodCostPct, 0) /
      Math.max(1, rows.filter((r) => r.revenue > 0).length)
    : null;

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">วันเริ่มต้น</label>
          <input type="date" value={fromDate} max={today} onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">วันสิ้นสุด</label>
          <input type="date" value={toDate} max={today} onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <button type="button" onClick={handleQuery} disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loading ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
        {rows && (
          <button type="button" onClick={handleExport}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Export CSV
          </button>
        )}
      </div>

      {/* Summary stat */}
      {avgFoodCostPct !== null && (
        <div className="flex gap-4">
          <div className="rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-900/5">
            <p className="text-xs text-slate-500">% ต้นทุนอาหารเฉลี่ย</p>
            <p className={`text-2xl font-bold mt-0.5 ${avgFoodCostPct > 35 ? 'text-red-600' : 'text-green-600'}`}>
              {avgFoodCostPct.toFixed(1)}%
            </p>
            <p className="text-xs text-slate-400 mt-0.5">เป้าหมาย ≤ 35%</p>
          </div>
        </div>
      )}

      {/* Bar chart */}
      {rows && rows.length > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
          <p className="text-sm font-medium text-slate-700 mb-4">% ต้นทุนอาหารรายวัน</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 'auto']} />
              <Tooltip
                formatter={(v) => [`${Number(v ?? 0).toFixed(1)}%`, '% ต้นทุนอาหาร']}
                labelFormatter={(l) => `วันที่ ${l}`}
              />
              <ReferenceLine y={35} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '35%', fill: '#ef4444', fontSize: 11 }} />
              <Bar dataKey="foodCostPct" radius={[3, 3, 0, 0]}>
                {rows.map((row) => (
                  <Cell key={row.date} fill={row.foodCostPct > 35 ? '#ef4444' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      {rows && (
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <Th>วันที่</Th>
                <Th align="right">รายได้</Th>
                <Th align="right">ต้นทุนทฤษฎี</Th>
                <Th align="right">% ต้นทุนอาหาร</Th>
                <Th align="right">เป้าหมาย</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400 text-xs">ไม่มีข้อมูลในช่วงเวลานี้</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.date} className="hover:bg-slate-50">
                  <Td>{r.date}</Td>
                  <Td align="right">฿{r.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">฿{r.theoreticalCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">
                    <span className={r.foodCostPct > 35 ? 'text-red-600 font-medium' : 'text-green-700 font-medium'}>
                      {r.revenue > 0 ? `${r.foodCostPct.toFixed(1)}%` : '—'}
                    </span>
                  </Td>
                  <Td align="right">
                    {r.revenue > 0
                      ? <span className={r.targetMet ? 'text-green-700' : 'text-red-600'}>{r.targetMet ? 'ผ่าน' : 'เกินเป้า'}</span>
                      : <span className="text-slate-400">—</span>
                    }
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

// ─── Page shell ────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');

  const TABS: { key: Tab; label: string }[] = [
    { key: 'revenue',  label: 'รายได้' },
    { key: 'ssf',      label: 'เงินสมทบ SSF / ภาษี' },
    { key: 'foodcost', label: 'ต้นทุนอาหาร' },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">รายงาน</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'revenue'  && <RevenueReport />}
      {tab === 'ssf'      && <SsfReport />}
      {tab === 'foodcost' && <FoodCostReport />}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-4 py-3 text-xs font-semibold text-slate-600 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({ children, align, className }: { children: React.ReactNode; align?: 'right'; className?: string }) {
  return (
    <td className={`px-4 py-3 text-slate-700 ${align === 'right' ? 'text-right tabular-nums' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}
