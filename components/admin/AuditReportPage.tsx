'use client';

import Link from 'next/link';
import { useState, Fragment } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardList,
  Clock,
  Filter,
  ShieldCheck,
  UserRound,
  WalletCards,
} from 'lucide-react';
import {
  getAuditReport,
  getShiftReport,
  getPaymentAdjustmentsReport,
  type AuditAction,
  type AuditReportRow,
  type ShiftReportRow,
} from '@/lib/actions/history';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ThaiDateInput } from '@/components/ui/thai-date-input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatThaiDateTime } from '@/lib/date-time';

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
  manager_approval_code_generated: 'สร้างรหัสอนุมัติ',
  manager_approval_code_revoked:   'ยกเลิกรหัสอนุมัติ',
  manager_approval_code_used:      'ใช้รหัสอนุมัติ',
  manager_approval_code_failed_attempt: 'กรอกรหัสอนุมัติผิด/หมดอายุ',
  sensitive_action_approved_by_code:    'แก้ไขรายการสำคัญด้วยรหัสอนุมัติ',
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

// ─── Status badge helpers ─────────────────────────────────────────────────────

const STATUS_BADGE_MAP: Record<string, { label: string; variant: BadgeVariant }> = {
  open:     { label: 'เปิดอยู่',     variant: 'success' },
  closed:   { label: 'ปิดแล้ว',      variant: 'neutral' },
  reviewed: { label: 'ตรวจสอบแล้ว', variant: 'info'    },
  pending:  { label: 'รอดำเนินการ',  variant: 'warning' },
  approved: { label: 'อนุมัติ',       variant: 'success' },
  rejected: { label: 'ปฏิเสธ',       variant: 'danger'  },
};
const AUDIT_ACTION_VARIANTS: Partial<Record<AuditAction, BadgeVariant>> = {
  delete_payment: 'danger',
  void_payment: 'danger',
  reopen_session: 'warning',
  process_payment: 'success',
  shift_open: 'info',
  shift_close: 'neutral',
  shift_review: 'purple',
  discount_request: 'warning',
  discount_approve: 'success',
  discount_reject: 'danger',
  cancel_order: 'orange',
  manager_approval_code_generated: 'info',
  manager_approval_code_revoked: 'warning',
  manager_approval_code_used: 'success',
  manager_approval_code_failed_attempt: 'danger',
  sensitive_action_approved_by_code: 'purple',
};

function AuditStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE_MAP[status];
  if (!cfg) return <StatusBadge label={status} variant="neutral" />;
  return <StatusBadge label={cfg.label} variant={cfg.variant} dot />;
}

