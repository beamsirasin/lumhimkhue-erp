'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { getQueueStatus, cancelQueueByToken } from '@/lib/actions/queue';
import type { QueueStatusData } from '@/lib/actions/queue';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  waiting: {
    heading: 'กำลังรอคิว',
    color: 'text-[var(--status-warning-fg)]',
    bg: 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)]',
    dot: 'bg-[var(--status-warning-fg)]',
    halo: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border-[var(--status-warning-border)]',
    Icon: Clock3,
    pulse: true,
  },
  waiting_suitable_table: {
    heading: 'รอโต๊ะที่เหมาะสม',
    color: 'text-[var(--status-orange-fg)]',
    bg: 'bg-[var(--status-orange-bg)] border-[var(--status-orange-border)]',
    dot: 'bg-[var(--status-orange-fg)]',
    halo: 'bg-[var(--status-orange-bg)] text-[var(--status-orange-fg)] border-[var(--status-orange-border)]',
    Icon: Clock3,
    pulse: true,
  },
  called: {
    heading: 'ถึงคิวของคุณแล้ว!',
    color: 'text-[var(--status-info-fg)]',
    bg: 'bg-[var(--status-info-bg)] border-[var(--status-info-border)]',
    dot: 'bg-[var(--status-info-fg)]',
    halo: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
    Icon: BellRing,
    pulse: true,
  },
  seated: {
    heading: 'รับเข้าแล้ว',
    color: 'text-[var(--status-success-fg)]',
    bg: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
    dot: 'bg-[var(--status-success-fg)]',
    halo: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
    Icon: CheckCircle2,
    pulse: false,
  },
  admitted: {
    heading: 'รับเข้าแล้ว',
    color: 'text-[var(--status-success-fg)]',
    bg: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
    dot: 'bg-[var(--status-success-fg)]',
    halo: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
    Icon: CheckCircle2,
    pulse: false,
  },
  admitted_billed: {
    heading: 'ออกบิลแล้ว',
    color: 'text-[var(--status-success-fg)]',
    bg: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
    dot: 'bg-[var(--status-success-fg)]',
    halo: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
    Icon: CheckCircle2,
    pulse: false,
  },
  left: {
    heading: 'ออกจากคิวแล้ว',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    dot: 'bg-muted-foreground/50',
    halo: 'bg-muted/50 text-muted-foreground border-border',
    Icon: XCircle,
    pulse: false,
  },
  skipped: {
    heading: 'ข้ามคิว',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    dot: 'bg-muted-foreground/50',
    halo: 'bg-muted/50 text-muted-foreground border-border',
    Icon: XCircle,
    pulse: false,
  },
  cancelled: {
    heading: 'ยกเลิกแล้ว',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    dot: 'bg-muted-foreground/50',
    halo: 'bg-muted/50 text-muted-foreground border-border',
    Icon: XCircle,
    pulse: false,
  },
} as const;

// Customer-facing: full Thai labels only, not staff shorthand
const SOUP_CHIP_STYLE: Record<string, string> = {
  'น้ำดำ':  'border-foreground/40 bg-foreground text-background',
  'น้ำใส':  'border-border bg-background text-foreground',
  'หมาล่า': 'border-[var(--status-danger-border)] bg-[var(--status-danger-fg)] text-white',
};

interface QueueStatusProps {
  token: string;
  initialData: QueueStatusData;
}

