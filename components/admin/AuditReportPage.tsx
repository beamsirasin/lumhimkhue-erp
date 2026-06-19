'use client';

import { useState, Fragment } from 'react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ClipboardList, Clock, AlertCircle } from 'lucide-react';
import {
  getAuditReport,
  getShiftReport,
  getPaymentAdjustmentsReport,
  type AuditAction,
  type AuditReportRow,
  type ShiftReportRow,
} from '@/lib/actions/history';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

function AuditStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE_MAP[status];
  if (!cfg) return <StatusBadge label={status} variant="neutral" />;
  return <StatusBadge label={cfg.label} variant={cfg.variant} />;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

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
    <div className="flex flex-wrap gap-4 items-end">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground font-normal">ตั้งแต่</Label>
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground font-normal">ถึง</Label>
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground font-normal">ประเภทการกระทำ</Label>
        <select
          value={filters.action ?? ''}
          onChange={(e) =>
            onChange({ ...filters, action: (e.target.value as AuditAction) || undefined })
          }
          className="h-8 w-56 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="text-xs text-muted-foreground font-medium">เวลา</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">ผู้ใช้</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">การกระทำ</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">ตาราง</TableHead>
          <TableHead className="text-xs text-muted-foreground font-medium">รายละเอียด</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(r.createdAt)}</TableCell>
            <TableCell className="whitespace-nowrap">{r.userName ?? r.userId?.slice(0, 8)}</TableCell>
            <TableCell className="whitespace-nowrap">{AUDIT_ACTION_LABELS[r.action as AuditAction] ?? r.action}</TableCell>
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
        <TableRow className="bg-muted/40 hover:bg-muted/40">
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
          <TableRow key={r.id}>
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
        <TableRow className="bg-muted/40 hover:bg-muted/40">
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
            <TableRow>
              <TableCell className="pr-1">
                <button
                  type="button"
                  aria-label="ดูรายละเอียด"
                  aria-expanded={expandedId === r.id}
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="rounded p-0.5 hover:bg-muted text-muted-foreground"
                >
                  {expandedId === r.id
                    ? <ChevronUp className="size-3.5" />
                    : <ChevronDown className="size-3.5" />
                  }
                </button>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(r.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap">{r.requesterName ?? r.requestedBy?.slice(0, 8)}</TableCell>
              <TableCell className="whitespace-nowrap">{mutationActionLabel(r)}</TableCell>
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
              <TableRow className="bg-muted/20 hover:bg-muted/20">
                <TableCell colSpan={9} className="px-6 py-3">
                  <div className="space-y-3 text-xs">
                    {/* Action context */}
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
                    {/* Payment rows snapshot — kept as raw table (nested detail, not a primary data table) */}
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

const TAB_CONFIG: { id: Tab; label: string }[] = [
  { id: 'audit',       label: 'บันทึกการกระทำ'    },
  { id: 'shifts',      label: 'รอบแคชเชียร์'      },
  { id: 'adjustments', label: 'การปรับปรุงชำระเงิน' },
];

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
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="รายงานตรวจสอบ"
        subtitle="บันทึกการกระทำ · รอบแคชเชียร์ · การปรับปรุงชำระเงิน"
      />

      <DataCard>
        <FilterBar filters={filters} onChange={setFilters} />
      </DataCard>

      <Tabs
        value={tab}
        onValueChange={(v) => { if (typeof v === 'string' && v) setTab(v as Tab); }}
        className="gap-0"
      >
        <TabsList
          variant="line"
          className="w-full justify-start rounded-none border-b border-border px-0 h-auto"
        >
          {TAB_CONFIG.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="px-4 py-2.5 h-auto rounded-none">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="audit" className="mt-4">
          <DataCard noPadding>
            {auditQuery.isLoading
              ? <TableLoadingSkeleton cols={5} />
              : <AuditTable rows={auditQuery.data ?? []} />
            }
          </DataCard>
        </TabsContent>

        <TabsContent value="shifts" className="mt-4">
          <DataCard noPadding>
            {shiftQuery.isLoading
              ? <TableLoadingSkeleton cols={9} />
              : <ShiftTable rows={shiftQuery.data ?? []} />
            }
          </DataCard>
        </TabsContent>

        <TabsContent value="adjustments" className="mt-4">
          <DataCard noPadding>
            {adjQuery.isLoading
              ? <TableLoadingSkeleton cols={8} />
              : <AdjustmentsTable rows={adjQuery.data ?? []} />
            }
          </DataCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