function AuditActionBadge({ action }: { action: string }) {
  const auditAction = action as AuditAction;
  return (
    <StatusBadge
      label={AUDIT_ACTION_LABELS[auditAction] ?? action}
      variant={AUDIT_ACTION_VARIANTS[auditAction] ?? 'neutral'}
      size="md"
      className="whitespace-nowrap"
    />
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(d: Date | string | null | undefined) {
  if (!d) return '—';
  return formatThaiDateTime(d);
}

function thb(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('th-TH', { style: 'currency', currency: 'THB' });
}

function DiffBadge({ value }: { value: number | null }) {
  if (value == null) return <span>—</span>;
  const color = value === 0 ? 'text-[var(--status-success-fg)]' : value > 0 ? 'text-[var(--status-warning-fg)]' : 'text-[var(--status-danger-fg)]';
  const sign  = value > 0 ? '+' : '';
  return <span className={color}>{sign}{thb(value)}</span>;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function TableLoadingSkeleton({ cols }: { cols: number }) {
  return (
    <div className="p-5 space-y-2">
      <div className="flex gap-4 pb-3 border-b border-border">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4 py-1">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface Filters {
  dateFrom: string;
  dateTo:   string;
  action?:  AuditAction;
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,12rem)_minmax(10rem,12rem)_minmax(14rem,1fr)]">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">ตั้งแต่</Label>
          <div>
            <ThaiDateInput
              value={filters.dateFrom}
              onValueChange={(dateFrom) => onChange({ ...filters, dateFrom })}
              className="h-10 w-full"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">ถึง</Label>
          <div>
            <ThaiDateInput
              value={filters.dateTo}
              onValueChange={(dateTo) => onChange({ ...filters, dateTo })}
              className="h-10 w-full"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label className="text-xs font-medium text-muted-foreground">ประเภทการกระทำ</Label>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <select
              value={filters.action ?? ''}
              onChange={(e) =>
                onChange({ ...filters, action: (e.target.value as AuditAction) || undefined })
              }
              className="h-10 w-full rounded-lg border border-input bg-[var(--surface-1)] pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">ทั้งหมด</option>
              {(Object.entries(AUDIT_ACTION_LABELS) as [AuditAction, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">ช่วงวันที่:</span>{' '}
        <span className="tabular-nums">{filters.dateFrom || '—'} - {filters.dateTo || '—'}</span>
      </div>
    </div>
  );
}

// ─── Table: audit logs ────────────────────────────────────────────────────────

function AuditTable({ rows }: { rows: AuditReportRow[] }) {
  if (!rows.length)
    return (
      <EmptyState
        icon={<ClipboardList className="size-5" />}
        title="ไม่มีข้อมูล"
        description="ไม่พบรายการในช่วงวันที่เลือก"
      />
    );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
          <TableHead className="text-xs text-muted-foreground font-medium">เวลา</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">ผู้ใช้</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">การกระทำ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">ตาราง</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">รายละเอียด</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="hover:bg-[var(--surface-2)]/70">
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(r.createdAt)}</TableCell>
            <TableCell className="whitespace-nowrap">{r.userName ?? r.userId?.slice(0, 8)}</TableCell>
            <TableCell className="whitespace-nowrap"><AuditActionBadge action={r.action} /></TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
              {r.entity} / {r.entityId?.slice(0, 8)}…
            </TableCell>
            <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
              {r.metadata ? JSON.stringify(r.metadata).slice(0, 120) : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Table: cashier shifts ────────────────────────────────────────────────────

function ShiftTable({ rows }: { rows: ShiftReportRow[] }) {
  if (!rows.length)
    return (
      <EmptyState
        icon={<Clock className="size-5" />}
        title="ไม่มีข้อมูล"
        description="ไม่พบรายการรอบในช่วงวันที่เลือก"
      />
    );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
          <TableHead className="text-xs text-muted-foreground font-medium">เปิดรอบ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">แคชเชียร์</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">ปิดรอบ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium text-right">เงินตั้งต้น</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium text-right">คาดหวัง</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium text-right">นับจริง</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium text-right">ผลต่าง</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">สถานะ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">หมายเหตุ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="hover:bg-[var(--surface-2)]/70">
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(r.openedAt)}</TableCell>
            <TableCell className="whitespace-nowrap">{r.cashierName ?? r.cashierId?.slice(0, 8)}</TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(r.closedAt)}</TableCell>
            <TableCell className="text-right tabular-nums">{thb(r.openingFloat)}</TableCell>
            <TableCell className="text-right tabular-nums">{thb(r.expectedCash)}</TableCell>
            <TableCell className="text-right tabular-nums">{thb(r.actualCash)}</TableCell>
            <TableCell className="text-right"><DiffBadge value={r.cashDifference} /></TableCell>
            <TableCell><AuditStatusBadge status={r.status} /></TableCell>
            <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
              {r.differenceReason ?? r.reviewNotes ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Table: payment adjustments ───────────────────────────────────────────────

function mutationActionLabel(row: AdjRow): string {
  switch (row.mutationAction) {
    case 'delete_payment': return 'ลบการชำระเงิน';
    case 'reopen_payment':
    case 'reopen_session': return 'แก้ไข → POS';
    default: return ADJ_TYPE_LABELS[row.type] ?? row.type;
  }
}

function AdjustmentActionBadge({ row }: { row: AdjRow }) {
  const variant: BadgeVariant = row.mutationAction === 'delete_payment'
    ? 'danger'
    : row.mutationAction === 'reopen_payment' || row.mutationAction === 'reopen_session'
      ? 'warning'
      : row.type === 'refund'
        ? 'orange'
        : 'info';

  return <StatusBadge label={mutationActionLabel(row)} variant={variant} size="md" className="whitespace-nowrap" />;
}

function AdjustmentsTable({ rows }: { rows: AdjRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!rows.length)
    return (
      <EmptyState
        icon={<AlertCircle className="size-5" />}
        title="ไม่มีข้อมูล"
        description="ไม่พบรายการปรับปรุงในช่วงวันที่เลือก"
      />
    );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-[var(--surface-2)] hover:bg-[var(--surface-2)]">
          <TableHead className="w-8" />
          <TableHead className="text-xs text-muted-foreground font-medium">เวลา</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">ผู้ขอ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">ประเภทการกระทำ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">สถานะรอบ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">หลังปิดรอบ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium text-right">จำนวน</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">สถานะ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">เหตุผล</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <TableRow className="hover:bg-[var(--surface-2)]/70">
              <TableCell className="pr-1">
                <button
                  type="button"
                  aria-label="ดูรายละเอียด"
                  aria-expanded={expandedId === r.id}
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="rounded-md border border-border bg-[var(--surface-1)] p-1 text-muted-foreground transition-colors hover:bg-[var(--surface-2)]"
                >
                  {expandedId === r.id
                    ? <ChevronUp className="size-3.5" />
                    : <ChevronDown className="size-3.5" />
                  }
                </button>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(r.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap">{r.requesterName ?? r.requestedBy?.slice(0, 8)}</TableCell>
              <TableCell className="whitespace-nowrap"><AdjustmentActionBadge row={r} /></TableCell>
              <TableCell>
                {r.shiftStatusAtMutation
                  ? <AuditStatusBadge status={r.shiftStatusAtMutation} />
                  : <span className="text-muted-foreground">—</span>
                }
              </TableCell>
              <TableCell>
                {r.mutationAfterClose
                  ? <StatusBadge label="หลังปิดรอบ" variant="warning" />
                  : <span className="text-muted-foreground">—</span>
                }
              </TableCell>
              <TableCell className="text-right tabular-nums">{thb(r.amount)}</TableCell>
              <TableCell><AuditStatusBadge status={r.status ?? 'approved'} /></TableCell>
              <TableCell
                className="max-w-xs text-xs text-muted-foreground"
                title={r.mutationReason ?? r.reason ?? undefined}
              >
                {r.mutationReason ?? r.reason ?? '—'}
              </TableCell>
            </TableRow>
            {expandedId === r.id && (
              <TableRow className="bg-[var(--surface-2)]/60 hover:bg-[var(--surface-2)]/60">
                <TableCell colSpan={9} className="px-6 py-3">
                  <div className="space-y-4 rounded-lg border border-border bg-[var(--surface-1)] p-4 text-xs shadow-[var(--shadow-card)]">
                    {/* Action context */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        บริบทการกระทำ
                      </p>
                      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-lg border border-border bg-[var(--surface-2)] p-3 text-muted-foreground">
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
                    {/* Payment rows snapshot — kept as raw table (nested detail, not a primary data table) */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        รายการ payment rows ก่อนการกระทำ ({r.paymentRowCount} รายการ · ยอดรวมที่กระทบ {thb(r.collectionImpact)})
                      </p>
                      {r.paymentRowsBefore.length === 0 ? (
                        <p className="text-muted-foreground">ไม่มีรายละเอียด payment_rows ใน snapshot นี้</p>
                      ) : (
                        <table className="w-full border-collapse rounded-lg bg-[var(--surface-1)] text-xs">
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
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TAB_CONFIG = [
  {
    id: 'audit',
    label: 'บันทึกการกระทำ',
    description: 'ดูเหตุการณ์สำคัญ ผู้ใช้ และ entity ที่ได้รับผลกระทบ',
    icon: ClipboardList,
    variant: 'info',
  },
  {
    id: 'shifts',
    label: 'รอบแคชเชียร์',
    description: 'ตรวจยอดเปิดรอบ ปิดรอบ ผลต่าง และสถานะการตรวจสอบ',
    icon: Clock,
    variant: 'success',
  },
  {
    id: 'adjustments',
    label: 'การปรับปรุงชำระเงิน',
    description: 'ติดตามการแก้ไข ลบ คืนเงิน และ snapshot ก่อนปรับปรุง',
    icon: WalletCards,
    variant: 'warning',
  },
] satisfies Array<{
  id: Tab;
  label: string;
  description: string;
  icon: typeof ClipboardList;
  variant: BadgeVariant;
}>;

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

  return (
    <AppShell>
      <PageHeader
        title="รายงานตรวจสอบ"
        subtitle="ตรวจสอบ audit trail รอบแคชเชียร์ และการปรับปรุงการชำระเงินในที่เดียว"
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
          <div className="flex items-center gap-2 rounded-lg border border-border bg-[var(--surface-2)] px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-[var(--status-info-fg)]" />
            <span className="font-medium text-foreground">Owner / Manager</span>
          </div>
        }
      />

      <DataCard
        title="ตัวกรองรายงาน"
        subtitle="ช่วงวันที่และประเภทการกระทำยังใช้เงื่อนไขเดิมทุกประการ"
        className="mt-6"
        actions={(
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <UserRound className="size-4" />
            <span>ผู้ใช้แสดงจากข้อมูล audit เดิม</span>
          </div>
        )}
      >
        <FilterBar filters={filters} onChange={setFilters} />
      </DataCard>

      <section className="mt-6 space-y-4">
        <Tabs
          value={tab}
          onValueChange={(v) => { if (typeof v === 'string' && v) setTab(v as Tab); }}
          className="space-y-5"
        >
          <TabsList className="grid h-auto w-full gap-2 rounded-lg border border-border bg-muted p-1 lg:grid-cols-3">
            {TAB_CONFIG.map((t) => {
              const Icon = t.icon;
              const isLoading = t.id === 'audit'
                ? auditQuery.isLoading
                : t.id === 'shifts'
                  ? shiftQuery.isLoading
                  : adjQuery.isLoading;
              const count = t.id === 'audit'
                ? auditQuery.data?.length ?? 0
                : t.id === 'shifts'
                  ? shiftQuery.data?.length ?? 0
                  : adjQuery.data?.length ?? 0;

              return (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="h-auto items-start justify-start gap-3 rounded-md px-3 py-3 text-left data-[state=active]:bg-[var(--surface-1)] data-[state=active]:shadow-sm"
                >
                  <span className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg border',
                    t.variant === 'info' && 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
                    t.variant === 'success' && 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
                    t.variant === 'warning' && 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
                  )}>
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{t.label}</span>
                      <StatusBadge
                        label={isLoading ? 'โหลดอยู่' : `${count.toLocaleString('th-TH')} รายการ`}
                        variant={isLoading ? 'neutral' : t.variant}
                      />
                    </span>
                    <span className="block text-xs font-normal leading-5 text-muted-foreground">{t.description}</span>
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="audit" className="mt-0">
            <DataCard
              title="บันทึกการกระทำ"
              subtitle="เวลา ผู้ใช้ การกระทำ entity และ metadata จาก audit log"
              noPadding
            >
              {auditQuery.isLoading
                ? <TableLoadingSkeleton cols={5} />
                : <AuditTable rows={auditQuery.data ?? []} />
              }
            </DataCard>
          </TabsContent>

          <TabsContent value="shifts" className="mt-0">
            <DataCard
              title="รอบแคชเชียร์"
              subtitle="ยอดเปิดรอบ ยอดคาดหวัง ยอดนับจริง ผลต่าง และสถานะรอบ"
              noPadding
            >
              {shiftQuery.isLoading
                ? <TableLoadingSkeleton cols={9} />
                : <ShiftTable rows={shiftQuery.data ?? []} />
              }
            </DataCard>
          </TabsContent>

          <TabsContent value="adjustments" className="mt-0">
            <DataCard
              title="การปรับปรุงชำระเงิน"
              subtitle="การแก้ไขหลังปิดรอบ เหตุผล และ snapshot payment rows ก่อนการกระทำ"
              noPadding
            >
              {adjQuery.isLoading
                ? <TableLoadingSkeleton cols={8} />
                : <AdjustmentsTable rows={adjQuery.data ?? []} />
              }
            </DataCard>
          </TabsContent>
        </Tabs>
      </section>
    </AppShell>
  );
}
