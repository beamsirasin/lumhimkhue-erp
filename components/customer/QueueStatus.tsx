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
  Info,
  Loader2,
  XCircle,
} from 'lucide-react';
import { getQueueStatus, cancelQueueByToken } from '@/lib/actions/queue';
import type { QueueStatusData } from '@/lib/actions/queue';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  waiting: {
    heading: 'กำลังรอคิว',
    sub: null,
    color: 'text-[var(--status-warning-fg)]',
    bg: 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)]',
    band: 'bg-[var(--status-warning-bg)]',
    dot: 'bg-[var(--status-warning-fg)]',
    halo: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border-[var(--status-warning-border)]',
    Icon: Clock3,
    pulse: true,
  },
  waiting_suitable_table: {
    heading: 'รอโต๊ะที่เหมาะสม',
    sub: 'กำลังรอโต๊ะขนาดที่เหมาะกับกลุ่มของคุณว่าง',
    color: 'text-[var(--status-orange-fg)]',
    bg: 'bg-[var(--status-orange-bg)] border-[var(--status-orange-border)]',
    band: 'bg-[var(--status-orange-bg)]',
    dot: 'bg-[var(--status-orange-fg)]',
    halo: 'bg-[var(--status-orange-bg)] text-[var(--status-orange-fg)] border-[var(--status-orange-border)]',
    Icon: Clock3,
    pulse: true,
  },
  called: {
    heading: 'ถึงคิวของคุณแล้ว!',
    sub: 'โปรดแสดงหน้านี้กับพนักงานหน้าร้าน',
    color: 'text-[var(--status-info-fg)]',
    bg: 'bg-[var(--status-info-bg)] border-[var(--status-info-border)]',
    band: 'bg-[var(--status-info-bg)]',
    dot: 'bg-[var(--status-info-fg)]',
    halo: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
    Icon: BellRing,
    pulse: true,
  },
  seated: {
    heading: 'รับเข้าแล้ว',
    sub: 'ขอให้อร่อยกับมื้อนี้',
    color: 'text-[var(--status-success-fg)]',
    bg: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
    band: 'bg-[var(--status-success-bg)]',
    dot: 'bg-[var(--status-success-fg)]',
    halo: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
    Icon: CheckCircle2,
    pulse: false,
  },
  admitted: {
    heading: 'รับเข้าแล้ว',
    sub: 'ขอให้อร่อยกับมื้อนี้',
    color: 'text-[var(--status-success-fg)]',
    bg: 'bg-[var(--status-success-bg)] border-[var(--status-success-border)]',
    band: 'bg-[var(--status-success-bg)]',
    dot: 'bg-[var(--status-success-fg)]',
    halo: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
    Icon: CheckCircle2,
    pulse: false,
  },
  left: {
    heading: 'ออกจากคิวแล้ว',
    sub: 'ติดต่อพนักงานหน้าร้านหากต้องการเข้าคิวอีกครั้ง',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    band: 'bg-muted/40',
    dot: 'bg-muted-foreground/50',
    halo: 'bg-muted/50 text-muted-foreground border-border',
    Icon: XCircle,
    pulse: false,
  },
  skipped: {
    heading: 'ข้ามคิว',
    sub: 'ติดต่อพนักงานหน้าร้านหากต้องการเข้าคิวอีกครั้ง',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    band: 'bg-muted/40',
    dot: 'bg-muted-foreground/50',
    halo: 'bg-muted/50 text-muted-foreground border-border',
    Icon: XCircle,
    pulse: false,
  },
  cancelled: {
    heading: 'ยกเลิกแล้ว',
    sub: 'คิวนี้ถูกยกเลิกแล้ว — สแกน QR ใหม่หากต้องการเข้าคิวอีกครั้ง',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border',
    band: 'bg-muted/40',
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

/* Light page backdrop; the perforation notches reuse the exact same opaque
   color so they read as cut-outs from the ticket card. */
const PAGE_BG = 'bg-[var(--surface-0)]';
const NOTCH_BG = 'bg-[var(--surface-0)]';

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
    // Adaptive polling: near-realtime while the status can still change,
    // relaxed once the queue is admitted/terminal (staff can still revert,
    // so never stop entirely).
    refetchInterval: (query) => {
      const status = query.state.data?.entry.status;
      if (status === 'waiting' || status === 'waiting_suitable_table' || status === 'called') {
        return 3_000;
      }
      return 15_000;
    },
    staleTime: 2_000,
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
      <div className={cn('flex min-h-dvh items-center justify-center px-6', PAGE_BG)}>
        <div className="w-full max-w-[420px] rounded-3xl bg-card p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground">
            <XCircle className="size-6" />
          </div>
          <p className="text-base font-semibold text-foreground">ไม่พบข้อมูลคิว</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            ลิงก์อาจหมดอายุหรือไม่ถูกต้อง กรุณาสแกน QR จากตั๋วคิวอีกครั้ง
          </p>
        </div>
      </div>
    );
  }

  const { entry, position, latestCalledQueueNumber } = data;

  // Customer-facing: billing progress is internal — a billed queue displays
  // exactly the same as an admitted one (รับเข้าแล้ว).
  const cfg = STATUS_CONFIG[entry.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.waiting;
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
    <div className={cn('flex min-h-dvh flex-col items-center px-4 py-5 sm:justify-center sm:py-8', PAGE_BG)}>
      <main className="flex w-full max-w-[420px] flex-col gap-4">

        {/* 1. Brand header */}
        <header className="flex items-center gap-2.5 px-1">
          <div className="relative shrink-0 overflow-hidden rounded-xl border border-border bg-card">
            <Image
              src="/images/logo.png"
              alt="Lum Him Khue"
              width={38}
              height={38}
              className="object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold text-foreground">
              ลำฮิมคือ ชาบู บุฟเฟต์
            </h1>
            <p className="text-[11px] text-muted-foreground">ระบบเช็คสถานะคิว</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            อัปเดตอัตโนมัติ
          </div>
        </header>

        {/* 2. The ticket — one card: status band → number → stats → perforation → details */}
        <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-dialog)]">

          {/* Status band + number */}
          <div className={cn('px-5 pb-7 pt-6 text-center', cfg.band)}>
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-[13px] font-bold shadow-[var(--shadow-card)]', cfg.halo, 'bg-card')}>
              <StatusIcon className={cn('size-4', cfg.pulse && 'animate-pulse')} />
              {cfg.heading}
            </span>
            <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
              คิวของคุณ
            </p>
            <p className={cn('mt-1.5 text-[64px] font-black leading-none tabular-nums', cfg.color)}>
              {entry.queueNumber}
            </p>
            {cfg.sub && (
              <p className={cn('mt-3.5 text-[13px] font-medium leading-relaxed', cfg.color)}>
                {cfg.sub}
              </p>
            )}
          </div>

          {/* Position stats — waiting only, inside the ticket */}
          {isActiveWaiting && (
            <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
              <div className="flex min-h-16 flex-col items-center justify-center gap-0.5 px-3 py-2.5 text-center">
                {isFirst ? (
                  <>
                    <p className="text-sm font-bold text-[var(--status-warning-fg)]">กลุ่มแรก!</p>
                    <p className="text-[11px] text-muted-foreground">เตรียมพร้อมเข้าโต๊ะ</p>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground">เหลืออีก</p>
                    <p className="text-xl font-black leading-tight tabular-nums text-foreground">
                      {aheadCount} <span className="text-[11px] font-medium text-muted-foreground">คิว</span>
                    </p>
                  </>
                )}
              </div>
              <div className="flex min-h-16 flex-col items-center justify-center gap-0.5 px-3 py-2.5 text-center">
                <p className="text-[11px] text-muted-foreground">เรียกล่าสุด</p>
                {latestCalledQueueNumber ? (
                  <p className="text-xl font-black leading-tight tabular-nums text-foreground">
                    {latestCalledQueueNumber}
                  </p>
                ) : (
                  <p className="py-0.5 text-sm font-semibold leading-tight text-muted-foreground/60">
                    ยังไม่มีการเรียก
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Perforation — notches cut from the page backdrop + dashed tear line */}
          <div className="relative py-1">
            <div className={cn('absolute -left-3.5 top-1/2 size-7 -translate-y-1/2 rounded-full border border-border', NOTCH_BG)} />
            <div className={cn('absolute -right-3.5 top-1/2 size-7 -translate-y-1/2 rounded-full border border-border', NOTCH_BG)} />
            <div className="mx-6 border-t-2 border-dashed border-border" />
          </div>

          {/* Details — bottom stub of the ticket */}
          <div className="space-y-4 px-5 pb-6 pt-5">

            {showName && (
              <div className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-[13px] text-muted-foreground">ชื่อ</span>
                <span className="text-right text-sm font-medium text-foreground">
                  {entry.customerName}
                </span>
              </div>
            )}

            {/* People count as chips — child omitted when 0 */}
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-[13px] text-muted-foreground">ผู้เข้าร่วม</span>
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
                <span className="shrink-0 pt-0.5 text-[13px] text-muted-foreground">น้ำซุป</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <CustomerSoupChips pots={entry.soupPots} />
                </div>
              </div>
            )}

            {/* Date + time */}
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-[13px] text-muted-foreground">ลงทะเบียน</span>
              <span className="text-right text-sm font-medium tabular-nums text-foreground">{registeredAt}</span>
            </div>

          </div>
        </section>

        {/* 3. Important notice — queue order + kitchen closing */}
        <div className="rounded-2xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3.5">
          <div className="flex items-center gap-1.5">
            <Info className="size-4 shrink-0 text-[var(--status-warning-fg)]" />
            <p className="text-[13px] font-bold text-[var(--status-warning-fg)]">ข้อมูลสำคัญ</p>
          </div>
          <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-[var(--status-warning-fg)]">
            <p>การเรียกคิวขึ้นอยู่กับลำดับและโต๊ะว่าง ร้านอาจเรียกคิวที่นั่งได้ก่อนหากมีโต๊ะว่างเหมาะสมกว่า</p>
            <p>
              <span className="font-bold">ครัวปิด 22:15 น.</span>{' '}
              ร้านไม่จำกัดเวลาทาน หากคิวจำนวนมากอาจรับคิวไม่ทันก่อนครัวปิด โปรดพิจารณาการรอคิว
            </p>
          </div>
        </div>

        {/* 4. Cancel — quiet secondary action; logic unchanged */}
        {canCancel && (
          <section>
            {!showCancelConfirm ? (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-border bg-card text-[13px] font-medium text-muted-foreground transition-colors hover:border-[var(--status-danger-border)] hover:text-[var(--status-danger-fg)]"
              >
                ยกเลิกคิวของฉัน
              </button>
            ) : (
              <div className="rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3">
                <p className="mb-2 text-center text-sm font-semibold text-[var(--status-danger-fg)]">
                  ยืนยันยกเลิกคิว?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm font-medium text-foreground"
                  >
                    ไม่ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-fg)] text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {cancelling && <Loader2 className="size-3.5 animate-spin" />}
                    ยืนยันยกเลิก
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

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
    // Duplicates render as two separate chips ("น้ำใส น้ำใส"), never "×2".
    pot.soups.forEach((soup, si) => {
      const style = SOUP_CHIP_STYLE[soup] ?? 'border-border bg-muted text-foreground';
      chips.push({ label: soup, style, key: `${pi}-${si}` });
    });
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
