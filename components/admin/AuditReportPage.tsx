'use client';

import { useState, Fragment } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  getAuditReport,
  getShiftReport,
  getPaymentAdjustmentsReport,
  type AuditAction,
  type AuditReportRow,
  type ShiftReportRow,
} from '@/lib/actions/history';

type Tab = 'audit' | 'shifts' | 'adjustments';

type AdjRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getPaymentAdjustmentsReport>>, { ok: true }>['data']
>[number];

const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  delete_payment:   'ลบการชำระเงิน',
  void_payment:     'ยกเลิกการชำระเงิน',
  reopen_session:   'เปิด session ใหม่',
  process_payment:  'รับชำระเงิน',
  shift_open:       'เปิดรอบแคชเชียร์',
  shift_close:      'ปิดรอบแคชเชียร์',
  shift_review:     'ตรวจสอบรอบ',
  discount_request: 'ขอส่วนลด',
  discount_approve: 'อนุมัติส่วนลด',
  discount_reject:  'ปฏิเสธส่วนลด',
  cancel_order:     'ยกเลิกออเดอร์',
};

const SHIFT_STATUS_LABELS: Record<string, string> = {
  open:     'เปิดอยู่',
  closed:   'ปิดแล้ว',
  reviewed: 'ตรวจสอบแล้ว',
};

const ADJ_TYPE_LABELS: Record<string, string> = {
  void:                'ยกเลิก/ลบ',
  refund:              'คืนเงิน',
  discount_correction: 'แก้ไขส่วนลด',
};

const SETTLEMENT_LABELS: Record<string, string> = {
  partial: 'รับชำระบางส่วน',
  final:   'ปิดบิลทั้งหมด',
};

function fmt(d: Date | string | null | undefined) {
  if (!d) return '—';
  return format(new Date(d), 'd MMM yy HH:mm', { locale: th });
}

function thb(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('th-TH', { style: 'currency', currency: 'THB' });
}