export function QueueStatus({ token, initialData }: QueueStatusProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ['queue-status', token],
    queryFn: () => getQueueStatus(token).then((r) => (r.ok ? r.data : null)),
    initialData,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  async function handleCancel() {
    setCancelling(true);
    const result = await cancelQueueByToken(token);
    setCancelling(false);
    if (!result.ok) {
      toast.error(result.error);
      setShowCancelConfirm(false);
      return;
    }
    setCancelled(true);
    setShowCancelConfirm(false);
    void refetch();
    toast.success('ยกเลิกคิวสำเร็จ');
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground">
            <XCircle className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">ไม่พบข้อมูลคิว</p>
          <p className="mt-1 text-xs text-muted-foreground">กรุณาตรวจสอบลิงก์อีกครั้ง</p>
        </div>
      </div>
    );
  }

  const { entry, position, latestCalledQueueNumber } = data;

  const displayStatusKey = (
    entry.status === 'admitted' && !!entry.billIssued ? 'admitted_billed' : entry.status
  ) as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[displayStatusKey] ?? STATUS_CONFIG.waiting;
  const StatusIcon = cfg.Icon;

  const canCancel =
    !cancelled &&
    (entry.status === 'waiting' || entry.status === 'waiting_suitable_table');
  const isActiveWaiting =
    entry.status === 'waiting' || entry.status === 'waiting_suitable_table';

  const adultCount = entry.adultCount ?? 0;
  const childCount = entry.childCount ?? 0;
  const hasAdultChild = adultCount + childCount > 0;
  const partySize = hasAdultChild ? adultCount + childCount : (entry.partySize ?? 0);

  const isFirst = position === 1;
  const aheadCount = position > 1 ? position - 1 : 0;

  const hasSoups =
    Array.isArray(entry.soupPots) &&
    (entry.soupPots as Array<{ soups: string[] }>).some(
      (p) => Array.isArray(p.soups) && p.soups.length > 0,
    );

  const showName = !!entry.customerName && entry.customerName !== '-';

  // Date + time: "22 มิ.ย. 2026 • 21:20 น."
  const registeredAt = format(
    new Date(entry.createdAt),
    "d MMM yyyy '•' HH:mm 'น.'",
    { locale: th },
  );

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-3">
      <main className="mx-auto flex w-full max-w-sm flex-col gap-3">

        {/* 1. Brand header */}
        <header className="flex items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-[var(--shadow-card)]">
          <div className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-[var(--surface-1)]">
            <Image
              src="/images/logo.png"
              alt="Lum Him Khue"
              width={36}
              height={36}
              className="object-cover"
            />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">
              ลำฮิมคือ ชาบู บุฟเฟต์
            </h1>
            <p className="text-[10px] text-muted-foreground">ระบบแสดงสถานะคิว</p>
          </div>
        </header>

        {/* 2. Queue hero — icon+status left, big number right */}
        <section className={cn('rounded-2xl border-2 p-4 shadow-[var(--shadow-dialog)]', cfg.bg)}>
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-xl border-2',
                  cfg.halo,
                )}
              >
                <StatusIcon className={cn('size-5', cfg.pulse && 'animate-pulse')} />
              </div>
              <div className="flex max-w-[5.5rem] items-center gap-1">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    cfg.dot,
                    cfg.pulse && 'animate-pulse',
                  )}
                />
                <p className={cn('text-center text-xs font-semibold leading-snug', cfg.color)}>
                  {cfg.heading}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-end">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                คิวของคุณ
              </p>
              <p className={cn('text-7xl font-black leading-none tabular-nums', cfg.color)}>
                {entry.queueNumber}
              </p>
            </div>
          </div>
        </section>

        {/* 3. Position stat cards — side-by-side, waiting only */}
        {isActiveWaiting && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <div
                className={cn(
                  'flex flex-col items-center justify-center rounded-xl border p-3 text-center',
                  isFirst
                    ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]'
                    : 'border-border bg-card shadow-[var(--shadow-card)]',
                )}
              >
                {isFirst ? (
                  <>
                    <p className="text-sm font-bold text-[var(--status-warning-fg)]">กลุ่มแรก!</p>
                    <p className="text-[10px] text-muted-foreground">เตรียมพร้อม</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-muted-foreground">เหลืออีก</p>
                    <p className="text-3xl font-black tabular-nums text-foreground">{aheadCount}</p>
                    <p className="text-[10px] text-muted-foreground">คิวก่อนหน้า</p>
                  </>
                )}
              </div>
              <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card p-3 text-center shadow-[var(--shadow-card)]">
                <p className="text-[10px] text-muted-foreground">เรียกล่าสุด</p>
                <p className="text-2xl font-black tabular-nums text-foreground">
                  {latestCalledQueueNumber ?? '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <RefreshCw className="size-3" />
              <span>อัปเดตอัตโนมัติทุก 10 วินาที</span>
            </div>
          </div>
        )}

        {/* 4. Details summary — soft card, no table borders */}
        <section className="rounded-2xl border border-border bg-card p-3.5 shadow-[var(--shadow-card)]">
          <div className="space-y-2.5">

            {showName && (
              <div className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-xs text-muted-foreground">ชื่อ</span>
                <span className="text-right text-sm font-medium text-foreground">
                  {entry.customerName}
                </span>
              </div>
            )}

            {/* People count as chips — child omitted when 0 */}
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-xs text-muted-foreground">ผู้เข้าร่วม</span>
              <div className="flex flex-wrap justify-end gap-1">
                {hasAdultChild ? (
                  <>
                    <CountChip label={`ผู้ใหญ่ ${adultCount} คน`} />
                    {childCount > 0 && <CountChip label={`เด็ก ${childCount} คน`} />}
                  </>
                ) : (
                  <CountChip label={`${partySize} คน`} />
                )}
              </div>
            </div>

            {/* Soup chips — hidden when no soups */}
            {hasSoups && (
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">น้ำซุป</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <CustomerSoupChips pots={entry.soupPots} />
                </div>
              </div>
            )}

            {/* Date + time */}
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-xs text-muted-foreground">ลงทะเบียน</span>
              <span className="text-right text-xs font-medium text-foreground">{registeredAt}</span>
            </div>

          </div>
        </section>

        {/* Refresh note — called status only (no stat cards above for this state) */}
        {entry.status === 'called' && (
          <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
            <RefreshCw className="size-3" />
            <span>อัปเดตอัตโนมัติทุก 10 วินาที</span>
          </div>
        )}

        {/* 5. Cancel — logic and token security unchanged */}
        {canCancel && (
          <section>
            {!showCancelConfirm ? (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="w-full rounded-xl border border-border bg-card py-2.5 text-center text-sm font-medium text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:border-[var(--status-danger-border)] hover:text-[var(--status-danger-fg)]"
              >
                ยกเลิกคิวของฉัน
              </button>
            ) : (
              <div className="rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3">
                <p className="mb-2.5 text-sm font-semibold text-[var(--status-danger-fg)]">
                  ยืนยันยกเลิกคิว?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex min-h-9 flex-1 items-center justify-center rounded-lg border border-border bg-card text-sm font-medium text-foreground"
                  >
                    ไม่ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-fg)] text-sm font-medium text-white disabled:opacity-60"
                  >
                    {cancelling && <Loader2 className="size-3.5 animate-spin" />}
                    ยืนยันยกเลิก
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Policy note */}
        <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
          การเรียกคิวขึ้นอยู่กับลำดับและโต๊ะว่าง ร้านอาจเรียกคิวที่นั่งได้ก่อนหากโต๊ะว่างเหมาะสมกว่า
        </p>

      </main>
    </div>
  );
}

function CountChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-[var(--surface-1)] px-2 py-0.5 text-xs font-medium text-foreground">
      {label}
    </span>
  );
}

function CustomerSoupChips({ pots }: { pots: unknown }) {
  if (!Array.isArray(pots) || pots.length === 0) return null;
  const typedPots = pots as Array<{ soups: string[] }>;

  const chips: Array<{ label: string; style: string; key: string }> = [];
  typedPots.forEach((pot, pi) => {
    if (!Array.isArray(pot.soups) || pot.soups.length === 0) return;
    const soups = pot.soups;
    if (soups.length === 2 && soups[0] === soups[1]) {
      const style = SOUP_CHIP_STYLE[soups[0]] ?? 'border-border bg-muted text-foreground';
      chips.push({ label: `${soups[0]} ×2`, style, key: `${pi}-dup` });
    } else {
      soups.forEach((soup, si) => {
        const style = SOUP_CHIP_STYLE[soup] ?? 'border-border bg-muted text-foreground';
        chips.push({ label: soup, style, key: `${pi}-${si}` });
      });
    }
  });

  if (chips.length === 0) return null;

  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
            chip.style,
          )}
        >
          {chip.label}
        </span>
      ))}
    </>
  );
}
