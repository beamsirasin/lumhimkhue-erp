'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { reviewShift, getShiftCollectionBreakdown } from '@/lib/actions/shifts';
import type { listShifts, ShiftCollectionBreakdown } from '@/lib/actions/shifts';

type ShiftRow = NonNullable<
  Extract<Awaited<ReturnType<typeof listShifts>>, { ok: true }>['data']
>[number];

const STATUS_LABEL: Record<string, string> = {
  open: 'เปิดอยู่',
  closed: 'ปิดแล้ว',
  reviewed: 'ตรวจสอบแล้ว',
};

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800',
  closed: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800',
  reviewed: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700',
};

function fmtThb(value: number): string {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  rows: ShiftRow[];
  canReview: boolean;
  onRefresh: () => void;
}

export function ShiftHistoryTable({ rows, canReview, onRefresh }: Props) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  // Breakdown expand state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [breakdownCache, setBreakdownCache] = useState<Record<string, ShiftCollectionBreakdown>>({});
  const [breakdownLoading, setBreakdownLoading] = useState<string | null>(null);
  const [breakdownError, setBreakdownError] = useState<Record<string, string>>({});

  async function handleReview(shiftId: string) {
    setLoading(shiftId);
    const res = await reviewShift({ shiftId, reviewNotes: reviewNotes.trim() || undefined });
    setLoading(null);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success('บันทึก review แล้ว');
    setReviewingId(null);
    setReviewNotes('');
    onRefresh();
  }

  async function handleExpand(shiftId: string) {
    if (expandedId === shiftId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(shiftId);
    if (breakdownCache[shiftId]) return;

    setBreakdownLoading(shiftId);
    setBreakdownError((prev) => ({ ...prev, [shiftId]: '' }));
    try {
      const result = await getShiftCollectionBreakdown(shiftId);
      if (result.ok) {
        setBreakdownCache((prev) => ({ ...prev, [shiftId]: result.data }));
      } else {
        setBreakdownError((prev) => ({ ...prev, [shiftId]: result.error || 'โหลดรายละเอียดยอดรับไม่สำเร็จ' }));
      }
    } finally {
      setBreakdownLoading(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        ไม่มีข้อมูลรอบแคชเชียร์
      </div>
    );
  }

  // Column count: 9 base + 1 if canReview = 9 or 10
  const colSpan = canReview ? 10 : 9;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">วันที่/เวลาเปิด</th>
            <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">แคชเชียร์</th>
            <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">ปิดรอบ</th>
            <th className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">เงินทอนตั้งต้น</th>
            <th className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">ยอดที่ควรมี</th>
            <th className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">ยอดนับได้</th>
            <th className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">ส่วนต่าง</th>
            <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">สถานะ</th>
            <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">ยอดรับ</th>
            {canReview && <th className="px-4 py-3 font-medium text-muted-foreground">ดำเนินการ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const diff = Number(row.cashDifference ?? 0);
            const isReviewing = reviewingId === row.id;
            const isExpanded = expandedId === row.id;
            const breakdown = breakdownCache[row.id];
            const bdLoading = breakdownLoading === row.id;
            const bdError = breakdownError[row.id];

            // Staleness check: live cashTotal vs stored expectedCash - openingFloat
            const showStaleness =
              breakdown &&
              row.status !== 'open' &&
              row.expectedCash != null &&
              Math.abs(breakdown.cashTotal - (Number(row.expectedCash) - Number(row.openingFloat))) > 0.01;

            return (
              <>
                <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {format(new Date(row.openedAt), 'd MMM yy HH:mm', { locale: th })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-foreground">
                    {row.cashierName ?? '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {row.closedAt ? format(new Date(row.closedAt), 'HH:mm น.') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    ฿{Number(row.openingFloat).toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.expectedCash != null ? `฿${Number(row.expectedCash).toLocaleString('th-TH')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.actualCash != null ? `฿${Number(row.actualCash).toLocaleString('th-TH')}` : '—'}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums font-medium ${
                    diff > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                    diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                  }`}>
                    {row.cashDifference != null
                      ? `${diff >= 0 ? '+' : ''}฿${diff.toLocaleString('th-TH')}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status] ?? ''}`}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label={isExpanded ? 'ซ่อนยอดรับ' : 'ดูยอดรับ'}
                      onClick={() => void handleExpand(row.id)}
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {isExpanded ? 'ซ่อน' : 'ดูยอดรับ'}
                    </button>
                  </td>
                  {canReview && (
                    <td className="px-4 py-3">
                      {row.status === 'closed' && (
                        <button
                          type="button"
                          onClick={() => { setReviewingId(isReviewing ? null : row.id); setReviewNotes(''); }}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
                        >
                          Review
                        </button>
                      )}
                      {row.status === 'reviewed' && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {row.reviewNotes ? `"${row.reviewNotes.slice(0, 20)}${row.reviewNotes.length > 20 ? '…' : ''}"` : 'ตรวจแล้ว'}
                        </span>
                      )}
                    </td>
                  )}
                </tr>

                {/* ── Breakdown sub-row ── */}
                {isExpanded && (
                  <tr key={`${row.id}-breakdown`} className="border-b border-border bg-muted/10">
                    <td colSpan={colSpan} className="px-6 py-4">
                      {bdLoading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          กำลังโหลดรายละเอียดยอดรับ…
                        </div>
                      )}
                      {!bdLoading && bdError && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          โหลดรายละเอียดยอดรับไม่สำเร็จ: {bdError}
                        </p>
                      )}
                      {!bdLoading && breakdown && (
                        <div className="space-y-4">
                          {/* Top summary */}
                          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                            <div>
                              <span className="text-muted-foreground">ยอดรับรวม </span>
                              <span className="font-semibold text-foreground tabular-nums">{fmtThb(breakdown.totalCollected)}</span>
                            </div>
                            {breakdown.cashTotal > 0 && (
                              <div>
                                <span className="text-muted-foreground">เงินสด </span>
                                <span className="tabular-nums">{fmtThb(breakdown.cashTotal)}</span>
                              </div>
                            )}
                            {breakdown.promptpayTotal > 0 && (
                              <div>
                                <span className="text-muted-foreground">QR PromptPay </span>
                                <span className="tabular-nums">{fmtThb(breakdown.promptpayTotal)}</span>
                              </div>
                            )}
                            {breakdown.welfareTotal > 0 && (
                              <div>
                                <span className="text-muted-foreground">สวัสดิการรัฐรับ </span>
                                <span className="tabular-nums">{fmtThb(breakdown.welfareTotal)}</span>
                              </div>
                            )}
                            {breakdown.legacyTotal > 0 && (
                              <div>
                                <span className="text-muted-foreground">ประวัติ QR+เงินสด </span>
                                <span className="tabular-nums">{fmtThb(breakdown.legacyTotal)}</span>
                              </div>
                            )}
                            <div>
                              <span className="text-muted-foreground">จำนวนรายการ </span>
                              <span className="tabular-nums">{breakdown.rowCount}</span>
                            </div>
                          </div>

                          {/* Staleness warning */}
                          {showStaleness && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                              ยอดเงินสดจากรายการต่างจากยอดที่บันทึกตอนปิดรอบ — อาจมีการปรับปรุง/ยกเลิกบิลหลังปิดรอบ
                            </div>
                          )}

                          {breakdown.rowCount === 0 ? (
                            <p className="text-xs text-muted-foreground">ไม่มีรายการรับเงินในรอบนี้</p>
                          ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              {/* Method summary */}
                              {breakdown.methodSummary.length > 0 && (
                                <div>
                                  <p className="mb-1.5 text-xs font-semibold text-foreground">ช่องทางชำระ</p>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-border">
                                        <th className="pb-1 text-left font-medium text-muted-foreground">ช่องทาง</th>
                                        <th className="pb-1 text-center font-medium text-muted-foreground">รายการ</th>
                                        <th className="pb-1 text-right font-medium text-muted-foreground">ยอดรับ</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {breakdown.methodSummary.map((m) => (
                                        <tr key={m.methodId} className="border-b border-border/50 last:border-0">
                                          <td className="py-1 text-foreground">{m.methodName}</td>
                                          <td className="py-1 text-center tabular-nums text-muted-foreground">{m.rowCount}</td>
                                          <td className="py-1 text-right tabular-nums font-medium">{fmtThb(m.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t border-border">
                                        <td className="pt-1.5 font-semibold text-foreground" colSpan={2}>รวม</td>
                                        <td className="pt-1.5 text-right tabular-nums font-semibold text-foreground">{fmtThb(breakdown.totalCollected)}</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}

                              {/* Account summary */}
                              {breakdown.accountSummary.length > 0 && (
                                <div>
                                  <p className="mb-1.5 text-xs font-semibold text-foreground">บัญชีรับเงิน</p>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-border">
                                        <th className="pb-1 text-left font-medium text-muted-foreground">บัญชี</th>
                                        <th className="pb-1 text-center font-medium text-muted-foreground">รายการ</th>
                                        <th className="pb-1 text-right font-medium text-muted-foreground">ยอดรับ</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {breakdown.accountSummary.map((a) => (
                                        <tr key={a.accountId} className="border-b border-border/50 last:border-0">
                                          <td className="py-1 text-foreground">{a.accountName}</td>
                                          <td className="py-1 text-center tabular-nums text-muted-foreground">{a.rowCount}</td>
                                          <td className="py-1 text-right tabular-nums font-medium">{fmtThb(a.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t border-border">
                                        <td className="pt-1.5 font-semibold text-foreground" colSpan={2}>รวม</td>
                                        <td className="pt-1.5 text-right tabular-nums font-semibold text-foreground">{fmtThb(breakdown.totalCollected)}</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}

                              {/* Account × method matrix */}
                              {breakdown.matrix.length > 0 && (
                                <div>
                                  <p className="mb-1.5 text-xs font-semibold text-foreground">บัญชี × ช่องทาง</p>
                                  <div className="space-y-2">
                                    {breakdown.matrix.map((acct) => (
                                      <div key={acct.accountId} className="rounded-md border border-border bg-card px-3 py-2">
                                        <p className="text-xs font-medium text-foreground mb-1">{acct.accountName}</p>
                                        {acct.methods.map((m) => (
                                          <div key={m.methodId} className="flex justify-between text-xs text-muted-foreground">
                                            <span>{m.methodName}</span>
                                            <span className="tabular-nums">{fmtThb(m.amount)}</span>
                                          </div>
                                        ))}
                                        <div className="mt-1 flex justify-between border-t border-border/50 pt-1 text-xs font-semibold text-foreground">
                                          <span>รวม</span>
                                          <span className="tabular-nums">{fmtThb(acct.total)}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}

                {/* ── Review sub-row ── */}
                {isReviewing && (
                  <tr key={`${row.id}-review`} className="bg-muted/20 border-b border-border">
                    <td colSpan={colSpan} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          placeholder="หมายเหตุ review (ไม่บังคับ)"
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleReview(row.id)}
                          disabled={loading === row.id}
                          className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60 transition-colors"
                        >
                          {loading === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยัน Review'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReviewingId(null)}
                          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
