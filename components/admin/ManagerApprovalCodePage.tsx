'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, ShieldAlert, RotateCcw, Plus, Copy, Check, Clock, ReceiptText } from 'lucide-react';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { StatusBadge, type BadgeVariant } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import {
  getManagerApprovalCodeState,
  generateManagerApprovalCode,
  revokeManagerApprovalCode,
} from '@/lib/actions/manager-approval';
import { formatThaiDateTime } from '@/lib/date-time';

type StateResult = Awaited<ReturnType<typeof getManagerApprovalCodeState>>;
type StateData = Extract<StateResult, { ok: true }>['data'];
type HistoryRow = StateData['history'][number];

const STATUS_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  active: { label: 'ใช้งานอยู่', variant: 'success' },
  used: { label: 'ใช้แล้ว', variant: 'neutral' },
  expired: { label: 'หมดอายุ', variant: 'warning' },
  revoked: { label: 'ยกเลิกแล้ว', variant: 'danger' },
};

/** Thai labels for the sensitive actions a code can be redeemed against. */
const ACTION_LABELS: Record<string, string> = {
  pos_saved_guest_count_edit: 'แก้ไขจำนวนผู้เข้าใช้ที่บันทึกแล้ว',
  pos_payment_delete: 'ลบรายการชำระเงิน',
  pos_payment_reopen: 'เปิดบิลที่ชำระแล้วอีกครั้ง',
};

function formatDateTime(d: Date | string) {
  return formatThaiDateTime(d);
}