function DiffBadge({ value }: { value: number | null }) {
  if (value == null) return <span>—</span>;
  const color = value === 0 ? 'text-emerald-600' : value > 0 ? 'text-amber-600' : 'text-red-600';
  const sign  = value > 0 ? '+' : '';
  return <span className={color}>{sign}{thb(value)}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open:     'bg-emerald-100 text-emerald-800',
    closed:   'bg-slate-100 text-slate-700',
    reviewed: 'bg-blue-100 text-blue-800',
    pending:  'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-red-100 text-red-800',
  };
  const cls = map[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {SHIFT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* ─── Filter bar ────────────────────────────────────────────────────────────*/
interface Filters {
  dateFrom: string;
  dateTo:   string;
  action?:  AuditAction;
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">ตั้งแต่</label>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">ถึง</label>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">ประเภทการกระทำ</label>
        <select
          value={filters.action ?? ''}
          onChange={(e) =>
            onChange({ ...filters, action: (e.target.value as AuditAction) || undefined })
          }
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">ทั้งหมด</option>
          {(Object.entries(AUDIT_ACTION_LABELS) as [AuditAction, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ─── Table: audit logs ─────────────────────────────────────────────────────*/
function AuditTable({ rows }: { rows: AuditReportRow[] }) {
  if (!rows.length)
    return <div className="py-16 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 pr-4 text-left font-medium">เวลา</th>
            <th className="py-2 pr-4 text-left font-medium">ผู้ใช้</th>
            <th className="py-2 pr-4 text-left font-medium">การกระทำ</th>
            <th className="py-2 pr-4 text-left font-medium">ตาราง</th>
            <th className="py-2 text-left font-medium">รายละเอียด</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{fmt(r.createdAt)}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{r.userName ?? r.userId?.slice(0, 8)}</td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {AUDIT_ACTION_LABELS[r.action as AuditAction] ?? r.action}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                {r.entity} / {r.entityId?.slice(0, 8)}…
              </td>
              <td className="py-2 max-w-xs truncate text-muted-foreground text-xs">
                {r.metadata ? JSON.stringify(r.metadata).slice(0, 120) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Table: cashier shifts ─────────────────────────────────────────────────*/
function ShiftTable({ rows }: { rows: ShiftReportRow[] }) {
  if (!rows.length)
    return <div className="py-16 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 pr-4 text-left font-medium">เปิดรอบ</th>
            <th className="py-2 pr-4 text-left font-medium">แคชเชียร์</th>
            <th className="py-2 pr-4 text-left font-medium">ปิดรอบ</th>
            <th className="py-2 pr-4 text-right font-medium">เงินตั้งต้น</th>
            <th className="py-2 pr-4 text-right font-medium">คาดหวัง</th>
            <th className="py-2 pr-4 text-right font-medium">นับจริง</th>
            <th className="py-2 pr-4 text-right font-medium">ผลต่าง</th>
            <th className="py-2 pr-4 text-left font-medium">สถานะ</th>
            <th className="py-2 text-left font-medium">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{fmt(r.openedAt)}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{r.cashierName ?? r.cashierId?.slice(0, 8)}</td>
              <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{fmt(r.closedAt)}</td>
              <td className="py-2 pr-4 text-right">{thb(r.openingFloat)}</td>
              <td className="py-2 pr-4 text-right">{thb(r.expectedCash)}</td>
              <td className="py-2 pr-4 text-right">{thb(r.actualCash)}</td>
              <td className="py-2 pr-4 text-right"><DiffBadge value={r.cashDifference} /></td>
              <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
              <td className="py-2 max-w-[180px] truncate text-xs text-muted-foreground">
                {r.differenceReason ?? r.reviewNotes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Table: payment adjustments ────────────────────────────────────────────*/
function mutationActionLabel(row: AdjRow): string {
  switch (row.mutationAction) {
    case 'delete_payment': return 'ลบการชำระเงิน';
    case 'reopen_payment':
    case 'reopen_session': return 'แก้ไข → POS';
    default: return ADJ_TYPE_LABELS[row.type] ?? row.type;
  }
}

function AdjustmentsTable({ rows }: { rows: AdjRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!rows.length)
    return <div className="py-16 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 pr-2 w-6" />
            <th className="py-2 pr-4 text-left font-medium">เวลา</th>
            <th className="py-2 pr-4 text-left font-medium">ผู้ขอ</th>
            <th className="py-2 pr-4 text-left font-medium">ประเภทการกระทำ</th>
            <th className="py-2 pr-4 text-left font-medium">สถานะรอบ</th>
            <th className="py-2 pr-4 text-left font-medium">หลังปิดรอบ</th>
            <th className="py-2 pr-4 text-right font-medium">จำนวน</th>
            <th className="py-2 pr-4 text-left font-medium">สถานะ</th>
            <th className="py-2 text-left font-medium">เหตุผล</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr className="border-b hover:bg-muted/30">
                <td className="py-2 pr-2">
                  <button
                    type="button"
                    aria-label="ดูรายละเอียด"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="rounded p-0.5 hover:bg-muted text-muted-foreground"
                  >
                    {expandedId === r.id
                      ? <ChevronUp className="size-3.5" />
                      : <ChevronDown className="size-3.5" />
                    }
                  </button>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{fmt(r.createdAt)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{r.requesterName ?? r.requestedBy?.slice(0, 8)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{mutationActionLabel(r)}</td>
                <td className="py-2 pr-4">
                  {r.shiftStatusAtMutation
                    ? <StatusBadge status={r.shiftStatusAtMutation} />
                    : <span className="text-muted-foreground">—</span>
                  }
                </td>
                <td className="py-2 pr-4">
                  {r.mutationAfterClose
                    ? (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
                        หลังปิดรอบ
                      </span>
                    )
                    : <span className="text-muted-foreground">—</span>
                  }
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{thb(r.amount)}</td>
                <td className="py-2 pr-4"><StatusBadge status={r.status ?? 'approved'} /></td>
                <td
                  className="py-2 max-w-xs whitespace-normal text-xs text-muted-foreground"
                  title={r.mutationReason ?? r.reason ?? undefined}
                >
                  {r.mutationReason ?? r.reason ?? '—'}
                </td>
              </tr>
              {expandedId === r.id && (
                <tr className="bg-muted/20 border-b">
                  <td colSpan={9} className="px-6 py-3">
                    <div className="space-y-3 text-xs">
                      {/* Context */}
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          บริบทการกระทำ
                        </p>
                        <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-0.5 text-muted-foreground">
                          <span>ประเภท</span>
                          <span className="text-foreground">{mutationActionLabel(r)}</span>
                          <span>Payment ID</span>
                          <span className="text-foreground font-mono">{r.paymentId}</span>
                          <span>ประเภทการรับเงิน</span>
                          <span className="text-foreground">{r.settlementType ? SETTLEMENT_LABELS[r.settlementType] ?? r.settlementType : '—'}</span>
                          <span>ยอดบิลตอนรับเงิน</span>
                          <span className="text-foreground tabular-nums">{thb(r.billTotalAtPayment)}</span>
                          <span>ชำระก่อนหน้า</span>
                          <span className="text-foreground tabular-nums">{thb(r.paidBefore)}</span>
                          <span>ยอดรับครั้งนั้น</span>
                          <span className="text-foreground tabular-nums">{thb(r.paymentTotal)}</span>
                          <span>คงเหลือหลังรับ</span>
                          <span className="text-foreground tabular-nums">{thb(r.remainingAfter)}</span>
                          <span>Shift ID</span>
                          <span className="text-foreground font-mono">{r.shiftId?.slice(0, 8) ?? '—'}</span>
                          <span>สถานะรอบขณะกระทำ</span>
                          <span className="text-foreground">{r.shiftStatusAtMutation ?? '—'}</span>
                          <span>ปิดรอบเมื่อ</span>
                          <span className="text-foreground">{r.shiftClosedAt ? fmt(r.shiftClosedAt) : '—'}</span>
                          <span>หลังปิดรอบ</span>
                          <span className="text-foreground">{r.mutationAfterClose ? 'ใช่' : 'ไม่ใช่'}</span>
                          <span>เหตุผลผู้แก้ไข</span>
                          <span className="text-foreground">{r.mutationReason ?? r.reason ?? '—'}</span>
                        </div>
                      </div>
                      {/* Payment rows snapshot */}
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          รายการ payment rows ก่อนการกระทำ ({r.paymentRowCount} รายการ · ยอดรวมที่กระทบ {thb(r.collectionImpact)})
                        </p>
                        {r.paymentRowsBefore.length === 0 ? (
                          <p className="text-muted-foreground">ไม่มีรายละเอียด payment_rows ใน snapshot นี้</p>
                        ) : (
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="border-b text-muted-foreground">
                                <th className="py-1 pr-3 text-left font-medium">#</th>
                                <th className="py-1 pr-3 text-right font-medium">ยอด</th>
                                <th className="py-1 pr-3 text-right font-medium">รับมา</th>
                                <th className="py-1 pr-3 text-right font-medium">ทอน</th>
                                <th className="py-1 pr-3 text-left font-medium">สถานะ</th>
                                <th className="py-1 pr-3 text-left font-medium">Method ID</th>
                                <th className="py-1 text-left font-medium">Account ID</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.paymentRowsBefore.map((pr, i) => (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="py-1 pr-3 text-muted-foreground">{i + 1}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{thb(pr.amount)}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{pr.amountTendered != null ? thb(pr.amountTendered) : '—'}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{pr.changeAmount != null ? thb(pr.changeAmount) : '—'}</td>
                                  <td className="py-1 pr-3 text-muted-foreground">{pr.status}</td>
                                  <td className="py-1 pr-3 font-mono text-muted-foreground">{pr.paymentMethodId.slice(0, 8)}</td>
                                  <td className="py-1 font-mono text-muted-foreground">{pr.receivingAccountId?.slice(0, 8) ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t">
                                <td colSpan={4} className="pt-1.5 font-semibold">ยอดรวมที่กระทบ</td>
                                <td colSpan={3} className="pt-1.5 text-right font-semibold tabular-nums">{thb(r.collectionImpact)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main page component ───────────────────────────────────────────────────*/
export function AuditReportPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [tab, setTab] = useState<Tab>('audit');
  const [filters, setFilters] = useState<Filters>({ dateFrom: today, dateTo: today });

  const auditQuery = useQuery({
    queryKey: ['audit-report', filters, tab],
    queryFn: () =>
      getAuditReport({
        dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00` : undefined,
        dateTo:   filters.dateTo   ? `${filters.dateTo}T23:59:59`   : undefined,
        action:   filters.action,
      }).then((r) => (r.ok ? r.data : [])),
    enabled: tab === 'audit',
    staleTime: 30_000,
  });

  const shiftQuery = useQuery({
    queryKey: ['shift-report', filters],
    queryFn: () =>
      getShiftReport({
        dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00` : undefined,
        dateTo:   filters.dateTo   ? `${filters.dateTo}T23:59:59`   : undefined,
      }).then((r) => (r.ok ? r.data : [])),
    enabled: tab === 'shifts',
    staleTime: 30_000,
  });

  const adjQuery = useQuery({
    queryKey: ['adj-report', filters],
    queryFn: () =>
      getPaymentAdjustmentsReport({
        dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00` : undefined,
        dateTo:   filters.dateTo   ? `${filters.dateTo}T23:59:59`   : undefined,
      }).then((r) => (r.ok ? r.data : [])),
    enabled: tab === 'adjustments',
    staleTime: 30_000,
  });

  const TAB_CONFIG: { id: Tab; label: string }[] = [
    { id: 'audit',       label: 'บันทึกการกระทำ' },
    { id: 'shifts',      label: 'รอบแคชเชียร์'   },
    { id: 'adjustments', label: 'การปรับปรุงชำระเงิน' },
  ];

  const isLoading =
    (tab === 'audit'       && auditQuery.isLoading) ||
    (tab === 'shifts'      && shiftQuery.isLoading) ||
    (tab === 'adjustments' && adjQuery.isLoading);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-medium">รายงานตรวจสอบ</h1>
        <p className="text-sm text-muted-foreground mt-1">
          บันทึกการกระทำ · รอบแคชเชียร์ · การปรับปรุงชำระเงิน
        </p>
      </div>

      {/* Filter bar */}
      <div className="rounded-lg border bg-card p-4">
        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TAB_CONFIG.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table area */}
      <div className="rounded-lg border bg-card p-4">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <>
            {tab === 'audit'       && <AuditTable       rows={auditQuery.data ?? []} />}
            {tab === 'shifts'      && <ShiftTable        rows={shiftQuery.data ?? []} />}
            {tab === 'adjustments' && <AdjustmentsTable  rows={adjQuery.data ?? []} />}
          </>
        )}
      </div>
    </div>
  );
}
