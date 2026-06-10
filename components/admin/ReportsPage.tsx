'use client';

import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { getReportSummary } from '@/lib/actions/dashboard';
import { getPayrollCycles, getPayrollSsfReport } from '@/lib/actions/hr';
import { getFoodCostReport } from '@/lib/actions/recipes';
import { getProfitLossReport, upsertMonthlyExpense } from '@/lib/actions/reports/pl';
import { getMenuPerformanceReport } from '@/lib/actions/reports/menu-performance';
import { getVatReport } from '@/lib/actions/reports/vat-report';
import { getWhtReport } from '@/lib/actions/reports/wht-report';
import { getSsfReport } from '@/lib/actions/reports/ssf-report';
import type { ReportSummary } from '@/lib/actions/dashboard';
import type { SsfReportRow } from '@/lib/actions/hr';
import type { FoodCostRow } from '@/lib/actions/recipes';
import type { PLReport } from '@/lib/actions/reports/pl';
import type { MenuPerformanceRow } from '@/lib/actions/reports/menu-performance';
import type { VatReport } from '@/lib/actions/reports/vat-report';
import type { WhtReport } from '@/lib/actions/reports/wht-report';
import type { SsfReport } from '@/lib/actions/reports/ssf-report';

type Tab = 'revenue' | 'ssf' | 'foodcost' | 'pl' | 'menu' | 'vat' | 'wht' | 'ssf_tax';

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
                <Th>วันที่</Th><Th align="right">จำนวนโต๊ะ</Th><Th align="right">จำนวนลูกค้า</Th>
                <Th align="right">รายได้รวม</Th><Th align="right">เฉลี่ยต่อโต๊ะ</Th>
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
                  <Td>รวม</Td><Td align="right">{report.totals.sessions}</Td>
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
  const [totals, setTotals] = useState<{ gross: number; ssfEmployee: number; ssfEmployer: number; withholdingTax: number; netPayAfterTax: number } | null>(null);
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
    setRows(result.data.rows); setTotals(result.data.totals); setCycleName(result.data.cycle.name);
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
                <Th>รายชื่อพนักงาน</Th><Th align="right">เงินเดือนรวม</Th><Th align="right">SSF ลูกจ้าง</Th>
                <Th align="right">SSF นายจ้าง</Th><Th align="right">ภาษีหัก ณ ที่จ่าย</Th><Th align="right">รับสุทธิ</Th>
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

  const avgFoodCostPct = rows && rows.length > 0
    ? rows.filter((r) => r.revenue > 0).reduce((s, r) => s + r.foodCostPct, 0) / Math.max(1, rows.filter((r) => r.revenue > 0).length)
    : null;

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
      </div>

      {avgFoodCostPct !== null && (
        <div className="flex gap-4">
          <div className="rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-900/5">
            <p className="text-xs text-slate-500">% ต้นทุนอาหารเฉลี่ย</p>
            <p className={`text-2xl font-bold mt-0.5 ${avgFoodCostPct > 35 ? 'text-red-600' : 'text-green-600'}`}>{avgFoodCostPct.toFixed(1)}%</p>
            <p className="text-xs text-slate-400 mt-0.5">เป้าหมาย ≤ 35%</p>
          </div>
        </div>
      )}

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
                {rows.map((row) => <Cell key={row.date} fill={row.foodCostPct > 35 ? '#ef4444' : '#22c55e'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows && (
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <Th>วันที่</Th><Th align="right">รายได้</Th><Th align="right">ต้นทุนทฤษฎี</Th>
                <Th align="right">% ต้นทุนอาหาร</Th><Th align="right">เป้าหมาย</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-slate-400 text-xs">ไม่มีข้อมูล</td></tr>}
              {rows.map((r) => (
                <tr key={r.date} className="hover:bg-slate-50">
                  <Td>{r.date}</Td>
                  <Td align="right">฿{r.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">฿{r.theoreticalCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right"><span className={r.foodCostPct > 35 ? 'text-red-600 font-medium' : 'text-green-700 font-medium'}>{r.revenue > 0 ? `${r.foodCostPct.toFixed(1)}%` : '—'}</span></Td>
                  <Td align="right">{r.revenue > 0 ? <span className={r.targetMet ? 'text-green-700' : 'text-red-600'}>{r.targetMet ? 'ผ่าน' : 'เกินเป้า'}</span> : <span className="text-slate-400">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── P&L Report ────────────────────────────────────────────────────────────────

const EXPENSE_LABELS: Record<string, string> = {
  rent: 'ค่าเช่า',
  electricity: 'ค่าไฟ',
  water: 'ค่าน้ำ',
  other: 'อื่นๆ',
};

function PLReportTab() {
  const thisMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(thisMonth);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<PLReport | null>(null);
  const [expenseEdits, setExpenseEdits] = useState<Record<string, string>>({});
  const [savingExpense, setSavingExpense] = useState<string | null>(null);

  async function handleQuery() {
    setLoading(true);
    const r = await getProfitLossReport(month);
    setLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setReport(r.data);
    setExpenseEdits({
      rent: r.data.rentCost.toString(),
      electricity: r.data.electricityCost.toString(),
      water: r.data.waterCost.toString(),
      other: r.data.otherCost.toString(),
    });
  }

  async function saveExpense(category: string) {
    setSavingExpense(category);
    const amount = parseFloat(expenseEdits[category] ?? '0') || 0;
    const r = await upsertMonthlyExpense({ month, category, amount });
    setSavingExpense(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('บันทึกแล้ว');
    handleQuery();
  }

  function fmtBaht(n: number) {
    return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function PLRow({ label, value, bold, indent, color }: { label: string; value: number; bold?: boolean; indent?: boolean; color?: string }) {
    return (
      <div className={`flex justify-between py-2 text-sm border-b border-slate-50 ${bold ? 'font-semibold' : ''} ${indent ? 'pl-6' : ''}`}>
        <span className="text-slate-700">{label}</span>
        <span className={`tabular-nums ${color ?? 'text-slate-900'}`}>฿{fmtBaht(value)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">เดือน</label>
          <input type="month" value={month} max={thisMonth} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <button type="button" onClick={handleQuery} disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loading ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
      </div>

      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* P&L statement */}
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
            <p className="text-sm font-semibold text-slate-900 mb-3">กำไร-ขาดทุน — {month}</p>

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 mt-3">รายได้</div>
            <PLRow label="รายได้บุฟเฟ่ต์" value={report.buffetRevenue} indent />
            <PLRow label="รายได้ Add-on" value={report.addonRevenue} indent />
            <PLRow label="รายได้รวม" value={report.totalRevenue} bold />

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 mt-4">ต้นทุนอาหาร (COGS)</div>
            {report.foodCostAvailable ? (
              <>
                <PLRow label="ต้นทุนอาหาร (ทฤษฎี)" value={report.foodCost} indent color="text-red-600" />
                <PLRow label="กำไรขั้นต้น" value={report.grossProfit} bold color={report.grossProfit >= 0 ? 'text-green-700' : 'text-red-600'} />
                <div className="flex justify-between py-1 text-xs text-slate-500 border-b border-slate-50">
                  <span className="pl-6">Gross Margin</span>
                  <span className={report.grossMarginPct >= 60 ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>{report.grossMarginPct.toFixed(1)}%</span>
                </div>
              </>
            ) : (
              <div className="pl-6 py-2 text-xs text-slate-400">ยังไม่มีสูตรอาหาร</div>
            )}

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 mt-4">ค่าแรงงาน</div>
            {report.laborCostAvailable ? (
              <>
                <PLRow label="เงินเดือน + incentive" value={report.laborCost} indent color="text-red-600" />
                <div className="flex justify-between py-1 text-xs text-slate-500 border-b border-slate-50">
                  <span className="pl-6">Labor Cost %</span>
                  <span className={report.laborCostPct > 30 ? 'text-amber-700 font-medium' : 'text-slate-600'}>{report.laborCostPct.toFixed(1)}%</span>
                </div>
              </>
            ) : (
              <div className="pl-6 py-2 text-xs text-slate-400">ยังไม่มีข้อมูลเงินเดือน</div>
            )}

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 mt-4">ค่าใช้จ่ายอื่น</div>
            <PLRow label="ค่าเช่า" value={report.rentCost} indent />
            <PLRow label="ค่าไฟ" value={report.electricityCost} indent />
            <PLRow label="ค่าน้ำ" value={report.waterCost} indent />
            <PLRow label="อื่นๆ" value={report.otherCost} indent />
            <PLRow label="รวมค่าใช้จ่ายอื่น" value={report.totalOtherCost} bold />

            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <PLRow label="กำไรสุทธิ" value={report.netProfit} bold color={report.netProfit >= 0 ? 'text-green-700' : 'text-red-600'} />
              <div className="flex justify-between pt-1 text-sm font-semibold">
                <span className="text-slate-500">Net Margin</span>
                <span className={report.netMarginPct >= 10 ? 'text-green-700' : 'text-amber-700'}>{report.netMarginPct.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* Manual expense input */}
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
            <p className="text-sm font-semibold text-slate-900 mb-1">กรอกค่าใช้จ่ายอื่น</p>
            <p className="text-xs text-slate-400 mb-4">ค่าใช้จ่ายเดือน {month}</p>
            <div className="space-y-3">
              {(['rent', 'electricity', 'water', 'other'] as const).map((cat) => (
                <div key={cat} className="flex items-center gap-2">
                  <label className="w-24 text-sm text-slate-700 shrink-0">{EXPENSE_LABELS[cat]}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseEdits[cat] ?? '0'}
                    onChange={(e) => setExpenseEdits((prev) => ({ ...prev, [cat]: e.target.value }))}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-right outline-none focus:border-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => saveExpense(cat)}
                    disabled={savingExpense === cat}
                    className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 shrink-0"
                  >
                    {savingExpense === cat ? '…' : 'บันทึก'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Menu Performance Report ──────────────────────────────────────────────────

const QUADRANT_CONFIG: Record<string, { label: string; color: string; dot: string; desc: string }> = {
  star:     { label: 'Stars',         color: '#3b82f6', dot: 'bg-blue-500',  desc: 'ยอดขายสูง, margin สูง — พระเอก' },
  cashcow:  { label: 'Cash Cows',     color: '#22c55e', dot: 'bg-green-500', desc: 'ยอดขายสูง, margin ต่ำ — ดูแลต้นทุน' },
  question: { label: 'Question Marks', color: '#f59e0b', dot: 'bg-amber-500', desc: 'ยอดขายต่ำ, margin สูง — โปรโมตเพิ่ม' },
  dog:      { label: 'Dogs',           color: '#ef4444', dot: 'bg-red-500',   desc: 'ยอดขายต่ำ, margin ต่ำ — พิจารณาเอาออก' },
};

function MenuReport() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MenuPerformanceRow[] | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');

  async function handleQuery() {
    if (fromDate > toDate) { toast.error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด'); return; }
    setLoading(true);
    const r = await getMenuPerformanceReport(fromDate, toDate);
    setLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setRows(r.data);
  }

  // Scatter chart data: one point per row, grouped by quadrant
  const scatterData = rows
    ? Object.keys(QUADRANT_CONFIG).map((q) => ({
        name: q,
        data: rows
          .filter((r) => r.quadrant === q)
          .map((r) => ({ x: r.qtySold, y: r.marginPct ?? 0, z: 1, name: r.name })),
      }))
    : [];

  const medianQty = rows && rows.length > 0
    ? [...rows].sort((a, b) => a.qtySold - b.qtySold)[Math.floor(rows.length / 2)].qtySold
    : 0;

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
        {rows && (
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 ml-auto">
            {(['table', 'chart'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setViewMode(m)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${viewMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {m === 'table' ? 'ตาราง' : 'BCG Chart'}
              </button>
            ))}
          </div>
        )}
      </div>

      {rows && viewMode === 'chart' && (
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-900">BCG Matrix — ยอดขาย vs Margin %</p>
          </div>
          <div className="flex flex-wrap gap-3 mb-4">
            {Object.entries(QUADRANT_CONFIG).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5 text-xs">
                <span className={`size-2 rounded-full ${v.dot} shrink-0`} />
                <span className="font-medium text-slate-700">{v.label}</span>
                <span className="text-slate-400">— {v.desc}</span>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="x" type="number" name="ยอดขาย" tick={{ fontSize: 11 }} label={{ value: 'จำนวนที่สั่ง', position: 'insideBottom', offset: -4, fontSize: 11 }} />
              <YAxis dataKey="y" type="number" name="Margin %" tick={{ fontSize: 11 }} label={{ value: 'Margin %', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }} unit="%" />
              <ZAxis dataKey="z" range={[60, 60]} />
              <ReferenceLine x={medianQty} stroke="#94a3b8" strokeDasharray="4 4" />
              <ReferenceLine y={30} stroke="#94a3b8" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload as { x: number; y: number; name: string };
                  return (
                    <div className="rounded-lg bg-white px-3 py-2 shadow-md text-xs ring-1 ring-slate-900/10">
                      <p className="font-semibold text-slate-800 mb-1">{d.name}</p>
                      <p className="text-slate-600">ยอดขาย: {d.x} จาน</p>
                      <p className="text-slate-600">Margin: {d.y.toFixed(1)}%</p>
                    </div>
                  );
                }}
              />
              {scatterData.map((s) => (
                <Scatter key={s.name} name={s.name} data={s.data} fill={QUADRANT_CONFIG[s.name].color} fillOpacity={0.7} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows && viewMode === 'table' && (
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <Th>เมนู</Th><Th>หมวด</Th>
                <Th align="right">จำนวนสั่ง</Th><Th align="right">% ของออเดอร์</Th>
                <Th align="right">ต้นทุน/ชิ้น</Th><Th align="right">ต้นทุนรวม</Th>
                <Th align="right">Margin %</Th><Th align="right">Quadrant</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-400 text-xs">ไม่มีข้อมูล</td></tr>}
              {rows.map((r) => {
                const qCfg = QUADRANT_CONFIG[r.quadrant];
                return (
                  <tr key={r.menuItemId} className="hover:bg-slate-50">
                    <Td><span className="font-medium text-slate-800">{r.name}</span></Td>
                    <Td><span className="text-xs text-slate-500">{r.categoryName}</span></Td>
                    <Td align="right">{r.qtySold}</Td>
                    <Td align="right">{r.pctOfTotal.toFixed(1)}%</Td>
                    <Td align="right">{r.costPerUnit > 0 ? `฿${r.costPerUnit.toFixed(2)}` : <span className="text-slate-300">—</span>}</Td>
                    <Td align="right">{r.theoreticalCostTotal > 0 ? `฿${r.theoreticalCostTotal.toFixed(2)}` : <span className="text-slate-300">—</span>}</Td>
                    <Td align="right">
                      {r.marginPct !== null
                        ? <span className={r.marginPct >= 30 ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>{r.marginPct.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td align="right">
                      {qCfg && <span className={`rounded-full px-2 py-0.5 text-xs font-medium`} style={{ background: `${qCfg.color}20`, color: qCfg.color }}>{qCfg.label}</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── VAT Report (ภ.พ.30) ───────────────────────────────────────────────────────

function VatReportTab() {
  const thisMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(thisMonth);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<VatReport | null>(null);

  async function handleQuery() {
    setLoading(true);
    const r = await getVatReport(month);
    setLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setReport(r.data);
  }

  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">เดือน</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <button type="button" onClick={handleQuery} disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loading ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5 text-center">
              <p className="text-xs text-slate-500">ภาษีขาย (Output VAT)</p>
              <p className="mt-1 text-xl font-bold text-slate-900">฿{fmt(report.outputVat)}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5 text-center">
              <p className="text-xs text-slate-500">ภาษีซื้อ (Input VAT)</p>
              <p className="mt-1 text-xl font-bold text-slate-900">฿{fmt(report.inputVat)}</p>
            </div>
            <div className={`rounded-xl p-4 shadow-sm ring-1 ring-slate-900/5 text-center ${report.netVat >= 0 ? 'bg-red-50' : 'bg-green-50'}`}>
              <p className="text-xs text-slate-500">ภาษีต้องชำระ</p>
              <p className={`mt-1 text-xl font-bold ${report.netVat >= 0 ? 'text-red-700' : 'text-green-700'}`}>
                ฿{fmt(Math.abs(report.netVat))} {report.netVat >= 0 ? '(ต้องจ่าย)' : '(ขอคืนได้)'}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
            <div className="px-4 py-3 bg-blue-50 border-b border-slate-100">
              <p className="text-sm font-semibold text-blue-800">ภาษีขาย (จากยอดขาย {report.outputRows.length} รายการ)</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr><Th>วันที่</Th><Th>เลขใบเสร็จ</Th><Th align="right">ยอดก่อนภาษี</Th><Th align="right">VAT {report.vatRate}%</Th><Th align="right">ยอดรวม</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {report.outputRows.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.date}</Td>
                    <Td><span className="font-mono text-xs">{r.refNo}</span></Td>
                    <Td align="right">฿{fmt(r.baseAmount)}</Td>
                    <Td align="right">฿{fmt(r.vatAmount)}</Td>
                    <Td align="right">฿{fmt(r.total)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-sm">รวม</td>
                  <Td align="right">฿{fmt(report.outputBase)}</Td>
                  <Td align="right">฿{fmt(report.outputVat)}</Td>
                  <Td align="right">฿{fmt(report.outputBase + report.outputVat)}</Td>
                </tr>
              </tfoot>
            </table>
          </div>

          {report.inputRows.length > 0 && (
            <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
              <div className="px-4 py-3 bg-emerald-50 border-b border-slate-100">
                <p className="text-sm font-semibold text-emerald-800">ภาษีซื้อ (จากใบสั่งซื้อ {report.inputRows.length} รายการ)</p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr><Th>วันที่รับสินค้า</Th><Th>เลขใบกำกับภาษี</Th><Th align="right">ยอดก่อนภาษี</Th><Th align="right">VAT</Th><Th align="right">ยอดรวม</Th></tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {report.inputRows.map((r, i) => (
                    <tr key={i}>
                      <Td>{r.date}</Td>
                      <Td><span className="font-mono text-xs">{r.refNo}</span></Td>
                      <Td align="right">฿{fmt(r.baseAmount)}</Td>
                      <Td align="right">฿{fmt(r.vatAmount)}</Td>
                      <Td align="right">฿{fmt(r.total)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-sm">รวม</td>
                    <Td align="right">฿{fmt(report.inputBase)}</Td>
                    <Td align="right">฿{fmt(report.inputVat)}</Td>
                    <Td align="right">฿{fmt(report.inputBase + report.inputVat)}</Td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── WHT Report (ภ.ง.ด.1) ─────────────────────────────────────────────────────

function WhtReportTab() {
  const thisMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(thisMonth);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<WhtReport | null>(null);

  async function handleQuery() {
    setLoading(true);
    const r = await getWhtReport(month);
    setLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setReport(r.data);
  }

  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">เดือน</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <button type="button" onClick={handleQuery} disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loading ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
      </div>

      {report && (
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
            <p className="text-sm font-semibold text-slate-800">ภ.ง.ด.1 — ภาษีหัก ณ ที่จ่าย เดือน {month}</p>
            <div className="flex gap-4 text-sm">
              <span className="text-slate-500">เงินได้: <strong className="text-slate-800">฿{fmt(report.totalGross)}</strong></span>
              <span className="text-red-600">ภาษีหัก: <strong>฿{fmt(report.totalWht)}</strong></span>
            </div>
          </div>
          {report.rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">ไม่มีข้อมูลภาษีหัก ณ ที่จ่ายในเดือนนี้</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr><Th>ชื่อพนักงาน</Th><Th>เลขประจำตัวประชาชน</Th><Th align="right">เงินได้สุทธิ</Th><Th align="right">ภาษีหัก ณ ที่จ่าย</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {report.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <Td>{r.fullName}</Td>
                    <Td><span className="font-mono text-xs">{r.nationalId ?? '—'}</span></Td>
                    <Td align="right">฿{fmt(r.gross)}</Td>
                    <Td align="right" className="text-red-600">฿{fmt(r.withholdingTax)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-sm">รวม</td>
                  <Td align="right">฿{fmt(report.totalGross)}</Td>
                  <Td align="right" className="text-red-600">฿{fmt(report.totalWht)}</Td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SSF Tax Report (ประกันสังคม) ─────────────────────────────────────────────

function SsfTaxTab() {
  const thisMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(thisMonth);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SsfReport | null>(null);

  async function handleQuery() {
    setLoading(true);
    const r = await getSsfReport(month);
    setLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setReport(r.data);
  }

  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">เดือน</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
        </div>
        <button type="button" onClick={handleQuery} disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {loading ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
      </div>

      {report && (
        <div className="rounded-xl bg-white overflow-hidden shadow-sm ring-1 ring-slate-900/5">
          <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
            <p className="text-sm font-semibold text-slate-800">ประกันสังคม เดือน {month}</p>
            <div className="flex gap-4 text-sm">
              <span className="text-slate-500">ลูกจ้าง: <strong>฿{fmt(report.totalSsfEmployee)}</strong></span>
              <span className="text-slate-500">นายจ้าง: <strong>฿{fmt(report.totalSsfEmployer)}</strong></span>
              <span className="text-blue-600">รวมนำส่ง: <strong>฿{fmt(report.totalSsf)}</strong></span>
            </div>
          </div>
          {report.rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">ไม่มีข้อมูลประกันสังคมในเดือนนี้</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr><Th>ชื่อพนักงาน</Th><Th>เลขประกันสังคม</Th><Th align="right">เงินเดือน</Th><Th align="right">ส่วนลูกจ้าง</Th><Th align="right">ส่วนนายจ้าง</Th><Th align="right">รวม</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {report.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <Td>{r.fullName}</Td>
                    <Td><span className="font-mono text-xs">{r.socialSecurityNumber ?? '—'}</span></Td>
                    <Td align="right">฿{fmt(r.gross)}</Td>
                    <Td align="right">฿{fmt(r.ssfEmployee)}</Td>
                    <Td align="right">฿{fmt(r.ssfEmployer)}</Td>
                    <Td align="right" className="font-medium">฿{fmt(r.total)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-sm">รวม</td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm" />
                  <Td align="right">฿{fmt(report.totalSsfEmployee)}</Td>
                  <Td align="right">฿{fmt(report.totalSsfEmployer)}</Td>
                  <Td align="right" className="text-blue-700">฿{fmt(report.totalSsf)}</Td>
                </tr>
              </tfoot>
            </table>
          )}
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
    { key: 'ssf',      label: 'SSF / ภาษี' },
    { key: 'foodcost', label: 'ต้นทุนอาหาร' },
    { key: 'pl',       label: 'P&L' },
    { key: 'menu',     label: 'เมนู' },
    { key: 'vat',      label: 'ภ.พ.30' },
    { key: 'wht',      label: 'ภ.ง.ด.1' },
    { key: 'ssf_tax',  label: 'ประกันสังคม' },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">รายงาน</h1>

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'revenue'  && <RevenueReport />}
      {tab === 'ssf'      && <SsfReport />}
      {tab === 'foodcost' && <FoodCostReport />}
      {tab === 'pl'       && <PLReportTab />}
      {tab === 'menu'     && <MenuReport />}
      {tab === 'vat'      && <VatReportTab />}
      {tab === 'wht'      && <WhtReportTab />}
      {tab === 'ssf_tax'  && <SsfTaxTab />}
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