function formatCountdown(ms: number) {
  if (ms <= 0) return 'หมดอายุ';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m} นาที ${s.toString().padStart(2, '0')} วินาที`;
}

function useCountdown(expiresAt: Date | string | null | undefined, active: boolean) {
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0,
  );
  useEffect(() => {
    if (!expiresAt || !active) return;
    const tick = () => setRemainingMs(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, active]);
  return remainingMs;
}

/** "ใครใช้ / ยกเลิกโดยใคร + เมื่อไหร่" summary for a history row. */
function usageInfo(row: HistoryRow): { who: string; when: string } | null {
  if (row.usedAt) return { who: row.usedByName ?? '—', when: formatDateTime(row.usedAt) };
  if (row.revokedAt) return { who: `ยกเลิกโดย ${row.revokedByName ?? '—'}`, when: formatDateTime(row.revokedAt) };
  return null;
}

function actionLabel(row: HistoryRow): string | null {
  if (!row.usedForAction) return null;
  return ACTION_LABELS[row.usedForAction] ?? row.usedForAction;
}

/** "ใช้ทำอะไร" cell — links to the actual bill in /pos/history when resolvable. */
function ActionCell({ row }: { row: HistoryRow }) {
  const action = actionLabel(row);
  if (!action) return <span className="text-muted-foreground">—</span>;
  if (!row.target) return <>{action}</>;
  return (
    <Link
      href={`/pos/history?date=${row.target.date}&session=${row.target.sessionId}`}
      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
    >
      <ReceiptText className="size-3.5 shrink-0" />
      {action}
    </Link>
  );
}

export function ManagerApprovalCodePage({ initialData }: { initialData: StateData }) {
  const queryClient = useQueryClient();
  const { openConfirm, dialog } = useConfirm();
  const [freshCode, setFreshCode] = useState<{ id: string; code: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data = initialData } = useQuery({
    queryKey: ['manager-approval-code'],
    queryFn: () => getManagerApprovalCodeState().then((r) => (r.ok ? r.data : initialData)),
    initialData,
  });

  const active = data.activeCode;
  const isActiveStatus = active?.status === 'active';
  const remainingMs = useCountdown(active?.expiresAt ?? null, !!isActiveStatus);
  const showFreshCode = !!freshCode && !!active && freshCode.id === active.id;

  async function handleGenerate() {
    setGenerating(true);
    const result = await generateManagerApprovalCode();
    setGenerating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setFreshCode({ id: result.data.id, code: result.data.code });
    setCopied(false);
    toast.success('สร้างรหัสอนุมัติใหม่แล้ว');
    queryClient.invalidateQueries({ queryKey: ['manager-approval-code'] });
  }

  function confirmGenerate() {
    if (active && isActiveStatus) {
      openConfirm(
        'การสร้างรหัสใหม่จะยกเลิกรหัสปัจจุบันทันที ต้องการดำเนินการต่อหรือไม่?',
        handleGenerate,
        { confirmLabel: 'สร้างรหัสใหม่', variant: 'default' },
      );
    } else {
      handleGenerate();
    }
  }

  function confirmRevoke() {
    if (!active) return;
    openConfirm(
      'ยกเลิกรหัสอนุมัติปัจจุบัน? แคชเชียร์จะไม่สามารถใช้รหัสนี้ได้อีก',
      async () => {
        setRevoking(true);
        const result = await revokeManagerApprovalCode({ codeId: active.id });
        setRevoking(false);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setFreshCode(null);
        toast.success('ยกเลิกรหัสแล้ว');
        queryClient.invalidateQueries({ queryKey: ['manager-approval-code'] });
      },
      { confirmLabel: 'ยกเลิกรหัส', variant: 'danger' },
    );
  }

  async function handleCopy() {
    if (!freshCode) return;
    try {
      await navigator.clipboard.writeText(freshCode.code);
      setCopied(true);
      toast.success('คัดลอกรหัสแล้ว');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('คัดลอกไม่สำเร็จ — กรุณาจดรหัสด้วยตนเอง');
    }
  }

  const statusCfg = active ? (STATUS_LABELS[active.status] ?? STATUS_LABELS.expired) : null;

  return (
    <AppShell>
      <PageHeader title="รหัสอนุมัติ" subtitle="ใช้สำหรับอนุมัติการแก้ไขรายการสำคัญของแคชเชียร์" />

      <DataCard title="รหัสปัจจุบัน">
        {!active ? (
          <div className="mx-auto max-w-md space-y-5 py-2 text-center">
            <EmptyState
              icon={<KeyRound className="size-6" />}
              title="ยังไม่มีรหัสอนุมัติที่ใช้งานอยู่"
              description="กดสร้างรหัสใหม่เพื่อเริ่มใช้งาน"
            />
            <Button size="lg" className="w-full sm:w-auto sm:px-10" onClick={confirmGenerate} disabled={generating}>
              <Plus /> สร้างรหัสใหม่
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {/* Status + countdown — centered */}
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {statusCfg && <StatusBadge label={statusCfg.label} variant={statusCfg.variant} dot size="md" />}
              {isActiveStatus && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 py-1 text-sm tabular-nums text-muted-foreground">
                  <Clock className="size-3.5" />
                  หมดอายุใน {formatCountdown(remainingMs)}
                </span>
              )}
            </div>

            {/* Code display — centered, shown once at generation */}
            {showFreshCode ? (
              <div className="rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-6 text-center sm:px-6">
                <p className="mb-3 text-xs text-[var(--status-success-fg)]">
                  รหัสที่สร้างล่าสุด (แสดงครั้งเดียว — จดไว้ก่อนออกจากหน้านี้)
                </p>
                <p className="select-all font-mono text-4xl font-bold tracking-[0.3em] text-[var(--status-success-fg)] sm:text-5xl sm:tracking-[0.4em]">
                  {freshCode.code}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="mt-4 border-[var(--status-success-border)] bg-transparent text-[var(--status-success-fg)] hover:bg-[var(--status-success-bg)] hover:text-[var(--status-success-fg)]"
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'}
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-[var(--surface-2)] px-4 py-6 text-center sm:px-6">
                <p className="font-mono text-4xl font-bold tracking-[0.3em] text-muted-foreground/50 sm:text-5xl sm:tracking-[0.4em]">
                  ••••••
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  รหัสแสดงเพียงครั้งเดียวตอนสร้าง — หากไม่ได้จดไว้ ให้สร้างรหัสใหม่
                </p>
              </div>
            )}

            {/* Meta — responsive grid */}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-center text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">สร้างโดย</dt>
                <dd className="mt-0.5 font-medium text-foreground">{active.generatedByName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">สร้างเมื่อ</dt>
                <dd className="mt-0.5 font-medium text-foreground">{formatDateTime(active.generatedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">หมดอายุเมื่อ</dt>
                <dd className="mt-0.5 font-medium text-foreground">{formatDateTime(active.expiresAt)}</dd>
              </div>
            </dl>

            {/* Actions — prominent, full-width on mobile */}
            <div className="flex flex-col-reverse gap-2.5 border-t border-border pt-5 sm:flex-row sm:justify-center sm:gap-3">
              <Button
                size="lg"
                variant="outline"
                onClick={confirmRevoke}
                disabled={!isActiveStatus || revoking}
                className="w-full text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)] sm:w-auto"
              >
                <RotateCcw /> ยกเลิกรหัสปัจจุบัน
              </Button>
              <Button size="lg" onClick={confirmGenerate} disabled={generating} className="w-full sm:w-auto sm:px-8">
                <Plus /> สร้างรหัสใหม่
              </Button>
            </div>
          </div>
        )}
      </DataCard>

      <div className="flex items-start gap-3 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3">
        <ShieldAlert className="size-5 shrink-0 text-[var(--status-warning-fg)]" />
        <p className="text-sm text-[var(--status-warning-fg)]">
          รหัสนี้ใช้สำหรับอนุมัติการแก้ไขรายการสำคัญ ห้ามส่งให้พนักงานเก็บไว้ถาวร
          และรหัสจะหมดอายุหลังใช้งานหรือครบ 1 ชั่วโมง
        </p>
      </div>

      <DataCard title="ประวัติการใช้งานล่าสุด" noPadding>
        {data.history.length === 0 ? (
          <div className="p-5">
            <EmptyState title="ยังไม่มีประวัติ" size="sm" />
          </div>
        ) : (
          <>
            {/* Tablet / desktop — table */}
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>สร้างโดย</TableHead>
                    <TableHead>ใช้งานโดย</TableHead>
                    <TableHead>ใช้ทำอะไร</TableHead>
                    <TableHead>หมดอายุเมื่อ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.history.map((row) => {
                    const cfg = STATUS_LABELS[row.status] ?? STATUS_LABELS.expired;
                    const usage = usageInfo(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <StatusBadge label={cfg.label} variant={cfg.variant} dot />
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{row.generatedByName ?? '—'}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(row.generatedAt)}</p>
                        </TableCell>
                        <TableCell>
                          {usage ? (
                            <>
                              <p className="font-medium text-foreground">{usage.who}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{usage.when}</p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ActionCell row={row} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(row.expiresAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile — stacked cards */}
            <div className="divide-y divide-border md:hidden">
              {data.history.map((row) => {
                const cfg = STATUS_LABELS[row.status] ?? STATUS_LABELS.expired;
                const usage = usageInfo(row);
                return (
                  <div key={row.id} className="space-y-2 px-4 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge label={cfg.label} variant={cfg.variant} dot />
                      {actionLabel(row) && (
                        <span className="min-w-0 truncate text-xs">
                          <ActionCell row={row} />
                        </span>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">สร้างโดย</dt>
                        <dd className="text-foreground">{row.generatedByName ?? '—'}</dd>
                        <dd className="text-xs text-muted-foreground">{formatDateTime(row.generatedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">ใช้งานโดย</dt>
                        {usage ? (
                          <>
                            <dd className="text-foreground">{usage.who}</dd>
                            <dd className="text-xs text-muted-foreground">{usage.when}</dd>
                          </>
                        ) : (
                          <dd className="text-muted-foreground">—</dd>
                        )}
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-muted-foreground">หมดอายุเมื่อ</dt>
                        <dd className="text-foreground">{formatDateTime(row.expiresAt)}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DataCard>

      {dialog}
    </AppShell>
  );
}
