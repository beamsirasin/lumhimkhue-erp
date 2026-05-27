'use client';

import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { getReportSummary } from '@/lib/actions/dashboard';
import type { ReportSummary } from '@/lib/actions/dashboard';

export function ReportsPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportSummary | null>(null);

  async function handleQuery() {
    if (fromDate > toDate) {
      toast.error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
      return;
    }
    setLoading(true);
    const result = await getReportSummary(fromDate, toDate);
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setReport(result.data);
  }

  function handleExport() {
    if (!report) return;
    const headers = ['วันที่', 'จำนวนโต๊ะ', 'จำนวนลูกค้า', 'รายได้รวม (฿)', 'เฉลี่ยต่อโต๊ะ (฿)'];
    const rows = report.rows.map((r) => [
      r.date,
      r.sessions,
      r.guests,
      r.revenue.toFixed(2),
      r.avgPerSession.toFixed(2),
    ]);
    const totalRow = [
      'รวม',
      report.totals.sessions,
      report.totals.guests,
      report.totals.revenue.toFixed(2),
      report.totals.sessions > 0
        ? (report.totals.revenue / report.totals.sessions).toFixed(2)
        : '0.00',
    ];
    const csv = [headers, ...rows, totalRow].map((r) => r.join(',')).join('\n');
    // BOM for Thai characters in Excel
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">รายงาน</h1>

      {/* Filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">วันเริ่มต้น</label>
          <input
            type="date"
            value={fromDate}
            max={today}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">วันสิ้นสุด</label>
          <input
            type="date"
            value={toDate}
            max={today}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>
        <button
          type="button"
          onClick={handleQuery}
          disabled={loading}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'กำลังดึงข้อมูล…' : 'ดูรายงาน'}
        </button>
        {report && (
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Results table */}
      {report && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400 text-xs">
                    ไม่มีข้อมูลในช่วงเวลานี้
                  </td>
                </tr>
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
                  <Td align="right">
                    ฿{report.totals.revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </Td>
                  <Td align="right">
                    ฿{(report.totals.sessions > 0
                      ? report.totals.revenue / report.totals.sessions
                      : 0
                    ).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
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

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`px-4 py-3 text-xs font-semibold text-slate-600 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td
      className={`px-4 py-3 text-slate-700 ${align === 'right' ? 'text-right tabular-nums' : ''}`}
    >
      {children}
    </td>
  );
}
