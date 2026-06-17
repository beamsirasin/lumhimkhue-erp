'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toast } from 'sonner';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { reviewShift } from '@/lib/actions/shifts';
import type { listShifts } from '@/lib/actions/shifts';

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

interface Props {
  rows: ShiftRow[];
  canReview: boolean;
  onRefresh: () => void;
}

export function ShiftHistoryTable({ rows, canReview, onRefresh }: Props) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

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

  if (rows.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        ไม่มีข้อมูลรอบแคชเชียร์
      </div>
    );
  }

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
            {canReview && <th className="px-4 py-3 font-medium text-muted-foreground">ดำเนินการ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const diff = Number(row.cashDifference ?? 0);
            const isReviewing = reviewingId === row.id;
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
                {isReviewing && (
                  <tr key={`${row.id}-review`} className="bg-muted/20 border-b border-border">
                    <td colSpan={canReview ? 9 : 8} className="px-4 py-3">
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
